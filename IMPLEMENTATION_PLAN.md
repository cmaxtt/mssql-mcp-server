# MSSQL MCP Server — Refactor, Improve & Upgrade Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Transform the current dual-language (TS + Python) MCP server into a single, production-grade TypeScript MCP server with full schema introspection, safe query execution, Streamable HTTP transport, and comprehensive test coverage.

**Architecture:** Single TypeScript codebase using `@modelcontextprotocol/sdk` ^1.29 with dual transport (stdio + Streamable HTTP), `mssql` ^12.x for database access, structured logging via `pino`, and vitest for testing. The Python query server is absorbed — its `execute_query` capability moves into the TypeScript server with proper SQL parsing (node-sql-parser) instead of vulnerable regex.

**Tech Stack:** Node.js 20+, TypeScript 5.x, `@modelcontextprotocol/sdk` ^1.29, `mssql` ^12.x, `zod` ^3.x, `pino` (logging), `node-sql-parser` (safe query validation), vitest, Docker (integration tests).

---

## Phase 0: Audit & Baseline (Read-Only)

### Task 0.1: Capture current test baseline

**Objective:** Confirm all existing tests pass before any changes.

**Files:**
- None (read-only)

**Step 1: Run existing tests**

```bash
cd N:/AI-PROJECTS/mssql_mcp_server
npm test
```

Expected: All 23 tests pass (10 tools + 13 db).

**Step 2: Record baseline**

Note any failures. If test suite is green, we have a clean baseline.

---

## Phase 1: Dependency Upgrade & Infrastructure

### Task 1.1: Upgrade MCP SDK to 1.29 and adopt new APIs

**Objective:** Bump `@modelcontextprotocol/sdk` from 1.25.3 to 1.29.0 and adapt to any API changes.

**Files:**
- Modify: `package.json`
- Modify: `src/index.ts`
- Potentially modify: `src/tools.ts`

**Step 1: Install updated SDK**

```bash
npm install @modelcontextprotocol/sdk@^1.29.0
```

**Step 2: Check for breaking changes**

The MCP SDK 1.29 introduces:
- Streamable HTTP as recommended transport
- Removal of deprecated session APIs
- Improved error types

**Step 3: Add Streamable HTTP transport support to index.ts**

The server should support both stdio and HTTP modes via CLI flag (`--transport stdio|http`). Default stays stdio for backward compatibility.

**Step 4: Verify tests still pass**

```bash
npm test
```

Expected: All 23 tests still pass.

**Verification:** `npm test` green.

---

### Task 1.2: Upgrade mssql from v10 to v12

**Objective:** Upgrade `mssql` from 10.0.4 to 12.7.0, adapting to any API changes.

**Files:**
- Modify: `package.json`
- Modify: `src/db.ts`

**Step 1: Install mssql v12**

```bash
npm install mssql@^12.7.0
npm install --save-dev @types/mssql@^12.0.0
```

**Step 2: Adapt db.ts**

Key changes in mssql v11/v12:
- Node.js 18+ minimum (already met)
- Native bigint support from tedious driver
- `sql.connect()` API unchanged for basic usage
- Connection pool API unchanged

**Step 3: Run tests**

```bash
npm test
```

**Verification:** All tests pass, types compile without errors.

---

### Task 1.3: Add structured logging with pino

**Objective:** Replace `console.error` with pino structured logger. Add log levels, request IDs, and JSON output for production.

**Files:**
- Create: `src/logger.ts`
- Modify: `src/index.ts`
- Modify: `src/db.ts`
- Modify: `src/tools.ts`

**Step 1: Install pino**

```bash
npm install pino
npm install --save-dev pino-pretty @types/pino
```

**Step 2: Create logger module**

Create `src/logger.ts`:
```typescript
import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL || (isDev ? 'debug' : 'info'),
  ...(isDev && {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true }
    }
  }),
  name: 'mssql-mcp-server',
});

export function createChildLogger(component: string) {
  return logger.child({ component });
}
```

**Step 3: Replace all console.error with logger**

- `src/index.ts`: logger.info for startup/shutdown
- `src/db.ts`: logger.info for connect, logger.error for failures, mask password in context
- `src/tools.ts`: logger.debug for tool calls, logger.error for failures

**Verification:** `npm test` green. Stderr output uses structured format.

---

### Task 1.4: Add connection retry with exponential backoff

**Objective:** Don't die immediately on connection failure. Retry up to N times with exponential backoff.

**Files:**
- Modify: `src/db.ts`

**Step 1: Add retry config via env vars**

```
DB_MAX_RETRIES=5        # default 5
DB_RETRY_DELAY_MS=1000  # default 1000
```

**Step 2: Implement retry logic in connectToDatabase()**

```typescript
const maxRetries = parseInt(process.env.DB_MAX_RETRIES || '5');
const baseDelay = parseInt(process.env.DB_RETRY_DELAY_MS || '1000');

for (let attempt = 1; attempt <= maxRetries; attempt++) {
  try {
    pool = await sql.connect(config);
    logger.info({ attempt }, 'Connected to MSSQL');
    return;
  } catch (err) {
    logger.error({ attempt, maxRetries, err }, 'Connection attempt failed');
    if (attempt === maxRetries) throw err;
    const delay = baseDelay * Math.pow(2, attempt - 1);
    await new Promise(r => setTimeout(r, delay));
  }
}
```

**Step 3: Update tests**

Add test for retry exhaustion. Mock `sql.connect` to reject N times.

**Verification:** `npm test` green. New test covers retry exhaustion.

---

### Task 1.5: Add connection string support alongside env vars

**Objective:** Support `DB_CONNECTION_STRING` as an alternative to individual `DB_HOST`/`DB_USER`/... vars.

**Files:**
- Modify: `src/db.ts`
- Modify: `.env.example`

**Step 1: Modify config construction**

```typescript
if (process.env.DB_CONNECTION_STRING) {
  config = sql.ConnectionPool.parseConnectionString(process.env.DB_CONNECTION_STRING);
} else {
  config = {
    server: process.env.DB_HOST || 'localhost',
    // ... existing individual field logic
  };
}
```

**Step 2: Update .env.example**

Add commented-out `DB_CONNECTION_STRING` example.

**Verification:** `npm test` green. New tests for connection string parsing.

---

## Phase 2: Error Handling & Content Types

### Task 2.1: Structured error responses with proper MCP error types

**Objective:** Use MCP SDK error types instead of returning `isError: true` strings. Tools should throw `McpError` for proper error protocol.

**Files:**
- Modify: `src/tools.ts`
- Create: `src/errors.ts`

**Step 1: Create errors module**

```typescript
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

export class TableNotFoundError extends McpError {
  constructor(schema: string, table: string) {
    super(ErrorCode.InvalidParams, `Table [${schema}].[${table}] not found`);
  }
}

export class DatabaseError extends McpError {
  constructor(message: string) {
    super(ErrorCode.InternalError, message);
  }
}
```

**Step 2: Update get_ddl to throw on missing table**

Instead of `return { isError: true, ... }`, throw `TableNotFoundError`.

**Step 3: Update all tools to catch and wrap db errors**

Wrap handler bodies in try/catch that converts `mssql` errors to `DatabaseError`.

**Step 4: Update tests**

Tests that check `result.isError` should now expect thrown errors.

**Verification:** `npm test` green. Tools throw proper MCP errors.

---

### Task 2.2: Return structured MCP content (ResourceContent, not raw JSON strings)

**Objective:** Use `{ type: "resource", resource: { uri, mimeType, text } }` for schema data instead of `{ type: "text", text: JSON.stringify(...) }`. This lets MCP clients render results better.

**Files:**
- Modify: `src/tools.ts`

**Step 1: Define content builders**

```typescript
function jsonContent(data: unknown): McpContent {
  return {
    type: 'text',
    text: JSON.stringify(data, null, 2),
  };
}
```

**Step 2: Keep text/JSON for now but add a structured alternative as resource**

For schema-heavy returns (describe_table), also include a resource content type with `application/json` mime type.

**Verification:** Tests updated. Output format backward-compatible (text type still used), resource enriched.

---

## Phase 3: DDL Generation — Complete

### Task 3.1: Full DDL generation with all constraint types

**Objective:** Upgrade `get_ddl` to include: unique constraints, check constraints, default constraints, foreign keys, computed columns, and identity columns.

**Files:**
- Modify: `src/tools.ts`

**Step 1: Query additional metadata**

Add queries for:
- `sys.check_constraints` + `sys.identity_columns` + `sys.computed_columns`
- `sys.default_constraints` (already partially covered by `COLUMN_DEFAULT`)

**Step 2: Build complete DDL**

The DDL should now include:
```
CREATE TABLE [schema].[table] (
  [ID] int IDENTITY(1,1) NOT NULL,
  [Name] nvarchar(100) NOT NULL,
  [Email] nvarchar(255) NULL,
  [Active] bit NOT NULL DEFAULT ((1)),
  [Score] AS ([A] + [B]),                          -- computed
  CONSTRAINT [PK_Table] PRIMARY KEY CLUSTERED ([ID]),
  CONSTRAINT [UQ_Table_Email] UNIQUE ([Email]),
  CONSTRAINT [CK_Table_Active] CHECK ([Active] IN (0, 1)),
  CONSTRAINT [FK_Table_Dept] FOREIGN KEY ([DeptID]) REFERENCES [dbo].[Departments]([ID])
);
```

**Step 3: Add identity column detection**

SQL Server: `sys.identity_columns` joined on `object_id` and `column_id`.

**Step 4: Update tests**

Add DDL tests for: identity columns, unique constraints, check constraints, FKs, computed columns.

**Verification:** `npm test` green. DDL output includes all constraint types.

---

## Phase 4: New Tools

### Task 4.1: Add list_views and describe_view tools

**Objective:** Discover and inspect database views.

**Files:**
- Modify: `src/tools.ts`

**Step 1: Add list_views tool**

```typescript
server.tool("list_views", "List views in a schema (or all)", {
  schema: z.string().optional()
}, async ({ schema }) => {
  // Query INFORMATION_SCHEMA.VIEWS
});
```

**Step 2: Add describe_view tool**

```typescript
server.tool("describe_view", "Get view definition", {
  schema: z.string().default("dbo"),
  view: z.string()
}, async ({ schema, view }) => {
  // Query sys.sql_modules for VIEW_DEFINITION
  // Also return columns via INFORMATION_SCHEMA.VIEW_COLUMN_USAGE
});
```

**Step 3: Add tests**

**Verification:** `npm test` green. 2 new tools registered.

---

### Task 4.2: Add list_procedures and describe_procedure tools

**Objective:** Discover and inspect stored procedures.

**Files:**
- Modify: `src/tools.ts`

**Step 1: Add list_procedures**

```typescript
server.tool("list_procedures", "List stored procedures", {
  schema: z.string().optional()
}, async ({ schema }) => {
  // Query sys.procedures joined with sys.schemas
});
```

**Step 2: Add describe_procedure**

```typescript
server.tool("describe_procedure", "Get procedure definition and parameters", {
  schema: z.string().default("dbo"),
  procedure: z.string()
}, async ({ schema, procedure }) => {
  // Query sys.sql_modules for definition
  // Query sys.parameters for parameter list
});
```

**Step 3: Add tests**

**Verification:** `npm test` green. Tools registered and functional.

---

### Task 4.3: Merge Python execute_query into TypeScript with proper SQL parsing

**Objective:** Absorb the Python server's `execute_query` capability. Use `node-sql-parser` to validate queries safely instead of regex keyword matching.

**Files:**
- Modify: `src/tools.ts`
- Create: `src/query-validator.ts`

**Step 1: Install node-sql-parser**

```bash
npm install node-sql-parser
```

**Step 2: Create query-validator.ts**

Uses `node-sql-parser` to parse SQL AST:
- Rejects non-SELECT statements at the AST level (not regex)
- Supports configurable allowed tables via `ALLOWED_TABLES` env var
- Returns parsed statement type

**Step 3: Add execute_query tool**

```typescript
server.tool("execute_query", "Execute a read-only SELECT query", {
  query: z.string().describe("SELECT statement to execute"),
  limit: z.number().int().min(1).max(1000).default(100).describe("Max rows to return")
}, async ({ query, limit }) => {
  // 1. Validate with node-sql-parser
  // 2. Check table allowlist if ALLOWED_TABLES set
  // 3. Append TOP or use SET ROWCOUNT for limit
  // 4. Execute and return JSON results
});
```

**Step 4: Add query timeout config**

```
DB_QUERY_TIMEOUT_MS=30000  # default 30s
```

**Step 5: Add tests**

**Verification:** `npm test` green. Safe query execution works. Dangerous queries rejected.

---

### Task 4.4: Add health_check tool

**Objective:** Let MCP clients verify the server state.

**Files:**
- Modify: `src/tools.ts`

**Step 1: Add health_check tool**

```typescript
server.tool("health_check", "Check database connectivity and server status", {}, async () => {
  const pool = await getPool();
  const start = Date.now();
  await pool.request().query('SELECT 1 AS ping');
  const latency = Date.now() - start;
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        status: 'healthy',
        database: process.env.DB_NAME || 'unknown',
        server: process.env.DB_HOST || 'unknown',
        latency_ms: latency,
        uptime_seconds: Math.floor(process.uptime()),
        node_version: process.version,
        server_version: '1.0.0',
      }, null, 2)
    }]
  };
});
```

**Verification:** `npm test` green. Tool responds with health data.

---

## Phase 5: Streamable HTTP Transport

### Task 5.1: Add HTTP transport alongside stdio

**Objective:** Support Streamable HTTP (MCP spec recommended transport) in addition to stdio.

**Files:**
- Modify: `src/index.ts`
- Create: `src/transports.ts`

**Step 1: Add CLI argument parsing**

Use `process.argv` (or `yargs` if already present — minimal deps preferred):

```
node dist/index.js --transport http --port 3000
node dist/index.js --transport stdio   # default
```

**Step 2: Implement HTTP transport**

```typescript
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import http from 'node:http';

// Create HTTP server
const httpServer = http.createServer(async (req, res) => {
  // CORS headers for browser-based MCP clients
  res.setHeader('Access-Control-Allow-Origin', '*');
  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  // Handle MCP requests
  if (req.url === '/mcp') {
    await streamableTransport.handleRequest(req, res);
  } else if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

httpServer.listen(port, () => {
  logger.info({ port }, 'MCP server listening (Streamable HTTP)');
});
```

**Step 3: Keep stdio as default for backward compatibility**

**Verification:** Start server in HTTP mode, curl `/health` returns 200. curl POST `/mcp` with JSON-RPC body returns MCP response.

---

### Task 5.2: Update Docker setup for HTTP mode

**Objective:** Docker compose should support running in HTTP mode for easier integration.

**Files:**
- Modify: `docker-compose.yml`
- Modify: `Dockerfile`
- Create: `docker-compose.http.yml`

**Step 1: Add HTTP mode compose file**

Separate compose for HTTP mode exposing port 3000.

**Step 2: Update Dockerfile health check to use `/health` endpoint when in HTTP mode**

**Verification:** `docker-compose -f docker-compose.http.yml up` starts server on port 3000.

---

## Phase 6: Integration Tests

### Task 6.1: Docker-based integration test harness

**Objective:** Run real integration tests against a Docker SQL Server instance.

**Files:**
- Create: `tests/integration/`
- Create: `tests/integration/setup.ts`
- Create: `tests/integration/tools.integration.test.ts`
- Create: `tests/integration/db.integration.test.ts`

**Step 1: Create test SQL Server setup**

Docker Compose test file that starts SQL Server, runs `setup_schema.sql`, then runs tests.

**Step 2: Write integration tests**

- `connectToDatabase` succeeds with real DB
- `list_tables` returns actual tables
- `describe_table` returns real columns
- `get_ddl` generates valid DDL
- `execute_query` runs a real SELECT

**Step 3: Add npm script**

```json
"test:integration": "vitest run --config vitest.integration.config.ts"
```

**Verification:** `npm run test:integration` passes against Docker SQL Server.

---

## Phase 7: Cleanup & Polish

### Task 7.1: Eliminate Python version (absorb into TS)

**Objective:** Remove `python_version/` directory. The TypeScript server now has `execute_query` and all Python capabilities.

**Files:**
- Delete: `python_version/` (entire directory)
- Modify: `README.md` (remove Python section, update to reflect merged capabilities)

**Step 1: Update README**

Remove "Optional Python Query Server" section. Add note that `execute_query` is now in the main TS server.

**Step 2: Delete python_version/**

**Verification:** README is accurate. No references to Python server remain.

---

### Task 7.2: Update documentation

**Objective:** Refresh README, add API reference, update mcp_config.json examples.

**Files:**
- Modify: `README.md`
- Modify: `mcp_config.json`
- Modify: `WHATWASIMPLEMENTED.md`

**Step 1: Update README**

- New tools: `list_views`, `describe_view`, `list_procedures`, `describe_procedure`, `execute_query`, `health_check`
- HTTP transport option
- Connection string support
- Updated quickstart

**Step 2: Update mcp_config.json**

Add HTTP mode example alongside stdio.

**Verification:** Documentation accurate and complete.

---

### Task 7.3: Add npm publish preparation

**Objective:** Prepare package for npm publishing.

**Files:**
- Modify: `package.json`
- Create: `.npmignore`

**Step 1: Update package.json**

```json
{
  "name": "mssql-mcp-server",
  "version": "2.0.0",
  "description": "MCP server for Microsoft SQL Server — schema introspection, DDL generation, and safe query execution",
  "main": "dist/index.js",
  "bin": {
    "mssql-mcp-server": "dist/index.js"
  },
  "files": ["dist/", "README.md", "LICENSE"],
  "keywords": ["mcp", "sql-server", "mssql", "model-context-protocol", "database"],
  "repository": "https://github.com/cmaxtt/mssql-mcp-server"
}
```

**Step 2: Create .npmignore**

Exclude tests, source, Docker files, etc.

**Verification:** `npm pack --dry-run` shows only dist + docs.

---

## Summary

| Phase | Tasks | Description |
|-------|-------|-------------|
| 0 | 1 | Baseline audit |
| 1 | 5 | Dependency upgrades, logging, retry, connection string |
| 2 | 2 | Structured errors, MCP content types |
| 3 | 1 | Complete DDL generation |
| 4 | 4 | New tools: views, procedures, query execution, health |
| 5 | 2 | Streamable HTTP transport |
| 6 | 1 | Integration tests |
| 7 | 3 | Cleanup, docs, publish prep |

**Total: 19 tasks**

## File Map

| File | Action |
|------|--------|
| `package.json` | Modify (deps, scripts, metadata) |
| `src/index.ts` | Modify (dual transport, logging) |
| `src/db.ts` | Modify (retry, connection string, logging) |
| `src/tools.ts` | Modify (errors, new tools, complete DDL, execute_query) |
| `src/logger.ts` | Create |
| `src/errors.ts` | Create |
| `src/query-validator.ts` | Create |
| `src/transports.ts` | Create |
| `tests/tools.test.ts` | Modify (new tools, error tests) |
| `tests/db.test.ts` | Modify (retry, connection string tests) |
| `tests/integration/*` | Create |
| `docker-compose.yml` | Modify |
| `Dockerfile` | Modify |
| `.env.example` | Modify |
| `.npmignore` | Create |
| `README.md` | Modify |
| `mcp_config.json` | Modify |
| `WHATWASIMPLEMENTED.md` | Modify |
| `python_version/` | Delete |

## Risks & Tradeoffs

1. **mssql v12 breaking changes**: The `mssql` package API is largely stable. The main change from v10→v12 is native bigint from tedious, which shouldn't affect our usage. If anything breaks, pin to v11 first.

2. **node-sql-parser weight**: Adds ~2MB to deps. Alternative: keep the regex approach but improve it. Tradeoff: AST-based parsing is correct; regex never will be.

3. **Streamable HTTP**: New transport in MCP SDK 1.29. If the SDK API shifts, fall back to continuing with stdio-only and deferring HTTP.

4. **DDL completeness**: We can't perfectly reconstruct DDL from metadata alone (SQL Server's `SCRIPT TABLE AS CREATE` isn't available via SQL). We'll get 95% there — enough for documentation and migration, but not a byte-perfect round-trip.

5. **Integration tests need Docker**: Will be skipped in CI if Docker unavailable. Document this.

## Post-Implementation

After all tasks complete:
1. Run full test suite: `npm test && npm run test:integration`
2. Verify with Hermes: re-register via `hermes mcp add` with updated config
3. Test in-session: "show me tables", "describe tblInvoices", "run SELECT COUNT(*) FROM tblInvoices"
4. Commit and push to `cmaxtt/mssql-mcp-server`
5. Tag as `v2.0.0`
