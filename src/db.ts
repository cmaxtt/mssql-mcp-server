import sql from "mssql";
import type pino from "pino";
import type { ConnectionConfig, TlsConfig, TimeoutConfig, PoolConfig, RetryConfig } from "./config.js";
import { getLogger } from "./logger.js";

let pool: sql.ConnectionPool | null = null;
let connectPromise: Promise<sql.ConnectionPool> | null = null;
let isShuttingDown = false;

export interface ConnectOptions {
  connection: ConnectionConfig;
  tls: TlsConfig;
  timeouts: TimeoutConfig;
  pool: PoolConfig;
  retry: RetryConfig;
}

// ── Transient error detection ──

/**
 * Error codes from tedious/mssql that indicate a transient (retryable) failure.
 * Network blips, DNS resolution, timeouts — not auth or config errors.
 */
const TRANSIENT_CODES = new Set([
  "ESOCKET",
  "ECONNRESET",
  "ETIMEOUT",
  "ESOCKETTIMEDOUT",
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
]);

function isTransientError(err: unknown): boolean {
  if (err instanceof Error) {
    const code = (err as any).code;
    if (code && TRANSIENT_CODES.has(code)) {
      return true;
    }
  }
  return false;
}

// ── Jitter ──

function jitter(delayMs: number): number {
  // ±20% jitter
  const factor = 0.8 + Math.random() * 0.4;
  return Math.round(delayMs * factor);
}

// ── Build mssql config ──

/**
 * Returns either a connection string (for connection-string mode) or a
 * standard mssql config object (for individual-field mode).
 */
function buildConfig(options: ConnectOptions): string | sql.config {
  const { connection, tls, timeouts, pool: poolCfg } = options;

  if (connection.useConnectionString && connection.connectionString) {
    // Connection string mode: pass the string directly to ConnectionPool constructor.
    // Pool and timeout options are set via separate properties after construction,
    // or we rely on the connection string itself for those settings.
    return connection.connectionString;
  }

  return {
    server: connection.server,
    port: connection.port,
    database: connection.database,
    user: connection.user,
    password: connection.password,
    pool: {
      max: poolCfg.max,
      min: poolCfg.min,
    },
    options: {
      encrypt: tls.encrypt,
      trustServerCertificate: tls.trustServerCertificate,
      connectTimeout: timeouts.connectMs,
      requestTimeout: timeouts.requestMs,
    },
    connectionTimeout: timeouts.connectMs,
    requestTimeout: timeouts.requestMs,
  };
}

// ── Public API ──

export async function connectToDatabase(
  options: ConnectOptions,
  log: pino.Logger = getLogger()
): Promise<sql.ConnectionPool> {
  // If already connecting, return the in-flight promise
  if (connectPromise) {
    log.debug("Connection already in progress, waiting");
    return connectPromise;
  }

  // If already connected, return existing pool
  if (pool && pool.connected) {
    log.debug("Already connected, reusing pool");
    return pool;
  }

  // Start new connection attempt
  connectPromise = doConnect(options, log);

  try {
    const result = await connectPromise;
    return result;
  } finally {
    connectPromise = null;
  }
}

async function doConnect(
  options: ConnectOptions,
  log: pino.Logger
): Promise<sql.ConnectionPool> {
  const { retry } = options;
  const config = buildConfig(options);

  const loggable = connectionStringFree(config);
  log.info({ config: loggable }, "Connecting to MSSQL");

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= retry.maxRetries + 1; attempt++) {
    try {
      const newPool = new sql.ConnectionPool(config);

      // Listen for pool-level errors (e.g., connection dropped after initial connect)
      newPool.on("error", (err: Error) => {
        log.error({ err, poolConnected: newPool.connected }, "Pool error event");
      });

      await newPool.connect();
      pool = newPool;

      log.info({ attempt, totalAttempts: attempt }, "Connected to MSSQL database");
      return newPool;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      const isTransient = isTransientError(lastError);

      if (!isTransient || attempt > retry.maxRetries) {
        // Non-transient error, or retries exhausted
        if (!isTransient) {
          log.error(
            { err: lastError, attempt },
            "Non-transient connection error — not retrying"
          );
        } else {
          log.error(
            { err: lastError, attempt, maxRetries: retry.maxRetries },
            "Connection failed after all retries"
          );
        }
        throw lastError;
      }

      // Transient — retry with backoff
      const baseDelay = Math.min(
        retry.baseDelayMs * Math.pow(2, attempt - 1),
        retry.maxDelayMs
      );
      const delay = jitter(baseDelay);

      log.warn(
        {
          err: lastError,
          attempt,
          nextAttempt: attempt + 1,
          delayMs: delay,
        },
        "Transient connection error — retrying"
      );

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // Shouldn't reach here, but TypeScript needs it
  throw lastError ?? new Error("Connection failed");
}

export async function getPool(): Promise<sql.ConnectionPool> {
  if (!pool || !pool.connected) {
    throw new Error("Database not connected");
  }
  return pool;
}

export async function closeDatabase() {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  const log = getLogger();

  // Cancel any in-flight connection attempt
  if (connectPromise) {
    log.info("Cancelling in-flight connection attempt");
    connectPromise = null;
  }

  if (pool) {
    log.info("Closing database pool");
    try {
      await pool.close();
    } catch (err) {
      log.error({ err }, "Error closing pool");
    }
    pool = null;
  }
}

// ── Helpers ──

function connectionStringFree(cfg: string | sql.config): Record<string, unknown> {
  if (typeof cfg === "string") {
    return { connectionString: "[redacted]" };
  }
  const { password, ...rest } = cfg as any;
  return rest;
}

/** Reset internal state (for testing only). */
export function _resetForTesting() {
  pool = null;
  connectPromise = null;
  isShuttingDown = false;
}
