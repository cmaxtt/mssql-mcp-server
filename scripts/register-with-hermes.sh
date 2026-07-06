#!/bin/bash
# Register mssql-mcp-server with Hermes Agent
# Usage: ./scripts/register-with-hermes.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "=== MSSQL MCP Server — Hermes Registration ==="

# Check .env
if [ ! -f "$PROJECT_ROOT/.env" ]; then
    echo "ERROR: .env file not found."
    echo "  Copy .env.example to .env and edit it first:"
    echo "  cp $PROJECT_ROOT/.env.example $PROJECT_ROOT/.env"
    exit 1
fi

# Source .env
set -a
source "$PROJECT_ROOT/.env"
set +a

# Build if needed
if [ ! -f "$PROJECT_ROOT/dist/index.js" ]; then
    echo "Building TypeScript..."
    (cd "$PROJECT_ROOT" && npm install && npm run build)
fi

# Register with Hermes
echo "Registering mssql-schema with Hermes..."
printf 'Y\nY\n' | hermes mcp add mssql-schema \
    --command node \
    --env "DB_HOST=${DB_HOST:-localhost}" \
    --env "DB_PORT=${DB_PORT:-1433}" \
    --env "DB_USER=${DB_USER:-sa}" \
    --env "DB_PASSWORD=${DB_PASSWORD}" \
    --env "DB_NAME=${DB_NAME:-master}" \
    --env "DB_ENCRYPT=${DB_ENCRYPT:-false}" \
    --env "DB_TRUST_CERT=${DB_TRUST_CERT:-true}" \
    --args "$PROJECT_ROOT/dist/index.js"

echo ""
echo "Done! Restart Hermes (or /reset in-session) to load the tools."
echo "Test with: hermes mcp test mssql-schema"
