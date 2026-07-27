/**
 * MCP tool result builders.
 *
 * Every tool response includes:
 *  - A text content block (JSON string, for broad client compatibility).
 *  - `structuredContent` (typed object, for clients that understand output schemas).
 *
 * Schema shapes are plain objects (not Zod) for SDK v1 compatibility.
 */

/**
 * An MCP content block.
 */
interface ContentBlock {
  type: "text";
  text: string;
}

/**
 * A complete tool response (matches MCP SDK v1 shape).
 */
export interface ToolResponse {
  content: ContentBlock[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

// ── Schema shapes (plain TS interfaces, not Zod) ──

export interface SchemasListResult {
  schemas: Array<{ name: string; schema_id: number }>;
}

export interface TablesListResult {
  tables: Array<{ TABLE_SCHEMA: string; TABLE_NAME: string; TABLE_TYPE: string }>;
  count: number;
}

export interface ColumnsResult {
  schema: string;
  table: string;
  columns: Array<{
    COLUMN_NAME: string;
    DATA_TYPE: string;
    CHARACTER_MAXIMUM_LENGTH: number | null;
    IS_NULLABLE: string;
    COLUMN_DEFAULT: string | null;
  }>;
  count: number;
}

export interface IndexesResult {
  schema: string;
  table: string;
  indexes: Array<{
    IndexName: string;
    IndexType: string;
    ColumnName: string;
    is_included_column: boolean;
    is_unique: boolean;
    is_primary_key: boolean;
  }>;
  count: number;
}

export interface ForeignKeysResult {
  schema: string;
  table: string;
  foreignKeys: Array<{
    ForeignKeyName: string;
    ParentTable: string;
    ParentColumn: string;
    ReferencedTable: string;
    ReferencedColumn: string;
  }>;
  count: number;
}

export interface DdlResult {
  schema: string;
  table: string;
  ddl: string;
}

export interface HealthResult {
  status: "healthy" | "degraded" | "unhealthy";
  database: string;
  server: string;
  latencyMs: number;
  uptimeSeconds: number;
}

// ── Builders ──

export function schemasResult(rows: Array<{ name: string; schema_id: number }>): ToolResponse {
  return {
    content: [{ type: "text", text: JSON.stringify(rows, null, 2) }],
    structuredContent: { schemas: rows } as Record<string, unknown>,
  };
}

export function tablesResult(rows: Array<{ TABLE_SCHEMA: string; TABLE_NAME: string; TABLE_TYPE: string }>): ToolResponse {
  return {
    content: [{ type: "text", text: JSON.stringify(rows, null, 2) }],
    structuredContent: { tables: rows, count: rows.length } as Record<string, unknown>,
  };
}

export function columnsResult(
  schema: string,
  table: string,
  rows: Array<{
    COLUMN_NAME: string;
    DATA_TYPE: string;
    CHARACTER_MAXIMUM_LENGTH: number | null;
    IS_NULLABLE: string;
    COLUMN_DEFAULT: string | null;
  }>
): ToolResponse {
  return {
    content: [{ type: "text", text: JSON.stringify(rows, null, 2) }],
    structuredContent: { schema, table, columns: rows, count: rows.length } as Record<string, unknown>,
  };
}

export function indexesResult(
  schema: string,
  table: string,
  rows: Array<{
    IndexName: string;
    IndexType: string;
    ColumnName: string;
    is_included_column: boolean;
    is_unique: boolean;
    is_primary_key: boolean;
  }>
): ToolResponse {
  return {
    content: [{ type: "text", text: JSON.stringify(rows, null, 2) }],
    structuredContent: { schema, table, indexes: rows, count: rows.length } as Record<string, unknown>,
  };
}

export function foreignKeysResult(
  schema: string,
  table: string,
  rows: Array<{
    ForeignKeyName: string;
    ParentTable: string;
    ParentColumn: string;
    ReferencedTable: string;
    ReferencedColumn: string;
  }>
): ToolResponse {
  return {
    content: [{ type: "text", text: JSON.stringify(rows, null, 2) }],
    structuredContent: { schema, table, foreignKeys: rows, count: rows.length } as Record<string, unknown>,
  };
}

export function ddlResult(schema: string, table: string, ddl: string): ToolResponse {
  return {
    content: [{ type: "text", text: ddl }],
    structuredContent: { schema, table, ddl } as Record<string, unknown>,
  };
}

export function healthResult(data: HealthResult): ToolResponse {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    structuredContent: data as unknown as Record<string, unknown>,
  };
}

export function jsonResult(data: unknown): ToolResponse {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    structuredContent: data as Record<string, unknown>,
  };
}

// ── Views ──

export interface ViewsListResult {
  views: Array<{ schema: string; name: string }>;
  count: number;
}

export function viewsListResult(rows: Array<{ schema: string; name: string }>): ToolResponse {
  return {
    content: [{ type: "text", text: JSON.stringify(rows, null, 2) }],
    structuredContent: { views: rows, count: rows.length } as Record<string, unknown>,
  };
}

export function viewDetailResult(detail: {
  schema: string;
  name: string;
  definition: string | null;
  isEncrypted: boolean;
  columns: Array<{
    name: string;
    typeName: string;
    maxLength: number | null;
    precision: number | null;
    scale: number | null;
    isNullable: boolean;
  }>;
}): ToolResponse {
  return {
    content: [{ type: "text", text: JSON.stringify(detail, null, 2) }],
    structuredContent: detail as unknown as Record<string, unknown>,
  };
}

// ── Procedures ──

export function proceduresListResult(rows: Array<{ schema: string; name: string }>): ToolResponse {
  return {
    content: [{ type: "text", text: JSON.stringify(rows, null, 2) }],
    structuredContent: { procedures: rows, count: rows.length } as Record<string, unknown>,
  };
}

export function procedureDetailResult(detail: {
  schema: string;
  name: string;
  definition: string | null;
  isEncrypted: boolean;
  parameters: Array<{
    name: string;
    typeName: string;
    maxLength: number | null;
    precision: number | null;
    scale: number | null;
    isOutput: boolean;
    isReadOnly: boolean;
    hasDefault: boolean;
    ordinal: number;
  }>;
}): ToolResponse {
  return {
    content: [{ type: "text", text: JSON.stringify(detail, null, 2) }],
    structuredContent: detail as unknown as Record<string, unknown>,
  };
}

// ── Correlation IDs ──

let correlationCounter = 0;

/**
 * Generate a unique correlation ID for a tool invocation.
 */
export function correlationId(): string {
  correlationCounter++;
  const ts = Date.now().toString(36);
  const count = correlationCounter.toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${ts}-${count}-${rand}`;
}
