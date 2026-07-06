import pyodbc
import os
from dotenv import load_dotenv

# Load .env from current directory
script_dir = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(script_dir, '.env'))

DB_CONNECTION_STRING = os.getenv("DB_CONNECTION_STRING")

if not DB_CONNECTION_STRING:
    print("ERROR: DB_CONNECTION_STRING not found in .env")
    exit(1)

def list_all_tables():
    try:
        conn = pyodbc.connect(DB_CONNECTION_STRING)
        cursor = conn.cursor()
        
        # Query INFORMATION_SCHEMA.TABLES to get all tables
        query = """
        SELECT 
            TABLE_SCHEMA,
            TABLE_NAME, 
            TABLE_TYPE
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_TYPE IN ('BASE TABLE', 'VIEW')
        ORDER BY TABLE_SCHEMA, TABLE_NAME
        """
        
        cursor.execute(query)
        tables = cursor.fetchall()
        
        print(f"Found {len(tables)} tables/views in the database:")
        print("=" * 80)
        
        # Group by schema
        tables_by_schema = {}
        for table in tables:
            schema = table.TABLE_SCHEMA
            name = table.TABLE_NAME
            type_ = table.TABLE_TYPE
            if schema not in tables_by_schema:
                tables_by_schema[schema] = []
            tables_by_schema[schema].append((name, type_))
        
        for schema in sorted(tables_by_schema.keys()):
            print(f"\nSchema: {schema}")
            print("-" * 40)
            for table_name, table_type in sorted(tables_by_schema[schema]):
                type_indicator = "[VIEW]" if table_type == "VIEW" else "[TABLE]"
                print(f"  {table_name:50} {type_indicator}")
        
        conn.close()
        
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    list_all_tables()