import pino from "pino";
import type { LogConfig } from "./config.js";

let logger: pino.Logger | null = null;

/** Initialize the process logger. All output goes to stderr to keep stdio MCP-safe. */
export function initLogger(config: LogConfig): pino.Logger {
  if (config.pretty) {
    logger = pino(
      { name: "mssql-mcp-server", level: config.level },
      pino.transport({
        target: "pino-pretty",
        options: { colorize: true, destination: 2 },
      })
    );
  } else {
    logger = pino(
      { name: "mssql-mcp-server", level: config.level },
      pino.destination(2)
    );
  }
  return logger;
}

export function getLogger(): pino.Logger {
  if (!logger) {
    logger = pino({ name: "mssql-mcp-server", level: "info" }, pino.destination(2));
  }
  return logger;
}

export function childLogger(bindings: Record<string, unknown>): pino.Logger {
  return getLogger().child(bindings);
}

export function _resetLoggerForTesting(): void {
  logger = null;
}
