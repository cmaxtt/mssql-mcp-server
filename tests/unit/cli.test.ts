import { describe, expect, it } from "vitest";
import { applyCliOverrides, parseCliArgs } from "../../src/cli.js";
import type { TransportConfig } from "../../src/config.js";

const base: TransportConfig = {
  mode: "http",
  httpHost: "127.0.0.1",
  httpPort: 3000,
  allowedOrigins: "",
  bodyLimitBytes: 1024,
};

describe("CLI transport overrides", () => {
  it("does not override environment transport when no flag is supplied", () => {
    expect(applyCliOverrides(base, parseCliArgs([])).mode).toBe("http");
  });

  it("applies explicit transport, host, and port values", () => {
    expect(
      applyCliOverrides(
        { ...base, bearerToken: "a-long-random-token-at-least-32-chars" },
        parseCliArgs(["--transport", "http", "--host", "0.0.0.0", "--port", "8080"])
      )
    ).toMatchObject({ mode: "http", httpHost: "0.0.0.0", httpPort: 8080 });
  });

  it("rejects unknown arguments and unsafe effective binds", () => {
    expect(() => parseCliArgs(["--wat"])).toThrow(/Unknown/);
    expect(() => applyCliOverrides(base, { host: "0.0.0.0" })).toThrow(/BEARER_TOKEN/);
  });
});
