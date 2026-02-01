# MS SQL MCP Server

A Model Context Protocol (MCP) server that connects to Microsoft SQL Server, enabling AI agents to inspect database schemas (tables, columns, indexes, foreign keys) and generate DDL.

## Features

- **Schema Inspection**:
  - `list_schemas`: List all database schemas.
  - `list_tables`: List tables within a schema.
  - `describe_table`: Get detailed column definitions for a table.
  - `list_indexes`: View index information.
  - `list_foreign_keys`: innovative foreign key relationships.
- **DDL Generation**:
  - `get_ddl`: Generate `CREATE TABLE` statements based on table metadata.
- **Docker Support**: Fully containerized setup for easy deployment.

## Prerequisites

- [Docker](https://www.docker.com/) & Docker Compose
- [Node.js](https://nodejs.org/) (v20+ for local development)

## Quick Start

### 1. Clone the Repository
```bash
git clone https://github.com/cmaxtt/mssql-mcp-server.git
cd mssql-mcp-server
```

### 2. Configuration
Copy the example environment file:
```bash
cp .env.example .env
```
Edit `.env` with your SQL Server credentials.

### 3. Run with Docker Compose
This starts both an MS SQL Server instance (for testing) and the MCP Server.
```bash
docker-compose up -d --build
```

### 4. Connect an MCP Client
You can run the server directly using Docker. Configure your MCP client (e.g., Claude Desktop, Zed, etc.) to run the following command:

```bash
docker run -i --rm \
  --network host \
  -e DB_HOST=localhost \
  -e DB_USER=your_user \
  -e DB_PASSWORD=your_password \
  mssql-mcp-server
```
*Note: If connecting to a local SQL Server on the host machine from a container, use `host.docker.internal` as the `DB_HOST`.*

## Development

### Install Dependencies
```bash
npm install
```

### Build
```bash
npm run build
```

### Local Testing
A test script `test_mcp.js` is included to verify functionality.
```bash
# Ensure your local database is running
npm run build
node test_mcp.js
```

## Tools Reference

| Tool Name | Arguments | Description |
|-----------|-----------|-------------|
| `list_schemas` | None | Lists all schemas in the database. |
| `list_tables` | `schema` (optional) | Lists tables in the specified schema (default: all). |
| `describe_table` | `schema`, `table` | Returns column details (type, length, nullable, default). |
| `list_indexes` | `schema`, `table` | Lists indexes for a table. |
| `list_foreign_keys` | `schema`, `table` | Lists foreign keys for a table. |
| `get_ddl` | `schema`, `table` | Generates a CREATE TABLE SQL script. |

## License
ISC
