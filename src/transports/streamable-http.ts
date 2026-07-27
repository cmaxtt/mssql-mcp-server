import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TransportConfig } from "../config.js";
import { getPool } from "../db.js";
import { getLogger } from "../logger.js";
import { createHash, timingSafeEqual } from "node:crypto";
import http, { type IncomingMessage, type ServerResponse } from "node:http";

const log = getLogger().child({ component: "http-transport" });
const READINESS_TIMEOUT_MS = 2_000;

export interface HttpServerOptions {
  transport: TransportConfig;
  mcpServer: McpServer;
}

export async function startHttpServer(options: HttpServerOptions): Promise<http.Server> {
  const { transport, mcpServer } = options;
  const mcpTransport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await mcpServer.connect(mcpTransport);

  const allowedOrigins = new Set(
    transport.allowedOrigins.split(",").map((value) => value.trim()).filter(Boolean)
  );

  const server = http.createServer(async (req, res) => {
    setSecurityHeaders(res);
    const path = new URL(req.url ?? "/", "http://localhost").pathname;

    if (path === "/health/live" && req.method === "GET") {
      return sendJson(res, 200, { status: "ok" });
    }

    if (path === "/health/ready" && req.method === "GET") {
      const ready = await databaseIsReady();
      return sendJson(res, ready ? 200 : 503, { status: ready ? "ok" : "unavailable" });
    }

    if (path !== "/mcp") {
      return sendJson(res, 404, { error: "Not found." });
    }

    const origin = req.headers.origin;
    if (origin && !allowedOrigins.has(origin)) {
      return sendJson(res, 403, { error: "Origin not allowed." });
    }
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    res.setHeader("Access-Control-Allow-Methods", "POST, GET, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      return res.end();
    }

    if (!["POST", "GET", "DELETE"].includes(req.method ?? "")) {
      res.setHeader("Allow", "POST, GET, DELETE, OPTIONS");
      return sendJson(res, 405, { error: "Method not allowed." });
    }

    if (transport.bearerToken && !hasValidBearerToken(req, transport.bearerToken)) {
      res.setHeader("WWW-Authenticate", "Bearer");
      return sendJson(res, 401, { error: "Unauthorized." });
    }

    try {
      const body =
        req.method === "POST"
          ? await readJsonBody(req, transport.bodyLimitBytes)
          : undefined;
      await mcpTransport.handleRequest(req, res, body);
    } catch (err) {
      if (err instanceof HttpRequestError) {
        return sendJson(res, err.status, { error: err.message });
      }
      log.error({ err }, "MCP request handler error");
      if (!res.headersSent) {
        return sendJson(res, 500, { error: "Internal server error." });
      }
    }
  });

  server.requestTimeout = 35_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxRequestsPerSocket = 1_000;
  server.once("close", () => {
    void mcpTransport.close().catch((err) => log.error({ err }, "HTTP transport close failed"));
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(transport.httpPort, transport.httpHost, () => {
      server.removeListener("error", reject);
      server.on("error", (err) => log.error({ err }, "HTTP server error"));
      log.info(
        { host: transport.httpHost, port: transport.httpPort },
        "MCP server listening (Streamable HTTP)"
      );
      resolve(server);
    });
  });
}

async function databaseIsReady(): Promise<boolean> {
  try {
    const pool = await getPool();
    const request = pool.request();
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        request.cancel();
        reject(new Error("Readiness query timed out"));
      }, READINESS_TIMEOUT_MS);
      timer.unref();
    });
    await Promise.race([request.query("SELECT 1 AS ping"), timeout]);
    if (timer) clearTimeout(timer);
    return true;
  } catch (err) {
    log.warn({ err }, "Database readiness check failed");
    return false;
  }
}

async function readJsonBody(req: IncomingMessage, limitBytes: number): Promise<unknown> {
  const rawLength = req.headers["content-length"];
  if (rawLength !== undefined) {
    const declared = Number(rawLength);
    if (!Number.isInteger(declared) || declared < 0) {
      throw new HttpRequestError(400, "Invalid Content-Length.");
    }
    if (declared > limitBytes) {
      throw new HttpRequestError(413, "Request body too large.");
    }
  }

  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > limitBytes) {
      req.resume();
      throw new HttpRequestError(413, "Request body too large.");
    }
    chunks.push(buffer);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpRequestError(400, "Request body must be valid JSON.");
  }
}

function hasValidBearerToken(req: IncomingMessage, expected: string): boolean {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return false;
  const providedDigest = createHash("sha256").update(auth.slice(7)).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}

function setSecurityHeaders(res: ServerResponse): void {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) return;
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

class HttpRequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}
