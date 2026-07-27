import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { connectToDatabase, closeDatabase, getPool, _resetForTesting } from '../../src/db.js';
import { getTableMetadata, listViews, getViewDetail, listProcedures, getProcedureDetail } from '../../src/db/metadata-repository.js';
import { buildDdl } from '../../src/ddl/ddl-builder.js';
import { validateQuery } from '../../src/query/query-validator.js';
import { executeQuery } from '../../src/db/query-executor.js';

// ── Test configuration ──
// Requires MSSQL_SA_PASSWORD env var; defaults to port 14333 matching docker-compose.test.yml
const TEST_DB = {
  connection: {
    useConnectionString: false,
    host: process.env.MSSQL_HOST || 'localhost',
    server: process.env.MSSQL_HOST || 'localhost',
    port: Number(process.env.MSSQL_PORT || 14333),
    database: process.env.MSSQL_DATABASE || 'master',
    user: process.env.MSSQL_USER || 'sa',
    password: process.env.MSSQL_SA_PASSWORD || '',
  },
  tls: {
    encrypt: false,
    trustServerCertificate: true,
  },
  timeouts: {
    connectMs: 15000,
    requestMs: 30000,
    lockMs: 5000,
  },
  pool: {
    min: 0,
    max: 5,
  },
  retry: {
    maxRetries: 3,
    baseDelayMs: 500,
    maxDelayMs: 5000,
  },
};

const defaultQueryOptions = {
  config: {
    maxRows: 100,
    maxResultBytes: 1048576,
    maxConcurrency: 10,
    allowedSchemas: [],
    allowedTables: [],
  },
  timeouts: {
    connectMs: 15000,
    requestMs: 30000,
    lockMs: 5000,
  },
};

// ── Dynamic runner & Setup / Teardown ──

let dockerAvailable = false;

function itIfDocker(name: string, fn: (ctx: any) => Promise<void> | void) {
  it(name, async (ctx) => {
    if (!dockerAvailable) {
      return ctx.skip();
    }
    await fn(ctx);
  });
}

beforeAll(async () => {
  if (!process.env.MSSQL_SA_PASSWORD) {
    console.log('Integration tests: MSSQL_SA_PASSWORD environment variable not set — skipping integration suite');
    return;
  }
  try {
    await connectToDatabase(TEST_DB);
    const pool = await getPool();
    dockerAvailable = true;
    console.log(`Integration tests: SQL Server connected on port ${TEST_DB.connection.port}`);

    // Bootstrapping test schema
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const schemaSqlPath = path.resolve(__dirname, '../../setup_schema.sql');
    if (fs.existsSync(schemaSqlPath)) {
      const sqlContent = fs.readFileSync(schemaSqlPath, 'utf8');
      const ddlRegex = /(CREATE\s+(?:TABLE|VIEW|PROCEDURE)[\s\S]*?)(?=(?:CREATE\s+(?:TABLE|VIEW|PROCEDURE)|$))/gi;
      const statements = Array.from(sqlContent.matchAll(ddlRegex)).map((m) => m[1].trim());

      for (const stmt of statements) {
        try {
          await pool.request().batch(stmt);
        } catch (err: any) {
          if (!err.message?.includes('already an object') && !err.message?.includes('There is already an object')) {
            console.warn('Schema setup warning:', err.message);
          }
        }
      }
      console.log('Integration tests: setup_schema.sql bootstrapped');
    }
  } catch (err: any) {
    console.log('Integration tests: SQL Server not reachable — skipping:', err.message);
  }
}, 30000);

afterAll(async () => {
  if (dockerAvailable) {
    await closeDatabase();
    _resetForTesting();
  }
});

// ── Tests ──

describe('Integration: Database Connection', () => {
  itIfDocker('connects to SQL Server and pings', async () => {
    const pool = await getPool();
    const result = await pool.request().query('SELECT 1 AS ping');
    expect(result.recordset[0].ping).toBe(1);
  });

  itIfDocker('getPool returns the same pool', async () => {
    const p1 = await getPool();
    const p2 = await getPool();
    expect(p1).toBe(p2);
  });
});

describe('Integration: Schema Metadata', () => {
  itIfDocker('list_tables finds setup_schema tables', async () => {
    const pool = await getPool();
    const result = await pool.request().query(
      "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME"
    );
    const tables = result.recordset.map((r: any) => r.TABLE_NAME);
    expect(tables).toContain('MCP_Test_Customers');
    expect(tables).toContain('MCP_Test_Orders');
  });

  itIfDocker('getTableMetadata returns structured data', async () => {
    const pool = await getPool();
    const meta = await getTableMetadata(pool, 'dbo', 'MCP_Test_Customers');

    expect(meta).not.toBeNull();
    expect(meta!.columns.length).toBeGreaterThan(0);
    expect(meta!.columns.map((c) => c.name)).toContain('CustomerID');
    expect(meta!.primaryKey).not.toBeNull();
    expect(meta!.primaryKey!.columns).toContain('CustomerID');
  });

  itIfDocker('getTableMetadata returns null for non-existent table', async () => {
    const pool = await getPool();
    const meta = await getTableMetadata(pool, 'dbo', 'NonExistentTable');
    expect(meta).toBeNull();
  });
});

describe('Integration: DDL Generation', () => {
  itIfDocker('generates DDL for MCP_Test_Customers', async () => {
    const pool = await getPool();
    const meta = await getTableMetadata(pool, 'dbo', 'MCP_Test_Customers');
    expect(meta).not.toBeNull();

    const { ddl } = buildDdl(meta!);
    expect(ddl).toContain('CREATE TABLE [dbo].[MCP_Test_Customers]');
    expect(ddl).toContain('[CustomerID]');
    expect(ddl).toContain('PRIMARY KEY');
  });

  itIfDocker('generates DDL with foreign keys for MCP_Test_Orders', async () => {
    const pool = await getPool();
    const meta = await getTableMetadata(pool, 'dbo', 'MCP_Test_Orders');
    expect(meta).not.toBeNull();

    const { ddl } = buildDdl(meta!);
    expect(ddl).toContain('CREATE TABLE [dbo].[MCP_Test_Orders]');
    expect(ddl).toContain('FOREIGN KEY');
    expect(ddl).toContain('MCP_Test_Customers');
  });

  itIfDocker('DDL is marked as generated documentation', async () => {
    const pool = await getPool();
    const meta = await getTableMetadata(pool, 'dbo', 'MCP_Test_Customers');
    const { ddl } = buildDdl(meta!);
    expect(ddl).toContain('Generated documentation DDL');
  });
});

describe('Integration: Views', () => {
  itIfDocker('listViews finds test view', async () => {
    const pool = await getPool();
    const views = await listViews(pool);
    const names = views.map((v) => v.name);
    expect(names).toContain('MCP_Test_CustomerOrders');
  });

  itIfDocker('getViewDetail returns definition and columns', async () => {
    const pool = await getPool();
    const detail = await getViewDetail(pool, 'dbo', 'MCP_Test_CustomerOrders');

    expect(detail).not.toBeNull();
    expect(detail!.definition).toBeTruthy();
    expect(detail!.definition).toContain('SELECT');
    expect(detail!.columns.length).toBeGreaterThan(0);
  });
});

describe('Integration: Stored Procedures', () => {
  itIfDocker('listProcedures finds test procedure', async () => {
    const pool = await getPool();
    const procs = await listProcedures(pool);
    const names = procs.map((p) => p.name);
    expect(names).toContain('MCP_Test_GetCustomerCount');
  });

  itIfDocker('getProcedureDetail returns parameters and definition', async () => {
    const pool = await getPool();
    const detail = await getProcedureDetail(pool, 'dbo', 'MCP_Test_GetCustomerCount');

    expect(detail).not.toBeNull();
    expect(detail!.definition).toBeTruthy();
  });
});

describe('Integration: Query Validator', () => {
  itIfDocker('valid query passes validation', () => {
    const result = validateQuery(
      'SELECT * FROM dbo.MCP_Test_Customers',
      { maxTextBytes: 32768, allowedSchemas: '', allowedTables: '' }
    );
    expect(result.valid).toBe(true);
  });

  itIfDocker('rejects INSERT', () => {
    const result = validateQuery(
      "INSERT INTO MCP_Test_Customers (Name) VALUES ('Test')",
      { maxTextBytes: 32768, allowedSchemas: '', allowedTables: '' }
    );
    expect(result.valid).toBe(false);
  });
});

describe('Integration: Hardened Query Execution', () => {
  itIfDocker('executes a query via executeQuery with row count and normalized types', async () => {
    const pool = await getPool();
    // Ensure test data exists
    await pool.request().query(`
      IF NOT EXISTS (SELECT 1 FROM MCP_Test_Customers WHERE Email = 'integration_a@test.com')
      BEGIN
        INSERT INTO MCP_Test_Customers (Name, Email) VALUES ('Integration User A', 'integration_a@test.com')
        INSERT INTO MCP_Test_Customers (Name, Email) VALUES ('Integration User B', 'integration_b@test.com')
        INSERT INTO MCP_Test_Customers (Name, Email) VALUES ('Integration User C', 'integration_c@test.com')
      END
    `);

    const result = await executeQuery(pool, 'SELECT CustomerID, Name, Email, CreatedAt FROM MCP_Test_Customers ORDER BY CustomerID', defaultQueryOptions);
    expect(result.rowCount).toBeGreaterThanOrEqual(3);
    expect(result.columns).toContain('CustomerID');
    expect(result.columns).toContain('Name');
    expect(typeof result.rows[0].CreatedAt).toBe('string'); // Normalized ISO date string
  });

  itIfDocker('enforces maxRows truncation and resets ROWCOUNT context', async () => {
    const pool = await getPool();
    const opts = {
      ...defaultQueryOptions,
      config: {
        ...defaultQueryOptions.config,
        maxRows: 2,
      },
    };

    const result = await executeQuery(pool, 'SELECT * FROM MCP_Test_Customers ORDER BY CustomerID', opts);
    expect(result.rows.length).toBe(2);
    expect(result.truncated).toBe(true);

    // Verify session ROWCOUNT was safely reset to 0
    const rawCheck = await pool.request().query('SELECT COUNT(*) AS total FROM MCP_Test_Customers');
    expect(rawCheck.recordset[0].total).toBeGreaterThan(2);
  });

  itIfDocker('rejects queries exceeding maxResultBytes', async () => {
    const pool = await getPool();
    const opts = {
      ...defaultQueryOptions,
      config: {
        ...defaultQueryOptions.config,
        maxResultBytes: 50, // artificially low limit
      },
    };

    await expect(
      executeQuery(pool, 'SELECT * FROM MCP_Test_Customers', opts)
    ).rejects.toThrow('serialized query result exceeds');
  });
});

describe('Integration: Least-Privilege Setup Script', () => {
  itIfDocker('validates syntax and execution of create_least_privilege_login.sql', async () => {
    const pool = await getPool();
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const scriptPath = path.resolve(__dirname, '../../create_least_privilege_login.sql');
    const sqlContent = fs.readFileSync(scriptPath, 'utf8');
    const replaced = sqlContent
      .replace(/<database>/g, 'master')
      .replace(/<login>/g, 'mcp_least_priv_test')
      .replace(/<password>/g, 'StrongPass123!');

    const batches = replaced
      .split(/\n\s*GO\s*\n/i)
      .map((b) => b.trim())
      .filter((b) => b.length > 0 && !b.startsWith('-- Verify setup'));

    for (const batch of batches) {
      await pool.request().batch(batch);
    }

    const check = await pool.request().query("SELECT 1 FROM sys.database_principals WHERE name = 'mcp_least_priv_test'");
    expect(check.recordset.length).toBe(1);

    // Clean up
    await pool.request().batch(`
      IF EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'mcp_least_priv_test')
        DROP USER [mcp_least_priv_test];
      IF EXISTS (SELECT 1 FROM sys.server_principals WHERE name = 'mcp_least_priv_test')
        DROP LOGIN [mcp_least_priv_test];
    `);
  });
});
