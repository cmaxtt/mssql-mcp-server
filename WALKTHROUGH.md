# MSSQL MCP Server Walkthrough

I have successfully built and deployed a Microsoft SQL Server MCP (Model Context Protocol) Server. This allows AI agents to inspecting database schemas and generating DDL for MS SQL databases.

## 1. Solution Overview

The solution consists of:
- **`mssql-mcp-server/`**: A Node.js/TypeScript project implementing the MCP server.
- **Dockerized Setup**: A `docker-compose.yml` that orchestrates:
    - `mssql_server`: A local MS SQL Server instance (Developer edition).
    - `mcp-server`: The MCP server containerized and connected to the database network.
- **Tools Implemented**:
    - `list_schemas`, `list_tables`, `describe_table`
    - `list_indexes`, `list_foreign_keys`
    - `get_ddl`

## 2. Verification Results

### Database Connection
I configured the `mcp-server` to talk to `mssql_server` over the Docker bridge network.
- **Status**: ✅ Connected
- **User**: `simple_user` (Created specifically for MCP access with `sysadmin` role for testing)

### Tool Functionality
Verified via the `test_mcp.js` script and direct Docker execution:
- **`list_tables`**: Successfully retrieved `tblInvoices`, `tblVendors`, etc.
- **`describe_table`**: Correctly pulled column types (e.g., `InvoiceID` as `int`, `Provider` as `nvarchar`).
- **`get_ddl`**: Generated valid `CREATE TABLE` statements including Primary Keys.

### Git Repository
The complete code has been pushed to: [cmaxtt/mssql-mcp-server](https://github.com/cmaxtt/mssql-mcp-server.git)

## 3. How to Use

### Quick Start (Docker)
1.  **Start the services**:
    ```bash
    cd mssql-mcp-server
    docker-compose up -d
    ```
    *This starts the DB and builds the server image.*

2.  **Configure your MCP Client**:
    Add the configuration found in `mcp_config.json` to your IDE or Agent settings. This configures the client to run:
    ```json
    {
      "command": "docker",
      "args": ["run", "--network", "mssql-mcp-server_mcp-network", ... "mssql-mcp"]
    }
    ```

### Manual Testing
You can manually query the server:
```bash
docker run -i --rm --network mssql-mcp-server_mcp-network \
  -e DB_HOST=mssql_server \
  -e DB_USER=simple_user \
  -e DB_PASSWORD=ComplexPassword1 \
  -e DB_ENCRYPT=true \
  -e DB_TRUST_CERT=true \
  mssql-mcp
```
*Input typical JSON-RPC commands to `stdin` to interact.*
