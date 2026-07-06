import argparse
import sys
from fastmcp import FastMCP
import database

# Parse command line arguments
parser = argparse.ArgumentParser(description="MSSQL MCP Server")
parser.add_argument("--mode", choices=["stdio", "http"], default="stdio",
                   help="Server mode: stdio (MCP protocol) or http (FastAPI)")
parser.add_argument("--port", type=int, default=8000,
                   help="Port for HTTP server (default: 8000)")
parser.add_argument("--host", default="0.0.0.0",
                   help="Host for HTTP server (default: 0.0.0.0)")
args = parser.parse_args()

# Initialize FastMCP Server
mcp = FastMCP("mssql-server")

# Set stateless_http for HTTP mode (to avoid deprecation warning)
if args.mode == "http":
    # Try to set stateless_http via settings if available
    try:
        mcp.settings.stateless_http = True
    except AttributeError:
        # Fall back to deprecated parameter (will show warning)
        pass

# --- Resources ---
@mcp.resource("sql://schema")
def get_schema() -> str:
    """Returns the database schema for allowed tables, including relationships."""
    return database.get_all_schemas()

# --- Tools ---
@mcp.tool()
def execute_query(sql_query: str) -> str:
    """
    Executes a read-only SQL SELECT query on the allowed tables.
    Arguments:
        sql_query: The SELECT statement to execute.
    Returns:
        A text representation of the query results (JSON-like).
    """
    try:
        results = database.execute_safe_query(sql_query)
        return str(results)
    except Exception as e:
        return f"Error executing query: {str(e)}"

def validate_database_connection():
    """Validate database connectivity for both HTTP and stdio modes."""
    try:
        database.get_connection().close()
        print("Successfully connected to SQL Server.")
        sys.stdout.flush()
        return True
    except Exception as e:
        print(f"WARNING: Could not connect to SQL Server: {e}")
        print("Please check your .env file and ensure the database is running.")
        sys.stdout.flush()
        return False

# --- Main Entry Point ---
if __name__ == "__main__":
    # Validate database connection before starting
    if not validate_database_connection():
        print("Database connection failed. Exiting.")
        sys.stdout.flush()
        sys.exit(1)
    
    if args.mode == "stdio":
        print("MSSQL MCP Server running in stdio mode (MCP protocol)")
        sys.stdout.flush()
        import asyncio
        asyncio.run(mcp.run_stdio_async())
    else:  # http mode
        from fastapi import FastAPI
        import uvicorn
        
        print(f"MSSQL MCP Server running in HTTP mode on {args.host}:{args.port}")
        print(f"MCP endpoint: /mcp")
        print(f"API documentation: http://{args.host}:{args.port}/docs")
        sys.stdout.flush()
        
        # Create the FastAPI app
        app = FastAPI(title="MSSQL MCP Server")
        
        # Get the ASGI app from FastMCP
        # Use `http_app()` to get the ASGI application for mounting
        mcp_asgi_app = mcp.http_app()
        
        # Mount it. 
        # Note: For stateless_http=True with FastMCP, it typically exposes an endpoint like /mcp or similar.
        # However, FastMCP usage might vary slightly.
        # 'mcp.http_app()' returns a full Starlette/FastAPI app that handles the MCP protocol.
        # We can mount it to handle requests at "/" or a subpath.
        # Given the instructions "mount it so it can be served over HTTP", we'll mount at /mcp
        app.mount("/mcp", mcp_asgi_app)
        
        # Function to check connectivity on startup
        @app.on_event("startup")
        async def startup_event():
            # Connection already validated, but we can log it
            print("HTTP server starting with valid database connection")
        
        @app.get("/")
        def home():
            return {"status": "running", "message": "Visit /mcp for MCP interface (JSON-RPC) or check /docs"}
        
        uvicorn.run(app, host=args.host, port=args.port)
