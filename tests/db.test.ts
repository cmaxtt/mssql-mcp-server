import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock mssql before anything imports db
vi.mock('mssql', () => {
  const mockPool = {
    close: vi.fn().mockResolvedValue(undefined),
    request: vi.fn(),
  };
  return {
    default: {
      connect: vi.fn().mockResolvedValue(mockPool),
      NVarChar: 'nvarchar' as any,
      ConnectionPool: vi.fn(),
    },
  };
});

describe('db module', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.clearAllMocks();
  });

  describe('connectToDatabase config parsing', () => {
    it('uses DB_HOST from env', async () => {
      vi.stubEnv('DB_HOST', 'test-server');
      vi.stubEnv('DB_USER', 'sa');
      vi.stubEnv('DB_PASSWORD', 'pwd');
      vi.stubEnv('DB_NAME', 'testdb');

      const { connectToDatabase } = await import('../src/db.js');
      const mssql = await import('mssql');
      await connectToDatabase();

      const config = (mssql.default.connect as any).mock.calls[0][0];
      expect(config.server).toBe('test-server');
      expect(config.user).toBe('sa');
      expect(config.password).toBe('pwd');
      expect(config.database).toBe('testdb');
    });

    it('defaults DB_HOST to localhost when unset', async () => {
      vi.stubEnv('DB_USER', 'sa');
      vi.stubEnv('DB_PASSWORD', 'pwd');
      vi.stubEnv('DB_NAME', 'testdb');

      const { connectToDatabase } = await import('../src/db.js');
      const mssql = await import('mssql');
      await connectToDatabase();

      const config = (mssql.default.connect as any).mock.calls[0][0];
      expect(config.server).toBe('localhost');
    });

    it('defaults DB_PORT to 1433 when unset', async () => {
      vi.stubEnv('DB_HOST', 'test-server');
      vi.stubEnv('DB_USER', 'sa');
      vi.stubEnv('DB_PASSWORD', 'pwd');
      vi.stubEnv('DB_NAME', 'testdb');

      const { connectToDatabase } = await import('../src/db.js');
      const mssql = await import('mssql');
      await connectToDatabase();

      const config = (mssql.default.connect as any).mock.calls[0][0];
      expect(config.port).toBe(1433);
    });

    it('parses numeric DB_PORT from env', async () => {
      vi.stubEnv('DB_HOST', 'test-server');
      vi.stubEnv('DB_USER', 'sa');
      vi.stubEnv('DB_PASSWORD', 'pwd');
      vi.stubEnv('DB_NAME', 'testdb');
      vi.stubEnv('DB_PORT', '5433');

      const { connectToDatabase } = await import('../src/db.js');
      const mssql = await import('mssql');
      await connectToDatabase();

      const config = (mssql.default.connect as any).mock.calls[0][0];
      expect(config.port).toBe(5433);
    });

    it('sets encrypt=true when DB_ENCRYPT=true', async () => {
      vi.stubEnv('DB_HOST', 'test-server');
      vi.stubEnv('DB_USER', 'sa');
      vi.stubEnv('DB_PASSWORD', 'pwd');
      vi.stubEnv('DB_NAME', 'testdb');
      vi.stubEnv('DB_ENCRYPT', 'true');

      const { connectToDatabase } = await import('../src/db.js');
      const mssql = await import('mssql');
      await connectToDatabase();

      const config = (mssql.default.connect as any).mock.calls[0][0];
      expect(config.options.encrypt).toBe(true);
    });

    it('sets encrypt=false when DB_ENCRYPT=false', async () => {
      vi.stubEnv('DB_HOST', 'test-server');
      vi.stubEnv('DB_USER', 'sa');
      vi.stubEnv('DB_PASSWORD', 'pwd');
      vi.stubEnv('DB_NAME', 'testdb');
      vi.stubEnv('DB_ENCRYPT', 'false');

      const { connectToDatabase } = await import('../src/db.js');
      const mssql = await import('mssql');
      await connectToDatabase();

      const config = (mssql.default.connect as any).mock.calls[0][0];
      expect(config.options.encrypt).toBe(false);
    });

    it('sets trustServerCertificate=true when DB_TRUST_CERT=true', async () => {
      vi.stubEnv('DB_HOST', 'test-server');
      vi.stubEnv('DB_USER', 'sa');
      vi.stubEnv('DB_PASSWORD', 'pwd');
      vi.stubEnv('DB_NAME', 'testdb');
      vi.stubEnv('DB_TRUST_CERT', 'true');

      const { connectToDatabase } = await import('../src/db.js');
      const mssql = await import('mssql');
      await connectToDatabase();

      const config = (mssql.default.connect as any).mock.calls[0][0];
      expect(config.options.trustServerCertificate).toBe(true);
    });

    it('sets trustServerCertificate=false when DB_TRUST_CERT=anything else', async () => {
      vi.stubEnv('DB_HOST', 'test-server');
      vi.stubEnv('DB_USER', 'sa');
      vi.stubEnv('DB_PASSWORD', 'pwd');
      vi.stubEnv('DB_NAME', 'testdb');
      vi.stubEnv('DB_TRUST_CERT', 'false');

      const { connectToDatabase } = await import('../src/db.js');
      const mssql = await import('mssql');
      await connectToDatabase();

      const config = (mssql.default.connect as any).mock.calls[0][0];
      expect(config.options.trustServerCertificate).toBe(false);
    });

    it('masks password in log output', async () => {
      vi.stubEnv('DB_HOST', 'test-server');
      vi.stubEnv('DB_USER', 'sa');
      vi.stubEnv('DB_PASSWORD', 'pass@word123');
      vi.stubEnv('DB_NAME', 'testdb');

      const spy = vi.spyOn(console, 'error');
      const { connectToDatabase } = await import('../src/db.js');
      await connectToDatabase();

      // The log should show masked password with last 3 chars visible
      const configObjCall = spy.mock.calls.find(
        (c) => typeof c[1] === 'object' && c[1] !== null && 'password' in c[1]
      );
      expect(configObjCall).toBeDefined();
      const maskedPwd = (configObjCall![1] as any).password;
      expect(maskedPwd).toContain('*****');
      expect(maskedPwd).toContain('123'); // last 3 chars
      expect(maskedPwd).not.toBe('pass@word123');

      spy.mockRestore();
    });
  });

  describe('getPool lifecycle', () => {
    it('throws when pool is not connected', async () => {
      const { getPool } = await import('../src/db.js');
      await expect(getPool()).rejects.toThrow('Database not connected');
    });

    it('returns pool after successful connect', async () => {
      vi.stubEnv('DB_HOST', 'test-server');
      vi.stubEnv('DB_USER', 'sa');
      vi.stubEnv('DB_PASSWORD', 'pwd');
      vi.stubEnv('DB_NAME', 'testdb');

      const { connectToDatabase, getPool } = await import('../src/db.js');
      await connectToDatabase();
      const pool = await getPool();
      expect(pool).toBeDefined();
      expect(pool.request).toBeDefined();
    });
  });

  describe('closeDatabase', () => {
    it('closes pool and nulls it', async () => {
      vi.stubEnv('DB_HOST', 'test-server');
      vi.stubEnv('DB_USER', 'sa');
      vi.stubEnv('DB_PASSWORD', 'pwd');
      vi.stubEnv('DB_NAME', 'testdb');

      const { connectToDatabase, closeDatabase, getPool } = await import('../src/db.js');
      await connectToDatabase();

      const pool = await getPool();
      expect(pool).toBeDefined();

      await closeDatabase();

      await expect(getPool()).rejects.toThrow('Database not connected');
    });

    it('is a no-op when pool is already null', async () => {
      const { closeDatabase } = await import('../src/db.js');
      await expect(closeDatabase()).resolves.toBeUndefined();
    });
  });

  describe('connectToDatabase error handling', () => {
    it('throws when connection fails', async () => {
      vi.stubEnv('DB_HOST', 'invalid-host');
      vi.stubEnv('DB_USER', 'sa');
      vi.stubEnv('DB_PASSWORD', 'pwd');
      vi.stubEnv('DB_NAME', 'testdb');

      const mssql = await import('mssql');
      (mssql.default.connect as any).mockRejectedValueOnce(new Error('Connection refused'));

      const { connectToDatabase } = await import('../src/db.js');
      await expect(connectToDatabase()).rejects.toThrow('Connection refused');
    });
  });
});
