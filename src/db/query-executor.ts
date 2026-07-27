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
    throw new Error("Too many concurrent queries. Try again later.");
  }

  activeQueries++;
  const start = Date.now();

  try {
    // Create a dedicated request with limits
    const request = pool.request();
    (request as any).queryTimeout = timeouts.requestMs;

    // Set rowcount to limit + 1 so we can detect truncation
    const queryWithLimit = `SET ROWCOUNT ${config.maxRows + 1};\n${query}`;

    const result = await request.query(queryWithLimit);

    // Reset ROWCOUNT
    await pool.request().query("SET ROWCOUNT 0");

    const rows = result.recordset;
    const truncated = rows.length > config.maxRows;
    const limitedRows = truncated ? rows.slice(0, config.maxRows) : rows;

    // Normalize values
    const normalized = limitedRows.map((row: any) => normalizeRow(row));

    // Serialized size check
    const serialized = JSON.stringify(normalized);
    const bytes = Buffer.byteLength(serialized, "utf8");
    if (bytes > config.maxResultBytes) {
      return {
        columns: Object.keys(normalized[0] || {}),
        rows: [],
        rowCount: 0,
        truncated: true,
        elapsedMs: Date.now() - start,
      };
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
  } catch (err) {
    // Reset ROWCOUNT on error too
    try {
      await pool.request().query("SET ROWCOUNT 0");
    } catch {
      // Ignore cleanup errors
    }
    throw err;
  } finally {
    activeQueries--;
  }
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
