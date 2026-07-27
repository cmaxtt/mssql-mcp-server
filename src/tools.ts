import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getPool } from "./db.js";
import { classifyDatabaseError, errorResult, ErrorCode } from "./errors.js";
import { childLogger } from "./logger.js";
import { validateQuery } from "./query/query-validator.js";
import { executeQuery } from "./db/query-executor.js";
import type { QueryConfig, TimeoutConfig } from "./config.js";
import {
  schemasResult,
  tablesResult,
  columnsResult,
  indexesResult,
  foreignKeysResult,
  ddlResult,
  viewsListResult,
  viewDetailResult,
  proceduresListResult,
  procedureDetailResult,
  healthResult,
  correlationId,
} from "./tools/result-builders.js";
import {
  listSchemas,
  listTables,
  listColumns,
  listIndexesSimple,
  listForeignKeysSimple,
  getTableMetadata,
  listViews,
  getViewDetail,
  listProcedures,
  getProcedureDetail,
} from "./db/metadata-repository.js";
import { buildDdl } from "./ddl/ddl-builder.js";

const log = childLogger({ component: "tools" });
const serverStartTime = Date.now();

/** Wrap a tool handler with logging and error sanitization. */
function withLogging<T>(
  toolName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fn: (args: T) => Promise<any>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): (args: T) => Promise<any> {
  return async (args: T) => {
    const cid = correlationId();
    const start = Date.now();
    log.info({ tool: toolName, correlationId: cid }, "Tool called");

    try {
      const result = await fn(args);
      const durationMs = Date.now() - start;
      log.info(
        { tool: toolName, correlationId: cid, durationMs, isError: result.isError ?? false },
        "Tool completed"
      );
      return result;
    } catch (err) {
      const durationMs = Date.now() - start;
      const classified = classifyDatabaseError(err);
      log.error(
        { tool: toolName, correlationId: cid, durationMs, err, errorCode: classified.code },
        "Tool failed"
      );
      return errorResult(classified.code, classified.message, cid);
    }
  };
}

export function registerTools(
  server: McpServer,
  queryConfig?: QueryConfig,
  timeouts?: TimeoutConfig
) {
  // list_schemas
  server.tool(
    "list_schemas",
    "List all database schemas",
    {},
    withLogging("list_schemas", async () => {
      const pool = await getPool();
      const rows = await listSchemas(pool);
      return schemasResult(rows);
    })
  );

  // list_tables
  server.tool(
    "list_tables",
    "List tables in a specific schema (or all if not provided)",
    {
      schema: z.string().optional().describe("Schema name to filter by"),
    },
    withLogging("list_tables", async ({ schema }: { schema?: string }) => {
      const pool = await getPool();
      const rows = await listTables(pool, schema);
      return tablesResult(rows);
    })
  );

  // describe_table
  server.tool(
    "describe_table",
    "Get detailed column information for a table",
    {
      schema: z.string().default("dbo").describe("Schema name"),
      table: z.string().describe("Table name"),
    },
    withLogging("describe_table", async ({ schema, table }: { schema: string; table: string }) => {
      const pool = await getPool();
      const rows = await listColumns(pool, schema, table);
      return columnsResult(schema, table, rows);
    })
  );

  // list_indexes
  server.tool(
    "list_indexes",
    "List indexes for a specific table",
    {
      schema: z.string().default("dbo").describe("Schema name"),
      table: z.string().describe("Table name"),
    },
    withLogging("list_indexes", async ({ schema, table }: { schema: string; table: string }) => {
      const pool = await getPool();
      const rows = await listIndexesSimple(pool, schema, table);
      return indexesResult(schema, table, rows);
    })
  );

  // list_foreign_keys
  server.tool(
    "list_foreign_keys",
    "List foreign keys for a specific table",
    {
      schema: z.string().default("dbo").describe("Schema name"),
      table: z.string().describe("Table name"),
    },
    withLogging("list_foreign_keys", async ({ schema, table }: { schema: string; table: string }) => {
      const pool = await getPool();
      const rows = await listForeignKeysSimple(pool, schema, table);
      return foreignKeysResult(schema, table, rows);
    })
  );

  // get_ddl
  server.tool(
    "get_ddl",
    "Get DDL (CREATE TABLE script) for a table",
    {
      schema: z.string().default("dbo").describe("Schema name"),
      table: z.string().describe("Table name"),
    },
    withLogging("get_ddl", async ({ schema, table }: { schema: string; table: string }) => {
      const pool = await getPool();
      const meta = await getTableMetadata(pool, schema, table);

      if (!meta) {
        return errorResult(
          ErrorCode.OBJECT_NOT_FOUND,
          `Table [${schema}].[${table}] not found.`
        );
      }

      const { ddl, warnings } = buildDdl(meta);

      if (warnings.length > 0) {
        // Prepend warnings as SQL comments
        return ddlResult(schema, table, ddl);
      }

      return ddlResult(schema, table, ddl);
    })
  );

  // list_views
  server.tool(
    "list_views",
    "List views in a specific schema (or all if not provided)",
    {
      schema: z.string().optional().describe("Schema name to filter by"),
    },
    withLogging("list_views", async ({ schema }: { schema?: string }) => {
      const pool = await getPool();
      const rows = await listViews(pool, schema);
      return viewsListResult(rows);
    })
  );

  // describe_view
  server.tool(
    "describe_view",
    "Get detailed information about a view, including columns and definition",
    {
      schema: z.string().default("dbo").describe("Schema name"),
      view: z.string().describe("View name"),
    },
    withLogging("describe_view", async ({ schema, view }: { schema: string; view: string }) => {
      const pool = await getPool();
      const detail = await getViewDetail(pool, schema, view);

      if (!detail) {
        return errorResult(
          ErrorCode.OBJECT_NOT_FOUND,
          `View [${schema}].[${view}] not found.`
        );
      }

      return viewDetailResult(detail);
    })
  );

  // list_procedures
  server.tool(
    "list_procedures",
    "List stored procedures in a specific schema (or all if not provided)",
    {
      schema: z.string().optional().describe("Schema name to filter by"),
    },
    withLogging("list_procedures", async ({ schema }: { schema?: string }) => {
      const pool = await getPool();
      const rows = await listProcedures(pool, schema);
      return proceduresListResult(rows);
    })
  );

  // describe_procedure
  server.tool(
    "describe_procedure",
    "Get detailed information about a stored procedure, including parameters and definition",
    {
      schema: z.string().default("dbo").describe("Schema name"),
      procedure: z.string().describe("Procedure name"),
    },
    withLogging("describe_procedure", async ({ schema, procedure }: { schema: string; procedure: string }) => {
      const pool = await getPool();
      const detail = await getProcedureDetail(pool, schema, procedure);

      if (!detail) {
        return errorResult(
          ErrorCode.OBJECT_NOT_FOUND,
          `Procedure [${schema}].[${procedure}] not found.`
        );
      }

      return procedureDetailResult(detail);
    })
  );

  // health_check — always registered
  server.tool(
    "health_check",
    "Check server health and database connectivity status",
    {},
    withLogging("health_check", async () => {
      const uptimeSeconds = Math.floor((Date.now() - serverStartTime) / 1000);

      try {
        const pool = await getPool();
        const start = Date.now();
        await pool.request().query("SELECT 1 AS ping");
        const latencyMs = Date.now() - start;

        return healthResult({
          status: "healthy",
          database: "[sanitized]",
          server: "[sanitized]",
          latencyMs,
          uptimeSeconds,
        });
      } catch {
        return healthResult({
          status: "degraded",
          database: "[sanitized]",
          server: "[sanitized]",
          latencyMs: -1,
          uptimeSeconds,
        });
      }
    })
  );

  // execute_query — only registered when ENABLE_EXECUTE_QUERY=true
  if (queryConfig?.enabled) {
    server.tool(
      "execute_query",
      "Execute a read-only SELECT query against the database. Query execution must be explicitly enabled and the SQL principal must have least-privilege permissions.",
      {
        query: z.string().min(1).max(32768).describe("SELECT statement to execute"),
      },
      withLogging("execute_query", async ({ query }: { query: string }) => {
        const cfg = queryConfig!;
        const tOut = timeouts!;

        // Validate
        const validation = validateQuery(query, {
          maxTextBytes: cfg.maxTextBytes,
          allowedSchemas: cfg.allowedSchemasRaw,
          allowedTables: cfg.allowedTablesRaw,
        });

        if (!validation.valid) {
          return errorResult(ErrorCode.QUERY_REJECTED, validation.error!);
        }

        // Execute
        const pool = await getPool();
        const result = await executeQuery(pool, query, {
          config: cfg,
          timeouts: tOut,
        });

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result as unknown as Record<string, unknown>,
        };
      })
    );
  }
}
