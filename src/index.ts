import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools.js";
import { connectToDatabase, closeDatabase } from "./db.js";
import { startHttpServer } from "./transports/streamable-http.js";
import { parseConfig, redactConfig, TransportConfig } from "./config.js";
import { initLogger, getLogger } from "./logger.js";
import dotenv from "dotenv";

dotenv.config();

const server = new McpServer({
    name: "mssql-mcp-server",
    version: "1.0.0",
});

// ── CLI argument parsing ──
function parseCliArgs(): {
    transport: "stdio" | "http";
    host: string;
    port: number;
} {
    const args = process.argv.slice(2);
    let transport: "stdio" | "http" = "stdio";
    let host = "";
    let port = 0;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--transport" && i + 1 < args.length) {
            const val = args[i + 1];
            if (val !== "stdio" && val !== "http") {
                console.error(`Invalid transport: ${val}. Must be 'stdio' or 'http'.`);
                process.exit(1);
            }
            transport = val;
            i++;
        } else if (args[i] === "--host" && i + 1 < args.length) {
            host = args[i + 1];
            i++;
        } else if (args[i] === "--port" && i + 1 < args.length) {
            port = parseInt(args[i + 1], 10);
            if (isNaN(port) || port < 1 || port > 65535) {
                console.error(`Invalid port: ${args[i + 1]}`);
                process.exit(1);
            }
            i++;
        }
    }

    return { transport, host, port };
}

const cliArgs = parseCliArgs();

// ── Idempotent shutdown ──
let shuttingDown = false;
let httpServer: import("node:http").Server | null = null;

async function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    const log = getLogger();
    log.info({ signal }, "Received shutdown signal");

    if (httpServer) {
        log.info("Closing HTTP server");
        httpServer.close();
    }

    await closeDatabase();
    process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// ── Main ──
async function main() {
    const log = initLogger({ level: "info", pretty: false });

    try {
        // Parse and validate configuration
        const config = parseConfig();

        // CLI overrides for transport
        const transport: TransportConfig = { ...config.transport };
        if (cliArgs.transport) transport.mode = cliArgs.transport;
        if (cliArgs.host) transport.httpHost = cliArgs.host;
        if (cliArgs.port) transport.httpPort = cliArgs.port;

        log.info({ config: redactConfig(config) }, "Configuration loaded");
        log.info({ transportMode: transport.mode }, "Transport mode");

        // connect to database
        await connectToDatabase(
            {
                connection: config.connection,
                tls: config.tls,
                timeouts: config.timeouts,
                pool: config.pool,
                retry: config.retry,
            },
            log
        );

        // register tools (execute_query only if enabled)
        registerTools(server, config.query, config.timeouts);

        if (transport.mode === "http") {
            // Streamable HTTP mode
            httpServer = await startHttpServer({
                transport,
                mcpServer: server,
            });
        } else {
            // stdio mode (default)
            const stdioTransport = new StdioServerTransport();
            await server.connect(stdioTransport);
            log.info("MSSQL MCP Server running on stdio");
        }
    } catch (error) {
        log.fatal({ err: error }, "Failed to start server");
        process.exit(1);
    }
}

main();
