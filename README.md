# MSSQL MCP Server

A production-grade [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server for Microsoft SQL Server. Provides secure, read-only schema introspection, documentation-grade DDL generation, and opt-in query execution — all with structured logging, connection resilience, and dual transport (stdio + Streamable HTTP).

Built for [Hermes Agent](https://hermes-agent.nousresearch.com) and compatible with any MCP client (Claude Desktop, Continue, Cursor, etc.).

---

## Quick Start

### 1. Clone and build

```bash
git clone https://github.com/cmaxtt/mssql-mcp-server.git
cd mssql-mcp-server
npm install
npm run build
```

### 2. Configure

Copy `.env.example` to `.env` and fill in your database credentials:

```env
DB_HOST=your-server
DB_PORT=1433
DB_NAME=your-database
DB_USER=your-user
DB_PASSWORD=your-password
DB_ENCRYPT=true
DB_TRUST_SERVER_CERTIFICATE=false
```

Alternatively, use a connection string:

```env
DB_CONNECTION_STRING=Server=your-server;Database=your-db;User Id=your-user;Password=your-password;Encrypt=true;
```

### 3. Register with your MCP client

**Hermes Agent:**
```bash
hermes mcp add mssql-schema --command node --args "$(pwd)/dist/index.js" \
  --env DB_HOST=localhost DB_PORT=1433 DB_NAME=master \
  --env DB_USER=sa DB_PASSWORD=your-password \
  --env DB_ENCRYPT=false DB_TRUST_SERVER_CERTIFICATE=true
```

**Claude Desktop** — add to `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "mssql-schema": {
      "command": "node",
      "args": ["/absolute/path/to/dist/index.js"],
      "env": {
        "DB_HOST": "your-server",
        "DB_PORT": "1433",
        "DB_USER": "your-user",
        "DB_PASSWORD": "your-password",
        "DB_NAME": "your-database",
        "DB_ENCRYPT": "true",
        "DB_TRUST_SERVER_CERTIFICATE": "false"
      }
    }
  }
}
```

### 4. Use it

Ask your AI: *"List all tables in the dbo schema"* or *"Show me the DDL for tblInvoices"*.

---

## Streamable HTTP Mode

```bash
node dist/index.js --transport http --port 3000
```

| CLI Flag | Default | Description |
|----------|---------|-------------|
| `--transport` | `stdio` | `stdio` or `http` |
| `--port` | `3000` | HTTP listen port |
| `--host` | `127.0.0.1` | HTTP bind address |

CLI flags override `.env` settings. HTTP security controls (origin validation, bearer tokens) are described in the [Security](#security) section.

---

## Tools Reference (12 total)

### Schema Inspection

| Tool | Arguments | Returns | Example |
|------|-----------|---------|---------|
| `list_schemas` | None | All database schemas | `[{"name":"dbo","schema_id":1}]` |
| `list_tables` | `schema?` | Tables and views | `[{"TABLE_SCHEMA":"dbo","TABLE_NAME":"tblInvoices","TABLE_TYPE":"BASE TABLE"}]` |
| `describe_table` | `schema`, `table` | Column details (type, length, nullable, defaults) | 60 columns for tblInvoices |
| `list_indexes` | `schema`, `table` | Indexes with key columns, included columns, filters | Composite PK, nonclustered indexes |
| `list_foreign_keys` | `schema`, `table` | FK relationships (referenced schema, table, column, update/delete actions) | `tblInvoiceDetails → tblInvoices` |
| `get_ddl` | `schema`, `table` | Documentation-grade CREATE TABLE DDL | Identity, computed columns, defaults, PK, UQ, CK, FK, indexes |

### Views & Procedures

| Tool | Arguments | Returns | Notes |
|------|-----------|---------|-------|
| `list_views` | `schema?` | All views | Uses `sys.objects` for accuracy |
| `describe_view` | `schema`, `view` | Definition (SQL text) + column metadata | Returns `isEncrypted: true` for encrypted views |
| `list_procedures` | `schema?` | All stored procedures | |
| `describe_procedure` | `schema`, `procedure` | Definition + parameter details (name, type, length, direction, default) | Does NOT execute procedures |

### Health & Query

| Tool | Arguments | Returns | Notes |
|------|-----------|---------|-------|
| `health_check` | None | `{status, latencyMs, uptimeSeconds}` | Sanitized, no DB details exposed |
| `execute_query` | `query` | `{columns, rows, rowCount, truncated, elapsedMs}` | **Disabled by default.** Requires `ENABLE_EXECUTE_QUERY=true` |

---

## DDL Generation Features

The `get_ddl` tool generates documentation-grade DDL (not byte-perfect round-trips). It covers:

- **Identity columns**: seed/increment
- **Computed columns**: expression + PERSISTED flag
- **Default constraints**: with constraint names
- **Primary keys**: clustered/nonclustered, composite keys, ascending/descending
- **Unique constraints**: with constraint names
- **Check constraints**: with trust status noted
- **Foreign keys**: composite FKs, referenced columns, ON DELETE/UPDATE actions
- **Non-constraint indexes**: clustered/nonclustered, key columns with sort order, INCLUDEd columns, WHERE filters, disabled state
- **Schema-qualified identifiers**: `[schema].[table]` with bracket escaping
- **Unsupported features**: flagged as SQL comments in the output

---

## Security

### Default posture

- Query execution **disabled** by default (`ENABLE_EXECUTE_QUERY=false`)
- TLS encryption **enabled** by default (`DB_ENCRYPT=true`)
- HTTP binds to **127.0.0.1** only
- **No wildcard CORS** — explicit origin allowlist only
- Non-loopback HTTP binds require **bearer token** authentication
- Credentials **never logged** — passwords and connection strings are sanitized to `***`
- Error messages expose a **public vocabulary** — internal details stay in logs

### Least-privilege SQL login

Use `create_least_privilege_login.sql` to create a dedicated login with only the permissions needed:

- `CONNECT` — required
- `VIEW DEFINITION ON SCHEMA::dbo` — for schema inspection tools
- `SELECT` on specific tables — only if `ENABLE_EXECUTE_QUERY=true`
- Explicit `DENY` on ALTER, CONTROL, CREATE, DELETE, EXECUTE, INSERT, UPDATE, etc.

```sql
-- Customize and run:
-- sqlcmd -S your-server -U sa -P your-password -i create_least_privilege_login.sql
```

### Query validation (execute_query)

When enabled, all queries pass through a **fail-closed, multi-layer validator**:

1. **Size check**: query text ≤ 32,768 bytes
2. **Statement count**: exactly one statement
3. **AST parse**: `node-sql-parser` (TransactSQL dialect) — rejects non-SELECT, multiple statements, unparseable syntax
4. **Text blocklist**: rejects SELECT INTO, OPENROWSET, OPENQUERY, OPENDATASOURCE, xp_cmdshell, sp_executesql
5. **Schema/table allowlist**: optional whitelist enforcement
6. **Execution limits**: max rows, max result bytes, request timeout, lock timeout, concurrency limit

---

## Configuration Reference

All settings are documented in `.env.example`. Key variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_HOST` | `localhost` | SQL Server hostname |
| `DB_PORT` | `1433` | SQL Server port |
| `DB_NAME` | `master` | Database name |
| `DB_USER` | `sa` | SQL login (use least-privilege!) |
| `DB_PASSWORD` | — | SQL password |
| `DB_CONNECTION_STRING` | — | Alternative to individual params (mutually exclusive) |
| `DB_ENCRYPT` | `true` | Enable TLS |
| `DB_TRUST_SERVER_CERTIFICATE` | `false` | Trust self-signed certs (dev only) |
| `DB_CONNECT_TIMEOUT_MS` | `15000` | Connection timeout |
| `DB_REQUEST_TIMEOUT_MS` | `30000` | Query timeout |
| `DB_MAX_RETRIES` | `5` | Max transient retry attempts |
| `DB_POOL_MIN` | `0` | Min pool connections |
| `DB_POOL_MAX` | `10` | Max pool connections |
| `ENABLE_EXECUTE_QUERY` | `false` | Enable SELECT execution |
| `MCP_TRANSPORT` | `stdio` | Transport mode (`stdio` or `http`) |
| `LOG_LEVEL` | `info` | Pino log level (`debug`, `info`, `warn`, `error`) |
| `LOG_PRETTY` | `false` | Enable pretty-printed logs (dev only) |

Connection string and individual parameters are **mutually exclusive** — providing both causes a startup error.

---

## Development

```bash
npm install              # Install dependencies
npm run build            # Compile TypeScript
npm test                 # Unit + contract tests (129 tests, ~1.3s)
npm run test:unit        # Unit tests only
npm run test:contract    # Contract tests (MCP protocol)
npm run test:integration # Docker-based integration tests (16 tests)
npm run typecheck        # TypeScript type checking
npm run test:watch       # Watch mode
npm run pack:check       # Dry-run npm pack
```

### Integration tests

Requires Docker. Start the test SQL Server container:

```bash
MSSQL_SA_PASSWORD=YourPassword123! docker compose -f docker-compose.test.yml up -d
npm run test:integration
```

Without Docker, integration tests skip gracefully (16 skipped, 0 failed).

---

## Architecture

```
src/
  index.ts                  — CLI parsing, dual transport (stdio/HTTP)
  config.ts                 — Zod-validated env config (30+ vars)
  logger.ts                 — Pino structured logger (stderr only)
  errors.ts                 — 8-code public error vocabulary
  db.ts                     — ConnectionPool lifecycle, retry with backoff + jitter, connection dedup
  tools.ts                  — 12 MCP tools with logging wrapper + correlation IDs
  db/
    metadata-repository.ts  — All SQL queries, sys.* catalog views, deterministic ordering
    query-executor.ts       — Safe query execution with limits, value normalization, cleanup
  query/
    query-validator.ts      — Fail-closed T-SQL validator (AST + text blocklist)
  ddl/
    ddl-builder.ts          — Complete DDL generation (identity, computed, constraints, indexes)
  tools/
    result-builders.ts      — Typed result builders with structuredContent + text dual output
  transports/
    streamable-http.ts      — HTTP server with origin validation, bearer auth, body limits
```

### Key design principles

- **Single source of truth**: All configuration in `config.ts`, all SQL in `metadata-repository.ts`
- **Fail-closed defaults**: Query execution disabled, TLS enabled, loopback HTTP
- **Structured logging**: Pino JSON to stderr — stdout stays clean for MCP protocol
- **Error vocabulary**: 8 public error codes, internal details only in logs
- **Transient-only retry**: Socket errors retried with capped exponential backoff + jitter; auth/config errors fail immediately
- **Connection deduplication**: Concurrent callers share one in-flight connect promise
- **Idempotent shutdown**: SIGINT + SIGTERM handle both stdio and HTTP cleanly

---

## Error Codes

Public error vocabulary returned in `isError` tool responses:

| Code | Meaning |
|------|---------|
| `DATABASE_UNAVAILABLE` | Pool disconnected, connection lost |
| `OBJECT_NOT_FOUND` | Table/view/procedure doesn't exist |
| `PERMISSION_DENIED` | Insufficient SQL permissions |
| `QUERY_REJECTED` | Query failed validation (non-SELECT, forbidden functions, size exceeded) |
| `QUERY_TIMEOUT` | Query exceeded request or lock timeout |
| `RESULT_TOO_LARGE` | Result exceeded max rows or max bytes |
| `INTERNAL_ERROR` | Unexpected failure (details logged internally) |
| `NOT_IMPLEMENTED` | Feature not yet available |

---

## Docker

### Development stack

```bash
docker compose up -d
```

Starts SQL Server 2022 + the MCP server.

### Test stack (integration tests)

```bash
docker compose -f docker-compose.test.yml up -d
```

Starts a dedicated SQL Server on port 14333 with test schema objects.

---

## Migration from Python Version

The Python server (`python_version/`) has been retired. All capabilities are now provided by the TypeScript server:

| Python Feature | TypeScript Replacement |
|---------------|----------------------|
| `execute_query` | `execute_query` tool (AST-validated, disabled by default) |
| `sql://schema` resource | 10 schema tools (tables, views, procedures, DDL, indexes, FKs, health) |

The Python code is preserved in git history (`git checkout HEAD~1 python_version/`).

---

## License

ISC
