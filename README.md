# MS SQL MCP Server

A Model Context Protocol (MCP) server that connects to Microsoft SQL Server, enabling AI agents to inspect database schemas (tables, columns, indexes, foreign keys) and generate DDL.

## Features

- **Schema Inspection**:
  - `list_schemas`: List all database schemas.
  - `list_tables`: List tables within a schema.
  - `describe_table`: Get detailed column definitions for a table.
  - `list_indexes`: View index information.
  - `list_foreign_keys`: Inspect foreign key relationships.
- **DDL Generation**:
  - `get_ddl`: Generate `CREATE TABLE` statements based on table metadata.
- **Docker Support**: Fully containerized setup for easy deployment.

## Prerequisites

### For Docker Deployment
- [Docker](https://www.docker.com/) & Docker Compose

### For Local Development & OpenCode Integration
- [Node.js](https://nodejs.org/) (v20+)
- [Python 3.8+](https://www.python.org/) with `fastmcp`, `pyodbc`, `python-dotenv` packages
- [ODBC Driver 17+ for SQL Server](https://learn.microsoft.com/en-us/sql/connect/odbc/download-odbc-driver-for-sql-server)
- SQL Server database access

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

#### Google Antigravity CLI

**Local Installation:**
1. Clone and build the server:
```bash
git clone https://github.com/cmaxtt/mssql-mcp-server.git
cd mssql-mcp-server
npm install
npm run build
```

2. Add to Antigravity CLI configuration:

**Windows:** `%APPDATA%\antigravity\config.json`  
**Linux/macOS:** `~/.config/antigravity/config.json`

```json
{
  "mcpServers": {
    "mssql-schema": {
      "command": "node",
      "args": ["/full/path/to/mssql-mcp-server/dist/index.js"],
      "env": {
        "DB_HOST": "localhost",
        "DB_USER": "your_user",
        "DB_PASSWORD": "your_password",
        "DB_NAME": "your_database",
        "DB_ENCRYPT": "false",
        "DB_TRUST_CERT": "true"
      }
    },
    "mssql-query": {
      "command": "python",
      "args": ["/full/path/to/mssql-mcp-server/python_version/main.py", "--mode", "stdio"],
      "env": {
        "DB_CONNECTION_STRING": "Driver={ODBC Driver 17 for SQL Server};Server=localhost;Database=your_db;Uid=your_user;Pwd=your_password;"
      }
    }
  }
}
```

**Docker Installation (Recommended for testing):**
If using the Docker setup from this repository:

```json
{
  "mcpServers": {
    "mssql-mcp": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "--network", "mssql-mcp-server_mcp-network",
        "-e", "DB_HOST=mssql_server",
        "-e", "DB_USER=simple_user",
        "-e", "DB_PASSWORD=ComplexPassword1",
        "-e", "DB_ENCRYPT=true",
        "-e", "DB_TRUST_CERT=true",
        "mssql-mcp"
      ]
    }
  }
}
```

#### Claude Desktop
Use the same configuration as above in your Claude Desktop settings file:
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Linux:** `~/.config/Claude/claude_desktop_config.json`

#### Manual Docker Run
You can also run the server directly using Docker for testing:

```bash
docker run -i --rm \
  --network mssql-mcp-server_mcp-network \
  -e DB_HOST=mssql_server \
  -e DB_USER=simple_user \
  -e DB_PASSWORD=ComplexPassword1 \
  -e DB_ENCRYPT=true \
  -e DB_TRUST_CERT=true \
  mssql-mcp
```

## Development

### Install Dependencies

**TypeScript server:**
```bash
npm install
```

**Python server:**
```bash
pip install fastmcp pyodbc python-dotenv
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

## OpenCode Integration

This MCP server can be used with [OpenCode](https://opencode.ai) to enable AI agents to inspect your SQL Server database schema.

### Configuration

1. **Project-specific configuration** (recommended):
   - The repository includes a `.opencode/config.jsonc` file with both MCP servers pre-configured:
     - `mssql-schema`: TypeScript server for schema inspection (tables, columns, DDL)
     - `mssql-query`: Python server for executing read-only SELECT queries
   
   OpenCode will automatically detect this configuration when working in this directory.

2. **Global configuration**:
   - Copy the configuration from `.opencode/config.jsonc` to your global OpenCode config directory:
     - Windows: `%APPDATA%\opencode\opencode.jsonc`
     - Linux/macOS: `~/.config/opencode/opencode.jsonc`

### Usage with OpenCode

Once configured, you can ask OpenCode agents to interact with your database:

```
What tables are in the database?
```

```
Show me the schema for the invoices table
```

```
Generate a CREATE TABLE script for tblVendors
```

```
Run a query to find recent invoices
```

The agent will use the appropriate MCP tools to fulfill your requests.

## Tools Reference

### TypeScript Server (Schema Inspection)

| Tool Name | Arguments | Description |
|-----------|-----------|-------------|
| `list_schemas` | None | Lists all schemas in the database. |
| `list_tables` | `schema` (optional) | Lists tables in the specified schema (default: all). |
| `describe_table` | `schema`, `table` | Returns column details (type, length, nullable, default). |
| `list_indexes` | `schema`, `table` | Lists indexes for a table. |
| `list_foreign_keys` | `schema`, `table` | Lists foreign keys for a table. |
| `get_ddl` | `schema`, `table` | Generates a CREATE TABLE SQL script. |

### Python Server (Query Execution)

| Tool Name | Arguments | Description |
|-----------|-----------|-------------|
| `execute_query` | `sql_query` (string) | Executes a read-only SELECT query on allowed tables (`tblInvoices`, `tblInvoiceDetails`, `tblVendors`). |

**Resource:** `sql://schema` - Returns database schema including table structures and relationships.

## License
ISC
