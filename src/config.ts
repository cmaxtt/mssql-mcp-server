import { z } from "zod";

// ── Encryption / TLS ──
const tlsSettings = z.object({
  DB_ENCRYPT: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  DB_TRUST_SERVER_CERTIFICATE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

// ── Timeouts ──
const timeoutSettings = z.object({
  DB_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(1000).default(15000),
  DB_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30000),
  DB_LOCK_TIMEOUT_MS: z.coerce.number().int().min(100).default(5000),
});

// ── Retry ──
const retrySettings = z.object({
  DB_MAX_RETRIES: z.coerce.number().int().min(0).max(20).default(5),
  DB_RETRY_BASE_DELAY_MS: z.coerce.number().int().min(100).default(500),
  DB_RETRY_MAX_DELAY_MS: z.coerce.number().int().min(1000).default(10000),
});

// ── Pool ──
const poolSettings = z.object({
  DB_POOL_MIN: z.coerce.number().int().min(0).default(0),
  DB_POOL_MAX: z.coerce.number().int().min(1).default(10),
});

// ── Query execution ──
const querySettings = z.object({
  ENABLE_EXECUTE_QUERY: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  ALLOWED_SCHEMAS: z.string().default("dbo"),
  ALLOWED_TABLES: z.string().default(""),
  QUERY_MAX_ROWS: z.coerce.number().int().min(1).max(10000).default(100),
  QUERY_MAX_TEXT_BYTES: z.coerce.number().int().min(1024).default(32768),
  QUERY_MAX_RESULT_BYTES: z.coerce.number().int().min(1024).default(1048576),
  QUERY_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(2),
});

// ── Transport ──
const transportSettings = z.object({
  MCP_TRANSPORT: z.enum(["stdio", "http"]).default("stdio"),
  MCP_HTTP_HOST: z.string().default("127.0.0.1"),
  MCP_HTTP_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  MCP_HTTP_ALLOWED_ORIGINS: z.string().default(""),
  MCP_HTTP_BEARER_TOKEN: z.string().optional(),
  MCP_HTTP_BODY_LIMIT_BYTES: z.coerce.number().int().min(1024).default(1048576),
});

// ── Logging ──
const logSettings = z.object({
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  LOG_PRETTY: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

// ── Combined raw schema (all envs optional at this level) ──
const rawEnvSchema = z.object({
  // Connection — either connection string OR individual fields
  DB_CONNECTION_STRING: z.string().optional(),
  DB_HOST: z.string().optional(),
  DB_PORT: z.string().optional(),
  DB_INSTANCE: z.string().optional(),
  DB_NAME: z.string().optional(),
  DB_USER: z.string().optional(),
  DB_PASSWORD: z.string().optional(),
  // TLS
  DB_ENCRYPT: z.string().optional(),
  DB_TRUST_SERVER_CERTIFICATE: z.string().optional(),
  // Backward compat: old env var name
  DB_TRUST_CERT: z.string().optional(),
  // Timeouts
  DB_CONNECT_TIMEOUT_MS: z.string().optional(),
  DB_REQUEST_TIMEOUT_MS: z.string().optional(),
  DB_LOCK_TIMEOUT_MS: z.string().optional(),
  // Retry
  DB_MAX_RETRIES: z.string().optional(),
  DB_RETRY_BASE_DELAY_MS: z.string().optional(),
  DB_RETRY_MAX_DELAY_MS: z.string().optional(),
  // Pool
  DB_POOL_MIN: z.string().optional(),
  DB_POOL_MAX: z.string().optional(),
  // Query
  ENABLE_EXECUTE_QUERY: z.string().optional(),
  ALLOWED_SCHEMAS: z.string().optional(),
  ALLOWED_TABLES: z.string().optional(),
  QUERY_MAX_ROWS: z.string().optional(),
  QUERY_MAX_TEXT_BYTES: z.string().optional(),
  QUERY_MAX_RESULT_BYTES: z.string().optional(),
  QUERY_MAX_CONCURRENCY: z.string().optional(),
  // Transport
  MCP_TRANSPORT: z.string().optional(),
  MCP_HTTP_HOST: z.string().optional(),
  MCP_HTTP_PORT: z.string().optional(),
  MCP_HTTP_ALLOWED_ORIGINS: z.string().optional(),
  MCP_HTTP_BEARER_TOKEN: z.string().optional(),
  MCP_HTTP_BODY_LIMIT_BYTES: z.string().optional(),
  // Logging
  LOG_LEVEL: z.string().optional(),
  LOG_PRETTY: z.string().optional(),
});

// ── Parsed config type ──
export interface AppConfig {
  connection: ConnectionConfig;
  tls: TlsConfig;
  timeouts: TimeoutConfig;
  retry: RetryConfig;
  pool: PoolConfig;
  query: QueryConfig;
  transport: TransportConfig;
  log: LogConfig;
}

export interface ConnectionConfig {
  useConnectionString: boolean;
  connectionString?: string;
  host?: string;
  port: number;
  instance?: string;
  database: string;
  user: string;
  password: string;
  /** The `server` value passed to mssql (host\instance or host) */
  server: string;
}

export interface TlsConfig {
  encrypt: boolean;
  trustServerCertificate: boolean;
}

export interface TimeoutConfig {
  connectMs: number;
  requestMs: number;
  lockMs: number;
}

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export interface PoolConfig {
  min: number;
  max: number;
}

export interface QueryConfig {
  enabled: boolean;
  allowedSchemasRaw: string;
  allowedTablesRaw: string;
  maxRows: number;
  maxTextBytes: number;
  maxResultBytes: number;
  maxConcurrency: number;
}

export interface TransportConfig {
  mode: "stdio" | "http";
  httpHost: string;
  httpPort: number;
  allowedOrigins: string;
  bearerToken?: string;
  bodyLimitBytes: number;
}

export interface LogConfig {
  level: "fatal" | "error" | "warn" | "info" | "debug" | "trace";
  pretty: boolean;
}

// ── Parse function ──
export function parseConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  // Parse raw envs
  const raw = rawEnvSchema.parse(env);

  // Backward compat: DB_TRUST_CERT → DB_TRUST_SERVER_CERTIFICATE
  const trustCert = raw.DB_TRUST_SERVER_CERTIFICATE ?? raw.DB_TRUST_CERT;

  // Validate mutual exclusivity
  const hasConnString = !!raw.DB_CONNECTION_STRING;
  const hasIndividual =
    !!(raw.DB_HOST || raw.DB_USER || raw.DB_PASSWORD || raw.DB_NAME || raw.DB_INSTANCE);

  if (hasConnString && hasIndividual) {
    throw new Error(
      "DB_CONNECTION_STRING is mutually exclusive with DB_HOST/DB_USER/DB_PASSWORD/DB_NAME. " +
        "Use one or the other, not both."
    );
  }

  if (!hasConnString && !hasIndividual) {
    throw new Error(
      "Either DB_CONNECTION_STRING or DB_HOST/DB_USER/DB_PASSWORD/DB_NAME must be provided."
    );
  }

  // When using individual fields, DB_NAME, DB_USER, and DB_PASSWORD are all required
  if (hasIndividual && !hasConnString) {
    const missing: string[] = [];
    if (!raw.DB_NAME) missing.push("DB_NAME");
    if (!raw.DB_USER) missing.push("DB_USER");
    if (!raw.DB_PASSWORD) missing.push("DB_PASSWORD");
    if (missing.length > 0) {
      throw new Error(
        `When using individual connection settings, ${missing.join(", ")} must be provided.`
      );
    }
  }

  // Parse connection
  const connection: ConnectionConfig = hasConnString
    ? parseConnectionString(raw.DB_CONNECTION_STRING!)
    : parseIndividualConnection(
        raw.DB_HOST ?? "localhost",
        raw.DB_PORT ?? "1433",
        raw.DB_INSTANCE,
        raw.DB_NAME ?? "",
        raw.DB_USER ?? "",
        raw.DB_PASSWORD ?? ""
      );

  // TLS
  const tlsParsed = tlsSettings.parse({
    DB_ENCRYPT: raw.DB_ENCRYPT ?? "true",
    DB_TRUST_SERVER_CERTIFICATE: trustCert ?? "false",
  });
  const tls: TlsConfig = {
    encrypt: tlsParsed.DB_ENCRYPT,
    trustServerCertificate: tlsParsed.DB_TRUST_SERVER_CERTIFICATE,
  };

  // Timeouts — parse once
  const tParsed = timeoutSettings.parse({
    DB_CONNECT_TIMEOUT_MS: raw.DB_CONNECT_TIMEOUT_MS ?? "15000",
    DB_REQUEST_TIMEOUT_MS: raw.DB_REQUEST_TIMEOUT_MS ?? "30000",
    DB_LOCK_TIMEOUT_MS: raw.DB_LOCK_TIMEOUT_MS ?? "5000",
  });
  const timeouts: TimeoutConfig = {
    connectMs: tParsed.DB_CONNECT_TIMEOUT_MS,
    requestMs: tParsed.DB_REQUEST_TIMEOUT_MS,
    lockMs: tParsed.DB_LOCK_TIMEOUT_MS,
  };

  // Retry
  const retryParsed = retrySettings.parse({
    DB_MAX_RETRIES: raw.DB_MAX_RETRIES ?? "5",
    DB_RETRY_BASE_DELAY_MS: raw.DB_RETRY_BASE_DELAY_MS ?? "500",
    DB_RETRY_MAX_DELAY_MS: raw.DB_RETRY_MAX_DELAY_MS ?? "10000",
  });
  const retry: RetryConfig = {
    maxRetries: retryParsed.DB_MAX_RETRIES,
    baseDelayMs: retryParsed.DB_RETRY_BASE_DELAY_MS,
    maxDelayMs: retryParsed.DB_RETRY_MAX_DELAY_MS,
  };

  // Pool
  const poolParsed = poolSettings.parse({
    DB_POOL_MIN: raw.DB_POOL_MIN ?? "0",
    DB_POOL_MAX: raw.DB_POOL_MAX ?? "10",
  });
  const pool: PoolConfig = {
    min: poolParsed.DB_POOL_MIN,
    max: poolParsed.DB_POOL_MAX,
  };

  // Query
  const queryParsed = querySettings.parse({
    ENABLE_EXECUTE_QUERY: raw.ENABLE_EXECUTE_QUERY ?? "false",
    ALLOWED_SCHEMAS: raw.ALLOWED_SCHEMAS ?? "dbo",
    ALLOWED_TABLES: raw.ALLOWED_TABLES ?? "",
    QUERY_MAX_ROWS: raw.QUERY_MAX_ROWS ?? "100",
    QUERY_MAX_TEXT_BYTES: raw.QUERY_MAX_TEXT_BYTES ?? "32768",
    QUERY_MAX_RESULT_BYTES: raw.QUERY_MAX_RESULT_BYTES ?? "1048576",
    QUERY_MAX_CONCURRENCY: raw.QUERY_MAX_CONCURRENCY ?? "2",
  });
  const query: QueryConfig = {
    enabled: queryParsed.ENABLE_EXECUTE_QUERY,
    allowedSchemasRaw: queryParsed.ALLOWED_SCHEMAS,
    allowedTablesRaw: queryParsed.ALLOWED_TABLES,
    maxRows: queryParsed.QUERY_MAX_ROWS,
    maxTextBytes: queryParsed.QUERY_MAX_TEXT_BYTES,
    maxResultBytes: queryParsed.QUERY_MAX_RESULT_BYTES,
    maxConcurrency: queryParsed.QUERY_MAX_CONCURRENCY,
  };

  // Transport
  const transportParsed = transportSettings.parse({
    MCP_TRANSPORT: raw.MCP_TRANSPORT ?? "stdio",
    MCP_HTTP_HOST: raw.MCP_HTTP_HOST ?? "127.0.0.1",
    MCP_HTTP_PORT: raw.MCP_HTTP_PORT ?? "3000",
    MCP_HTTP_ALLOWED_ORIGINS: raw.MCP_HTTP_ALLOWED_ORIGINS ?? "",
    MCP_HTTP_BEARER_TOKEN: raw.MCP_HTTP_BEARER_TOKEN,
    MCP_HTTP_BODY_LIMIT_BYTES: raw.MCP_HTTP_BODY_LIMIT_BYTES ?? "1048576",
  });
  const transport: TransportConfig = {
    mode: transportParsed.MCP_TRANSPORT,
    httpHost: transportParsed.MCP_HTTP_HOST,
    httpPort: transportParsed.MCP_HTTP_PORT,
    allowedOrigins: transportParsed.MCP_HTTP_ALLOWED_ORIGINS,
    bearerToken: transportParsed.MCP_HTTP_BEARER_TOKEN,
    bodyLimitBytes: transportParsed.MCP_HTTP_BODY_LIMIT_BYTES,
  };

  // Log
  const logParsed = logSettings.parse({
    LOG_LEVEL: raw.LOG_LEVEL ?? "info",
    LOG_PRETTY: raw.LOG_PRETTY ?? "false",
  });
  const log: LogConfig = {
    level: logParsed.LOG_LEVEL,
    pretty: logParsed.LOG_PRETTY,
  };

  return { connection, tls, timeouts, retry, pool, query, transport, log };
}

// ── Helpers ──

function parseConnectionString(cs: string): ConnectionConfig {
  return {
    useConnectionString: true,
    connectionString: cs,
    database: "",
    user: "",
    password: "",
    server: cs, // opaque — mssql parses it
    port: 1433,
  };
}

function parseIndividualConnection(
  host: string,
  portStr: string,
  instance: string | undefined,
  database: string,
  user: string,
  password: string
): ConnectionConfig {
  const port = parseInt(portStr, 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid DB_PORT: ${portStr}`);
  }

  // Build server name: host\instance for named instances, host otherwise
  let server = host;
  if (instance) {
    server = `${host}\\${instance}`;
  }

  return {
    useConnectionString: false,
    host,
    port,
    instance,
    database,
    user,
    password,
    server,
  };
}

/**
 * Redacted view of config for logging. Never exposes passwords or connection strings.
 */
export function redactConfig(config: AppConfig): Record<string, unknown> {
  return {
    connection: config.connection.useConnectionString
      ? { useConnectionString: true, server: "[connection-string]" }
      : {
          useConnectionString: false,
          server: config.connection.server,
          port: config.connection.port,
          database: config.connection.database,
          user: config.connection.user,
          password: "***",
        },
    tls: config.tls,
    timeouts: config.timeouts,
    retry: config.retry,
    pool: config.pool,
    query: {
      ...config.query,
      // allowedSchemas and allowedTables are not secrets
    },
    transport: {
      ...config.transport,
      bearerToken: config.transport.bearerToken ? "***" : undefined,
    },
    log: config.log,
  };
}
