# MS SQL MCP Server

A Model Context Protocol (MCP) server for Microsoft SQL Server. Enables AI agents to inspect database schemas (tables, columns, indexes, foreign keys) and generate DDL.

## Quickstart (2 minutes)

**Prerequisites:** Node.js 20+, a reachable SQL Server.

```bash
git clone https://github.com/cmaxtt/mssql-mcp-server.git
cd mssql-mcp-server
npm install
npm run build
cp .env.example .env
# Edit .env with your SQL Server credentials
```

### Register with Hermes Agent

```bash
npm run register
# Or manually: ./scripts/register-with-hermes.sh
```

Restart Hermes (or `/reset` in-session), then ask: *"What tables are in the database?"*

### Other MCP Clients

**Claude Desktop** — add to `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "mssql-schema": {
      "command": "node",
      "args": ["/path/to/mssql-mcp-server/dist/index.js"],
      "env": {
        "DB_HOST": "your-server",
        "DB_USER": "your-user",
        "DB_PASSWORD": "your-password",
        "DB_NAME": "your-database",
        "DB_ENCRYPT": "false",
        "DB_TRUST_CERT": "true"
      }
    }
  }
}
```

**OpenCode** — copy `.opencode/config.jsonc` to your project or global config.

---

## Tools Reference

| Tool | Arguments | Description |
|------|-----------|-------------|
| `list_schemas` | None | Lists all schemas |
| `list_tables` | `schema` (optional) | Lists tables |
| `describe_table` | `schema`, `table` | Column details (type, length, nullable, default) |
| `list_indexes` | `schema`, `table` | Indexes for a table |
| `list_foreign_keys` | `schema`, `table` | Foreign key relationships |
| `get_ddl` | `schema`, `table` | CREATE TABLE SQL script |

---

## Development

```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript
npm test             # Run tests (25 unit tests)
npm run test:watch   # Watch mode
npm run dev          # TypeScript watch mode
```

---

## Docker

```bash
docker-compose up -d --build
```

Starts a SQL Server 2022 container + the MCP server for testing.

---

## Optional: Python Query Server

An optional FastMCP-based server for read-only SELECT queries lives in `python_version/`.
Most users only need the TypeScript schema server. See `python_version/README.md` for setup.

## License

ISC
