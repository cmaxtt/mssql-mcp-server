import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the database module
vi.mock('../../src/db.js', () => ({
  getPool: vi.fn(),
  connectToDatabase: vi.fn().mockResolvedValue(undefined),
  closeDatabase: vi.fn(),
  _resetForTesting: vi.fn(),
}));

// Mock the metadata repo + DDL builder
vi.mock('../../src/db/metadata-repository.js', () => ({
  listSchemas: vi.fn(),
  listTables: vi.fn(),
  listColumns: vi.fn(),
  listIndexesSimple: vi.fn(),
  listForeignKeysSimple: vi.fn(),
  getTableMetadata: vi.fn(),
  listViews: vi.fn(),
  getViewDetail: vi.fn(),
  listProcedures: vi.fn(),
  getProcedureDetail: vi.fn(),
}));

vi.mock('../../src/ddl/ddl-builder.js', () => ({
  buildDdl: vi.fn(),
}));

vi.mock('mssql', () => ({
  default: { NVarChar: 'nvarchar' as any },
}));

import { registerTools } from '../../src/tools.js';
import {
  listSchemas,
  listTables,
  listColumns,
  listIndexesSimple,
  listForeignKeysSimple,
  getTableMetadata,
} from '../../src/db/metadata-repository.js';
import { buildDdl } from '../../src/ddl/ddl-builder.js';

function captureServer() {
  const tools: any[] = [];
  const server = {
    tool: (name: string, desc: string, schema: any, handler: any) => {
      tools.push({ name, desc, schema, handler });
    },
  };
  return { tools, server };
}

describe('MCP contract tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('all 11 tools are registered (10 + health_check)', () => {
    const { tools, server } = captureServer();
    registerTools(server);
    expect(tools.map((t: any) => t.name).sort()).toEqual([
      'describe_procedure', 'describe_table', 'describe_view',
      'get_ddl', 'health_check', 'list_foreign_keys', 'list_indexes',
      'list_procedures', 'list_schemas', 'list_tables', 'list_views',
    ]);
  });

  describe('list_schemas contract', () => {
    it('returns content array with text and structuredContent', async () => {
      (listSchemas as any).mockResolvedValueOnce([{ name: 'dbo', schema_id: 1 }]);

      const { tools, server } = captureServer();
      registerTools(server);
      const tool = tools.find((t: any) => t.name === 'list_schemas')!;
      const result = await tool.handler({});

      expect(result.content).toBeDefined();
      expect(result.content.length).toBeGreaterThanOrEqual(1);
      expect(result.content[0].type).toBe('text');
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toEqual([{ name: 'dbo', schema_id: 1 }]);
      expect(result.structuredContent).toBeDefined();
      expect(result.structuredContent.schemas).toEqual([{ name: 'dbo', schema_id: 1 }]);
    });
  });

  describe('list_tables contract', () => {
    it('returns structuredContent with tables array and count', async () => {
      const rows = [{ TABLE_SCHEMA: 'hr', TABLE_NAME: 'Emp', TABLE_TYPE: 'BASE TABLE' }];
      (listTables as any).mockResolvedValueOnce(rows);

      const { tools, server } = captureServer();
      registerTools(server);
      const tool = tools.find((t: any) => t.name === 'list_tables')!;
      const result = await tool.handler({ schema: 'hr' });

      expect(result.structuredContent.tables).toEqual(rows);
      expect(result.structuredContent.count).toBe(1);
    });
  });

  describe('describe_table contract', () => {
    it('returns structuredContent with columns array', async () => {
      const rows = [{ COLUMN_NAME: 'ID', DATA_TYPE: 'int', CHARACTER_MAXIMUM_LENGTH: null, IS_NULLABLE: 'NO', COLUMN_DEFAULT: null }];
      (listColumns as any).mockResolvedValueOnce(rows);

      const { tools, server } = captureServer();
      registerTools(server);
      const tool = tools.find((t: any) => t.name === 'describe_table')!;
      const result = await tool.handler({ schema: 'dbo', table: 'T' });

      expect(result.structuredContent.schema).toBe('dbo');
      expect(result.structuredContent.table).toBe('T');
      expect(result.structuredContent.columns).toEqual(rows);
      expect(result.structuredContent.count).toBe(1);
    });
  });

  describe('list_indexes contract', () => {
    it('returns structuredContent with indexes array', async () => {
      const rows = [{ IndexName: 'PK_X', IndexType: 'CLUSTERED', ColumnName: 'A', is_included_column: false, is_unique: true, is_primary_key: true }];
      (listIndexesSimple as any).mockResolvedValueOnce(rows);

      const { tools, server } = captureServer();
      registerTools(server);
      const tool = tools.find((t: any) => t.name === 'list_indexes')!;
      const result = await tool.handler({ schema: 'dbo', table: 'T' });

      expect(result.structuredContent.indexes).toEqual(rows);
      expect(result.structuredContent.count).toBe(1);
    });
  });

  describe('list_foreign_keys contract', () => {
    it('returns structuredContent with foreignKeys array', async () => {
      const rows = [{ ForeignKeyName: 'FK_A', ParentTable: 'A', ParentColumn: 'AID', ReferencedTable: 'B', ReferencedColumn: 'BID' }];
      (listForeignKeysSimple as any).mockResolvedValueOnce(rows);

      const { tools, server } = captureServer();
      registerTools(server);
      const tool = tools.find((t: any) => t.name === 'list_foreign_keys')!;
      const result = await tool.handler({ schema: 'dbo', table: 'A' });

      expect(result.structuredContent.foreignKeys).toEqual(rows);
    });
  });

  describe('get_ddl contract', () => {
    it('returns structuredContent with ddl string on success', async () => {
      (getTableMetadata as any).mockResolvedValueOnce({
        schema: 'dbo',
        name: 'Users',
        columns: [],
        unsupportedFeatures: [],
      });
      (buildDdl as any).mockReturnValueOnce({
        ddl: 'CREATE TABLE [dbo].[Users] (\n    [ID] int NOT NULL\n);\nGO\n',
        warnings: [],
      });

      const { tools, server } = captureServer();
      registerTools(server);
      const tool = tools.find((t: any) => t.name === 'get_ddl')!;
      const result = await tool.handler({ schema: 'dbo', table: 'Users' });

      expect(result.structuredContent.schema).toBe('dbo');
      expect(result.structuredContent.table).toBe('Users');
      expect(result.structuredContent.ddl).toContain('CREATE TABLE');
    });

    it('returns structured error for missing table', async () => {
      (getTableMetadata as any).mockResolvedValueOnce(null);

      const { tools, server } = captureServer();
      registerTools(server);
      const tool = tools.find((t: any) => t.name === 'get_ddl')!;
      const result = await tool.handler({ schema: 'dbo', table: 'Missing' });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error.code).toBe('OBJECT_NOT_FOUND');
      expect(result.structuredContent.code).toBe('OBJECT_NOT_FOUND');
    });
  });

  describe('error sanitization', () => {
    it('returns sanitized error when DB throws', async () => {
      (listSchemas as any).mockRejectedValueOnce(new Error('Connection is closed.'));

      const { tools, server } = captureServer();
      registerTools(server);
      const tool = tools.find((t: any) => t.name === 'list_schemas')!;
      const result = await tool.handler({});

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error.code).toBe('DATABASE_UNAVAILABLE');
      expect(parsed.error.message).not.toContain('closed');
      expect(parsed.error.message).toContain('unavailable');
    });
  });
});
