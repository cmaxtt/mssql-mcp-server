import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { connectToDatabase, closeDatabase, getPool, _resetForTesting } from '../../src/db.js';
import { getTableMetadata } from '../../src/db/metadata-repository.js';
import { listViews, getViewDetail, listProcedures, getProcedureDetail } from '../../src/db/metadata-repository.js';
import { buildDdl } from '../../src/ddl/ddl-builder.js';
import { validateQuery } from '../../src/query/query-validator.js';

// ── Test configuration ──
// These match docker-compose.test.yml defaults
const TEST_DB = {
  connection: {
    useConnectionString: false,
    host: 'localhost',
    server: 'localhost',
    port: 14333,
    database: 'master',
    user: 'sa',
    password: process.env.MSSQL_SA_PASSWORD || 'TestPass123!',
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

// ── Setup / Teardown ──

let dockerAvailable = false;

beforeAll(async () => {
  // Check if Docker is available and the test container is running
  try {
    await connectToDatabase(TEST_DB);
    dockerAvailable = true;
    console.log('Integration tests: SQL Server connected on port 14333');
  } catch {
    console.log('Integration tests: Docker/SQL Server not available — skipping');
  }
}, 30000);

afterAll(async () => {
  if (dockerAvailable) {
    await closeDatabase();
    _resetForTesting();
  }
});

// ── Conditional test runner ──

const itIfDocker = dockerAvailable ? it : it.skip;

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

    const { ddl, warnings } = buildDdl(meta!);
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
    // Should have FK to Customers
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

describe('Integration: Query Execution', () => {
  itIfDocker('executes a simple SELECT', async () => {
    const pool = await getPool();
    const result = await pool.request().query('SELECT COUNT(*) AS cnt FROM MCP_Test_Customers');
    expect(result.recordset[0].cnt).toBeGreaterThanOrEqual(0);
  });

  itIfDocker('respects ROWCOUNT', async () => {
    const pool = await getPool();
    // Insert test data first
    await pool.request().query(`
      IF NOT EXISTS (SELECT 1 FROM MCP_Test_Customers)
      BEGIN
        INSERT INTO MCP_Test_Customers (Name, Email) VALUES ('Test A', 'a@test.com')
        INSERT INTO MCP_Test_Customers (Name, Email) VALUES ('Test B', 'b@test.com')
        INSERT INTO MCP_Test_Customers (Name, Email) VALUES ('Test C', 'c@test.com')
      END
    `);

    // Limit to 2 rows
    await pool.request().query('SET ROWCOUNT 2');
    const result = await pool.request().query('SELECT * FROM MCP_Test_Customers ORDER BY CustomerID');
    await pool.request().query('SET ROWCOUNT 0');

    expect(result.recordset.length).toBeLessThanOrEqual(2);
  });
});
