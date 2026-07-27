import nodeSqlParser from "node-sql-parser";

/**
 * Fail-closed T-SQL query validator.
 *
 * Uses node-sql-parser with TransactSQL dialect as a secondary guard.
 * The PRIMARY protection is the SQL Server permission boundary (least-privilege
 * login). This validator is a defense-in-depth layer that rejects dangerous
 * queries before they reach the database.
 */

const parser = new nodeSqlParser.Parser();

/** SQL constructs that must never appear in an accepted query. */
const FORBIDDEN_AST_TYPES = new Set([
  "insert",
  "delete",
  "update",
  "drop",
  "alter",
  "truncate",
  "exec",
  "execute",
  "merge",
  "grant",
  "revoke",
  "create",
  "use",
  "replace",
]);

/** Function names that are blocked even inside a SELECT. */
const FORBIDDEN_FUNCTIONS = new Set([
  "OPENROWSET",
  "OPENQUERY",
  "OPENDATASOURCE",
  "xp_cmdshell",
  "sp_executesql",
]);

export interface ValidationResult {
  valid: boolean;
  error?: string;
  /** Normalized table references extracted from the AST. */
  tables?: Array<{ schema: string | null; table: string }>;
}

export interface ValidationOptions {
  /** Maximum input SQL text length in bytes. */
  maxTextBytes: number;
  /** Allowed schemas (comma-separated). Empty = all allowed. */
  allowedSchemas: string;
  /** Allowed tables (comma-separated). Empty = all allowed. */
  allowedTables: string;
}

/**
 * Validate a SQL query string. Returns `{ valid: true }` if the query is a
 * single, safe SELECT statement with no forbidden constructs.
 */
export function validateQuery(
  sql: string,
  options: ValidationOptions
): ValidationResult {
  // 1. Input size check
  if (Buffer.byteLength(sql, "utf8") > options.maxTextBytes) {
    return { valid: false, error: "Query text exceeds maximum allowed size." };
  }

  // 2. Parse the SQL
  let ast: any;
  try {
    ast = parser.astify(sql, { database: "TransactSQL" });
  } catch {
    return { valid: false, error: "Query could not be parsed. Only SELECT statements are allowed." };
  }

  // 3. Reject multiple statements
  if (Array.isArray(ast)) {
    return { valid: false, error: "Only one SQL statement is allowed." };
  }

  // 4. Must be a SELECT
  if (!ast || ast.type !== "select") {
    const type = ast?.type ?? "unknown";
    if (FORBIDDEN_AST_TYPES.has(type)) {
      return { valid: false, error: `${type.toUpperCase()} statements are not allowed.` };
    }
    return { valid: false, error: `Only SELECT statements are allowed (got ${type}).` };
  }

  // 5. Reject SELECT INTO (text-based check — parser doesn't flag it in AST)
  const sqlUpper = sql.toUpperCase();
  if (/\bINTO\b/.test(sqlUpper)) {
    return { valid: false, error: "SELECT INTO is not allowed." };
  }

  // 6. Reject forbidden functions (OPENROWSET, OPENQUERY, etc.)
  for (const fn of FORBIDDEN_FUNCTIONS) {
    if (sqlUpper.includes(fn.toUpperCase())) {
      return { valid: false, error: `${fn} is not allowed in queries.` };
    }
  }

  // 7. Extract table references for allowlist check
  const extracted = extractTables(ast);
  const tables = extracted.tables;
  if (extracted.hasMultiPartName) {
    return {
      valid: false,
      error: "Three- and four-part table names are not allowed.",
    };
  }
  const parsedSchemas = options.allowedSchemas
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const parsedTables = options.allowedTables
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

  if (parsedSchemas.length > 0) {
    for (const t of tables) {
      const schema = (t.schema || "dbo").toLowerCase();
      if (!parsedSchemas.includes(schema)) {
        return {
          valid: false,
          error: `Schema '${t.schema || "dbo"}' is not in the allowed schemas list.`,
        };
      }
    }
  }

  if (parsedTables.length > 0) {
    for (const t of tables) {
      if (!parsedTables.includes(t.table.toLowerCase())) {
        return {
          valid: false,
          error: `Table '${t.table}' is not in the allowed tables list.`,
        };
      }
    }
  }

  return { valid: true, tables };
}

/**
 * Extract table references from the AST.
 */
function extractTables(ast: any): {
  tables: Array<{ schema: string | null; table: string }>;
  hasMultiPartName: boolean;
} {
  const tables: Array<{ schema: string | null; table: string }> = [];
  const cteNames = new Set<string>();
  let hasMultiPartName = false;

  for (const cte of ast.with ?? []) {
    const name = cte?.name?.value;
    if (typeof name === "string") cteNames.add(name.toLowerCase());
  }

  function walk(node: any) {
    if (!node || typeof node !== "object") return;

    if (Array.isArray(node.from)) {
      for (const source of node.from) {
        if (typeof source?.table === "string" && !cteNames.has(source.table.toLowerCase())) {
          // TransactSQL AST uses `db` for schema.table and both `db` plus
          // `schema` for database.schema.table.
          if (source.db && source.schema) hasMultiPartName = true;
          tables.push({
            schema: source.schema || source.db || null,
            table: source.table,
          });
        }
      }
    }

    for (const key of Object.keys(node)) {
      const val = node[key];
      if (Array.isArray(val)) {
        for (const item of val) walk(item);
      } else if (val && typeof val === "object") {
        walk(val);
      }
    }
  }

  walk(ast);
  return { tables, hasMultiPartName };
}
