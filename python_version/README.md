# Python Query Server (Optional / Legacy)

This is an optional add-on server for executing read-only SELECT queries against your SQL Server.
The **primary** MCP server is the TypeScript one in `src/` which handles schema inspection.

## When to use this

Most users only need the TypeScript schema inspection tools. Set up the Python server
only if you need AI agents to run SELECT queries directly against your database.

## Setup

```bash
pip install fastmcp pyodbc python-dotenv
```

Create a `.env` file in this directory:
```
DB_CONNECTION_STRING=DRIVER={ODBC Driver 17 for SQL Server};SERVER=your-server;DATABASE=your-db;UID=your-user;PWD=your-password
```

Run:
```bash
python main.py --mode stdio
```
