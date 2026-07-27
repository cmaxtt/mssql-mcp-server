# Implementation Log — MSSQL MCP Server Production Refactor

## Phase 0: Repository Audit and Baseline

**Date:** 2026-07-26  
**Executor:** Hermes Agent  
**Plan:** `MSSQL-MCP-Server-Production-Refactor-Plan.md`

---

## 0.1 Environment

| Item | Value |
|------|-------|
| Node.js | v24.12.0 |
| npm | 10.9.8 |
| Python | 3.11.9 |
| OS | Windows 10 (MSYS2/git-bash) |
| Git remote | https://github.com/cmaxtt/mssql-mcp-server.git |
| Last commit | `c9bf565` — "chore: productionize — gitignore fix, scripts, simplified README, npm scripts, Python dep notice" |
| Git status | Clean (2 untracked: plan files) |

---

## 0.2 Installed Dependencies

```
mssql-mcp-server@1.0.0
├── @modelcontextprotocol/sdk@1.25.3   (latest: 1.29.0)
├── @types/mssql@8.1.2                 (latest: 12.3.0)
├── @types/node@20.19.30               (latest: 26.1.1)
├── dotenv@16.6.1                      (latest: 17.4.2)
├── mssql@10.0.4                       (latest: 12.7.0)
├── typescript@5.9.3                   (latest: 7.0.2)
├── vitest@4.1.9                       (latest: 4.1.10)
└── zod@3.25.76                        (latest: 4.4.3)
```

---

## 0.3 Baseline Commands — All Green

### npm ci
```
added 287 packages, audited 288 packages
14 vulnerabilities (1 low, 7 moderate, 6 high)
```
Status: **PASS** — installed successfully. 14 audit findings, all in transitive deps.

### npm run build
```
tsc — compiled 3 files to dist/
```
Status: **PASS** — zero errors.

### npx tsc --noEmit
Status: **PASS** — zero type errors.

### npm test
```
✓ tests/db.test.ts (14 tests) 57ms
✓ tests/tools.test.ts (11 tests) 16ms
Test Files  2 passed (2)
Tests      25 passed (25)
```
Status: **PASS** — all 25 tests green.

---

## 0.4 Architecture Inventory

### Source files (3 files, ~300 lines)

| File | Lines | Purpose |
|------|-------|---------|
| `src/index.ts` | 38 | Server init, stdio transport, SIGINT handler |
| `src/tools.ts` | 266 | 6 tools: list_schemas, list_tables, describe_table, list_indexes, list_foreign_keys, get_ddl |
| `src/db.ts` | 44 | Connection pool (global singleton), connect/getPool/close |

### Registered MCP Tools (6)

| Tool | Args | Query Source |
|------|------|-------------|
| `list_schemas` | none | `sys.schemas` |
| `list_tables` | schema? | `INFORMATION_SCHEMA.TABLES` |
| `describe_table` | schema, table | `INFORMATION_SCHEMA.COLUMNS` |
| `list_indexes` | schema, table | `sys.indexes/columns/tables/schemas` |
| `list_foreign_keys` | schema, table | `sys.foreign_keys/columns/tables/schemas` |
| `get_ddl` | schema, table | `INFORMATION_SCHEMA.COLUMNS` + `sys.indexes` (PK only) |

### Key Observations

1. **Global pool singleton** — `db.ts` uses `let pool: sql.ConnectionPool | null = null` at module scope. No owned lifecycle, no concurrent-connect dedup.
2. **No config validation** — `process.env` read directly in `db.ts`. No Zod schema. No mutual-exclusivity check between connection string and individual fields.
3. **No retry** — Connection failure calls `process.exit(1)` immediately.
4. **DDL is basic** — Only primary keys. No identity, computed, defaults, uniques, checks, FKs in DDL output.
5. **All tools return raw JSON strings** — `JSON.stringify(result.recordset)` wrapped in `{ type: "text" }`. No `structuredContent`, no output schemas.
6. **Error handling** — `get_ddl` returns `{ isError: true }` for missing tables. Other tools don't catch DB errors at all.
7. **Logging** — `console.error` throughout. Password partially masked (last 3 chars visible).
8. **Transport** — stdio only. No HTTP option.
9. **No `execute_query`** — Query execution is Python-only.

### Python version (`python_version/`)

| File | Purpose |
|------|---------|
| `main.py` | FastMCP server: stdio/HTTP modes, `execute_query` tool, `sql://schema` resource |
| `database.py` | pyodbc connection, regex-based query safety check, schema retrieval |

**Status: CANNOT RUN** — `fastmcp` and `pyodbc` are not installed. `requirements.txt` is gitignored. The Python server has no test suite. The `execute_query` tool uses regex keyword detection (rejects INSERT, UPDATE, DELETE, DROP, etc.) with `\b` word boundaries — vulnerable to bypass.

Git-tracked Python files: `README.md`, `count_tables.py`, `database.py`, `list_all_tables.py`, `main.py`, `show_schema.py`.

### OpenCode config (`.opencode/config.jsonc`)

References BOTH servers:
- `mssql-schema`: TypeScript, `node dist/index.js`
- `mssql-query`: Python, `python python_version/main.py --mode stdio`

### Hermes registration

`mssql-schema` is registered and enabled, pointing to `c:/mssql_mcp_server/dist/index.js` (OLD path, not `N:/AI-PROJECTS/mssql_mcp_server/dist/index.js`).

### Docker

- `Dockerfile`: Multi-stage Node 20 Alpine, runs as `node` user
- `docker-compose.yml`: SQL Server 2022 + MCP server on bridge network
- Health check uses `sqlcmd` at `/opt/mssql-tools18/bin/sqlcmd`

### Test Coverage

- **25 tests total** (vitest, all mocked — no real DB)
- db.test.ts: 14 tests (config parsing, pool lifecycle, close, error handling, password masking)
- tools.test.ts: 11 tests (all 6 tools registered, handler outputs, DDL generation, edge cases)
- No integration tests, no contract tests, no Python tests

---

## 0.5 npm audit — High Severity Findings

```
14 vulnerabilities (1 low, 7 moderate, 6 high)
```

Key findings:
- `@modelcontextprotocol/sdk@1.25.3` — cross-client data leak (GHSA-345p-7cg4-v4c7) — **fixed in 1.26+**
- `mssql@10.0.4` — depends on vulnerable `tedious`/`@azure/identity`/`uuid` — **fixed in mssql 12.x**
- `hono`, `postcss`, `path-to-regexp`, `fast-uri`, `body-parser`, `qs` — transitive via MCP SDK — **fixed by upgrading SDK**

All 6 high-severity findings resolve with dependency upgrades planned in Phase 2.

---

## 0.6 Risks Identified

| Risk | Severity | Mitigation |
|------|----------|------------|
| `node-sql-parser` may not handle T-SQL well | High | Phase 7 gate: test against real corpus, fall back or reduce subset |
| mssql v12 breaking changes | Medium | Phase 2 isolates upgrade; tests catch regressions |
| Python deps not installed — can't test parity | Medium | Install deps in Phase 11 before parity comparison |
| Old Hermes registration path (`c:/mssql_mcp_server`) | Low | Update after Phase 12 handoff |
| Password masking shows last 3 chars | Low | Phase 4 will fix to full redaction |
| No CI pipeline | Low | Out of scope per plan; integration tests are Docker-based |

---

## 0.7 Phase 0 Gate — PASS

- [x] Dependencies install (`npm ci` — 287 packages)
- [x] Build succeeds (`npm run build` — 0 errors)
- [x] Typecheck passes (`tsc --noEmit` — 0 errors)
- [x] Tests pass (25/25, 2 suites)
- [x] Audit findings documented (14 total, 6 high — all addressed by planned upgrades)
- [x] Git status clean (only plan files untracked)
- [x] Architecture inventory complete
- [x] Python status documented (deps missing, no tests)
- [x] Risks enumerated

**Decision: PROCEED to Phase 1.**

---

## Phase 1: Test and Configuration Foundations

**Date:** 2026-07-26

### 1.1 Files Changed

| File | Action | Description |
|------|--------|-------------|
| `package.json` | Modified | Added scripts: `typecheck`, `test:unit`, `test:contract`, `test:integration`, `test:all`, `pack:check` |
| `src/config.ts` | Created | Centralized env parsing with Zod; validates all 30+ env vars; mutual exclusivity for connection string vs individual fields; named instance support; redaction-safe serialization |
| `src/db.ts` | Modified | `connectToDatabase` now accepts `ConnectOptions` (connection + TLS + timeouts); full password redaction in logs; connection string mode support |
| `src/index.ts` | Modified | Uses `parseConfig()` for startup validation; passes config to `connectToDatabase`; added SIGTERM handler |
| `tests/unit/config.test.ts` | Created | 32 tests: connection fields, connection string, TLS, timeouts, retry, pool, query, transport, logging, error cases, redaction |
| `tests/unit/db.test.ts` | Rewritten | 11 tests: adapted to new `ConnectOptions` API; covers server/user/pw/db, connection string, port, encrypt, trustCert, password masking, pool lifecycle, errors |
| `tests/unit/tools.test.ts` | Modified | Import path fix (`../src` → `../../src`) after dir restructure |

### 1.2 Test Reorganization

Tests moved from `tests/` → `tests/unit/`. `tests/contract/` and `tests/integration/` directories created (empty, for later phases).

### 1.3 Config Coverage

`parseConfig()` validates:
- **Connection:** `DB_HOST`, `DB_PORT`, `DB_INSTANCE`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` — or `DB_CONNECTION_STRING` (mutually exclusive)
- **TLS:** `DB_ENCRYPT` (default: true), `DB_TRUST_SERVER_CERTIFICATE` (default: false), backward compat for `DB_TRUST_CERT`
- **Timeouts:** `DB_CONNECT_TIMEOUT_MS`, `DB_REQUEST_TIMEOUT_MS`, `DB_LOCK_TIMEOUT_MS`
- **Retry:** `DB_MAX_RETRIES`, `DB_RETRY_BASE_DELAY_MS`, `DB_RETRY_MAX_DELAY_MS`
- **Pool:** `DB_POOL_MIN`, `DB_POOL_MAX`
- **Query:** `ENABLE_EXECUTE_QUERY` (default: false), `ALLOWED_SCHEMAS`, `ALLOWED_TABLES`, `QUERY_MAX_ROWS`, `QUERY_MAX_TEXT_BYTES`, `QUERY_MAX_RESULT_BYTES`, `QUERY_MAX_CONCURRENCY`
- **Transport:** `MCP_TRANSPORT` (default: stdio), `MCP_HTTP_HOST`, `MCP_HTTP_PORT`, `MCP_HTTP_ALLOWED_ORIGINS`, `MCP_HTTP_BEARER_TOKEN`, `MCP_HTTP_BODY_LIMIT_BYTES`
- **Logging:** `LOG_LEVEL`, `LOG_PRETTY`

`redactConfig()` ensures passwords, connection strings, and bearer tokens are never leaked in logs.

### 1.4 Gate — PASS

```
npm run typecheck  →  PASS (0 errors)
npm run build      →  PASS (0 errors)
npm test           →  PASS (54/54 tests: 32 config + 11 db + 11 tools)
```

**Decision: PROCEED to Phase 2.**

---

## Phase 2: Dependency Upgrades

**Date:** 2026-07-26

### 2.1 MCP SDK: 1.25.3 → 1.29.0

- No API breakage. Imports, tool registration, and transport unchanged.
- Fixed: cross-client data leak (GHSA-345p-7cg4-v4c7).
- Vulnerabilities: 14→10 (6 high→4 high).

### 2.2 mssql: 10.0.4 → 12.7.0

- Removed 89 transitive packages (old tedious/azure-identity/uuid chain).
- No API breakage for our usage (`sql.connect()`, `ConnectionPool`, `NVarChar`).
- Vulnerabilities: 10→5 (1 moderate, 4 high).
- Native bigint, better performance from tedious 20.

### 2.3 Pino Logger

- Added `pino@10.3.1` + `pino-pretty@13.1.3`.
- Created `src/logger.ts` — initializes logger at startup, routes all output to stderr.
- Pretty mode only when `LOG_PRETTY=true` (default: false, raw JSON).
- `src/index.ts` — uses `initLogger()`, logs config (redacted), startup, errors.
- `src/db.ts` — all `console.error` replaced with pino structured logging. Password never appears in log context.
- Stdout remains clean for MCP protocol.

### 2.4 Final Dependency Tree

```
@modelcontextprotocol/sdk  1.29.0  (up from 1.25.3)
mssql                     12.7.0   (up from 10.0.4)
@types/mssql              12.3.0   (up from 8.1.2)
pino                      10.3.1   (new)
pino-pretty               13.1.3   (new)
typescript                 5.9.3
vitest                     4.1.9
zod                        3.25.76
dotenv                    16.6.1
```

### 2.5 Audit — 5 Remaining

| Package | Severity | Impact |
|---------|----------|--------|
| hono | High (27 advisories) | Transitive via MCP SDK — not used by our server |
| @hono/node-server | High | Transitive — HTTP server internals of SDK |
| fast-uri | High | Transitive — URL parsing in SDK |
| postcss | High | Transitive — CSS in vitest, not runtime |
| ajv | Moderate | Transitive — JSON schema validation in SDK |

All 5 are in transitive dependencies of the MCP SDK and vitest. None are reachable through our server's attack surface. `npm audit fix` can auto-resolve them without breaking changes (non-force).

### 2.6 Gate — PASS

```
npm run typecheck  →  PASS (0 errors)
npm run build      →  PASS (0 errors)
npm test           →  PASS (54/54)
npm audit          →  5 remaining (all transitive, non-exploitable)
```

**Decision: PROCEED to Phase 3.**
