import { describe, it, expect } from 'vitest';
import { buildDdl, quoteIdentifier } from '../../src/ddl/ddl-builder.js';
import type { TableMetadata } from '../../src/db/metadata-repository.js';

// ── Test fixtures ──

function baseTable(overrides: Partial<TableMetadata> = {}): TableMetadata {
  return {
    schema: 'dbo',
    name: 'TestTable',
    columns: [],
    primaryKey: null,
    uniqueConstraints: [],
    checkConstraints: [],
    foreignKeys: [],
    indexes: [],
    unsupportedFeatures: [],
    ...overrides,
  };
}

describe('buildDdl', () => {
  describe('basic table', () => {
    it('generates CREATE TABLE with schema-qualified name', () => {
      const meta = baseTable({
        columns: [
          { name: 'ID', typeName: 'int', maxLength: null, precision: 10, scale: 0, collation: null, isNullable: false, isIdentity: true, identitySeed: 1, identityIncrement: 1, isComputed: false, computedDefinition: null, isPersisted: false, defaultDefinition: null, defaultName: null },
        ],
      });

      const { ddl } = buildDdl(meta);
      expect(ddl).toContain('CREATE TABLE [dbo].[TestTable]');
      expect(ddl).toContain('[ID] int IDENTITY(1,1) NOT NULL');
    });

    it('generates multiple columns', () => {
      const meta = baseTable({
        columns: [
          { name: 'ID', typeName: 'int', maxLength: null, precision: 10, scale: 0, collation: null, isNullable: false, isIdentity: true, identitySeed: 1, identityIncrement: 1, isComputed: false, computedDefinition: null, isPersisted: false, defaultDefinition: null, defaultName: null },
          { name: 'Name', typeName: 'nvarchar', maxLength: 200, precision: null, scale: null, collation: null, isNullable: true, isIdentity: false, identitySeed: null, identityIncrement: null, isComputed: false, computedDefinition: null, isPersisted: false, defaultDefinition: null, defaultName: null },
          { name: 'Email', typeName: 'nvarchar', maxLength: 510, precision: null, scale: null, collation: null, isNullable: false, isIdentity: false, identitySeed: null, identityIncrement: null, isComputed: false, computedDefinition: null, isPersisted: false, defaultDefinition: null, defaultName: null },
        ],
      });

      const { ddl } = buildDdl(meta);
      expect(ddl).toContain('[ID] int IDENTITY(1,1) NOT NULL');
      expect(ddl).toContain('[Name] nvarchar(100) NULL');
      expect(ddl).toContain('[Email] nvarchar(255) NOT NULL');
    });

    it('handles varchar MAX', () => {
      const meta = baseTable({
        columns: [
          { name: 'Notes', typeName: 'nvarchar', maxLength: -1, precision: null, scale: null, collation: null, isNullable: true, isIdentity: false, identitySeed: null, identityIncrement: null, isComputed: false, computedDefinition: null, isPersisted: false, defaultDefinition: null, defaultName: null },
        ],
      });

      const { ddl } = buildDdl(meta);
      expect(ddl).toContain('[Notes] nvarchar(MAX) NULL');
    });
  });

  describe('data types', () => {
    it('formats decimal with precision and scale', () => {
      const meta = baseTable({
        columns: [
          { name: 'Price', typeName: 'decimal', maxLength: null, precision: 18, scale: 4, collation: null, isNullable: false, isIdentity: false, identitySeed: null, identityIncrement: null, isComputed: false, computedDefinition: null, isPersisted: false, defaultDefinition: null, defaultName: null },
        ],
      });

      const { ddl } = buildDdl(meta);
      expect(ddl).toContain('[Price] decimal(18,4) NOT NULL');
    });

    it('handles collation', () => {
      const meta = baseTable({
        columns: [
          { name: 'Code', typeName: 'varchar', maxLength: 10, precision: null, scale: null, collation: 'Latin1_General_CS_AS', isNullable: false, isIdentity: false, identitySeed: null, identityIncrement: null, isComputed: false, computedDefinition: null, isPersisted: false, defaultDefinition: null, defaultName: null },
        ],
      });

      const { ddl } = buildDdl(meta);
      expect(ddl).toContain('[Code] varchar(10) COLLATE Latin1_General_CS_AS NOT NULL');
    });
  });

  describe('computed columns', () => {
    it('generates computed column definition', () => {
      const meta = baseTable({
        columns: [
          { name: 'FullName', typeName: 'nvarchar', maxLength: null, precision: null, scale: null, collation: null, isNullable: true, isIdentity: false, identitySeed: null, identityIncrement: null, isComputed: true, computedDefinition: '([FirstName]+[LastName])', isPersisted: false, defaultDefinition: null, defaultName: null },
        ],
      });

      const { ddl } = buildDdl(meta);
      expect(ddl).toContain('[FullName] AS ([FirstName]+[LastName])');
    });

    it('marks persisted computed columns', () => {
      const meta = baseTable({
        columns: [
          { name: 'FullName', typeName: 'nvarchar', maxLength: null, precision: null, scale: null, collation: null, isNullable: true, isIdentity: false, identitySeed: null, identityIncrement: null, isComputed: true, computedDefinition: '([FirstName]+[LastName])', isPersisted: true, defaultDefinition: null, defaultName: null },
        ],
      });

      const { ddl } = buildDdl(meta);
      expect(ddl).toContain('PERSISTED');
    });
  });

  describe('default constraints', () => {
    it('adds default constraint with name', () => {
      const meta = baseTable({
        columns: [
          { name: 'Active', typeName: 'bit', maxLength: null, precision: null, scale: null, collation: null, isNullable: false, isIdentity: false, identitySeed: null, identityIncrement: null, isComputed: false, computedDefinition: null, isPersisted: false, defaultDefinition: '((1))', defaultName: 'DF_TestTable_Active' },
        ],
      });

      const { ddl } = buildDdl(meta);
      expect(ddl).toContain('CONSTRAINT [DF_TestTable_Active] DEFAULT ((1))');
    });

    it('skips default for identity columns', () => {
      const meta = baseTable({
        columns: [
          { name: 'ID', typeName: 'int', maxLength: null, precision: 10, scale: 0, collation: null, isNullable: false, isIdentity: true, identitySeed: 1, identityIncrement: 1, isComputed: false, computedDefinition: null, isPersisted: false, defaultDefinition: '((1))', defaultName: 'DF_TestTable_ID' },
        ],
      });

      const { ddl } = buildDdl(meta);
      // Should have IDENTITY, not DEFAULT
      expect(ddl).toContain('IDENTITY');
      expect(ddl).not.toContain('DEFAULT ((1))');
    });
  });

  describe('primary key', () => {
    it('generates clustered primary key', () => {
      const meta = baseTable({
        columns: [
          { name: 'ID', typeName: 'int', maxLength: null, precision: 10, scale: 0, collation: null, isNullable: false, isIdentity: true, identitySeed: 1, identityIncrement: 1, isComputed: false, computedDefinition: null, isPersisted: false, defaultDefinition: null, defaultName: null },
        ],
        primaryKey: {
          name: 'PK_TestTable',
          columns: ['ID'],
          isClustered: true,
        },
      });

      const { ddl } = buildDdl(meta);
      expect(ddl).toContain('CONSTRAINT [PK_TestTable] PRIMARY KEY CLUSTERED ([ID])');
    });

    it('handles composite primary key', () => {
      const meta = baseTable({
        columns: [
          { name: 'OrderID', typeName: 'int', maxLength: null, precision: 10, scale: 0, collation: null, isNullable: false, isIdentity: false, identitySeed: null, identityIncrement: null, isComputed: false, computedDefinition: null, isPersisted: false, defaultDefinition: null, defaultName: null },
          { name: 'ProductID', typeName: 'int', maxLength: null, precision: 10, scale: 0, collation: null, isNullable: false, isIdentity: false, identitySeed: null, identityIncrement: null, isComputed: false, computedDefinition: null, isPersisted: false, defaultDefinition: null, defaultName: null },
        ],
        primaryKey: {
          name: 'PK_OrderItems',
          columns: ['OrderID', 'ProductID'],
          isClustered: true,
        },
      });

      const { ddl } = buildDdl(meta);
      expect(ddl).toContain('PRIMARY KEY CLUSTERED ([OrderID], [ProductID])');
    });
  });

  describe('unique constraints', () => {
    it('generates unique constraint', () => {
      const meta = baseTable({
        columns: [
          { name: 'ID', typeName: 'int', maxLength: null, precision: 10, scale: 0, collation: null, isNullable: false, isIdentity: true, identitySeed: 1, identityIncrement: 1, isComputed: false, computedDefinition: null, isPersisted: false, defaultDefinition: null, defaultName: null },
          { name: 'Email', typeName: 'nvarchar', maxLength: 510, precision: null, scale: null, collation: null, isNullable: false, isIdentity: false, identitySeed: null, identityIncrement: null, isComputed: false, computedDefinition: null, isPersisted: false, defaultDefinition: null, defaultName: null },
        ],
        uniqueConstraints: [
          { name: 'UQ_TestTable_Email', columns: ['Email'], isClustered: false },
        ],
      });

      const { ddl } = buildDdl(meta);
      expect(ddl).toContain('CONSTRAINT [UQ_TestTable_Email] UNIQUE NONCLUSTERED ([Email])');
    });
  });

  describe('check constraints', () => {
    it('generates check constraint', () => {
      const meta = baseTable({
        columns: [
          { name: 'Status', typeName: 'varchar', maxLength: 20, precision: null, scale: null, collation: null, isNullable: false, isIdentity: false, identitySeed: null, identityIncrement: null, isComputed: false, computedDefinition: null, isPersisted: false, defaultDefinition: null, defaultName: null },
        ],
        checkConstraints: [
          { name: 'CK_Status', definition: '([Status] IN (\'Active\',\'Inactive\'))', isTrusted: true, isDisabled: false },
        ],
      });

      const { ddl } = buildDdl(meta);
      expect(ddl).toContain("CONSTRAINT [CK_Status] CHECK ([Status] IN ('Active','Inactive'))");
    });

    it('flags not-trusted check constraints', () => {
      const meta = baseTable({
        columns: [
          { name: 'Score', typeName: 'int', maxLength: null, precision: 10, scale: 0, collation: null, isNullable: false, isIdentity: false, identitySeed: null, identityIncrement: null, isComputed: false, computedDefinition: null, isPersisted: false, defaultDefinition: null, defaultName: null },
        ],
        checkConstraints: [
          { name: 'CK_Score', definition: '([Score]>(0))', isTrusted: false, isDisabled: false },
        ],
      });

      const { ddl } = buildDdl(meta);
      expect(ddl).toContain('NOT TRUSTED');
    });
  });

  describe('foreign keys', () => {
    it('generates foreign key', () => {
      const meta = baseTable({
        columns: [
          { name: 'ID', typeName: 'int', maxLength: null, precision: 10, scale: 0, collation: null, isNullable: false, isIdentity: true, identitySeed: 1, identityIncrement: 1, isComputed: false, computedDefinition: null, isPersisted: false, defaultDefinition: null, defaultName: null },
          { name: 'DeptID', typeName: 'int', maxLength: null, precision: 10, scale: 0, collation: null, isNullable: false, isIdentity: false, identitySeed: null, identityIncrement: null, isComputed: false, computedDefinition: null, isPersisted: false, defaultDefinition: null, defaultName: null },
        ],
        foreignKeys: [
          {
            name: 'FK_TestTable_Department',
            columns: ['DeptID'],
            referencedSchema: 'dbo',
            referencedTable: 'Departments',
            referencedColumns: ['ID'],
            onUpdate: 'NO_ACTION',
            onDelete: 'CASCADE',
            isTrusted: true,
            isDisabled: false,
          },
        ],
      });

      const { ddl } = buildDdl(meta);
      expect(ddl).toContain('CONSTRAINT [FK_TestTable_Department] FOREIGN KEY ([DeptID]) REFERENCES [dbo].[Departments] ([ID])');
      expect(ddl).toContain('ON DELETE CASCADE');
    });

    it('handles composite foreign keys', () => {
      const meta = baseTable({
        columns: [
          { name: 'OrderID', typeName: 'int', maxLength: null, precision: 10, scale: 0, collation: null, isNullable: false, isIdentity: false, identitySeed: null, identityIncrement: null, isComputed: false, computedDefinition: null, isPersisted: false, defaultDefinition: null, defaultName: null },
          { name: 'LineID', typeName: 'int', maxLength: null, precision: 10, scale: 0, collation: null, isNullable: false, isIdentity: false, identitySeed: null, identityIncrement: null, isComputed: false, computedDefinition: null, isPersisted: false, defaultDefinition: null, defaultName: null },
        ],
        foreignKeys: [
          {
            name: 'FK_Composite',
            columns: ['OrderID', 'LineID'],
            referencedSchema: 'dbo',
            referencedTable: 'Orders',
            referencedColumns: ['ID', 'Line'],
            onUpdate: 'NO_ACTION',
            onDelete: 'NO_ACTION',
            isTrusted: true,
            isDisabled: false,
          },
        ],
      });

      const { ddl } = buildDdl(meta);
      expect(ddl).toContain('FOREIGN KEY ([OrderID], [LineID]) REFERENCES [dbo].[Orders] ([ID], [Line])');
    });
  });

  describe('indexes', () => {
    it('generates non-constraint indexes as separate CREATE INDEX', () => {
      const meta = baseTable({
        columns: [
          { name: 'ID', typeName: 'int', maxLength: null, precision: 10, scale: 0, collation: null, isNullable: false, isIdentity: true, identitySeed: 1, identityIncrement: 1, isComputed: false, computedDefinition: null, isPersisted: false, defaultDefinition: null, defaultName: null },
          { name: 'Name', typeName: 'nvarchar', maxLength: 200, precision: null, scale: null, collation: null, isNullable: true, isIdentity: false, identitySeed: null, identityIncrement: null, isComputed: false, computedDefinition: null, isPersisted: false, defaultDefinition: null, defaultName: null },
        ],
        indexes: [
          {
            name: 'IX_TestTable_Name',
            type: 'NONCLUSTERED',
            columns: [{ name: 'Name', descending: false }],
            includedColumns: [],
            filter: null,
            isUnique: false,
            isClustered: false,
            isDisabled: false,
            isConstraint: false,
          },
        ],
      });

      const { ddl } = buildDdl(meta);
      expect(ddl).toContain('CREATE NONCLUSTERED INDEX [IX_TestTable_Name] ON [dbo].[TestTable] ([Name] ASC)');
      expect(ddl).toContain('Non-constraint indexes');
    });

    it('skips constraint-backed indexes from index section', () => {
      const meta = baseTable({
        columns: [
          { name: 'ID', typeName: 'int', maxLength: null, precision: 10, scale: 0, collation: null, isNullable: false, isIdentity: true, identitySeed: 1, identityIncrement: 1, isComputed: false, computedDefinition: null, isPersisted: false, defaultDefinition: null, defaultName: null },
        ],
        primaryKey: {
          name: 'PK_TestTable',
          columns: ['ID'],
          isClustered: true,
        },
        indexes: [
          {
            name: 'PK_TestTable',
            type: 'CLUSTERED',
            columns: [{ name: 'ID', descending: false }],
            includedColumns: [],
            filter: null,
            isUnique: true,
            isClustered: true,
            isDisabled: false,
            isConstraint: true, // This is the PK — should NOT appear in index section
          },
        ],
      });

      const { ddl } = buildDdl(meta);
      // PK appears in CREATE TABLE body, not as separate CREATE INDEX
      expect(ddl).not.toContain('Non-constraint indexes');
    });

    it('includes filter and disabled state', () => {
      const meta = baseTable({
        columns: [
          { name: 'ID', typeName: 'int', maxLength: null, precision: 10, scale: 0, collation: null, isNullable: false, isIdentity: false, identitySeed: null, identityIncrement: null, isComputed: false, computedDefinition: null, isPersisted: false, defaultDefinition: null, defaultName: null },
          { name: 'IsDeleted', typeName: 'bit', maxLength: null, precision: null, scale: null, collation: null, isNullable: false, isIdentity: false, identitySeed: null, identityIncrement: null, isComputed: false, computedDefinition: null, isPersisted: false, defaultDefinition: '((0))', defaultName: null },
        ],
        indexes: [
          {
            name: 'IX_Filtered',
            type: 'NONCLUSTERED',
            columns: [{ name: 'ID', descending: false }],
            includedColumns: ['IsDeleted'],
            filter: '([IsDeleted]=(0))',
            isUnique: false,
            isClustered: false,
            isDisabled: true,
            isConstraint: false,
          },
        ],
      });

      const { ddl } = buildDdl(meta);
      expect(ddl).toContain('INCLUDE ([IsDeleted])');
      expect(ddl).toContain('WHERE ([IsDeleted]=(0))');
      expect(ddl).toContain('DISABLED');
    });
  });

  describe('escaped identifiers', () => {
    it('handles table/column names with special chars', () => {
      const meta = baseTable({
        name: 'Table With Spaces',
        columns: [
          { name: 'Column Name', typeName: 'int', maxLength: null, precision: 10, scale: 0, collation: null, isNullable: false, isIdentity: false, identitySeed: null, identityIncrement: null, isComputed: false, computedDefinition: null, isPersisted: false, defaultDefinition: null, defaultName: null },
        ],
      });

      const { ddl } = buildDdl(meta);
      expect(ddl).toContain('[Table With Spaces]');
      expect(ddl).toContain('[Column Name]');
    });

    it('escapes closing brackets in names', () => {
      const meta = baseTable({
        name: 'Tab]le',
        columns: [
          { name: 'Col]umn', typeName: 'int', maxLength: null, precision: 10, scale: 0, collation: null, isNullable: false, isIdentity: false, identitySeed: null, identityIncrement: null, isComputed: false, computedDefinition: null, isPersisted: false, defaultDefinition: null, defaultName: null },
        ],
      });

      const { ddl } = buildDdl(meta);
      expect(ddl).toContain('[Tab]]le]');
      expect(ddl).toContain('[Col]]umn]');
    });
  });

  describe('unsupported features', () => {
    it('prepends warnings as SQL comments', () => {
      const meta = baseTable({
        columns: [
          { name: 'ID', typeName: 'int', maxLength: null, precision: 10, scale: 0, collation: null, isNullable: false, isIdentity: false, identitySeed: null, identityIncrement: null, isComputed: false, computedDefinition: null, isPersisted: false, defaultDefinition: null, defaultName: null },
        ],
        unsupportedFeatures: ['System-versioned temporal table', 'Partition scheme'],
      });

      const { ddl, warnings } = buildDdl(meta);
      expect(ddl).toContain('-- WARNING: The following features are present but not represented in this DDL:');
      expect(ddl).toContain('--   - System-versioned temporal table');
      expect(ddl).toContain('--   - Partition scheme');
      expect(warnings).toHaveLength(2);
    });
  });
});
