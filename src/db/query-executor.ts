import sql from "mssql";
import type { ConnectionPool } from "mssql";
import type { QueryConfig, TimeoutConfig } from "../config.js";
import { childLogger } from "../logger.js";

const log = childLogger({ component: "query-executor" });

/** Concurrency limiter — only N queries can run at once. */
let activeQueries = 0;

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
  elapsedMs: number;
}

export interface QueryOptions {
  config: QueryConfig;
  timeouts: TimeoutConfig;
}

/**
 * Execute a read-only SELECT query with all configured limits.
 * The caller must validate the query before calling this function.
 */
export async function executeQuery(
  pool: ConnectionPool,
  query: string,
  options: QueryOptions
): Promise<QueryResult> {
  const { config, timeouts } = options;

  // Concurrency gate
  if (activeQueries >= config.maxConcurrency) {
    throw publicError(
      "DATABASE_UNAVAILABLE",
      "The query concurrency limit has been reached. Try again later."
    );
  }

  activeQueries++;
  const start = Date.now();

  try {
    const request = pool.request();
    const queryWithLimits = `
SET LOCK_TIMEOUT ${timeouts.lockMs};
SET ROWCOUNT ${config.maxRows + 1};
BEGIN TRY
  ${query}
  SET ROWCOUNT 0;
  SET LOCK_TIMEOUT -1;
END TRY
BEGIN CATCH
  SET ROWCOUNT 0;
  SET LOCK_TIMEOUT -1;
  THROW;
END CATCH;`;

    // Session-scoped settings and cleanup must run in the same SQL batch so a
    // pooled connection can never be returned with ROWCOUNT/LOCK_TIMEOUT set.
    const result = await request.query(queryWithLimits);

    const rows = result.recordset;
    const truncated = rows.length > config.maxRows;
    const limitedRows = truncated ? rows.slice(0, config.maxRows) : rows;

    // Normalize values
    const normalized = limitedRows.map((row: any) => normalizeRow(row));

    // Serialized size check
    const serialized = JSON.stringify(normalized);
    const bytes = Buffer.byteLength(serialized, "utf8");
    if (bytes > config.maxResultBytes) {
      throw publicError(
        "RESULT_TOO_LARGE",
        "The serialized query result exceeds the configured byte limit."
      );
    }

    return {
      columns: result.recordset.columns
        ? Object.keys(result.recordset.columns)
        : normalized.length > 0
        ? Object.keys(normalized[0])
        : [],
      rows: normalized,
      rowCount: normalized.length,
      truncated,
      elapsedMs: Date.now() - start,
    };
  } finally {
    activeQueries--;
  }
}

function publicError(code: string, message: string): Error {
  return Object.assign(new Error(message), { publicErrorCode: code });
}

/**
 * Normalize SQL Server values for safe JSON serialization.
 * - bigint → string (to preserve precision)
 * - Buffer → base64 string
 * - Date → ISO 8601 string
 * - High-precision decimal → string
 */
function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value === null || value === undefined) {
      out[key] = null;
    } else if (typeof value === "bigint") {
      out[key] = value.toString();
    } else if (Buffer.isBuffer(value)) {
      out[key] = value.toString("base64");
    } else if (value instanceof Date) {
      out[key] = value.toISOString();
    } else if (typeof value === "number" && !Number.isFinite(value)) {
      out[key] = null; // NaN, Infinity → null
    } else {
      out[key] = value;
    }
  }
  return out;
}
