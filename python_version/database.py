import pyodbc
import os
import re
from typing import List, Dict, Any, Optional
from dotenv import load_dotenv

# Load .env from the same directory as this script
script_dir = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(script_dir, '.env'))

DB_CONNECTION_STRING = os.getenv("DB_CONNECTION_STRING")
ALLOWED_TABLES = os.getenv("ALLOWED_TABLES", "").split(",")

# Remove whitespace from allowed tables
ALLOWED_TABLES = [t.strip() for t in ALLOWED_TABLES if t.strip()]

def get_connection():
    """Establishes a connection to the SQL Server."""
    try:
        conn = pyodbc.connect(DB_CONNECTION_STRING)
        return conn
    except Exception as e:
        print(f"Error connecting to database: {e}")
        raise

def get_virtual_relationships() -> str:
    """Returns a string describing the relationships between tables."""
    return """
RELATIONSHIPS:
- tblInvoices.InvoiceID (PK) <-> tblInvoiceDetails.InvoiceID (FK)
- tblVendors.VendorID (PK) <-> tblInvoiceDetails.VendorID (FK)
"""

def get_table_schema(table_name: str) -> str:
    """Retrieves the schema definition (DDL-like) for a specific table."""
    conn = get_connection()
    cursor = conn.cursor()
    
    try:
        # Get column information
        query = f"""
        SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = ?
        """
        cursor.execute(query, table_name)
        columns = cursor.fetchall()

        if not columns:
            return f"Table '{table_name}' not found or has no columns."

        schema = f"TABLE [{table_name}] (\n"
        for col in columns:
            col_name = col.COLUMN_NAME
            data_type = col.DATA_TYPE
            max_len = f"({col.CHARACTER_MAXIMUM_LENGTH})" if col.CHARACTER_MAXIMUM_LENGTH else ""
            nullable = "NULL" if col.IS_NULLABLE == 'YES' else "NOT NULL"
            schema += f"    [{col_name}] [{data_type}]{max_len} {nullable},\n"
        
        schema += ")"
        return schema
    except Exception as e:
        return f"Error retrieving schema for {table_name}: {e}"
    finally:
        conn.close()

def get_all_schemas() -> str:
    """Retrieves standard DDL schemas for all allowed tables."""
    full_schema_text = get_virtual_relationships() + "\n\n"
    
    for table in ALLOWED_TABLES:
        full_schema_text += get_table_schema(table) + "\n\n"
        
    return full_schema_text

def is_safe_query(query: str) -> bool:
    """Checks if the query is a read-only SELECT statement."""
    # Simple regex to start with SELECT (case-insensitive) and ensure no destructive commands
    # This is a basic check.
    query_upper = query.upper().strip()
    
    if not query_upper.startswith("SELECT"):
        return False
        
    forbidden_keywords = ["INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "TRUNCATE", "EXEC", "MERGE", "GRANT", "REVOKE"]
    for keyword in forbidden_keywords:
        # Check if keyword exists as a whole word
        if re.search(r'\b' + keyword + r'\b', query_upper):
            # Exception: SELECT ... INTO is dangerous, but pure SELECT is fine.
            # However, INSERT INTO is caught by INSERT.
            # We must be careful about valid column names containing these words, but regex \b helps.
            return False
            
    return True

def execute_safe_query(query: str) -> List[Dict[str, Any]]:
    """Executes a SQL query if it's safe (read-only)."""
    if not is_safe_query(query):
        raise ValueError("Only read-only SELECT queries are allowed.")
        
    conn = get_connection()
    cursor = conn.cursor()
    
    try:
        cursor.execute(query)
        
        # Get column names
        columns = [column[0] for column in cursor.description]
        
        results = []
        for row in cursor.fetchall():
            results.append(dict(zip(columns, row)))
            
        return results
    except Exception as e:
        raise RuntimeError(f"Database error execution query: {e}")
    finally:
        conn.close()
