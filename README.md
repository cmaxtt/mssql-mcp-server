# MSSQL MCP Server

A security-focused Model Context Protocol server for Microsoft SQL Server. It
provides schema metadata, documentation-grade DDL, view and procedure
inspection, health checks, and an explicitly opt-in read-only query tool.

The default transport is stdio, query execution is disabled, TLS verification
is enabled, and logs are written only to stderr.

## Requirements

- Node.js 24 LTS or newer
- Microsoft SQL Server 2017 or newer, Azure SQL, or a compatible endpoint
- A dedicated least-privilege SQL login; never use `sa` or a sysadmin login

## Install from source

```bash
git clone https://github.com/cmaxtt/mssql-mcp-server.git
cd mssql-mcp-server
npm ci
npm run build
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
notepad .env
npm.cmd ci
npm.cmd run build
```

On macOS/Linux:

```bash
cp .env.example .env
${EDITOR:-vi} .env
npm ci
npm run build
```

Fill in either `DB_CONNECTION_STRING` or the individual `DB_*` fields, never
both. See [INSTALLATION.md](docs/INSTALLATION.md) for client, Docker, and
least-privilege setup.

Run directly:

```bash
node dist/index.js
```

For MCP clients, use an absolute path and pass configuration in the client's
`env` object:

```json
{
  "mcpServers": {
    "mssql": {
      "command": "node",
      "args": ["/absolute/path/to/mssql-mcp-server/dist/index.js"],
      "env": {
        "DB_HOST": "sql.example.internal",
        "DB_PORT": "1433",
        "DB_NAME": "ApplicationDb",
        "DB_USER": "mcp_reader",
        "DB_PASSWORD": "supply-from-your-secret-store",
        "DB_ENCRYPT": "true",
        "DB_TRUST_SERVER_CERTIFICATE": "false"
      }
    }
  }
}
```

Do not depend on a project `.env` file when the client launches the server
from another working directory; pass `env` values explicitly.

## Tools

| Tool | Purpose |
|---|---|
| `list_schemas` | List visible schemas |
| `list_tables` | List visible tables, optionally by schema |
| `describe_table` | Return column metadata |
| `list_indexes` | Return index metadata |
| `list_foreign_keys` | Return foreign-key metadata |
| `get_ddl` | Generate documentation-grade table DDL |
| `list_views` / `describe_view` | Inspect views and definitions |
| `list_procedures` / `describe_procedure` | Inspect procedures; never execute them |
| `health_check` | Test database access with sanitized output |
| `execute_query` | Execute one validated SELECT; absent unless enabled |

Every tool keeps text output for broad client compatibility and also returns
stable `structuredContent`.

## Opt-in query execution

`execute_query` is not registered unless `ENABLE_EXECUTE_QUERY=true`. Enabling
it is safe only with a SQL principal that cannot write or administer the
database. The application also enforces:

- one parseable SELECT statement;
- schema and optional table allowlists;
- no cross-database three/four-part names;
- blocks for `SELECT INTO`, external rowset functions, and execution helpers;
- query text, row, result-byte, lock-timeout, and concurrency limits;
- session limit cleanup in the same SQL batch.

The validator is defense in depth, not a substitute for SQL permissions.

## Streamable HTTP

```bash
node dist/index.js --transport http --host 127.0.0.1 --port 3000
```

Endpoints:

- `POST|GET|DELETE /mcp`
- `GET /health/live`
- `GET /health/ready`

HTTP defaults to loopback. A non-loopback bind fails at startup unless
`MCP_HTTP_BEARER_TOKEN` contains at least 32 characters. Browser origins are
denied unless listed exactly in `MCP_HTTP_ALLOWED_ORIGINS`. Request bodies are
limited even when chunked. Put remote deployments behind TLS; bearer tokens
must not travel over plaintext networks.

CLI transport flags override environment settings. Omitting a flag does not
override `MCP_TRANSPORT`.

## Configuration

All supported settings and safe defaults are in [.env.example](.env.example).
Configuration is validated at startup. Passwords, bearer tokens, and connection
strings are redacted from logs.

Important production defaults:

| Setting | Default |
|---|---|
| `DB_ENCRYPT` | `true` |
| `DB_TRUST_SERVER_CERTIFICATE` | `false` |
| `ENABLE_EXECUTE_QUERY` | `false` |
| `MCP_TRANSPORT` | `stdio` |
| `MCP_HTTP_HOST` | `127.0.0.1` |
| `QUERY_MAX_ROWS` | `100` |
| `QUERY_MAX_RESULT_BYTES` | `1048576` |

## Docker

The Compose file is a local evaluation stack. It deliberately requires secrets
instead of committing defaults and pins SQL Server 2022 CU26.

```bash
export MSSQL_SA_PASSWORD='replace-with-a-strong-local-password'
export MCP_HTTP_BEARER_TOKEN='replace-with-at-least-32-random-characters'
docker compose up --build
```

PowerShell:

```powershell
$env:MSSQL_SA_PASSWORD = 'replace-with-a-strong-local-password'
$env:MCP_HTTP_BEARER_TOKEN = 'replace-with-at-least-32-random-characters'
docker compose up --build
```

The Compose stack uses `sa` only to make an isolated local SQL container easy
to start. For any shared or production database, configure `mcp-server` with
the dedicated login created from `create_least_privilege_login.sql`.

## Development and verification

```bash
npm run typecheck
npm run build
npm run test:unit
npm run test:contract
npm run test:integration
npm audit --audit-level=high
npm run pack:check
```

`test:integration` requires Docker and an explicitly supplied
`MSSQL_SA_PASSWORD`. `npm run validate` runs all non-Docker release checks.

## Operational notes

- `/health/live` checks only the process; `/health/ready` runs a bounded DB ping.
- Connection retry applies only to transient network errors.
- SIGINT and SIGTERM close the transport and owned connection pool.
- DDL is intended for documentation. Unsupported SQL Server features are
  reported as warnings and the output is not promised to round-trip exactly.
- Encrypted modules or definitions hidden by permissions return limited
  metadata rather than being executed.

## License

ISC. See [LICENSE](LICENSE).
