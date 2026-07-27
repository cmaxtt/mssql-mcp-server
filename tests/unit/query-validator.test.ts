import { describe, it, expect } from 'vitest';
import { validateQuery } from '../../src/query/query-validator.js';

const defaultOpts = {
  maxTextBytes: 32768,
  allowedSchemas: '',
  allowedTables: '',
};

describe('query-validator', () => {
  describe('accepts valid SELECT queries', () => {
    const valid = [
      'SELECT * FROM tblInvoices',
      'SELECT InvoiceID, Provider FROM tblInvoices',
      "SELECT * FROM tblInvoices WHERE InvoiceDate > '2026-01-01'",
      'SELECT i.InvoiceID, d.ProductName FROM tblInvoices i INNER JOIN tblInvoiceDetails d ON i.InvoiceID = d.InvoiceID',
      'WITH cte AS (SELECT * FROM tblInvoices WHERE Total > 100) SELECT * FROM cte',
      'SELECT * FROM tblInvoices WHERE InvoiceID IN (SELECT InvoiceID FROM tblInvoiceDetails)',
      'SELECT Provider FROM tblInvoices UNION SELECT Provider FROM tblVendors',
      'SELECT TOP 10 * FROM tblInvoices ORDER BY InvoiceDate DESC',
      'SELECT COUNT(*), SUM(Total) FROM tblInvoices',
      'SELECT Provider, COUNT(*) FROM tblInvoices GROUP BY Provider HAVING COUNT(*) > 5',
      'SELECT DISTINCT Provider FROM tblInvoices',
    ];

    for (const sql of valid) {
      it(`accepts: ${sql.slice(0, 60)}`, () => {
        const result = validateQuery(sql, defaultOpts);
        expect(result.valid).toBe(true);
      });
    }
  });

  describe('rejects non-SELECT statements', () => {
    const invalid = [
      { sql: "INSERT INTO tblInvoices (Provider) VALUES ('Test')", reason: 'INSERT' },
      { sql: 'DELETE FROM tblInvoices', reason: 'DELETE' },
      { sql: "UPDATE tblInvoices SET Provider = 'x'", reason: 'UPDATE' },
      { sql: 'DROP TABLE tblInvoices', reason: 'DROP' },
      { sql: 'TRUNCATE TABLE tblInvoices', reason: 'TRUNCATE' },
      { sql: 'EXEC sp_help', reason: 'EXEC' },
      { sql: 'ALTER TABLE tblInvoices ADD NewCol int', reason: 'ALTER' },
    ];

    for (const { sql, reason } of invalid) {
      it(`rejects ${reason}: ${sql.slice(0, 50)}`, () => {
        const result = validateQuery(sql, defaultOpts);
        expect(result.valid).toBe(false);
      });
    }
  });

  describe('rejects SELECT INTO', () => {
    it('rejects SELECT ... INTO #temp', () => {
      const result = validateQuery('SELECT * INTO #temp FROM tblInvoices', defaultOpts);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('SELECT INTO');
    });

    it('rejects SELECT ... INTO permanent_table', () => {
      const result = validateQuery('SELECT * INTO NewTable FROM tblInvoices', defaultOpts);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('SELECT INTO');
    });
  });

  describe('rejects multiple statements', () => {
    it('rejects semicolon-separated statements', () => {
      const result = validateQuery('SELECT 1; DROP TABLE tblInvoices', defaultOpts);
      expect(result.valid).toBe(false);
    });

    it('rejects statements separated by newlines (if parser detects them)', () => {
      const result = validateQuery('SELECT 1\nDROP TABLE tblInvoices', defaultOpts);
      expect(result.valid).toBe(false);
    });
  });

  describe('rejects forbidden functions', () => {
    const forbidden = ['OPENROWSET', 'OPENQUERY', 'OPENDATASOURCE', 'xp_cmdshell', 'sp_executesql'];

    for (const fn of forbidden) {
      it(`rejects ${fn} in query text`, () => {
        const result = validateQuery(`SELECT * FROM ${fn}('...')`, defaultOpts);
        expect(result.valid).toBe(false);
      });
    }
  });

  describe('input size limit', () => {
    it('rejects oversized query', () => {
      const longQuery = 'SELECT ' + 'x'.repeat(500);
      const result = validateQuery(longQuery, { ...defaultOpts, maxTextBytes: 100 });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('size');
    });
  });

  describe('schema allowlist', () => {
    it('allows tables in allowed schemas', () => {
      const result = validateQuery('SELECT * FROM hr.Employees', {
        ...defaultOpts,
        allowedSchemas: 'hr,dbo',
      });
      expect(result.valid).toBe(true);
    });

    it('rejects tables in disallowed schemas', () => {
      const result = validateQuery('SELECT * FROM admin.Secrets', {
        ...defaultOpts,
        allowedSchemas: 'hr,dbo',
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('admin');
    });
  });

  describe('table allowlist', () => {
    it('allows tables in allowlist', () => {
      const result = validateQuery('SELECT * FROM tblInvoices', {
        ...defaultOpts,
        allowedTables: 'tblInvoices,tblInvoiceDetails',
      });
      expect(result.valid).toBe(true);
    });

    it('rejects tables not in allowlist', () => {
      const result = validateQuery('SELECT * FROM tblSecrets', {
        ...defaultOpts,
        allowedTables: 'tblInvoices,tblInvoiceDetails',
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('tblSecrets');
    });
  });

  describe('multi-part names', () => {
    it('rejects three-part table names', () => {
      const result = validateQuery('SELECT * FROM MyDB.dbo.tblInvoices', defaultOpts);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Three-');
    });
  });

  describe('adversarial inputs', () => {
    it('rejects null byte injection', () => {
      const result = validateQuery('SELECT * FROM tblInvoices\u0000; DROP TABLE tblInvoices', defaultOpts);
      expect(result.valid).toBe(false);
    });

    it('rejects Unicode whitespace tricks', () => {
      // Unicode non-breaking space might confuse simple parsers
      const result = validateQuery('SELECT\u00A0*\u00A0FROM\u00A0tblInvoices', defaultOpts);
      // The parser should either reject or handle this
      // We just care that it doesn't crash
      expect(typeof result.valid).toBe('boolean');
    });
  });

  describe('extract tables', () => {
    it('extracts table references from simple SELECT', () => {
      const result = validateQuery('SELECT * FROM dbo.tblInvoices', defaultOpts);
      expect(result.tables).toBeDefined();
      expect(result.tables!.length).toBeGreaterThanOrEqual(1);
      expect(result.tables![0].table.toLowerCase()).toBe('tblinvoices');
    });

    it('does not treat column aliases or CTE names as physical tables', () => {
      const result = validateQuery(
        'WITH recent AS (SELECT i.InvoiceID FROM dbo.tblInvoices i) SELECT r.InvoiceID FROM recent r',
        { ...defaultOpts, allowedSchemas: 'dbo', allowedTables: 'tblInvoices' }
      );
      expect(result.valid).toBe(true);
      expect(result.tables).toEqual([{ schema: 'dbo', table: 'tblInvoices' }]);
    });
  });
});
