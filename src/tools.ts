import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getPool } from "./db.js";
import sql from "mssql";

export function registerTools(server: McpServer) {
    // list_schemas
    server.tool(
        "list_schemas",
        "List all database schemas",
        {},
        async () => {
            const pool = await getPool();
            const result = await pool.request().query(
                "SELECT name, schema_id FROM sys.schemas"
            );
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(result.recordset, null, 2),
                    },
                ],
            };
        }
    );

    // list_tables
    server.tool(
        "list_tables",
        "List tables in a specific schema (or all if not provided)",
        {
            schema: z.string().optional().describe("Schema name to filter by"),
        },
        async ({ schema }: { schema?: string }) => {
            const pool = await getPool();
            let query = "SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE FROM INFORMATION_SCHEMA.TABLES";
            const request = pool.request();

            if (schema) {
                query += " WHERE TABLE_SCHEMA = @schema";
                request.input("schema", sql.NVarChar, schema);
            }

            const result = await request.query(query);
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(result.recordset, null, 2),
                    },
                ],
            };
        }
    );

    // describe_table
    server.tool(
        "describe_table",
        "Get detailed column information for a table",
        {
            schema: z.string().default("dbo").describe("Schema name"),
            table: z.string().describe("Table name"),
        },
        async ({ schema, table }: { schema: string; table: string }) => {
            const pool = await getPool();
            const request = pool.request();
            request.input("schema", sql.NVarChar, schema);
            request.input("table", sql.NVarChar, table);

            const result = await request.query(`
        SELECT 
          COLUMN_NAME, 
          DATA_TYPE, 
          CHARACTER_MAXIMUM_LENGTH, 
          IS_NULLABLE, 
          COLUMN_DEFAULT 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = @table
      `);

            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(result.recordset, null, 2),
                    },
                ],
            };
        }
    );

    // list_indexes
    server.tool(
        "list_indexes",
        "List indexes for a specific table",
        {
            schema: z.string().default("dbo").describe("Schema name"),
            table: z.string().describe("Table name"),
        },
        async ({ schema, table }: { schema: string; table: string }) => {
            const pool = await getPool();
            const request = pool.request();
            request.input("schema", sql.NVarChar, schema);
            request.input("table", sql.NVarChar, table);

            const query = `
        SELECT 
          i.name AS IndexName,
          i.type_desc AS IndexType,
          c.name AS ColumnName,
          ic.is_included_column,
          i.is_unique,
          i.is_primary_key
        FROM sys.indexes i
        INNER JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
        INNER JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
        INNER JOIN sys.tables t ON i.object_id = t.object_id
        INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
        WHERE s.name = @schema AND t.name = @table
        ORDER BY i.name, ic.key_ordinal;
      `;

            const result = await request.query(query);
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(result.recordset, null, 2),
                    },
                ],
            };
        }
    );

    // list_foreign_keys
    server.tool(
        "list_foreign_keys",
        "List foreign keys for a specific table",
        {
            schema: z.string().default("dbo").describe("Schema name"),
            table: z.string().describe("Table name"),
        },
        async ({ schema, table }: { schema: string; table: string }) => {
            const pool = await getPool();
            const request = pool.request();
            request.input("schema", sql.NVarChar, schema);
            request.input("table", sql.NVarChar, table);

            const query = `
        SELECT 
          fk.name AS ForeignKeyName,
          tp.name AS ParentTable,
          cp.name AS ParentColumn,
          tr.name AS ReferencedTable,
          cr.name AS ReferencedColumn
        FROM sys.foreign_keys fk
        INNER JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id
        INNER JOIN sys.tables tp ON fkc.parent_object_id = tp.object_id
        INNER JOIN sys.columns cp ON fkc.parent_object_id = cp.object_id AND fkc.parent_column_id = cp.column_id
        INNER JOIN sys.tables tr ON fkc.referenced_object_id = tr.object_id
        INNER JOIN sys.columns cr ON fkc.referenced_object_id = cr.object_id AND fkc.referenced_column_id = cr.column_id
        INNER JOIN sys.schemas s ON tp.schema_id = s.schema_id
        WHERE s.name = @schema AND tp.name = @table;
      `;

            const result = await request.query(query);
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(result.recordset, null, 2),
                    },
                ],
            };
        }
    );

    // get_ddl
    server.tool(
        "get_ddl",
        "Get DDL (CREATE TABLE script) for a table",
        {
            schema: z.string().default("dbo").describe("Schema name"),
            table: z.string().describe("Table name"),
        },
        async ({ schema, table }: { schema: string; table: string }) => {
            // Constructing a basic DDL from metadata is complex.
            // We will do a best-effort simple reconstruction using columns and primary key.
            const pool = await getPool();
            const request = pool.request();
            request.input("schema", sql.NVarChar, schema);
            request.input("table", sql.NVarChar, table);

            // Get columns
            const colsResult = await request.query(`
            SELECT 
            COLUMN_NAME, 
            DATA_TYPE, 
            CHARACTER_MAXIMUM_LENGTH, 
            IS_NULLABLE,
            COLUMN_DEFAULT
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = @table
        `);

            if (colsResult.recordset.length === 0) {
                return {
                    isError: true,
                    content: [{ type: "text", text: `Table ${schema}.${table} not found.` }]
                };
            }

            // Get PK
            const pkResult = await request.query(`
             SELECT 
                c.name AS ColumnName
            FROM sys.indexes i
            INNER JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
            INNER JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
            INNER JOIN sys.tables t ON i.object_id = t.object_id
            INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
            WHERE s.name = @schema AND t.name = @table AND i.is_primary_key = 1
            ORDER BY ic.key_ordinal;
        `);
            const pkColumns = pkResult.recordset.map((r: any) => r.ColumnName);

            let ddl = `CREATE TABLE [${schema}].[${table}] (\n`;
            const colDefs = colsResult.recordset.map((col: any) => {
                let def = `  [${col.COLUMN_NAME}] ${col.DATA_TYPE}`;
                if (col.CHARACTER_MAXIMUM_LENGTH && col.CHARACTER_MAXIMUM_LENGTH > 0) {
                    def += `(${col.CHARACTER_MAXIMUM_LENGTH})`;
                } else if (col.CHARACTER_MAXIMUM_LENGTH === -1) {
                    def += `(MAX)`;
                }
                if (col.IS_NULLABLE === 'NO') {
                    def += " NOT NULL";
                } else {
                    def += " NULL";
                }
                if (col.COLUMN_DEFAULT) {
                    def += ` DEFAULT ${col.COLUMN_DEFAULT}`;
                }

                return def;
            });

            ddl += colDefs.join(",\n");

            if (pkColumns.length > 0) {
                ddl += `,\n  CONSTRAINT PK_${table} PRIMARY KEY CLUSTERED (${pkColumns.map((c: string) => `[${c}]`).join(", ")})`;
            }

            ddl += "\n);";

            return {
                content: [
                    {
                        type: "text",
                        text: ddl,
                    },
                ],
            };
        }
    );
}
