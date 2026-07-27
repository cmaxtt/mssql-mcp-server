import { describe, expect, it, vi } from "vitest";
import { executeQuery } from "../../src/db/query-executor.js";

const options = {
  config: {
    enabled: true,
    allowedSchemasRaw: "dbo",
    allowedTablesRaw: "",
    maxRows: 2,
    maxTextBytes: 32768,
    maxResultBytes: 1024,
    maxConcurrency: 2,
  },
  timeouts: { connectMs: 15000, requestMs: 30000, lockMs: 750 },
};

describe("executeQuery", () => {
  it("sets and resets session limits within the same batch", async () => {
    const query = vi.fn().mockResolvedValue({
      recordset: Object.assign([{ id: 1 }, { id: 2 }, { id: 3 }], {
        columns: { id: {} },
      }),
    });
    const pool = { request: () => ({ query }) } as any;

    const result = await executeQuery(pool, "SELECT id FROM dbo.Items", options);

    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toContain("SET LOCK_TIMEOUT 750");
    expect(query.mock.calls[0][0]).toContain("SET ROWCOUNT 3");
    expect(query.mock.calls[0][0]).toContain("BEGIN CATCH");
    expect(result.rows).toEqual([{ id: 1 }, { id: 2 }]);
    expect(result.truncated).toBe(true);
  });

  it("raises a classified error when the serialized result is too large", async () => {
    const query = vi.fn().mockResolvedValue({
      recordset: Object.assign([{ value: "x".repeat(2000) }], {
        columns: { value: {} },
      }),
    });
    const pool = { request: () => ({ query }) } as any;

    await expect(executeQuery(pool, "SELECT value FROM dbo.Items", options)).rejects.toMatchObject({
      publicErrorCode: "RESULT_TOO_LARGE",
    });
  });
});
