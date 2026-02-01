import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools.js";
import { connectToDatabase, closeDatabase } from "./db.js";
import dotenv from "dotenv";

dotenv.config();

const server = new McpServer({
    name: "mssql-mcp-server",
    version: "1.0.0",
});

async function main() {
    try {
        // connect to database
        await connectToDatabase();

        // register tools
        registerTools(server);

        // start server
        const transport = new StdioServerTransport();
        await server.connect(transport);
        console.error("MSSQL MCP Server running on stdio");
    } catch (error) {
        console.error("Failed to start server:", error);
        process.exit(1);
    }
}

// Handle cleanup
process.on("SIGINT", async () => {
    await closeDatabase();
    process.exit(0);
});

main();
