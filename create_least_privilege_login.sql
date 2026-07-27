-- Least-Privilege SQL Server Setup for mssql-mcp-server
-- ====================================================
-- Replace placeholders before running:
--   <database>   = target database name
--   <login>      = SQL login name for the MCP server
--   <password>   = strong password for the login
--
-- This script creates a dedicated login with only the permissions
-- needed for read-only schema inspection. For query execution
-- (ENABLE_EXECUTE_QUERY=true), additional SELECT permissions
-- are required on the allowed tables.
--
-- NEVER use sa or a sysadmin login for the MCP server.

USE [<database>];
GO

-- Create login (if not using Windows auth)
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = '<login>')
BEGIN
    CREATE LOGIN [<login>] WITH PASSWORD = '<password>', CHECK_POLICY = ON;
END
GO

-- Create database user
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = '<login>')
BEGIN
    CREATE USER [<login>] FOR LOGIN [<login>];
END
GO

-- Grant CONNECT (required)
GRANT CONNECT TO [<login>];
GO

-- Grant VIEW DEFINITION on schema (needed for schema inspection tools)
GRANT VIEW DEFINITION ON SCHEMA::[dbo] TO [<login>];
GO

-- Grant SELECT on specific tables (only if query execution is enabled)
-- GRANT SELECT ON [dbo].[tblInvoices] TO [<login>];
-- GRANT SELECT ON [dbo].[tblInvoiceDetails] TO [<login>];
-- GRANT SELECT ON [dbo].[tblVendors] TO [<login>];

-- Explicitly DENY dangerous permissions for defense-in-depth
DENY ALTER TO [<login>];
DENY CONTROL TO [<login>];
DENY CREATE TABLE TO [<login>];
DENY DELETE TO [<login>];
DENY EXECUTE TO [<login>];
DENY INSERT TO [<login>];
DENY REFERENCES TO [<login>];
DENY TAKE OWNERSHIP TO [<login>];
DENY UPDATE TO [<login>];
DENY VIEW CHANGE TRACKING TO [<login>];

-- Verify setup
SELECT
    dp.name AS UserName,
    dp.type_desc AS UserType,
    sp.name AS LoginName,
    sp.is_disabled AS LoginDisabled
FROM sys.database_principals dp
LEFT JOIN sys.server_principals sp ON dp.sid = sp.sid
WHERE dp.name = '<login>';
