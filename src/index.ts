#!/usr/bin/env node
import dotenv from "dotenv";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { applyCliOverrides, parseCliArgs } from "./cli.js";
import { parseConfig, redactConfig } from "./config.js";
import { connectToDatabase, closeDatabase } from "./db.js";
import { getLogger, initLogger } from "./logger.js";
import { registerTools } from "./tools.js";
import { startHttpServer } from "./transports/streamable-http.js";

dotenv.config();

const server = new McpServer({ name: "mssql-mcp-server", version: "1.0.0" });
let shuttingDown = false;
let httpServer: import("node:http").Server | null = null;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  const log = getLogger();
  log.info({ signal }, "Received shutdown signal");

  if (httpServer) {
    await new Promise<void>((resolve) => httpServer!.close(() => resolve()));
  }
  await server.close();
  await closeDatabase();
}

process.once("SIGINT", () => {
  void shutdown("SIGINT").catch((err) => getLogger().error({ err }, "Shutdown failed"));
});
process.once("SIGTERM", () => {
  void shutdown("SIGTERM").catch((err) => getLogger().error({ err }, "Shutdown failed"));
});

async function main(): Promise<void> {
  try {
    const config = parseConfig();
    const log = initLogger(config.log);
    const transport = applyCliOverrides(config.transport, parseCliArgs());

    log.info({ config: redactConfig(config) }, "Configuration loaded");
    log.info({ transportMode: transport.mode }, "Transport mode");

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

    registerTools(server, config.query, config.timeouts);

    if (transport.mode === "http") {
      httpServer = await startHttpServer({ transport, mcpServer: server });
    } else {
      await server.connect(new StdioServerTransport());
      log.info("MSSQL MCP Server running on stdio");
    }
  } catch (err) {
    getLogger().fatal({ err }, "Failed to start server");
    process.exitCode = 1;
    await closeDatabase();
  }
}

void main();
