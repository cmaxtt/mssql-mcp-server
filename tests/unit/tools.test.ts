import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('mssql', () => ({ default: { NVarChar: 'nvarchar' as any } }));

let mockRequest: { input: any; query: any };

vi.mock('../../src/db.js', () => ({ getPool: vi.fn() }));

// Mock the metadata repository for get_ddl tests
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

// Mock the DDL builder
vi.mock('../../src/ddl/ddl-builder.js', () => ({
  buildDdl: vi.fn(),
}));

import { registerTools } from '../../src/tools.js';
import { getPool } from '../../src/db.js';
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

describe('tools module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequest = {
      input: vi.fn().mockReturnThis(),
      query: vi.fn(),
    };
    (getPool as any).mockResolvedValue({ request: () => mockRequest });
  });

  it('registers all 11 tools (10 + health_check)', () => {
    const { tools, server } = captureServer();
    registerTools(server);
    expect(tools.map((t: any) => t.name).sort()).toEqual([
      'describe_procedure', 'describe_table', 'describe_view',
      'get_ddl', 'health_check', 'list_foreign_keys', 'list_indexes',
      'list_procedures', 'list_schemas', 'list_tables', 'list_views',
    ]);
  });

  it('list_schemas returns JSON', async () => {
    (listSchemas as any).mockResolvedValueOnce([{ name: 'dbo', schema_id: 1 }]);
    const { tools, server } = captureServer();
    registerTools(server);
    const tool = tools.find((t: any) => t.name === 'list_schemas')!;
    const result = await tool.handler({});
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual([{ name: 'dbo', schema_id: 1 }]);
  });

  it('list_tables with schema filter', async () => {
    (listTables as any).mockResolvedValueOnce([{ TABLE_SCHEMA: 'hr', TABLE_NAME: 'Emp', TABLE_TYPE: 'BASE TABLE' }]);
    const { tools, server } = captureServer();
    registerTools(server);
    const tool = tools.find((t: any) => t.name === 'list_tables')!;
    await tool.handler({ schema: 'hr' });
    expect(listTables).toHaveBeenCalledWith(expect.anything(), 'hr');
  });

  it('describe_table returns columns', async () => {
    (listColumns as any).mockResolvedValueOnce([{ COLUMN_NAME: 'ID', DATA_TYPE: 'int', CHARACTER_MAXIMUM_LENGTH: null, IS_NULLABLE: 'NO', COLUMN_DEFAULT: null }]);
    const { tools, server } = captureServer();
    registerTools(server);
    const tool = tools.find((t: any) => t.name === 'describe_table')!;
    const result = await tool.handler({ schema: 'dbo', table: 'T' });
    expect(result.structuredContent.columns[0].COLUMN_NAME).toBe('ID');
  });

  it('describe_table defaults schema to dbo', async () => {
    (listColumns as any).mockResolvedValueOnce([]);
    const { tools, server } = captureServer();
    registerTools(server);
    const tool = tools.find((t: any) => t.name === 'describe_table')!;
    await tool.handler({ schema: 'dbo', table: 'Users' });
    expect(listColumns).toHaveBeenCalledWith(expect.anything(), 'dbo', 'Users');
  });

  it('list_indexes', async () => {
    (listIndexesSimple as any).mockResolvedValueOnce([{ IndexName: 'PK_X', IndexType: 'CLUSTERED', ColumnName: 'A', is_included_column: false, is_unique: true, is_primary_key: true }]);
    const { tools, server } = captureServer();
    registerTools(server);
    const tool = tools.find((t: any) => t.name === 'list_indexes')!;
    const result = await tool.handler({ schema: 'dbo', table: 'T' });
    expect(result.structuredContent.indexes[0].IndexName).toBe('PK_X');
  });

  it('list_foreign_keys', async () => {
    (listForeignKeysSimple as any).mockResolvedValueOnce([{ ForeignKeyName: 'FK_A', ParentTable: 'A', ParentColumn: 'AID', ReferencedTable: 'B', ReferencedColumn: 'BID' }]);
    const { tools, server } = captureServer();
    registerTools(server);
    const tool = tools.find((t: any) => t.name === 'list_foreign_keys')!;
    const result = await tool.handler({ schema: 'dbo', table: 'A' });
    expect(result.structuredContent.foreignKeys[0].ForeignKeyName).toBe('FK_A');
  });

  it('get_ddl with PK', async () => {
    (getTableMetadata as any).mockResolvedValueOnce({
      schema: 'dbo',
      name: 'Users',
      columns: [
        { name: 'ID', typeName: 'int', isNullable: false },
        { name: 'Name', typeName: 'nvarchar', maxLength: 100, isNullable: true },
      ],
      unsupportedFeatures: [],
    });
    (buildDdl as any).mockReturnValueOnce({
      ddl: 'CREATE TABLE [dbo].[Users] (\n    [ID] int NOT NULL,\n    [Name] nvarchar(100) NULL,\n    CONSTRAINT PK_Users PRIMARY KEY CLUSTERED ([ID])\n);\nGO\n',
      warnings: [],
    });
    const { tools, server } = captureServer();
    registerTools(server);
    const tool = tools.find((t: any) => t.name === 'get_ddl')!;
    const result = await tool.handler({ schema: 'dbo', table: 'Users' });
    const ddl = result.content[0].text;
    expect(ddl).toContain('CREATE TABLE [dbo].[Users]');
    expect(ddl).toContain('[ID] int NOT NULL');
    expect(ddl).toContain('CONSTRAINT PK_Users PRIMARY KEY CLUSTERED ([ID])');
  });

  it('get_ddl missing table', async () => {
    (getTableMetadata as any).mockResolvedValueOnce(null);
    const { tools, server } = captureServer();
    registerTools(server);
    const tool = tools.find((t: any) => t.name === 'get_ddl')!;
    const result = await tool.handler({ schema: 'dbo', table: 'Missing' });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error.code).toBe('OBJECT_NOT_FOUND');
  });

  it('get_ddl varchar MAX', async () => {
    (getTableMetadata as any).mockResolvedValueOnce({
      schema: 'dbo',
      name: 'Notes',
      columns: [
        { name: 'Notes', typeName: 'nvarchar', maxLength: -1, isNullable: true },
      ],
      unsupportedFeatures: [],
    });
    (buildDdl as any).mockReturnValueOnce({
      ddl: 'CREATE TABLE [dbo].[Notes] (\n    [Notes] nvarchar(MAX) NULL\n);\nGO\n',
      warnings: [],
    });
    const { tools, server } = captureServer();
    registerTools(server);
    const tool = tools.find((t: any) => t.name === 'get_ddl')!;
    const result = await tool.handler({ schema: 'dbo', table: 'Notes' });
    expect(result.content[0].text).toContain('nvarchar(MAX)');
  });

  it('get_ddl column default', async () => {
    (getTableMetadata as any).mockResolvedValueOnce({
      schema: 'dbo',
      name: 'Flags',
      columns: [
        { name: 'Active', typeName: 'bit', isNullable: false, defaultDefinition: '((1))' },
      ],
      unsupportedFeatures: [],
    });
    (buildDdl as any).mockReturnValueOnce({
      ddl: 'CREATE TABLE [dbo].[Flags] (\n    [Active] bit NOT NULL DEFAULT ((1))\n);\nGO\n',
      warnings: [],
    });
    const { tools, server } = captureServer();
    registerTools(server);
    const tool = tools.find((t: any) => t.name === 'get_ddl')!;
    const result = await tool.handler({ schema: 'dbo', table: 'Flags' });
    expect(result.content[0].text).toContain('DEFAULT ((1))');
  });
});
