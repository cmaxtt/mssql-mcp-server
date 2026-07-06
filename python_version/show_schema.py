import database
import sys

def show_schema():
    try:
        print("Getting schema for 'tblInvoices'...")
        schema = database.get_table_schema('tblInvoices')
        print(schema)
        
        print("\n" + "="*60 + "\n")
        print("Getting schema for 'tblInvoiceDetails'...")
        schema2 = database.get_table_schema('tblInvoiceDetails')
        print(schema2)
        
        print("\n" + "="*60 + "\n")
        print("Getting schema for 'tblVendors'...")
        schema3 = database.get_table_schema('tblVendors')
        print(schema3)
        
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    show_schema()