import type {
  TableMetadata,
  ColumnMeta,
  PrimaryKeyMeta,
  UniqueConstraintMeta,
  CheckConstraintMeta,
  ForeignKeyMeta,
  IndexMeta,
} from "../db/metadata-repository.js";

/**
 * Build a documentation-grade CREATE TABLE DDL statement from table metadata.
 *
 * This is a generated/documentation DDL — NOT a byte-perfect round-trip.
 * Unsupported features (temporal, memory-optimized, partitions, etc.) are
 * reported as warnings in the output header.
 */

export interface DdlOutput {
  ddl: string;
  warnings: string[];
}

export function buildDdl(meta: TableMetadata): DdlOutput {
  const warnings: string[] = [];
  const lines: string[] = [];

  // Header comment with warnings
  if (meta.unsupportedFeatures.length > 0) {
    lines.push("-- WARNING: The following features are present but not represented in this DDL:");
    for (const f of meta.unsupportedFeatures) {
      lines.push(`--   - ${f}`);
    }
    warnings.push(...meta.unsupportedFeatures);
  }
  lines.push("-- Generated documentation DDL — not a byte-perfect script");
  lines.push("");

  // Table header
  const schemaName = quoteIdentifier(meta.schema);
  const tableName = quoteIdentifier(meta.name);
  lines.push(`CREATE TABLE ${schemaName}.${tableName} (`);

  // Column definitions
  const colDefs: string[] = [];
  for (const col of meta.columns) {
    colDefs.push(buildColumnDef(col));
  }
  lines.push(colDefs.join(",\n"));

  // Primary key
  if (meta.primaryKey) {
    lines.push(buildPrimaryKey(meta.primaryKey));
  }

  // Unique constraints
  for (const uq of meta.uniqueConstraints) {
    lines.push(buildUniqueConstraint(uq));
  }

  // Check constraints
  for (const ck of meta.checkConstraints) {
    lines.push(buildCheckConstraint(ck));
  }

  // Foreign keys
  for (const fk of meta.foreignKeys) {
    lines.push(buildForeignKey(fk));
  }

  lines.push(");");
  lines.push("GO");
  lines.push("");

  // Non-constraint indexes as a separate section
  const nonConstraintIndexes = meta.indexes.filter((i) => !i.isConstraint);
  if (nonConstraintIndexes.length > 0) {
    lines.push("-- Non-constraint indexes");
    for (const idx of nonConstraintIndexes) {
      lines.push(buildIndex(idx, meta.schema, meta.name));
    }
    lines.push("");
  }

  return {
    ddl: lines.join("\n"),
    warnings,
  };
}

// ── Column definition ──

function buildColumnDef(col: ColumnMeta): string {
  const parts: string[] = [];
  parts.push(`    ${quoteIdentifier(col.name)}`);

  // Computed columns
  if (col.isComputed) {
    parts.push(` AS ${col.computedDefinition}`);
    if (col.isPersisted) {
      parts.push(" PERSISTED");
    }
    return parts.join("");
  }

  // Data type
  parts.push(` ${formatDataType(col)}`);

  // Identity
  if (col.isIdentity) {
    const seed = col.identitySeed ?? 1;
    const inc = col.identityIncrement ?? 1;
    parts.push(` IDENTITY(${seed},${inc})`);
  }

  // Nullability
  parts.push(col.isNullable ? " NULL" : " NOT NULL");

  // Default
  if (col.defaultDefinition && !col.isIdentity) {
    // Don't emit DEFAULT for identity columns
    parts.push(` CONSTRAINT ${quoteIdentifier(col.defaultName ?? `DF_${col.name}`)} DEFAULT ${col.defaultDefinition}`);
  }

  return parts.join("");
}

function formatDataType(col: ColumnMeta): string {
  let type = col.typeName;

  // Handle special cases
  const sysTypes: Record<string, string> = {
    varchar: "varchar",
    nvarchar: "nvarchar",
    char: "char",
    nchar: "nchar",
    varbinary: "varbinary",
    binary: "binary",
  };

  if (type in sysTypes) {
    // String/binary types
    if (col.maxLength === -1) {
      type += "(MAX)";
    } else if (col.maxLength && col.maxLength > 0) {
      // For nchar/nvarchar, maxLength is in bytes; divide by 2 for character length
      if (type.startsWith("n")) {
        type += `(${col.maxLength / 2})`;
      } else {
        type += `(${col.maxLength})`;
      }
    }
  } else if (type === "decimal" || type === "numeric") {
    const prec = col.precision ?? 18;
    const scale = col.scale ?? 0;
    type += `(${prec},${scale})`;
  } else if (type === "datetime2" || type === "datetimeoffset" || type === "time") {
    if (col.scale !== null && col.scale !== 7) {
      type += `(${col.scale})`;
    }
  }

  // Collation
  if (col.collation) {
    type += ` COLLATE ${col.collation}`;
  }

  return type;
}

// ── Constraints ──

function buildPrimaryKey(pk: PrimaryKeyMeta): string {
  const cols = pk.columns.map(quoteIdentifier).join(", ");
  const clustered = pk.isClustered ? "CLUSTERED" : "NONCLUSTERED";
  return `,    CONSTRAINT ${quoteIdentifier(pk.name)} PRIMARY KEY ${clustered} (${cols})`;
}

function buildUniqueConstraint(uq: UniqueConstraintMeta): string {
  const cols = uq.columns.map(quoteIdentifier).join(", ");
  const clustered = uq.isClustered ? "CLUSTERED" : "NONCLUSTERED";
  return `,    CONSTRAINT ${quoteIdentifier(uq.name)} UNIQUE ${clustered} (${cols})`;
}

function buildCheckConstraint(ck: CheckConstraintMeta): string {
  const suffix = !ck.isTrusted ? " -- NOT TRUSTED" : "";
  return `,    CONSTRAINT ${quoteIdentifier(ck.name)} CHECK ${ck.definition}${suffix}`;
}

function buildForeignKey(fk: ForeignKeyMeta): string {
  const cols = fk.columns.map(quoteIdentifier).join(", ");
  const refCols = fk.referencedColumns.map(quoteIdentifier).join(", ");
  const refTable = `${quoteIdentifier(fk.referencedSchema)}.${quoteIdentifier(fk.referencedTable)}`;
  let clause = `,    CONSTRAINT ${quoteIdentifier(fk.name)} FOREIGN KEY (${cols}) REFERENCES ${refTable} (${refCols})`;

  if (fk.onUpdate !== "NO_ACTION") {
    clause += ` ON UPDATE ${fk.onUpdate.replace("_", " ")}`;
  }
  if (fk.onDelete !== "NO_ACTION") {
    clause += ` ON DELETE ${fk.onDelete.replace("_", " ")}`;
  }
  if (!fk.isTrusted) {
    clause += " -- NOT TRUSTED";
  }

  return clause;
}

// ── Indexes ──

function buildIndex(idx: IndexMeta, schema: string, table: string): string {
  const parts: string[] = [];
  parts.push("CREATE");

  if (idx.isUnique) parts.push("UNIQUE");
  parts.push(idx.isClustered ? "CLUSTERED" : "NONCLUSTERED");
  parts.push("INDEX");
  parts.push(quoteIdentifier(idx.name));
  parts.push("ON");
  parts.push(`${quoteIdentifier(schema)}.${quoteIdentifier(table)}`);

  // Key columns
  const keyCols = idx.columns
    .map((c) => `${quoteIdentifier(c.name)} ${c.descending ? "DESC" : "ASC"}`)
    .join(", ");
  parts.push(`(${keyCols})`);

  // Included columns
  if (idx.includedColumns.length > 0) {
    const included = idx.includedColumns.map(quoteIdentifier).join(", ");
    parts.push(`INCLUDE (${included})`);
  }

  // Filter
  if (idx.filter) {
    parts.push(`WHERE ${idx.filter}`);
  }

  let ddl = parts.join(" ") + ";";

  if (idx.isDisabled) {
    ddl += " -- DISABLED";
  }

  return ddl;
}

// ── Helpers ──

export function quoteIdentifier(name: string): string {
  // Always use bracket quoting for SQL Server
  return `[${name.replace(/\]/g, "]]")}]`;
}
