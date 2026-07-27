import type { TransportConfig } from "./config.js";
import { isLoopbackHost } from "./config.js";

export interface CliOverrides {
  transport?: "stdio" | "http";
  host?: string;
  port?: number;
}

export function parseCliArgs(args: string[] = process.argv.slice(2)): CliOverrides {
  const overrides: CliOverrides = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const value = args[i + 1];

    if (arg === "--transport") {
      if (value !== "stdio" && value !== "http") {
        throw new Error("--transport must be either 'stdio' or 'http'.");
      }
      overrides.transport = value;
      i++;
    } else if (arg === "--host") {
      if (!value) throw new Error("--host requires a value.");
      overrides.host = value;
      i++;
    } else if (arg === "--port") {
      const port = Number(value);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error("--port must be an integer between 1 and 65535.");
      }
      overrides.port = port;
      i++;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return overrides;
}

export function applyCliOverrides(
  transport: TransportConfig,
  overrides: CliOverrides
): TransportConfig {
  const result = { ...transport };
  if (overrides.transport) result.mode = overrides.transport;
  if (overrides.host) result.httpHost = overrides.host;
  if (overrides.port) result.httpPort = overrides.port;

  if (result.mode === "http" && !isLoopbackHost(result.httpHost) && !result.bearerToken) {
    throw new Error(
      "MCP_HTTP_BEARER_TOKEN is required when the effective HTTP host is not loopback."
    );
  }
  return result;
}
