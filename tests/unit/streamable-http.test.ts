import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { TransportConfig } from "../../src/config.js";

const query = vi.fn();
const cancel = vi.fn();
vi.mock("../../src/db.js", () => ({
  getPool: vi.fn(async () => ({
    request: () => ({ query, cancel }),
  })),
}));

import { startHttpServer } from "../../src/transports/streamable-http.js";

let server: http.Server | undefined;
let baseUrl = "";

const transport: TransportConfig = {
  mode: "http",
  httpHost: "127.0.0.1",
  httpPort: 0,
  allowedOrigins: "https://allowed.example",
  bearerToken: "test-token",
  bodyLimitBytes: 128,
};

beforeEach(async () => {
  query.mockReset().mockResolvedValue({ recordset: [{ ping: 1 }] });
  cancel.mockReset();
  server = await startHttpServer({
    transport,
    mcpServer: new McpServer({ name: "test", version: "1.0.0" }),
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  if (server?.listening) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
  }
});

describe("Streamable HTTP controls", () => {
  it("keeps liveness public and makes readiness reflect the database", async () => {
    expect((await fetch(`${baseUrl}/health/live`)).status).toBe(200);
    expect((await fetch(`${baseUrl}/health/ready`)).status).toBe(200);

    query.mockRejectedValueOnce(new Error("database unavailable"));
    const unavailable = await fetch(`${baseUrl}/health/ready`);
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({ status: "unavailable" });
  });

  it("rejects unapproved browser origins and missing bearer tokens", async () => {
    const badOrigin = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { Origin: "https://evil.example" },
      body: "{}",
    });
    expect(badOrigin.status).toBe(403);

    const unauthenticated = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.headers.get("www-authenticate")).toBe("Bearer");
  });

  it("rejects oversized chunked bodies while reading the stream", async () => {
    const status = await new Promise<number>((resolve, reject) => {
      const address = server!.address() as AddressInfo;
      const request = http.request(
        {
          host: "127.0.0.1",
          port: address.port,
          path: "/mcp",
          method: "POST",
          headers: {
            Authorization: "Bearer test-token",
            "Content-Type": "application/json",
            "Transfer-Encoding": "chunked",
          },
        },
        (response) => {
          response.resume();
          response.on("end", () => resolve(response.statusCode ?? 0));
        }
      );
      request.on("error", reject);
      request.write(`{"value":"${"x".repeat(256)}`);
      request.end('"}');
    });
    expect(status).toBe(413);
  });

  it("returns security headers and sanitized routing errors", async () => {
    const response = await fetch(`${baseUrl}/missing`);
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });
});
