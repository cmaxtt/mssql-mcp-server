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

def analyze_tables():
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
        
        total = len(tables)
        tables_count = sum(1 for t in tables if t.TABLE_TYPE == 'BASE TABLE')
        views_count = sum(1 for t in tables if t.TABLE_TYPE == 'VIEW')
        
        print(f"Database Analysis:")
        print(f"Total tables/views: {total}")
        print(f"Tables: {tables_count}")
        print(f"Views: {views_count}")
        print("=" * 80)
        
        # Group by schema
        tables_by_schema = {}
        for table in tables:
            schema = table.TABLE_SCHEMA
            name = table.TABLE_NAME
            type_ = table.TABLE_TYPE
            if schema not in tables_by_schema:
                tables_by_schema[schema] = {'tables': [], 'views': []}
            if type_ == 'BASE TABLE':
                tables_by_schema[schema]['tables'].append(name)
            else:
                tables_by_schema[schema]['views'].append(name)
        
        for schema in sorted(tables_by_schema.keys()):
            schema_tables = tables_by_schema[schema]['tables']
            schema_views = tables_by_schema[schema]['views']
            print(f"\nSchema: {schema}")
            print(f"  Tables: {len(schema_tables)}, Views: {len(schema_views)}")
            
            # Show first 10 tables if many
            if len(schema_tables) > 0:
                print(f"  Sample tables: {', '.join(sorted(schema_tables)[:10])}")
                if len(schema_tables) > 10:
                    print(f"    ... and {len(schema_tables) - 10} more tables")
        
        # Identify key table categories
        print("\n" + "=" * 80)
        print("Key Table Categories:")
        
        # Find tables with common prefixes/patterns
        all_table_names = [t.TABLE_NAME for t in tables if t.TABLE_TYPE == 'BASE TABLE']
        
        categories = {
            'Invoice-related': ['tblInvoices', 'tblInvoiceDetails', 'tblInvoiceDetailsArc', 'tblInvoicesArc', 'tblCreditNote', 'tblCreditNoteDetails'],
            'Product/Inventory': ['tblProducts', 'tblInventoryValue', 'tblPriceChange', 'tblExpiryProducts', 'tblCategories', 'tblDepartments'],
            'Purchase/Order': ['tblPurchaseOrders', 'tblPurchaseDetails', 'tblPurchases', 'tblPurchaseOrdDetails', 'tblReceivedPurchase'],
            'Customer/Patient': ['tblCustomers', 'tblPCustomers', 'tblCus', 'tblPatients', 'tblDoctors'],
            'Vendor/Supplier': ['tblVendors', 'tblMultiVendors', 'tblPurchaseRep', 'tblVendors'],
            'Sales/Transaction': ['tblSalesTrans', 'tblFlashSales', 'tblNewFlashSales', 'tblPcFlashSales', 'tblTempSales'],
            'Audit/Log': ['tblAuditTrail', 'tblEditLog', 'tblTransAudit', 'tblCashierLog', 'tblServerLog'],
            'System/Configuration': ['tblUsers', 'tblStore', 'tblStores', 'tblsysDefault', 'tblMenuCtrl', 'tblTerms'],
        }
        
        for category, examples in categories.items():
            # Find which examples exist
            existing = [name for name in examples if name in all_table_names]
            if existing:
                print(f"  {category}: {', '.join(existing[:5])}")
                if len(existing) > 5:
                    print(f"    ... and {len(existing) - 5} more")
        
        conn.close()
        
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    analyze_tables()