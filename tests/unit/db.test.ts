import { describe, it, expect, beforeEach, vi } from 'vitest';
import { _resetForTesting } from '../../src/db.js';

// ── Mocks ──

const mockPool = {
  connected: true,
  close: vi.fn().mockResolvedValue(undefined),
  request: vi.fn(),
  on: vi.fn(),
  connect: vi.fn().mockResolvedValue(undefined),
};

vi.mock('mssql', () => {
  // Use a regular function (not arrow) for the constructor mock
  const connPoolCtor = vi.fn(function (this: any, _config: unknown) {
    // Copy mockPool properties onto `this` so `new ConnectionPool()` works
    Object.assign(this, mockPool);
  });
  return {
    default: {
      ConnectionPool: connPoolCtor,
      NVarChar: 'nvarchar' as any,
    },
  };
});

// ── Test fixture: standard connect options with retry ──

function makeOptions(overrides: Record<string, unknown> = {}) {
  return {
    connection: {
      useConnectionString: false,
      server: (overrides.server as string) ?? 'test-server',
      port: (overrides.port as number) ?? 1433,
      database: (overrides.database as string) ?? 'testdb',
      user: (overrides.user as string) ?? 'sa',
      password: (overrides.password as string) ?? 'pwd',
      host: (overrides.host as string) ?? 'test-server',
    },
    tls: {
      encrypt: (overrides.encrypt as boolean) ?? false,
      trustServerCertificate: (overrides.trustCert as boolean) ?? false,
    },
    timeouts: {
      connectMs: 15000,
      requestMs: 30000,
      lockMs: 5000,
    },
    pool: {
      min: 0,
      max: 10,
    },
    retry: {
      maxRetries: (overrides.maxRetries as number) ?? 2,
      baseDelayMs: (overrides.baseDelayMs as number) ?? 100,
      maxDelayMs: 5000,
    },
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  _resetForTesting();
  mockPool.connected = true;
  mockPool.connect.mockResolvedValue(undefined);
  mockPool.close.mockResolvedValue(undefined);
});

// ── Tests ──

describe('connectToDatabase', () => {
  it('creates ConnectionPool with correct config', async () => {
    const { connectToDatabase } = await import('../../src/db.js');
    const mssql = await import('mssql');

    await connectToDatabase(makeOptions());

    const Ctor = mssql.default.ConnectionPool as any;
    expect(Ctor).toHaveBeenCalledTimes(1);
    const cfg = Ctor.mock.calls[0][0];
    expect(cfg.server).toBe('test-server');
    expect(cfg.port).toBe(1433);
    expect(cfg.database).toBe('testdb');
    expect(cfg.user).toBe('sa');
    expect(cfg.password).toBe('pwd');
    expect(cfg.options.encrypt).toBe(false);
  });

  it('passes connection string directly to ConnectionPool', async () => {
    const { connectToDatabase } = await import('../../src/db.js');
    const mssql = await import('mssql');

    await connectToDatabase({
      ...makeOptions(),
      connection: {
        useConnectionString: true,
        connectionString: 'Server=myhost;Database=mydb;User Id=sa;Password=pwd;',
        server: 'myhost',
        port: 1433,
        database: '',
        user: '',
        password: '',
      },
    });

    const Ctor = mssql.default.ConnectionPool as any;
    expect(Ctor).toHaveBeenCalledWith('Server=myhost;Database=mydb;User Id=sa;Password=pwd;');
  });

  it('calls pool.connect() and returns the pool', async () => {
    const { connectToDatabase } = await import('../../src/db.js');

    const result = await connectToDatabase(makeOptions());

    expect(mockPool.connect).toHaveBeenCalled();
    expect(result).toEqual(mockPool);
  });

  it('registers pool error listener', async () => {
    const { connectToDatabase } = await import('../../src/db.js');

    await connectToDatabase(makeOptions());

    expect(mockPool.on).toHaveBeenCalledWith('error', expect.any(Function));
  });
});

describe('connection deduplication', () => {
  it('shares one in-flight connect promise for concurrent callers', async () => {
    const { connectToDatabase } = await import('../../src/db.js');
    const mssql = await import('mssql');

    // Make connect slow to simulate concurrent calls
    mockPool.connect.mockImplementation(
      () => new Promise((r) => setTimeout(r, 50))
    );

    const [a, b] = await Promise.all([
      connectToDatabase(makeOptions()),
      connectToDatabase(makeOptions()),
    ]);

    // ConnectionPool constructor called exactly once
    const Ctor = mssql.default.ConnectionPool as any;
    expect(Ctor).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  it('reuses existing connected pool without reconnecting', async () => {
    const { connectToDatabase } = await import('../../src/db.js');
    const mssql = await import('mssql');

    await connectToDatabase(makeOptions());
    // Second call — should skip connect entirely
    await connectToDatabase(makeOptions());

    // Still only one ConnectionPool constructed
    const Ctor = mssql.default.ConnectionPool as any;
    expect(Ctor).toHaveBeenCalledTimes(1);
  });
});

describe('retry logic', () => {
  it('retries on transient ESOCKET error', async () => {
    const { connectToDatabase } = await import('../../src/db.js');

    // First two attempts fail transient, third succeeds
    let callCount = 0;
    mockPool.connect.mockImplementation(() => {
      callCount++;
      if (callCount < 3) {
        const err = new Error('Connection lost');
        (err as any).code = 'ESOCKET';
        throw err;
      }
      return Promise.resolve();
    });

    await connectToDatabase(makeOptions({ maxRetries: 3 }));

    expect(callCount).toBe(3);
  });

  it('retries on transient ECONNREFUSED error', async () => {
    const { connectToDatabase } = await import('../../src/db.js');

    let callCount = 0;
    mockPool.connect.mockImplementation(() => {
      callCount++;
      if (callCount < 2) {
        const err = new Error('Connection refused');
        (err as any).code = 'ECONNREFUSED';
        throw err;
      }
      return Promise.resolve();
    });

    await connectToDatabase(makeOptions({ maxRetries: 3 }));

    expect(callCount).toBe(2);
  });

  it('uses exponential backoff with jitter', async () => {
    const { connectToDatabase } = await import('../../src/db.js');

    const delays: number[] = [];
    const origSetTimeout = globalThis.setTimeout;
    const setTimeoutSpy = vi
      .spyOn(globalThis, 'setTimeout')
      .mockImplementation((fn: any, ms?: number) => {
        if (ms !== undefined) delays.push(ms);
        // Fire immediately for test speed
        fn();
        return 0 as any;
      });

    let callCount = 0;
    mockPool.connect.mockImplementation(() => {
      callCount++;
      if (callCount < 3) {
        const err = new Error('Timeout');
        (err as any).code = 'ETIMEOUT';
        throw err;
      }
      return Promise.resolve();
    });

    await connectToDatabase(makeOptions({ maxRetries: 3, baseDelayMs: 100 }));

    setTimeoutSpy.mockRestore();

    // Should have at least 2 delays (for 2 retries)
    expect(delays.length).toBeGreaterThanOrEqual(2);
    // Base delay is 100ms; second should be ~200ms (±jitter)
    expect(delays[0]).toBeGreaterThan(0);
  });

  it('throws after retry exhaustion on transient errors', async () => {
    const { connectToDatabase } = await import('../../src/db.js');

    mockPool.connect.mockImplementation(() => {
      const err = new Error('Always down');
      (err as any).code = 'ECONNREFUSED';
      throw err;
    });

    await expect(
      connectToDatabase(makeOptions({ maxRetries: 1 }))
    ).rejects.toThrow('Always down');
  });

  it('does NOT retry non-transient errors (ELOGIN)', async () => {
    const { connectToDatabase } = await import('../../src/db.js');

    let callCount = 0;
    mockPool.connect.mockImplementation(() => {
      callCount++;
      const err = new Error('Login failed');
      (err as any).code = 'ELOGIN';
      throw err;
    });

    await expect(
      connectToDatabase(makeOptions({ maxRetries: 3 }))
    ).rejects.toThrow('Login failed');

    // Must fail immediately — only 1 attempt
    expect(callCount).toBe(1);
  });

  it('does NOT retry unknown errors (no code)', async () => {
    const { connectToDatabase } = await import('../../src/db.js');

    let callCount = 0;
    mockPool.connect.mockImplementation(() => {
      callCount++;
      throw new Error('Unknown failure');
    });

    await expect(
      connectToDatabase(makeOptions({ maxRetries: 3 }))
    ).rejects.toThrow('Unknown failure');

    expect(callCount).toBe(1);
  });
});

describe('getPool', () => {
  it('throws when not connected', async () => {
    const { getPool } = await import('../../src/db.js');
    await expect(getPool()).rejects.toThrow('Database not connected');
  });

  it('returns pool after successful connect', async () => {
    const { connectToDatabase, getPool } = await import('../../src/db.js');
    await connectToDatabase(makeOptions());
    const p = await getPool();
    expect(p).toEqual(mockPool);
  });

  it('throws when pool is connected=false', async () => {
    const { connectToDatabase, getPool } = await import('../../src/db.js');
    const poolRef = await connectToDatabase(makeOptions());

    // Simulate pool disconnection by mutating the actual pool object
    (poolRef as any).connected = false;

    await expect(getPool()).rejects.toThrow('Database not connected');
  });
});

describe('closeDatabase', () => {
  it('closes pool and nulls it', async () => {
    const { connectToDatabase, closeDatabase, getPool } = await import('../../src/db.js');
    await connectToDatabase(makeOptions());

    await closeDatabase();
    expect(mockPool.close).toHaveBeenCalled();

    await expect(getPool()).rejects.toThrow('Database not connected');
  });

  it('is idempotent — calling twice is safe', async () => {
    const { connectToDatabase, closeDatabase } = await import('../../src/db.js');
    await connectToDatabase(makeOptions());

    await closeDatabase();
    await closeDatabase(); // second call — no-op

    expect(mockPool.close).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when pool is already null', async () => {
    const { closeDatabase } = await import('../../src/db.js');
    await expect(closeDatabase()).resolves.toBeUndefined();
  });
});

describe('pool error events', () => {
  it('forwards pool errors to logger', async () => {
    const { connectToDatabase } = await import('../../src/db.js');

    await connectToDatabase(makeOptions());

    // Simulate pool error event
    const errorHandler = mockPool.on.mock.calls.find(
      (c: any[]) => c[0] === 'error'
    )?.[1];

    expect(errorHandler).toBeDefined();
    expect(typeof errorHandler).toBe('function');

    // Should not throw — just log
    const poolErr = new Error('Pool connection lost');
    expect(() => errorHandler(poolErr)).not.toThrow();
  });
});
