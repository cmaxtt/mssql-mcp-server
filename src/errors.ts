/**
 * Public error vocabulary for MCP tool results.
 *
 * These codes are returned in tool result `isError: true` responses so clients
 * can handle known failure modes programmatically. Internal error details (stack
 * traces, raw SQL errors, connection strings) are NEVER exposed — they go only
 * to the structured logger.
 */

export const ErrorCode = {
  /** The database server is unreachable or the pool is exhausted. */
  DATABASE_UNAVAILABLE: "DATABASE_UNAVAILABLE",
  /** The requested table, view, procedure, or other object was not found. */
  OBJECT_NOT_FOUND: "OBJECT_NOT_FOUND",
  /** The configured SQL principal lacks required permissions. */
  PERMISSION_DENIED: "PERMISSION_DENIED",
  /** The submitted query was rejected by the application-side validator. */
  QUERY_REJECTED: "QUERY_REJECTED",
  /** The query exceeded the configured time limit. */
  QUERY_TIMEOUT: "QUERY_TIMEOUT",
  /** The query result exceeded the configured row or byte limit. */
  RESULT_TOO_LARGE: "RESULT_TOO_LARGE",
  /** An unexpected internal error occurred. Details are logged server-side. */
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/**
 * Sanitized tool error returned to MCP clients.
 *
 * Never includes stack traces, raw SQL errors, connection strings, or passwords.
 */
export interface ToolError {
  code: ErrorCode;
  message: string;
  /** Server-side correlation ID for traceability. */
  correlationId?: string;
}

/**
 * Classify a raw mssql/tedious error into our public vocabulary.
 */
export function classifyDatabaseError(err: unknown): ToolError {
  if (err instanceof Error) {
    const msg = err.message || "";

    // Connection / pool errors
    if (
      msg.includes("Connection is closed") ||
      msg.includes("Connection lost") ||
      msg.includes("connect ETIMEDOUT") ||
      msg.includes("connect ECONNREFUSED") ||
      msg.includes("Failed to connect") ||
      msg.includes("Connection pool is closed") ||
      msg.includes("timeout")
    ) {
      return {
        code: ErrorCode.DATABASE_UNAVAILABLE,
        message: "Database is unavailable. Check connectivity and retry.",
      };
    }

    // Permission errors
    if (
      msg.includes("permission") ||
      msg.includes("Permission") ||
      msg.includes("denied") ||
      msg.includes("access") ||
      msg.includes("Access")
    ) {
      return {
        code: ErrorCode.PERMISSION_DENIED,
        message: "Insufficient permissions to perform this operation.",
      };
    }

    // Object not found
    if (
      msg.includes("Invalid object name") ||
      msg.includes("Could not find") ||
      msg.includes("not found") ||
      msg.includes("does not exist")
    ) {
      return {
        code: ErrorCode.OBJECT_NOT_FOUND,
        message: "The requested database object was not found.",
      };
    }

    // Query timeout
    if (msg.includes("Timeout") || msg.includes("timeout")) {
      return {
        code: ErrorCode.QUERY_TIMEOUT,
        message: "The query timed out. Try a narrower query or increase the timeout.",
      };
    }
  }

  // Fallback: unexpected internal error
  return {
    code: ErrorCode.INTERNAL_ERROR,
    message: "An unexpected internal error occurred.",
  };
}

/**
 * Create a structured error result for an MCP tool response.
 */
export function errorResult(
  code: ErrorCode,
  message: string,
  correlationId?: string
): { isError: true; content: { type: "text"; text: string }[]; structuredContent: ToolError } {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify({ error: { code, message, correlationId } }, null, 2),
      },
    ],
    structuredContent: { code, message, correlationId },
  };
}
