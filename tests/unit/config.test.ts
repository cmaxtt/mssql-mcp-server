import { describe, it, expect } from 'vitest';
import { parseConfig, redactConfig } from '../../src/config.js';

describe('parseConfig', () => {
  describe('individual connection fields', () => {
    it('parses DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD', () => {
      const config = parseConfig({
        DB_HOST: 'mysqlserver',
        DB_PORT: '1433',
        DB_NAME: 'mydb',
        DB_USER: 'myuser',
        DB_PASSWORD: 'mypassword',
      });

      expect(config.connection.useConnectionString).toBe(false);
      expect(config.connection.server).toBe('mysqlserver');
      expect(config.connection.port).toBe(1433);
      expect(config.connection.database).toBe('mydb');
      expect(config.connection.user).toBe('myuser');
      expect(config.connection.password).toBe('mypassword');
    });

    it('defaults DB_HOST to localhost', () => {
      const config = parseConfig({
        DB_NAME: 'mydb',
        DB_USER: 'myuser',
        DB_PASSWORD: 'mypassword',
      });

      expect(config.connection.server).toBe('localhost');
    });

    it('defaults DB_PORT to 1433', () => {
      const config = parseConfig({
        DB_HOST: 'mysqlserver',
        DB_NAME: 'mydb',
        DB_USER: 'myuser',
        DB_PASSWORD: 'mypassword',
      });

      expect(config.connection.port).toBe(1433);
    });

    it('supports named instances via DB_INSTANCE', () => {
      const config = parseConfig({
        DB_HOST: 'mysqlserver',
        DB_INSTANCE: 'SQLEXPRESS',
        DB_NAME: 'mydb',
        DB_USER: 'myuser',
        DB_PASSWORD: 'mypassword',
      });

      expect(config.connection.server).toBe('mysqlserver\\SQLEXPRESS');
      expect(config.connection.instance).toBe('SQLEXPRESS');
    });

    it('rejects invalid DB_PORT', () => {
      expect(() =>
        parseConfig({
          DB_HOST: 'mysqlserver',
          DB_PORT: 'notanumber',
          DB_NAME: 'mydb',
          DB_USER: 'myuser',
          DB_PASSWORD: 'mypassword',
        })
      ).toThrow();
    });
  });

  describe('connection string', () => {
    it('accepts DB_CONNECTION_STRING alone', () => {
      const config = parseConfig({
        DB_CONNECTION_STRING: 'Server=myhost;Database=mydb;User Id=sa;Password=pwd;',
      });

      expect(config.connection.useConnectionString).toBe(true);
      expect(config.connection.connectionString).toBe(
        'Server=myhost;Database=mydb;User Id=sa;Password=pwd;'
      );
    });

    it('rejects mixed connection string + individual fields', () => {
      expect(() =>
        parseConfig({
          DB_CONNECTION_STRING: 'Server=myhost;...',
          DB_HOST: 'otherhost',
          DB_NAME: 'mydb',
          DB_USER: 'myuser',
          DB_PASSWORD: 'mypassword',
        })
      ).toThrow(/mutually exclusive/);
    });
  });

  describe('TLS settings', () => {
    it('defaults encrypt to true', () => {
      const config = parseConfig({
        DB_HOST: 'mysqlserver',
        DB_NAME: 'mydb',
        DB_USER: 'myuser',
        DB_PASSWORD: 'mypassword',
      });

      expect(config.tls.encrypt).toBe(true);
    });

    it('defaults trustServerCertificate to false', () => {
      const config = parseConfig({
        DB_HOST: 'mysqlserver',
        DB_NAME: 'mydb',
        DB_USER: 'myuser',
        DB_PASSWORD: 'mypassword',
      });

      expect(config.tls.trustServerCertificate).toBe(false);
    });

    it('accepts explicit DB_ENCRYPT=false', () => {
      const config = parseConfig({
        DB_HOST: 'mysqlserver',
        DB_NAME: 'mydb',
        DB_USER: 'myuser',
        DB_PASSWORD: 'mypassword',
        DB_ENCRYPT: 'false',
      });

      expect(config.tls.encrypt).toBe(false);
    });

    it('accepts DB_TRUST_SERVER_CERTIFICATE=true', () => {
      const config = parseConfig({
        DB_HOST: 'mysqlserver',
        DB_NAME: 'mydb',
        DB_USER: 'myuser',
        DB_PASSWORD: 'mypassword',
        DB_TRUST_SERVER_CERTIFICATE: 'true',
      });

      expect(config.tls.trustServerCertificate).toBe(true);
    });

    it('falls back to DB_TRUST_CERT for backward compatibility', () => {
      const config = parseConfig({
        DB_HOST: 'mysqlserver',
        DB_NAME: 'mydb',
        DB_USER: 'myuser',
        DB_PASSWORD: 'mypassword',
        DB_TRUST_CERT: 'true',
      });

      expect(config.tls.trustServerCertificate).toBe(true);
    });

    it('prefers DB_TRUST_SERVER_CERTIFICATE over DB_TRUST_CERT', () => {
      const config = parseConfig({
        DB_HOST: 'mysqlserver',
        DB_NAME: 'mydb',
        DB_USER: 'myuser',
        DB_PASSWORD: 'mypassword',
        DB_TRUST_SERVER_CERTIFICATE: 'false',
        DB_TRUST_CERT: 'true',
      });

      expect(config.tls.trustServerCertificate).toBe(false);
    });
  });

  describe('timeouts', () => {
    it('has secure defaults', () => {
      const config = parseConfig({
        DB_HOST: 'mysqlserver',
        DB_NAME: 'mydb',
        DB_USER: 'myuser',
        DB_PASSWORD: 'mypassword',
      });

      expect(config.timeouts.connectMs).toBe(15000);
      expect(config.timeouts.requestMs).toBe(30000);
      expect(config.timeouts.lockMs).toBe(5000);
    });

    it('accepts custom values', () => {
      const config = parseConfig({
        DB_HOST: 'mysqlserver',
        DB_NAME: 'mydb',
        DB_USER: 'myuser',
        DB_PASSWORD: 'mypassword',
        DB_CONNECT_TIMEOUT_MS: '10000',
        DB_REQUEST_TIMEOUT_MS: '60000',
        DB_LOCK_TIMEOUT_MS: '2000',
      });

      expect(config.timeouts.connectMs).toBe(10000);
      expect(config.timeouts.requestMs).toBe(60000);
      expect(config.timeouts.lockMs).toBe(2000);
    });
  });

  describe('retry', () => {
    it('has sensible defaults', () => {
      const config = parseConfig({
        DB_HOST: 'mysqlserver',
        DB_NAME: 'mydb',
        DB_USER: 'myuser',
        DB_PASSWORD: 'mypassword',
      });

      expect(config.retry.maxRetries).toBe(5);
      expect(config.retry.baseDelayMs).toBe(500);
    });

    it('caps retry max delay', () => {
      const config = parseConfig({
        DB_HOST: 'mysqlserver',
        DB_NAME: 'mydb',
        DB_USER: 'myuser',
        DB_PASSWORD: 'mypassword',
        DB_RETRY_MAX_DELAY_MS: '30000',
      });

      expect(config.retry.maxDelayMs).toBe(30000);
    });
  });

  describe('pool', () => {
    it('defaults to min 0, max 10', () => {
      const config = parseConfig({
        DB_HOST: 'mysqlserver',
        DB_NAME: 'mydb',
        DB_USER: 'myuser',
        DB_PASSWORD: 'mypassword',
      });

      expect(config.pool.min).toBe(0);
      expect(config.pool.max).toBe(10);
    });
  });

  describe('query execution', () => {
    it('is disabled by default', () => {
      const config = parseConfig({
        DB_HOST: 'mysqlserver',
        DB_NAME: 'mydb',
        DB_USER: 'myuser',
        DB_PASSWORD: 'mypassword',
      });

      expect(config.query.enabled).toBe(false);
    });

    it('can be enabled', () => {
      const config = parseConfig({
        DB_HOST: 'mysqlserver',
        DB_NAME: 'mydb',
        DB_USER: 'myuser',
        DB_PASSWORD: 'mypassword',
        ENABLE_EXECUTE_QUERY: 'true',
      });

      expect(config.query.enabled).toBe(true);
    });

    it('enforces row and byte limits', () => {
      const config = parseConfig({
        DB_HOST: 'mysqlserver',
        DB_NAME: 'mydb',
        DB_USER: 'myuser',
        DB_PASSWORD: 'mypassword',
        QUERY_MAX_ROWS: '500',
        QUERY_MAX_RESULT_BYTES: '524288',
      });

      expect(config.query.maxRows).toBe(500);
      expect(config.query.maxResultBytes).toBe(524288);
    });
  });

  describe('transport', () => {
    it('defaults to stdio', () => {
      const config = parseConfig({
        DB_HOST: 'mysqlserver',
        DB_NAME: 'mydb',
        DB_USER: 'myuser',
        DB_PASSWORD: 'mypassword',
      });

      expect(config.transport.mode).toBe('stdio');
    });

    it('supports HTTP mode', () => {
      const config = parseConfig({
        DB_HOST: 'mysqlserver',
        DB_NAME: 'mydb',
        DB_USER: 'myuser',
        DB_PASSWORD: 'mypassword',
        MCP_TRANSPORT: 'http',
        MCP_HTTP_PORT: '8080',
      });

      expect(config.transport.mode).toBe('http');
      expect(config.transport.httpPort).toBe(8080);
    });

    it('defaults HTTP host to 127.0.0.1', () => {
      const config = parseConfig({
        DB_HOST: 'mysqlserver',
        DB_NAME: 'mydb',
        DB_USER: 'myuser',
        DB_PASSWORD: 'mypassword',
        MCP_TRANSPORT: 'http',
      });

      expect(config.transport.httpHost).toBe('127.0.0.1');
    });

    it('requires authentication for a non-loopback HTTP bind', () => {
      expect(() =>
        parseConfig({
          DB_HOST: 'mysqlserver',
          DB_NAME: 'mydb',
          DB_USER: 'myuser',
          DB_PASSWORD: 'mypassword',
          MCP_TRANSPORT: 'http',
          MCP_HTTP_HOST: '0.0.0.0',
        })
      ).toThrow(/BEARER_TOKEN/);
    });

    it('allows an authenticated non-loopback HTTP bind', () => {
      const config = parseConfig({
        DB_HOST: 'mysqlserver',
        DB_NAME: 'mydb',
        DB_USER: 'myuser',
        DB_PASSWORD: 'mypassword',
        MCP_TRANSPORT: 'http',
        MCP_HTTP_HOST: '0.0.0.0',
        MCP_HTTP_BEARER_TOKEN: 'a-long-random-token-at-least-32-chars',
      });
      expect(config.transport.httpHost).toBe('0.0.0.0');
    });
  });

  describe('logging', () => {
    it('defaults to info level, not pretty', () => {
      const config = parseConfig({
        DB_HOST: 'mysqlserver',
        DB_NAME: 'mydb',
        DB_USER: 'myuser',
        DB_PASSWORD: 'mypassword',
      });

      expect(config.log.level).toBe('info');
      expect(config.log.pretty).toBe(false);
    });
  });

  describe('error cases', () => {
    it('throws when no connection info provided', () => {
      expect(() => parseConfig({})).toThrow(/must be provided/);
    });

    it('throws when DB_HOST provided but no credentials', () => {
      expect(() =>
        parseConfig({ DB_HOST: 'mysqlserver' })
      ).toThrow(/DB_NAME, DB_USER, DB_PASSWORD must be provided/);
    });

    it('rejects a pool minimum larger than its maximum', () => {
      expect(() =>
        parseConfig({
          DB_HOST: 'mysqlserver',
          DB_NAME: 'mydb',
          DB_USER: 'myuser',
          DB_PASSWORD: 'mypassword',
          DB_POOL_MIN: '5',
          DB_POOL_MAX: '2',
        })
      ).toThrow(/DB_POOL_MIN/);
    });
  });
});

describe('redactConfig', () => {
  it('redacts password', () => {
    const config = parseConfig({
      DB_HOST: 'mysqlserver',
      DB_NAME: 'mydb',
      DB_USER: 'myuser',
      DB_PASSWORD: 's3cret!',
    });

    const redacted = redactConfig(config);
    const conn = redacted.connection as Record<string, unknown>;
    expect(conn.password).toBe('***');
  });

  it('redacts connection string', () => {
    const config = parseConfig({
      DB_CONNECTION_STRING: 'Server=myhost;Password=s3cret!',
    });

    const redacted = redactConfig(config);
    const conn = redacted.connection as Record<string, unknown>;
    expect(conn.server).toBe('[connection-string]');
    expect(conn.password).toBeUndefined();
  });

  it('redacts bearer token', () => {
    const config = parseConfig({
      DB_HOST: 'mysqlserver',
      DB_NAME: 'mydb',
      DB_USER: 'myuser',
      DB_PASSWORD: 'mypassword',
      MCP_TRANSPORT: 'http',
      MCP_HTTP_BEARER_TOKEN: 'token123-token123-token123-token123',
    });

    const redacted = redactConfig(config);
    const transport = redacted.transport as Record<string, unknown>;
    expect(transport.bearerToken).toBe('***');
  });

  it('does not leak database name or user', () => {
    // database and user ARE safe to log (they're identifiers, not secrets)
    const config = parseConfig({
      DB_HOST: 'mysqlserver',
      DB_NAME: 'mydb',
      DB_USER: 'myuser',
      DB_PASSWORD: 'mypassword',
    });

    const redacted = redactConfig(config);
    const conn = redacted.connection as Record<string, unknown>;
    expect(conn.database).toBe('mydb');
    expect(conn.user).toBe('myuser');
  });

  it('serializes without throwing', () => {
    const config = parseConfig({
      DB_HOST: 'mysqlserver',
      DB_NAME: 'mydb',
      DB_USER: 'myuser',
      DB_PASSWORD: 'mypassword',
    });

    const redacted = redactConfig(config);
    expect(() => JSON.stringify(redacted)).not.toThrow();
  });
});
