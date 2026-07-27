# Installation and deployment

## 1. Prepare the SQL principal

Copy `create_least_privilege_login.sql`, replace every placeholder, review the
grants for the intended schema/tables, then run it with a database
administrator account. The MCP runtime account should have:

- `CONNECT`;
- `VIEW DEFINITION` only on schemas it may inspect;
- `SELECT` only on explicitly approved tables if query execution is enabled;
- no server role and no database ownership/admin role.

Store the generated password in the MCP client's secret mechanism. Do not place
real credentials in source control, client screenshots, or shell history.

## 2. Build a deterministic installation

Install Node.js 24 LTS, clone the repository, and use the lockfile:

```bash
npm ci
npm run validate
```

For a machine-local command installation:

```bash
npm pack
npm install --global ./mssql-mcp-server-1.0.0.tgz
mssql-mcp-server
```

The package is not published by this repository workflow; install the locally
built archive or launch `dist/index.js` by absolute path.

## 3. Configure stdio clients

Stdio is recommended when the MCP client runs on the same machine. Configure:

- command: `node`
- arguments: absolute path to `dist/index.js`
- environment: database settings from `.env.example`

Example:

```json
{
  "mcpServers": {
    "mssql": {
      "command": "node",
      "args": ["C:\\absolute\\path\\mssql_mcp_server\\dist\\index.js"],
      "env": {
        "DB_HOST": "server-name",
        "DB_NAME": "database-name",
        "DB_USER": "mcp_reader",
        "DB_PASSWORD": "secret",
        "DB_ENCRYPT": "true",
        "DB_TRUST_SERVER_CERTIFICATE": "false",
        "ENABLE_EXECUTE_QUERY": "false"
      }
    }
  }
}
```

Use forward slashes or escaped backslashes in JSON on Windows.

## 4. Configure Streamable HTTP

For local-only HTTP:

```env
MCP_TRANSPORT=http
MCP_HTTP_HOST=127.0.0.1
MCP_HTTP_PORT=3000
```

For a non-loopback bind, also set a random token of 32+ characters and
terminate TLS in a trusted reverse proxy:

```env
MCP_HTTP_HOST=0.0.0.0
MCP_HTTP_BEARER_TOKEN=<random-secret>
MCP_HTTP_ALLOWED_ORIGINS=https://approved-client.example
```

Do not expose port 3000 directly to an untrusted network. Restrict ingress,
enable TLS, forward `Authorization`, and rate-limit at the proxy.

## 5. Verify after installation

```bash
npm run typecheck
npm run build
npm run test:unit
npm run test:contract
npm audit --audit-level=high
```

For HTTP deployments:

```bash
curl --fail http://127.0.0.1:3000/health/live
curl --fail http://127.0.0.1:3000/health/ready
```

Then connect an MCP client and call `health_check`, `list_schemas`, and
`list_tables`. Enable `execute_query` only after verifying the runtime login has
no write, execute, ownership, or administrative permissions.

## Troubleshooting

- TLS certificate error: install/trust the issuing CA. Use
  `DB_TRUST_SERVER_CERTIFICATE=true` only for controlled local development.
- Login failure: verify SQL authentication/TCP is enabled and the user exists
  in the target database.
- Named instance: set `DB_HOST` and `DB_INSTANCE`; omit `DB_INSTANCE` when
  using a fixed port.
- No tools in a desktop client: use an absolute script path, rebuild `dist`,
  restart the client, and check stderr logs.
- HTTP startup refuses `0.0.0.0`: set a 32+ character bearer token or bind to
  loopback.
- Readiness is `503`: test database connectivity and permissions from the MCP
  host; liveness should remain `200`.
