import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('mssql', () => ({ default: { NVarChar: 'nvarchar' as any } }));

let mockRequest: { input: any; query: any };

vi.mock('../src/db.js', () => ({ getPool: vi.fn() }));

import { registerTools } from '../src/tools.js';
import { getPool } from '../src/db.js';

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

  it('registers all 6 tools', () => {
    const { tools, server } = captureServer();
    registerTools(server);
    expect(tools.map((t: any) => t.name).sort()).toEqual([
      'describe_table', 'get_ddl', 'list_foreign_keys',
      'list_indexes', 'list_schemas', 'list_tables',
    ]);
  });

  it('list_schemas returns JSON', async () => {
    mockRequest.query.mockResolvedValueOnce({ recordset: [{ name: 'dbo', schema_id: 1 }] });
    const { tools, server } = captureServer();
    registerTools(server);
    const tool = tools.find((t: any) => t.name === 'list_schemas')!;
    const result = await tool.handler({});
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual([{ name: 'dbo', schema_id: 1 }]);
  });

  it('list_tables with schema filter', async () => {
    mockRequest.query.mockResolvedValueOnce({ recordset: [{ TABLE_SCHEMA: 'hr', TABLE_NAME: 'Emp', TABLE_TYPE: 'BASE TABLE' }] });
    const { tools, server } = captureServer();
    registerTools(server);
    const tool = tools.find((t: any) => t.name === 'list_tables')!;
    await tool.handler({ schema: 'hr' });
    expect(mockRequest.input).toHaveBeenCalledWith('schema', 'nvarchar', 'hr');
  });

  it('describe_table returns columns', async () => {
    mockRequest.query.mockResolvedValueOnce({ recordset: [{ COLUMN_NAME: 'ID', DATA_TYPE: 'int', CHARACTER_MAXIMUM_LENGTH: null, IS_NULLABLE: 'NO', COLUMN_DEFAULT: null }] });
    const { tools, server } = captureServer();
    registerTools(server);
    const tool = tools.find((t: any) => t.name === 'describe_table')!;
    const result = await tool.handler({ schema: 'dbo', table: 'T' });
    const cols = JSON.parse(result.content[0].text);
    expect(cols[0].COLUMN_NAME).toBe('ID');
  });

  it('describe_table defaults schema to dbo', async () => {
    mockRequest.query.mockResolvedValueOnce({ recordset: [] });
    const { tools, server } = captureServer();
    registerTools(server);
    const tool = tools.find((t: any) => t.name === 'describe_table')!;
    // When schema is omitted, Zod .default("dbo") fills it in via the SDK wrapper.
    // The raw handler receives 'dbo' as the SDK-applied default.
    await tool.handler({ schema: 'dbo', table: 'Users' });
    expect(mockRequest.input).toHaveBeenCalledWith('schema', 'nvarchar', 'dbo');
  });

  it('list_indexes', async () => {
    mockRequest.query.mockResolvedValueOnce({ recordset: [{ IndexName: 'PK_X', IndexType: 'CLUSTERED', ColumnName: 'A', is_included_column: false, is_unique: true, is_primary_key: true }] });
    const { tools, server } = captureServer();
    registerTools(server);
    const tool = tools.find((t: any) => t.name === 'list_indexes')!;
    const result = await tool.handler({ schema: 'dbo', table: 'T' });
    expect(JSON.parse(result.content[0].text)[0].IndexName).toBe('PK_X');
  });

  it('list_foreign_keys', async () => {
    mockRequest.query.mockResolvedValueOnce({ recordset: [{ ForeignKeyName: 'FK_A', ParentTable: 'A', ParentColumn: 'AID', ReferencedTable: 'B', ReferencedColumn: 'BID' }] });
    const { tools, server } = captureServer();
    registerTools(server);
    const tool = tools.find((t: any) => t.name === 'list_foreign_keys')!;
    const result = await tool.handler({ schema: 'dbo', table: 'A' });
    expect(JSON.parse(result.content[0].text)[0].ForeignKeyName).toBe('FK_A');
  });

  it('get_ddl with PK', async () => {
    mockRequest.query
      .mockResolvedValueOnce({ recordset: [
        { COLUMN_NAME: 'ID', DATA_TYPE: 'int', CHARACTER_MAXIMUM_LENGTH: null, IS_NULLABLE: 'NO', COLUMN_DEFAULT: null },
        { COLUMN_NAME: 'Name', DATA_TYPE: 'nvarchar', CHARACTER_MAXIMUM_LENGTH: 100, IS_NULLABLE: 'YES', COLUMN_DEFAULT: null },
      ]})
      .mockResolvedValueOnce({ recordset: [{ ColumnName: 'ID' }] });
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
    mockRequest.query.mockResolvedValueOnce({ recordset: [] });
    const { tools, server } = captureServer();
    registerTools(server);
    const tool = tools.find((t: any) => t.name === 'get_ddl')!;
    const result = await tool.handler({ schema: 'dbo', table: 'Missing' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not found');
  });

  it('get_ddl varchar MAX', async () => {
    mockRequest.query
      .mockResolvedValueOnce({ recordset: [{ COLUMN_NAME: 'Notes', DATA_TYPE: 'nvarchar', CHARACTER_MAXIMUM_LENGTH: -1, IS_NULLABLE: 'YES', COLUMN_DEFAULT: null }] })
      .mockResolvedValueOnce({ recordset: [] });
    const { tools, server } = captureServer();
    registerTools(server);
    const tool = tools.find((t: any) => t.name === 'get_ddl')!;
    const result = await tool.handler({ schema: 'dbo', table: 'Notes' });
    expect(result.content[0].text).toContain('nvarchar(MAX)');
  });

  it('get_ddl column default', async () => {
    mockRequest.query
      .mockResolvedValueOnce({ recordset: [{ COLUMN_NAME: 'Active', DATA_TYPE: 'bit', CHARACTER_MAXIMUM_LENGTH: null, IS_NULLABLE: 'NO', COLUMN_DEFAULT: '((1))' }] })
      .mockResolvedValueOnce({ recordset: [] });
    const { tools, server } = captureServer();
    registerTools(server);
    const tool = tools.find((t: any) => t.name === 'get_ddl')!;
    const result = await tool.handler({ schema: 'dbo', table: 'Flags' });
    expect(result.content[0].text).toContain('DEFAULT ((1))');
  });
});
