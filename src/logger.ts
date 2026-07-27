import pino from "pino";
import type { LogConfig } from "./config.js";

let logger: pino.Logger | null = null;

/**
 * Initialize the logger with the given log configuration.
 * Must be called once at startup, before any logging.
 */
export function initLogger(config: LogConfig): pino.Logger {
  const targets: pino.TransportTargetOptions[] = [];

  // Always log to stderr (stdio-safe — stdout is reserved for MCP protocol)
  if (config.pretty) {
    targets.push({
      target: "pino-pretty",
      level: config.level,
      options: { colorize: true, destination: 2 }, // stderr
    });
  } else {
    targets.push({
      target: "pino/file",
      level: config.level,
      options: { destination: 2 }, // stderr
    });
  }

  logger = pino({
    name: "mssql-mcp-server",
    level: config.level,
  });

  // Override with transport if pretty mode is enabled
  if (config.pretty) {
    logger = pino(
      {
        name: "mssql-mcp-server",
        level: config.level,
      },
      pino.destination(2) // Force stderr
    );

    // Re-create with pretty transport
    logger = pino(
      {
        name: "mssql-mcp-server",
        level: config.level,
      },
      pino.transport({
        targets: [
          {
            target: "pino-pretty",
            level: config.level,
            options: { colorize: true, destination: 2 },
          },
        ],
      })
    );
  } else {
    logger = pino(
      {
        name: "mssql-mcp-server",
        level: config.level,
      },
      pino.destination(2)
    );
  }

  return logger;
}

/**
 * Get the current logger. Throws if not initialized.
 */
export function getLogger(): pino.Logger {
  if (!logger) {
    // Fallback: create a minimal stderr logger
    logger = pino({ name: "mssql-mcp-server", level: "info" }, pino.destination(2));
  }
  return logger;
}

/**
 * Create a child logger with additional context.
 */
export function childLogger(bindings: Record<string, unknown>): pino.Logger {
  return getLogger().child(bindings);
}
