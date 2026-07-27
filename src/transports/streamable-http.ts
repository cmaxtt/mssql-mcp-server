import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TransportConfig } from "../config.js";
import { getLogger } from "../logger.js";
import http from "node:http";

const log = getLogger().child({ component: "http-transport" });

export interface HttpServerOptions {
  transport: TransportConfig;
  mcpServer: McpServer;
}

/**
 * Start a Streamable HTTP MCP server with all security controls applied.
 */
export async function startHttpServer(options: HttpServerOptions): Promise<http.Server> {
  const { transport, mcpServer } = options;

  const mcpTransport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  // Connect MCP server to transport
  await mcpServer.connect(mcpTransport);

  const allowedOrigins = transport.allowedOrigins
    ? transport.allowedOrigins.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  const server = http.createServer(async (req, res) => {
    // Security: validate Origin header
    if (allowedOrigins.length > 0) {
      const origin = req.headers.origin;
      if (origin && !allowedOrigins.includes(origin)) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Origin not allowed." }));
        return;
      }
      // Set CORS only when origin matches
      res.setHeader("Access-Control-Allow-Origin", origin || "");
      res.setHeader("Access-Control-Allow-Methods", "POST, GET, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept");
    }

    // Handle preflight
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // Bearer token auth for non-loopback binds
    if (
      transport.httpHost !== "127.0.0.1" &&
      transport.httpHost !== "localhost" &&
      transport.httpHost !== "::1"
    ) {
      if (transport.bearerToken) {
        const auth = req.headers.authorization;
        if (!auth || auth !== `Bearer ${transport.bearerToken}`) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Unauthorized." }));
          return;
        }
      }
    }

    // Body size limit
    const contentLength = parseInt(req.headers["content-length"] || "0", 10);
    if (contentLength > transport.bodyLimitBytes) {
      res.writeHead(413, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Request body too large." }));
      return;
    }

    // Route: /health/live — liveness (no DB query)
    if (req.url === "/health/live" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }

    // Route: /health/ready — readiness (DB ping)
    if (req.url === "/health/ready" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }

    // Route: /mcp — MCP protocol
    if (req.url === "/mcp" && (req.method === "POST" || req.method === "GET" || req.method === "DELETE")) {
      try {
        await mcpTransport.handleRequest(req, res);
      } catch (err) {
        log.error({ err }, "MCP request handler error");
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Internal server error." }));
        }
      }
      return;
    }

    // Unknown route
    if (req.url === "/mcp" || req.url?.startsWith("/health")) {
      res.writeHead(405, {
        "Content-Type": "application/json",
        Allow: "POST, GET, DELETE, OPTIONS",
      });
      res.end(JSON.stringify({ error: "Method not allowed." }));
    } else {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found." }));
    }
  });

  return new Promise((resolve, reject) => {
    server.on("error", (err) => {
      log.error({ err }, "HTTP server error");
      reject(err);
    });

    server.listen(transport.httpPort, transport.httpHost, () => {
      log.info(
        { host: transport.httpHost, port: transport.httpPort },
        "MCP server listening (Streamable HTTP)"
      );
      resolve(server);
    });
  });
}
