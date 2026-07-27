# What Was Implemented: MSSQL MCP Server — Production Refactor

## Current State (Post-Refactor)

A production-grade TypeScript MCP server providing secure, read-only SQL Server schema introspection, documentation-grade DDL generation, and opt-in query execution — all with structured logging, connection resilience, and dual transport (stdio + Streamable HTTP).

**Completed:** 2026-07-26 | **Tests:** 129 unit/contract + 16 integration

---

## Tools (12 total)

| Tool | Arguments | Description |
|------|-----------|-------------|
| `list_schemas` | None | Lists all schemas |
| `list_tables` | `schema?` | Lists tables |
| `describe_table` | `schema`, `table` | Column details |
| `list_indexes` | `schema`, `table` | Index information |
| `list_foreign_keys` | `schema`, `table` | Foreign key relationships |
| `get_ddl` | `schema`, `table` | Documentation-grade CREATE TABLE DDL (identity, computed, defaults, PK, UQ, CK, FK, indexes) |
| `list_views` | `schema?` | Lists views |
| `describe_view` | `schema`, `view` | View definition + column metadata |
| `list_procedures` | `schema?` | Lists stored procedures |
| `describe_procedure` | `schema`, `procedure` | Procedure definition + parameter details |
| `health_check` | None | Server health + DB connectivity (sanitized) |
| `execute_query` | `query` | Read-only SELECT (disabled by default) |

---

## Architecture

```
src/
  index.ts              — CLI parsing, dual transport (stdio/HTTP)
  config.ts              — Zod-validated env config (30+ vars)
  logger.ts              — Pino structured logger (stderr only)
  errors.ts              — 8-code public error vocabulary
  db.ts                  — ConnectionPool lifecycle, retry, dedup
  tools.ts               — 12 MCP tools with logging wrapper
  db/
    metadata-repository.ts  — sys.* catalog queries
    query-executor.ts       — Safe execution with limits
  query/
    query-validator.ts     — AST-based T-SQL validator
  ddl/
    ddl-builder.ts         — Complete DDL generation
  tools/
    result-builders.ts     — structuredContent + text results
  transports/
    streamable-http.ts     — HTTP server with security controls
```

---

## Security

- **Query execution**: Disabled by default (`ENABLE_EXECUTE_QUERY=false`)
- **SQL validation**: `node-sql-parser` AST-based + text blocklist (no regex)
- **Error sanitization**: Public error codes, internal details only in logs
- **HTTP**: Loopback default, origin validation, bearer token auth for non-loopback
- **Config**: Secure defaults (encrypt=true, trust=false)
- **Least privilege**: `create_least_privilege_login.sql` provided

---

## Key Improvements Over Original

| Area | Before | After |
|------|--------|-------|
| Language | TypeScript + Python | TypeScript only |
| Tools | 6 schema | 12 (schema + views + procedures + health + query) |
| DDL | PK-only | Full: identity, computed, defaults, UQ, CK, FK, indexes |
| Query validation | Python regex | AST-based T-SQL parser |
| Transport | stdio only | stdio + Streamable HTTP |
| Logging | console.error | Pino structured JSON (stderr) |
| Error handling | Raw strings | 8-code vocabulary, correlation IDs |
| Connection | No retry | Transient-only retry with backoff + jitter |
| Config | process.env | Zod-validated, 30+ vars |
| Tests | 25 unit | 129 unit/contract + 16 integration |
| Python server | Present | Retired (git history preserved) |
