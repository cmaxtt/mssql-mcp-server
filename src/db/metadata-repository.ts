import sql from "mssql";
import type { ConnectionPool } from "mssql";

/**
 * Complete table metadata for DDL generation.
 * All queries use sys.* catalog views for SQL Server-specific detail.
 * Result ordering is deterministic.
 */

export interface ColumnMeta {
  name: string;
  typeName: string;
  maxLength: number | null;
  precision: number | null;
  scale: number | null;
  collation: string | null;
  isNullable: boolean;
  isIdentity: boolean;
  identitySeed: number | null;
  identityIncrement: number | null;
  isComputed: boolean;
  computedDefinition: string | null;
  isPersisted: boolean;
  defaultDefinition: string | null;
  defaultName: string | null;
}

export interface PrimaryKeyMeta {
  name: string;
  columns: string[]; // ordered
  isClustered: boolean;
}

export interface UniqueConstraintMeta {
  name: string;
  columns: string[];
  isClustered: boolean;
}

export interface CheckConstraintMeta {
  name: string;
  definition: string;
  isTrusted: boolean;
  isDisabled: boolean;
}

export interface ForeignKeyMeta {
  name: string;
  columns: string[];
  referencedSchema: string;
  referencedTable: string;
  referencedColumns: string[];
  onUpdate: string;
  onDelete: string;
  isTrusted: boolean;
  isDisabled: boolean;
}

export interface IndexMeta {
  name: string;
  type: string;
  columns: { name: string; descending: boolean }[];
  includedColumns: string[];
  filter: string | null;
  isUnique: boolean;
  isClustered: boolean;
  isDisabled: boolean;
  /** True if this index is backing a constraint (PK or UQ) — we skip these in the index section */
  isConstraint: boolean;
}

export interface TableMetadata {
  schema: string;
  name: string;
  columns: ColumnMeta[];
  primaryKey: PrimaryKeyMeta | null;
  uniqueConstraints: UniqueConstraintMeta[];
  checkConstraints: CheckConstraintMeta[];
  foreignKeys: ForeignKeyMeta[];
  indexes: IndexMeta[];
  /** Features not expressed in the DDL output */
  unsupportedFeatures: string[];
}

// ── Queries ──

export async function getTableMetadata(
  pool: ConnectionPool,
  schema: string,
  table: string
): Promise<TableMetadata | null> {
  const request = pool.request();
  request.input("schema", sql.NVarChar, schema);
  request.input("table", sql.NVarChar, table);

  // Check table exists
  const tableCheck = await request.query(`
    SELECT 1 FROM sys.tables t
    INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = @schema AND t.name = @table
  `);
  if (tableCheck.recordset.length === 0) {
    return null;
  }

  const [columns, pk, uqs, cks, fks, indexes] = await Promise.all([
    getColumns(pool, schema, table),
    getPrimaryKey(pool, schema, table),
    getUniqueConstraints(pool, schema, table),
    getCheckConstraints(pool, schema, table),
    getForeignKeys(pool, schema, table),
    getIndexes(pool, schema, table),
  ]);

  const unsupportedFeatures = detectUnsupportedFeatures(columns, indexes);

  return {
    schema,
    name: table,
    columns,
    primaryKey: pk,
    uniqueConstraints: uqs,
    checkConstraints: cks,
    foreignKeys: fks,
    indexes,
    unsupportedFeatures,
  };
}

async function getColumns(
  pool: ConnectionPool,
  schema: string,
  table: string
): Promise<ColumnMeta[]> {
  const request = pool.request();
  request.input("schema", sql.NVarChar, schema);
  request.input("table", sql.NVarChar, table);

  const result = await request.query(`
    SELECT
      c.name AS columnName,
      tp.name AS typeName,
      c.max_length AS maxLength,
      c.precision,
      c.scale,
      c.collation_name AS collation,
      c.is_nullable AS isNullable,
      c.is_identity AS isIdentity,
      ISNULL(ic.seed_value, NULL) AS identitySeed,
      ISNULL(ic.increment_value, NULL) AS identityIncrement,
      c.is_computed AS isComputed,
      ISNULL(cc.definition, NULL) AS computedDefinition,
      ISNULL(cc.is_persisted, 0) AS isPersisted,
      ISNULL(dc.definition, NULL) AS defaultDefinition,
      dc.name AS defaultName
    FROM sys.columns c
    INNER JOIN sys.types tp ON c.user_type_id = tp.user_type_id
    INNER JOIN sys.tables t ON c.object_id = t.object_id
    INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
    LEFT JOIN sys.identity_columns ic ON c.object_id = ic.object_id AND c.column_id = ic.column_id
    LEFT JOIN sys.computed_columns cc ON c.object_id = cc.object_id AND c.column_id = cc.column_id
    LEFT JOIN sys.default_constraints dc ON c.default_object_id = dc.object_id
    WHERE s.name = @schema AND t.name = @table
    ORDER BY c.column_id
  `);

  return result.recordset.map((r: any) => ({
    name: r.columnName,
    typeName: r.typeName,
    maxLength: r.maxLength,
    precision: r.precision,
    scale: r.scale,
    collation: r.collation,
    isNullable: r.isNullable,
    isIdentity: r.isIdentity,
    identitySeed: r.identitySeed,
    identityIncrement: r.identityIncrement,
    isComputed: r.isComputed,
    computedDefinition: r.computedDefinition,
    isPersisted: r.isPersisted,
    defaultDefinition: r.defaultDefinition,
    defaultName: r.defaultName,
  }));
}

async function getPrimaryKey(
  pool: ConnectionPool,
  schema: string,
  table: string
): Promise<PrimaryKeyMeta | null> {
  const request = pool.request();
  request.input("schema", sql.NVarChar, schema);
  request.input("table", sql.NVarChar, table);

  const result = await request.query(`
    SELECT
      i.name AS constraintName,
      c.name AS columnName,
      i.type_desc AS indexType
    FROM sys.indexes i
    INNER JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
    INNER JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
    INNER JOIN sys.tables t ON i.object_id = t.object_id
    INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = @schema AND t.name = @table AND i.is_primary_key = 1
    ORDER BY ic.key_ordinal
  `);

  if (result.recordset.length === 0) return null;

  return {
    name: result.recordset[0].constraintName,
    columns: result.recordset.map((r: any) => r.columnName),
    isClustered: result.recordset[0].indexType === "CLUSTERED",
  };
}

async function getUniqueConstraints(
  pool: ConnectionPool,
  schema: string,
  table: string
): Promise<UniqueConstraintMeta[]> {
  const request = pool.request();
  request.input("schema", sql.NVarChar, schema);
  request.input("table", sql.NVarChar, table);

  const result = await request.query(`
    SELECT
      i.name AS constraintName,
      c.name AS columnName,
      i.type_desc AS indexType,
      ic.key_ordinal
    FROM sys.indexes i
    INNER JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
    INNER JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
    INNER JOIN sys.tables t ON i.object_id = t.object_id
    INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = @schema AND t.name = @table
      AND i.is_unique_constraint = 1
      AND i.is_primary_key = 0
    ORDER BY i.name, ic.key_ordinal
  `);

  const map = new Map<string, UniqueConstraintMeta>();
  for (const r of result.recordset as any[]) {
    if (!map.has(r.constraintName)) {
      map.set(r.constraintName, {
        name: r.constraintName,
        columns: [],
        isClustered: r.indexType === "CLUSTERED",
      });
    }
    map.get(r.constraintName)!.columns.push(r.columnName);
  }
  return [...map.values()];
}

async function getCheckConstraints(
  pool: ConnectionPool,
  schema: string,
  table: string
): Promise<CheckConstraintMeta[]> {
  const request = pool.request();
  request.input("schema", sql.NVarChar, schema);
  request.input("table", sql.NVarChar, table);

  const result = await request.query(`
    SELECT
      cc.name AS constraintName,
      cc.definition,
      cc.is_not_trusted AS isNotTrusted,
      cc.is_disabled AS isDisabled
    FROM sys.check_constraints cc
    INNER JOIN sys.tables t ON cc.parent_object_id = t.object_id
    INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = @schema AND t.name = @table
    ORDER BY cc.name
  `);

  return result.recordset.map((r: any) => ({
    name: r.constraintName,
    definition: r.definition,
    isTrusted: !r.isNotTrusted,
    isDisabled: r.isDisabled,
  }));
}

async function getForeignKeys(
  pool: ConnectionPool,
  schema: string,
  table: string
): Promise<ForeignKeyMeta[]> {
  const request = pool.request();
  request.input("schema", sql.NVarChar, schema);
  request.input("table", sql.NVarChar, table);

  const result = await request.query(`
    SELECT
      fk.name AS constraintName,
      cp.name AS columnName,
      rs.name AS referencedSchema,
      tr.name AS referencedTable,
      cr.name AS referencedColumn,
      fk.update_referential_action_desc AS onUpdate,
      fk.delete_referential_action_desc AS onDelete,
      fk.is_not_trusted AS isNotTrusted,
      fk.is_disabled AS isDisabled,
      fkc.constraint_column_id AS ordinal
    FROM sys.foreign_keys fk
    INNER JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id
    INNER JOIN sys.columns cp ON fkc.parent_object_id = cp.object_id AND fkc.parent_column_id = cp.column_id
    INNER JOIN sys.tables tr ON fkc.referenced_object_id = tr.object_id
    INNER JOIN sys.schemas rs ON tr.schema_id = rs.schema_id
    INNER JOIN sys.columns cr ON fkc.referenced_object_id = cr.object_id AND fkc.referenced_column_id = cr.column_id
    INNER JOIN sys.tables tp ON fkc.parent_object_id = tp.object_id
    INNER JOIN sys.schemas s ON tp.schema_id = s.schema_id
    WHERE s.name = @schema AND tp.name = @table
    ORDER BY fk.name, ordinal
  `);

  const map = new Map<string, ForeignKeyMeta>();
  for (const r of result.recordset as any[]) {
    if (!map.has(r.constraintName)) {
      map.set(r.constraintName, {
        name: r.constraintName,
        columns: [],
        referencedSchema: r.referencedSchema,
        referencedTable: r.referencedTable,
        referencedColumns: [],
        onUpdate: r.onUpdate,
        onDelete: r.onDelete,
        isTrusted: !r.isNotTrusted,
        isDisabled: r.isDisabled,
      });
    }
    const fk = map.get(r.constraintName)!;
    fk.columns.push(r.columnName);
    fk.referencedColumns.push(r.referencedColumn);
  }
  return [...map.values()];
}

async function getIndexes(
  pool: ConnectionPool,
  schema: string,
  table: string
): Promise<IndexMeta[]> {
  const request = pool.request();
  request.input("schema", sql.NVarChar, schema);
  request.input("table", sql.NVarChar, table);

  const result = await request.query(`
    SELECT
      i.name AS indexName,
      i.type_desc AS indexType,
      c.name AS columnName,
      ic.is_descending_key AS isDesc,
      ic.is_included_column AS isIncluded,
      i.is_unique,
      i.is_primary_key AS isPK,
      i.is_unique_constraint AS isUQ,
      i.has_filter AS hasFilter,
      i.filter_definition AS filterDefinition,
      i.is_disabled AS isDisabled,
      ic.key_ordinal,
      ic.index_column_id
    FROM sys.indexes i
    INNER JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
    INNER JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
    INNER JOIN sys.tables t ON i.object_id = t.object_id
    INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = @schema AND t.name = @table
      AND i.type > 0  -- skip heap
    ORDER BY i.name, ic.key_ordinal, ic.index_column_id
  `);

  const map = new Map<string, IndexMeta>();
  for (const r of result.recordset as any[]) {
    if (!map.has(r.indexName)) {
      map.set(r.indexName, {
        name: r.indexName,
        type: r.indexType,
        columns: [],
        includedColumns: [],
        filter: r.filterDefinition ?? null,
        isUnique: r.is_unique,
        isClustered: r.indexType === "CLUSTERED",
        isDisabled: r.isDisabled,
        isConstraint: r.isPK || r.isUQ,
      });
    }
    const idx = map.get(r.indexName)!;
    if (r.isIncluded) {
      idx.includedColumns.push(r.columnName);
    } else {
      idx.columns.push({ name: r.columnName, descending: r.isDesc });
    }
  }
  return [...map.values()];
}

function detectUnsupportedFeatures(
  columns: ColumnMeta[],
  indexes: IndexMeta[]
): string[] {
  const features: string[] = [];

  // Check for temporal tables — would need to query sys.tables.temporal_type
  // Check for memory-optimized — sys.tables.is_memory_optimized
  // These are placeholders for future enhancement

  return features;
}

// ── Simple queries (used by existing tools) ──

export async function listSchemas(pool: ConnectionPool) {
  const result = await pool.request().query(
    "SELECT name, schema_id FROM sys.schemas ORDER BY name"
  );
  return result.recordset;
}

export async function listTables(pool: ConnectionPool, schema?: string) {
  const request = pool.request();
  let query =
    "SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE FROM INFORMATION_SCHEMA.TABLES";
  if (schema) {
    query += " WHERE TABLE_SCHEMA = @schema";
    request.input("schema", sql.NVarChar, schema);
  }
  query += " ORDER BY TABLE_SCHEMA, TABLE_NAME";
  const result = await request.query(query);
  return result.recordset;
}

export async function listColumns(
  pool: ConnectionPool,
  schema: string,
  table: string
) {
  const request = pool.request();
  request.input("schema", sql.NVarChar, schema);
  request.input("table", sql.NVarChar, table);
  const result = await request.query(`
    SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE, COLUMN_DEFAULT
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = @table
    ORDER BY ORDINAL_POSITION
  `);
  return result.recordset;
}

export async function listIndexesSimple(
  pool: ConnectionPool,
  schema: string,
  table: string
) {
  const request = pool.request();
  request.input("schema", sql.NVarChar, schema);
  request.input("table", sql.NVarChar, table);
  const result = await request.query(`
    SELECT
      i.name AS IndexName, i.type_desc AS IndexType, c.name AS ColumnName,
      ic.is_included_column, i.is_unique, i.is_primary_key
    FROM sys.indexes i
    INNER JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
    INNER JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
    INNER JOIN sys.tables t ON i.object_id = t.object_id
    INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = @schema AND t.name = @table
    ORDER BY i.name, ic.key_ordinal
  `);
  return result.recordset;
}

export async function listForeignKeysSimple(
  pool: ConnectionPool,
  schema: string,
  table: string
) {
  const request = pool.request();
  request.input("schema", sql.NVarChar, schema);
  request.input("table", sql.NVarChar, table);
  const result = await request.query(`
    SELECT
      fk.name AS ForeignKeyName, tp.name AS ParentTable, cp.name AS ParentColumn,
      tr.name AS ReferencedTable, cr.name AS ReferencedColumn
    FROM sys.foreign_keys fk
    INNER JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id
    INNER JOIN sys.tables tp ON fkc.parent_object_id = tp.object_id
    INNER JOIN sys.columns cp ON fkc.parent_object_id = cp.object_id AND fkc.parent_column_id = cp.column_id
    INNER JOIN sys.tables tr ON fkc.referenced_object_id = tr.object_id
    INNER JOIN sys.columns cr ON fkc.referenced_object_id = cr.object_id AND fkc.referenced_column_id = cr.column_id
    INNER JOIN sys.schemas s ON tp.schema_id = s.schema_id
    WHERE s.name = @schema AND tp.name = @table
    ORDER BY fk.name
  `);
  return result.recordset;
}

// ── Views ──

export interface ViewMeta {
  schema: string;
  name: string;
  definition: string | null;
  isEncrypted: boolean;
  columns: ViewColumnMeta[];
}

export interface ViewColumnMeta {
  name: string;
  typeName: string;
  maxLength: number | null;
  precision: number | null;
  scale: number | null;
  isNullable: boolean;
}

export async function listViews(
  pool: ConnectionPool,
  schema?: string
): Promise<Array<{ schema: string; name: string }>> {
  const request = pool.request();
  let query = `
    SELECT s.name AS [schema], v.name AS [name]
    FROM sys.views v
    INNER JOIN sys.schemas s ON v.schema_id = s.schema_id
  `;
  if (schema) {
    query += " WHERE s.name = @schema";
    request.input("schema", sql.NVarChar, schema);
  }
  query += " ORDER BY s.name, v.name";
  const result = await request.query(query);
  return result.recordset.map((r: any) => ({ schema: r.schema, name: r.name }));
}

export async function getViewDetail(
  pool: ConnectionPool,
  schema: string,
  name: string
): Promise<ViewMeta | null> {
  const request = pool.request();
  request.input("schema", sql.NVarChar, schema);
  request.input("name", sql.NVarChar, name);

  const viewResult = await request.query(`
    SELECT
      v.object_id,
      sm.definition,
      CAST(OBJECTPROPERTY(v.object_id, 'IsEncrypted') AS bit) AS isEncrypted
    FROM sys.views v
    INNER JOIN sys.schemas s ON v.schema_id = s.schema_id
    LEFT JOIN sys.sql_modules sm ON v.object_id = sm.object_id
    WHERE s.name = @schema AND v.name = @name
  `);

  if (viewResult.recordset.length === 0) return null;

  const viewRow = viewResult.recordset[0] as any;
  const objectId: number = viewRow.object_id;

  const colReq = pool.request();
  colReq.input("objectId", sql.Int, objectId);
  const colResult = await colReq.query(`
    SELECT
      c.name AS columnName,
      tp.name AS typeName,
      c.max_length AS maxLength,
      c.precision,
      c.scale,
      c.is_nullable AS isNullable
    FROM sys.columns c
    INNER JOIN sys.types tp ON c.user_type_id = tp.user_type_id
    WHERE c.object_id = @objectId
    ORDER BY c.column_id
  `);

  return {
    schema,
    name,
    definition: viewRow.isEncrypted ? null : (viewRow.definition ?? null),
    isEncrypted: viewRow.isEncrypted,
    columns: colResult.recordset.map((r: any) => ({
      name: r.columnName,
      typeName: r.typeName,
      maxLength: r.maxLength,
      precision: r.precision,
      scale: r.scale,
      isNullable: r.isNullable,
    })),
  };
}

// ── Stored Procedures ──

export interface ProcedureMeta {
  schema: string;
  name: string;
  definition: string | null;
  isEncrypted: boolean;
  parameters: ProcedureParamMeta[];
}

export interface ProcedureParamMeta {
  name: string;
  typeName: string;
  maxLength: number | null;
  precision: number | null;
  scale: number | null;
  isOutput: boolean;
  isReadOnly: boolean;
  hasDefault: boolean;
  ordinal: number;
}

export async function listProcedures(
  pool: ConnectionPool,
  schema?: string
): Promise<Array<{ schema: string; name: string }>> {
  const request = pool.request();
  let query = `
    SELECT s.name AS [schema], p.name AS [name]
    FROM sys.procedures p
    INNER JOIN sys.schemas s ON p.schema_id = s.schema_id
  `;
  if (schema) {
    query += " WHERE s.name = @schema";
    request.input("schema", sql.NVarChar, schema);
  }
  query += " ORDER BY s.name, p.name";
  const result = await request.query(query);
  return result.recordset.map((r: any) => ({ schema: r.schema, name: r.name }));
}

export async function getProcedureDetail(
  pool: ConnectionPool,
  schema: string,
  name: string
): Promise<ProcedureMeta | null> {
  const request = pool.request();
  request.input("schema", sql.NVarChar, schema);
  request.input("name", sql.NVarChar, name);

  const procResult = await request.query(`
    SELECT
      p.object_id,
      sm.definition,
      CAST(OBJECTPROPERTY(p.object_id, 'IsEncrypted') AS bit) AS isEncrypted
    FROM sys.procedures p
    INNER JOIN sys.schemas s ON p.schema_id = s.schema_id
    LEFT JOIN sys.sql_modules sm ON p.object_id = sm.object_id
    WHERE s.name = @schema AND p.name = @name
  `);

  if (procResult.recordset.length === 0) return null;

  const procRow = procResult.recordset[0] as any;
  const objectId: number = procRow.object_id;

  const paramReq = pool.request();
  paramReq.input("objectId", sql.Int, objectId);
  const paramResult = await paramReq.query(`
    SELECT
      p.name AS paramName,
      tp.name AS typeName,
      p.max_length AS maxLength,
      p.precision,
      p.scale,
      p.is_output AS isOutput,
      p.is_readonly AS isReadOnly,
      p.has_default_value AS hasDefault,
      p.parameter_id AS ordinal
    FROM sys.parameters p
    INNER JOIN sys.types tp ON p.user_type_id = tp.user_type_id
    WHERE p.object_id = @objectId
    ORDER BY p.parameter_id
  `);

  return {
    schema,
    name,
    definition: procRow.isEncrypted ? null : (procRow.definition ?? null),
    isEncrypted: procRow.isEncrypted,
    parameters: paramResult.recordset.map((r: any) => ({
      name: r.paramName,
      typeName: r.typeName,
      maxLength: r.maxLength,
      precision: r.precision,
      scale: r.scale,
      isOutput: r.isOutput,
      isReadOnly: r.isReadOnly,
      hasDefault: r.hasDefault,
      ordinal: r.ordinal,
    })),
  };
}
