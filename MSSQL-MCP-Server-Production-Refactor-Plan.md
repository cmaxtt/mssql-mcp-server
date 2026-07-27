# MSSQL MCP Server — Production Refactor and Upgrade Plan

## Execution prompt for Hermes / Vibe Coder / another CLI coding agent

Use the following instructions as the authoritative implementation plan.

---

## 1. Mission

Refactor the existing Microsoft SQL Server MCP project into one maintainable,
production-quality TypeScript server that provides:

- SQL Server schema discovery and high-fidelity DDL documentation.
- Explicitly opt-in, read-only ad-hoc query execution.
- MCP over `stdio` and secured Streamable HTTP.
- Predictable configuration, logging, shutdown, and connection handling.
- Unit, protocol-contract, and Docker-based SQL Server integration tests.
- Accurate operator documentation and packaging checks.

The working repository is expected at:

```text
N:\AI-PROJECTS\mssql_mcp_server
```

Do not assume that the repository matches this plan. Inspect it first and adapt
filenames to its actual structure.

## 2. Required working method

If the `subagent-driven-development` skill is installed, use it for bounded,
independent research or test tasks. Keep one agent responsible for integration.
Do not allow multiple agents to edit the same files concurrently.

Work in small, reviewable increments:

1. Inspect.
2. Establish a baseline.
3. Make one coherent change.
4. Run the relevant tests and type checks.
5. Review the diff.
6. Record the result in the implementation log.
7. Continue only when the current gate passes.

Do not:

- Rewrite the project from scratch unless the audit proves that incremental
  refactoring is impractical.
- Change dependencies, transport, database layer, and tool contracts in one
  unreviewable step.
- Delete the Python implementation until TypeScript parity is demonstrated.
- expose passwords, connection strings, SQL result data, or complete submitted
  queries in logs.
- use `console.log` in `stdio` mode; stdout is reserved for the MCP protocol.
- push, tag, publish to npm, or create a remote release without explicit user
  approval.
- silently weaken tests to make a build pass.

When a requirement conflicts with the current code or SDK API, document the
conflict, follow the installed package's official API, and preserve the intended
security and behavior.

---

## 3. Non-negotiable engineering decisions

### 3.1 Runtime and dependency policy

- Target the latest patched Node.js 24 LTS available on the execution date.
- Keep the MCP SDK on the supported v1 production line for this release. Verify
  the latest stable v1 package before installation; do not migrate to an SDK v2
  prerelease as part of this refactor.
- Upgrade `mssql` independently from the MCP SDK so regressions can be isolated.
- Commit and use `package-lock.json`; CI must use `npm ci`.
- Do not add `@types/pino` unless the installed Pino package actually requires
  it; current Pino packages normally ship TypeScript declarations.
- Run `npm audit --audit-level=high` after dependency resolution. Do not apply
  `npm audit fix --force`. Resolve or explicitly document each remaining
  production finding.

### 3.2 SQL safety policy

`execute_query` is disabled by default:

```env
ENABLE_EXECUTE_QUERY=false
```

Enabling it requires all of the following:

1. A dedicated least-privilege SQL Server login/user.
2. Only the required `CONNECT`, `SELECT`, and narrowly scoped
   `VIEW DEFINITION` permissions.
3. No `db_owner`, `db_ddladmin`, `db_datawriter`, `EXECUTE`, impersonation, or
   server administration permissions.
4. Application-side fail-closed validation.
5. A row limit, query timeout, lock timeout, input-size limit, result-byte limit,
   and concurrency limit.

The SQL permission boundary is the primary protection. SQL parsing is a
secondary guard, not a security boundary.

The validator must:

- Parse as Microsoft SQL Server/T-SQL when the selected parser supports it.
- Accept exactly one statement.
- Accept only a top-level `SELECT`.
- Reject `SELECT INTO`.
- Reject unparseable syntax.
- Reject additional statements, including statements hidden after comments or
  semicolons.
- Enforce the optional table/schema allowlist using normalized AST references.
- Reject three- and four-part names unless explicitly enabled.
- Include adversarial tests for comments, Unicode whitespace, CTEs, subqueries,
  `UNION`, `OPENROWSET`, `OPENQUERY`, variables, temp objects, and attempted
  DML/DDL/`EXEC`.

Before adopting `node-sql-parser`, test it against a representative T-SQL
corpus from this repository. If it cannot reliably parse required SQL Server
syntax, stop and document the incompatibility. Do not fall back to regex-only
validation. Choose a T-SQL-capable alternative or reduce the accepted query
subset.

Do not naively append `TOP` to user SQL. Preserve query semantics. Implement a
tested server-side row cap, ensure session settings are reset even on failure,
and independently cap serialized output bytes. If session cleanup cannot be
guaranteed after cancellation, use a dedicated query pool/connection that is
discarded after the request.

### 3.3 HTTP security policy

The HTTP transport must:

- Bind to `127.0.0.1` by default.
- Expose one MCP endpoint, normally `/mcp`.
- Validate the `Origin` header when present.
- Use an explicit origin allowlist; never set
  `Access-Control-Allow-Origin: *`.
- Disable CORS unless a browser client actually requires it.
- Enforce a small request-body limit and supported content types.
- Return `405` with an `Allow` header for unsupported methods.
- Use secure bearer-token or standards-compatible authorization before binding
  to a non-loopback address.
- Never use the MCP session ID as authentication.
- Avoid exposing database host, database name, package versions, or stack traces
  from an unauthenticated health endpoint.

Choose and document either stateless or stateful Streamable HTTP. Prefer
stateless operation if the server does not need server-initiated messages,
subscriptions, or resumability. If stateful sessions are required, implement
session creation, lookup, expiry, DELETE handling, and cleanup explicitly.

### 3.4 MCP result and error policy

- Use `structuredContent` with an object `outputSchema` for tool results that
  have stable data shapes.
- Also return serialized JSON in a text content block for client compatibility.
- Use embedded resources only when the server genuinely exposes a stable,
  retrievable resource URI. Do not add a resource block merely to wrap JSON.
- Mark read-only tools with appropriate MCP tool annotations.
- Treat invalid tool arguments as protocol/validation errors.
- Return expected database or business failures as sanitized tool results with
  `isError: true`.
- Map unexpected failures centrally, include a correlation/request ID, log the
  full internal error only to stderr, and return a safe public message.
- Never leak SQL credentials, raw connection strings, stack traces, or sensitive
  database contents.

---

## 4. Target architecture

Prefer small modules rather than expanding one large `tools.ts`:

```text
src/
  index.ts
  config.ts
  logger.ts
  server.ts
  errors.ts
  db/
    pool.ts
    metadata-repository.ts
    query-executor.ts
  ddl/
    ddl-builder.ts
    ddl-types.ts
  query/
    query-validator.ts
  tools/
    register-tools.ts
    schema-tools.ts
    view-tools.ts
    procedure-tools.ts
    query-tools.ts
    health-tools.ts
    result-builders.ts
  transports/
    stdio.ts
    streamable-http.ts
tests/
  unit/
  contract/
  integration/
```

Adapt this map to the current repository. Preserve stable public imports when
reasonable.

Configuration must be parsed once in `config.ts` with Zod and passed to
components. Validate types, ranges, conflicting settings, and required secrets
at startup. Do not read `process.env` throughout the codebase.

Recommended settings:

```env
# Either DB_CONNECTION_STRING or the individual DB_* settings, never both.
DB_CONNECTION_STRING=
DB_HOST=localhost
DB_PORT=1433
DB_INSTANCE=
DB_NAME=
DB_USER=
DB_PASSWORD=
DB_ENCRYPT=true
DB_TRUST_SERVER_CERTIFICATE=false

DB_CONNECT_TIMEOUT_MS=15000
DB_REQUEST_TIMEOUT_MS=30000
DB_LOCK_TIMEOUT_MS=5000
DB_MAX_RETRIES=5
DB_RETRY_BASE_DELAY_MS=500
DB_RETRY_MAX_DELAY_MS=10000
DB_POOL_MIN=0
DB_POOL_MAX=10

ENABLE_EXECUTE_QUERY=false
ALLOWED_SCHEMAS=dbo
ALLOWED_TABLES=
QUERY_MAX_ROWS=100
QUERY_MAX_TEXT_BYTES=32768
QUERY_MAX_RESULT_BYTES=1048576
QUERY_MAX_CONCURRENCY=2

MCP_TRANSPORT=stdio
MCP_HTTP_HOST=127.0.0.1
MCP_HTTP_PORT=3000
MCP_HTTP_ALLOWED_ORIGINS=
MCP_HTTP_BEARER_TOKEN=
MCP_HTTP_BODY_LIMIT_BYTES=1048576

LOG_LEVEL=info
LOG_PRETTY=false
```

Never place real credentials in `.env.example`, tests, Docker Compose, or
documentation.

---

## 5. Implementation phases and gates

### Phase 0 — Repository audit and immutable baseline

#### Tasks

1. Confirm the actual repository root and read:
   - `package.json` and lockfile.
   - TypeScript configuration.
   - source, tests, Docker files, CI, README, MCP/Hermes configuration.
   - the Python implementation and its tests.
2. Check `git status --short` and preserve all pre-existing user changes.
3. Inventory:
   - Node/npm versions.
   - installed dependency versions.
   - registered tools and their input/output contracts.
   - current transports.
   - configuration variables.
   - use of the global `mssql` pool.
   - logging destinations.
   - test counts and skipped tests.
4. Run without changing files:

```bash
npm ci
npm run build --if-present
npm run typecheck --if-present
npm test
```

5. Run the Python tests separately if present.
6. Create `IMPLEMENTATION_LOG.md` containing the baseline, observed architecture,
   risks, and the exact commands/results. Do not claim a fixed test count until
   it has been observed.

#### Gate

- Stop and report if dependencies cannot install, the baseline cannot be
  reproduced, or unrelated user changes overlap required edits.
- Do not proceed by pretending the baseline is green.

### Phase 1 — Test and configuration foundations

#### Tasks

1. Add scripts as appropriate:

```text
build
typecheck
lint
test
test:unit
test:contract
test:integration
test:all
pack:check
```

2. Centralize environment parsing in `src/config.ts`.
3. Enforce mutual exclusivity between `DB_CONNECTION_STRING` and individual
   connection settings.
4. Support named instances and explicit ports without constructing malformed
   server names.
5. Parse a connection string with the public `mssql` API, then apply only
   supported non-secret runtime options.
6. Add redaction-safe configuration tests.
7. Add fixtures/fakes so unit tests do not require SQL Server.

#### Gate

```bash
npm run typecheck
npm test
```

Both must pass.

### Phase 2 — Dependency upgrades, one at a time

#### Tasks

1. Upgrade to the latest stable MCP SDK v1 release verified on the execution
   date. Adapt imports and registration APIs based on the installed SDK, not
   assumptions in this document.
2. Run build, typecheck, tests, and a minimal MCP Inspector smoke test.
3. Upgrade `mssql` to the verified stable v12 release.
4. Specifically test:
   - `bigint` values and JSON serialization.
   - decimal/numeric precision.
   - dates and timezone behavior.
   - binary values.
   - nulls.
   - multiple recordsets.
   - connection-string boolean options.
5. Add Pino and route logs to stderr.
6. Use pretty logging only when explicitly enabled for local development.
7. Audit the resolved dependency tree.

#### Gate

```bash
npm run build
npm run typecheck
npm test
npm audit --audit-level=high
```

Do not combine unresolved SDK and database-client regressions.

### Phase 3 — Database pool lifecycle and resilience

#### Tasks

1. Replace implicit global-pool behavior with an owned
   `new sql.ConnectionPool(config)` lifecycle unless the audit demonstrates a
   compelling reason not to.
2. Make concurrent `getPool()` calls share one in-flight connection promise.
3. Retry only transient connectivity failures. Do not retry authentication,
   authorization, invalid configuration, or unknown-certificate failures.
4. Use capped exponential backoff with jitter.
5. Emit one structured event per attempt without secrets.
6. Listen for pool errors.
7. Implement idempotent shutdown for `SIGINT` and `SIGTERM`; close transports,
   HTTP server, and pools once.
8. Add tests for:
   - successful first connection.
   - transient failures followed by success.
   - retry exhaustion.
   - non-retryable immediate failure.
   - simultaneous callers.
   - pool error and shutdown.

#### Gate

All lifecycle tests pass with no unhandled rejection or open-handle warning.

### Phase 4 — Consistent MCP contracts, logging, and errors

#### Tasks

1. Introduce result builders that emit:
   - stable `structuredContent`.
   - matching JSON text.
   - correct `isError` behavior.
2. Add output schemas for stable objects. Keep schemas as plain objects that are
   compatible with the installed SDK v1 behavior.
3. Add correlation IDs to tool execution and HTTP requests.
4. Log tool name, duration, row count, success/failure, and correlation ID.
5. Do not log arguments containing query text or returned data by default.
6. Sanitize `mssql` errors into a small public error vocabulary, such as:
   - `DATABASE_UNAVAILABLE`
   - `OBJECT_NOT_FOUND`
   - `PERMISSION_DENIED`
   - `QUERY_REJECTED`
   - `QUERY_TIMEOUT`
   - `RESULT_TOO_LARGE`
7. Preserve unexpected error details only in internal logs.
8. Add contract tests that call tools through the MCP server rather than only
   invoking internal functions.

#### Gate

Existing compatible clients still receive text content, while contract tests
also validate `structuredContent`.

### Phase 5 — Schema metadata and high-fidelity DDL

#### Tasks

1. Move metadata SQL into a repository layer with parameterized values.
2. Use `sys.*` catalog views consistently where `INFORMATION_SCHEMA` lacks SQL
   Server-specific detail.
3. Make metadata ordering deterministic.
4. Generate documentation-grade DDL covering:
   - schema-qualified identifiers.
   - data type, length, precision, scale, collation, and nullability.
   - identity seed/increment.
   - computed expression and `PERSISTED`.
   - default constraints.
   - primary and unique constraints, key order, and clustering.
   - check constraints and enabled/trusted state.
   - composite foreign keys, referenced columns, and update/delete actions.
5. Add non-constraint indexes as a separate section or separate tool:
   - uniqueness and clustering.
   - ordered key columns.
   - included columns.
   - filters.
   - disabled state.
6. Explicitly report unsupported or partial features rather than producing
   misleading DDL, including where applicable:
   - temporal/system-versioned tables.
   - partition schemes.
   - memory-optimized tables.
   - sparse/column-set columns.
   - graph, ledger, FILESTREAM, and encryption metadata.
7. Call the result “generated/documentation DDL”; do not promise byte-perfect
   round trips.
8. Build fixture-based tests for composite keys/FKs, escaped identifiers,
   identity, computed columns, constraints, indexes, and unsupported features.
9. In integration tests, execute supported generated DDL in a clean schema and
   compare resulting metadata.

#### Gate

The supported DDL subset round-trips in integration tests, and unsupported
features produce explicit warnings.

### Phase 6 — Views and stored procedures

#### Tasks

Implement:

- `list_views`
- `describe_view`
- `list_procedures`
- `describe_procedure`

Requirements:

- Filter by optional schema using parameters.
- Resolve objects by `schema_id`/`object_id`, not string concatenation.
- Use `sys.columns`/`sys.types` for view result metadata.
- Return view/procedure definition only when permissions allow it.
- Treat encrypted modules or unavailable definitions as a documented condition,
  not “not found.”
- For procedures, return parameter order, direction, type, length, precision,
  scale, and default metadata when SQL Server exposes it.
- Do not execute procedures.
- Add tool annotations and unit/contract/integration tests.

#### Gate

All four tools distinguish not-found, permission-limited, and encrypted-module
cases.

### Phase 7 — Safe, opt-in `execute_query`

#### Tasks

1. First capture the Python tool's real input/output behavior and create parity
   tests.
2. Implement the fail-closed validator described in Section 3.2.
3. At startup, if `ENABLE_EXECUTE_QUERY=true`, run a permission self-check where
   practical and warn/fail if the configured principal has dangerous roles.
   Do not require administrative permissions merely to perform this check.
4. Enforce:
   - one SELECT statement.
   - schema/table allowlist.
   - maximum input bytes.
   - maximum rows.
   - maximum serialized result bytes.
   - request and lock timeout.
   - concurrency limit.
   - cancellation/cleanup.
5. Normalize values that JSON cannot serialize directly, including `bigint`,
   buffers, high-precision numerics, and dates. Document the representation.
6. Return columns, rows, row count, truncation state, elapsed time, and
   correlation ID in a stable schema.
7. Add adversarial validator tests and real SQL Server tests.
8. Verify with a deliberately over-privileged test login that application
   validation rejects writes, while documenting that production must not use
   such a login.

#### Gate

- Disabled mode does not register the tool, or returns a clearly documented
  disabled result—choose one stable behavior.
- Every dangerous-query fixture is rejected.
- Normal SELECT/CTE/join/aggregate cases in the supported subset pass.
- Row, time, byte, and concurrency limits are demonstrated.

### Phase 8 — Health and readiness

#### Tasks

1. Implement an MCP `health_check` tool with sanitized data.
2. Implement:
   - `/health/live`: process is running; no database query.
   - `/health/ready`: pool can execute a lightweight parameter-free ping.
3. Set a short readiness timeout.
4. Do not expose database server/name or detailed runtime versions on public
   HTTP health routes.
5. Make Docker use readiness, not an information-rich diagnostic endpoint.

#### Gate

Liveness remains healthy during a temporary database outage; readiness becomes
unhealthy and recovers when connectivity returns.

### Phase 9 — Dual transport

#### Tasks

1. Keep `stdio` as the default.
2. Support configuration and CLI overrides:

```text
--transport stdio|http
--host <host>
--port <port>
```

CLI values override environment values. Invalid combinations fail at startup
with a useful message.

3. In stdio mode:
   - no non-protocol stdout output.
   - all logs go to stderr.
4. Implement Streamable HTTP according to the installed SDK v1 example and the
   applicable MCP transport specification.
5. Apply every control in Section 3.3.
6. Test initialize, tools/list, tools/call, invalid method, invalid origin,
   oversized body, missing/invalid authorization, session behavior, and clean
   shutdown.
7. Validate both transports with MCP Inspector.

#### Gate

- Hermes can register and invoke the stdio server.
- HTTP binds only to loopback by default.
- Invalid origins receive `403`.
- No wildcard CORS header is emitted.
- Protocol contract tests pass for both transports.

### Phase 10 — Docker and integration tests

#### Tasks

1. Use a pinned SQL Server container image supported by the target environment.
2. Keep the SA password in runtime environment/secrets, not version control.
3. Accept the SQL Server license only in the test/development Compose profile.
4. Add a deterministic schema setup and readiness probe.
5. Make integration tests:
   - opt-in locally.
   - deterministic and isolated.
   - responsible for cleanup.
   - fail clearly when Docker is unavailable, or skip only when an explicit
     skip flag is set.
6. Cover pool connection, metadata, DDL, views, procedures, query controls, and
   both transports where practical.
7. Ensure unit tests remain fast and Docker-free.

#### Gate

```bash
npm run test:unit
npm run test:contract
npm run test:integration
```

All pass on a clean environment with Docker available.

### Phase 11 — Python retirement with rollback

#### Tasks

1. Compare the TypeScript and Python tools using the parity matrix.
2. Update every Hermes/config/documentation reference to TypeScript.
3. Search the repository for Python-server references.
4. Preserve the last working Python implementation in version control history.
5. Remove `python_version/` only after:
   - parity tests pass.
   - TypeScript integration tests pass.
   - no runtime/config reference remains.
   - the diff shows no unique Python capability was lost.

#### Gate

The TypeScript server fully replaces the Python capability and rollback is
possible from the prior commit.

### Phase 12 — Documentation, packaging, and final handoff

#### Tasks

Update:

- `README.md`
- `.env.example`
- Hermes/MCP configuration examples.
- Docker instructions.
- security model and least-privilege SQL setup.
- tool reference with inputs, outputs, and examples.
- troubleshooting for TLS certificates, named instances, permissions, Docker,
  and stdio logging.
- `WHATWASIMPLEMENTED.md` or replace it with the maintained
  `IMPLEMENTATION_LOG.md`.

Provide a sample least-privilege SQL script, but require the operator to replace
database, schema, login, and user names. Never include a real password.

For npm packaging:

- Confirm the package name is available or intentionally scoped.
- Confirm `LICENSE`, repository URL, executable shebang, `bin`, `exports`,
  `engines`, files list, source maps, and declaration policy.
- Prefer the `files` allowlist in `package.json`; use `.npmignore` only when it
  adds value.
- Keep the existing version during development. Propose `2.0.0` only after
  confirming the final compatibility impact.
- Run `npm pack --dry-run` and inspect the file list.
- Do not run `npm publish`.

#### Final gate

Run from a clean checkout:

```bash
npm ci
npm run build
npm run typecheck
npm run lint --if-present
npm run test:unit
npm run test:contract
npm run test:integration
npm audit --audit-level=high
npm pack --dry-run
```

Then perform:

1. MCP Inspector smoke tests over stdio and HTTP.
2. Hermes stdio registration and calls:
   - list tables.
   - describe a known table.
   - generate DDL.
   - list/describe a view.
   - list/describe a procedure.
   - run a harmless SELECT only after query execution is explicitly enabled.
3. Secret scan of tracked files and the final diff.
4. `git status --short` and `git diff --check`.

Do not push, tag, or publish. Present the user with the final report and ask for
approval for external release actions.

---

## 6. Acceptance matrix

| Area | Required evidence |
|---|---|
| Baseline | Exact commands, versions, observed tests, and pre-existing failures recorded |
| Build quality | Build, typecheck, lint, unit tests, and contract tests pass |
| Database | Owned pool lifecycle, safe retry policy, shutdown, and no leaked secrets |
| Introspection | Tables, columns, keys, views, procedures, and permission-limited cases tested |
| DDL | Deterministic supported subset; round-trip integration test; warnings for unsupported features |
| Query execution | Off by default; least-privilege instructions; parser tests; row/time/byte/concurrency limits |
| MCP output | Compatible text plus validated structured content |
| stdio | Protocol-only stdout; logs on stderr |
| HTTP | Loopback default, origin validation, explicit auth for non-loopback, method/body/session tests |
| Health | Separate liveness/readiness with sanitized responses |
| Docker | Pinned image, secret-safe configuration, deterministic integration setup |
| Python removal | Parity proven before deletion; no references remain |
| Packaging | Dry-run inspected; nothing published |
| Handoff | Implementation log, remaining risks, exact verification output, no silent skips |

---

## 7. Mandatory final report format

At completion, report:

1. Outcome and architecture implemented.
2. Files added, changed, removed, and why.
3. Tool inventory and compatibility notes.
4. Security controls implemented.
5. Exact validation commands and pass/fail counts.
6. Dependency versions actually installed.
7. Docker/SQL Server version used for integration.
8. Remaining limitations, skipped tests, or risks.
9. Migration steps for the existing Hermes configuration.
10. Recommended next action.

Do not say “production ready” if any final gate was skipped or failed.

---

## 8. Notes correcting the earlier plan

- Node.js 20 is no longer an appropriate new production baseline; use the latest
  patched Node 24 LTS available when executing.
- MCP SDK `1.29.0` is the current stable v1 release at the time this plan was
  prepared, while a v2 line is still approaching stable release. Keep this
  project on stable v1 for the current refactor and revisit v2 separately.
- `mssql` `12.7.0` is current at the time this plan was prepared, but the agent
  must still verify the release and changelog on execution day.
- AST parsing improves validation but does not make a privileged SQL login safe.
- `Access-Control-Allow-Origin: *` is not appropriate for a local database MCP
  server.
- Stable tool data belongs in `structuredContent` plus compatible text; an
  embedded resource is not required merely because the payload is JSON.
- A thrown `McpError` is not the universal response for database/business
  failures; distinguish protocol errors from tool execution errors.
- Retrying every connection error wastes time and can hide configuration
  problems; retry only transient failures with a cap and jitter.
- Deleting Python and declaring version `2.0.0` are release gates, not early
  refactor steps.

---

## 9. Primary references

- MCP Streamable HTTP transport and security:
  <https://modelcontextprotocol.io/specification/2025-11-25/basic/transports>
- MCP tool results, structured content, and output schemas:
  <https://modelcontextprotocol.io/specification/2025-11-25/server/tools>
- Official MCP TypeScript SDK:
  <https://github.com/modelcontextprotocol/typescript-sdk>
- Official `node-mssql` repository and API:
  <https://github.com/tediousjs/node-mssql>
- Official Node.js release lifecycle:
  <https://nodejs.org/en/about/previous-releases>
- SQL Server database roles:
  <https://learn.microsoft.com/en-us/sql/relational-databases/security/authentication-access/database-level-roles>
- SQL Server schema permission guidance:
  <https://learn.microsoft.com/en-us/sql/t-sql/statements/grant-schema-permissions-transact-sql>
- `node-sql-parser` capabilities:
  <https://github.com/taozhi8833998/node-sql-parser>

