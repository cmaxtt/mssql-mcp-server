
CREATE TABLE [tblInvoices](
	[UserID] [int] NULL,
	[InvoiceDate] [datetime] NULL,
	[InvoiceID] [int] IDENTITY(1,1) NOT NULL,
	[InvoiceNo] [int] NULL,
	[Provider] [nvarchar](50) NULL,
	[InvoiceTime] [datetime] NULL,
	[PatientID] [int] NULL,
	[PaymentType] [nvarchar](20) NULL,
	[PriscriptionID] [int] NULL,
	[Register] [int] NULL,
	[SaleCost] [money] NULL,
	[StoreID] [int] NULL,
	[TransactionCount] [int] NULL,
	[loyPoints] [int] NOT NULL,
	[loyDollarValue] [money] NOT NULL,
	[loyCustomerID] [nvarchar](50) NULL,
 CONSTRAINT [PK_tblInvoices] PRIMARY KEY CLUSTERED 
(
	[InvoiceID] ASC
)
);

CREATE TABLE [tblInvoiceDetails](
	[InvoiceDetailsID] [int] IDENTITY(1,1) NOT NULL,
	[Description] [nvarchar](50) NULL,
	[CostPerUnit] [money] NULL,
	[InvoiceID] [int] NULL,
	[DeptId] [int] NULL,
	[ItemDiscountValue] [money] NULL,
	[PricePerUnit] [money] NULL,
	[ProductCode] [int] NULL,
	[Quantity] [int] NULL,
	[RetailYn] [bit] NULL,
	[VatPerUnit] [money] NULL,
	[Status] [nvarchar](1) NULL,
	[LoyCusID] [int] NULL,
	[VendorID] [int] NULL,
	[ItemClass] [nchar](10) NULL,
 CONSTRAINT [PK_tblInvoiceDetails] PRIMARY KEY CLUSTERED 
(
	[InvoiceDetailsID] ASC
)
);

CREATE TABLE [tblVendors](
	[VendorID] [int] NULL,
	[VendoRName] [nvarchar](75) NULL
);

CREATE TABLE [tblPurchases](
	[UserID] [int] NULL,
	[VendorID] [int] NULL,
	[pInvoiceDate] [datetime] NULL,
	[PInvoiceID] [int] IDENTITY(1,1) NOT NULL,
	[pInvoiceNo] [numeric](18, 0) NULL,
	[DiscountPercentage] [int] NULL,
	[DiscountValue] [money] NULL,
	[PurchaseNonVat] [money] NULL,
	[VendorName] [nvarchar](50) NULL,
	[TotalVI] [money] NULL,
	[PurchaseVat] [money] NULL,
	[Status] [nvarchar](1) NULL,
	[StoreID] [int] NULL,
	[CheckNo] [nvarchar](14) NULL,
	[PmtDueDate] [datetime] NULL,
	[Charge] [bit] NULL,
 CONSTRAINT [tblPurchases$PrimaryKey] PRIMARY KEY CLUSTERED 
(
    [PInvoiceID] ASC
)
);

CREATE TABLE [tblPurchaseDetails](
	[Description] [nvarchar](50) NULL,
	[CostPerUnit] [money] NULL,
	[pInvoiceDetailID] [int] IDENTITY(1,1) NOT NULL,
	[pInvoiceID] [int] NULL,
	[ItemDiscountValue] [money] NULL,
	[OriginalQty] [int] NULL,
	[PricePerUnit] [money] NULL,
	[ProductCode] [int] NULL,
	[Quantity] [int] NULL,
	[VatPerUnit] [money] NULL,
	[Activeyn] [bit] NULL,
	[lastSprice] [money] NULL,
	[LastRprice] [money] NULL,
	[DeptId] [int] NULL,
	[LocId] [int] NULL,
	[CatId] [int] NULL,
	[ReturnValue] [money] NOT NULL,
	[ItemClass] [smallint] NULL,
	CONSTRAINT [tblPurchaseDetails$PrimaryKey] PRIMARY KEY CLUSTERED 
	(
	[pInvoiceDetailID] ASC
	)
	);

	-- ── Integration test objects ──

	-- Test table with identity PK, unique constraint, default, check
	CREATE TABLE MCP_Test_Customers (
	CustomerID int IDENTITY(1,1) NOT NULL,
	Name nvarchar(100) NOT NULL,
	Email nvarchar(255) NULL,
	Status varchar(20) NOT NULL DEFAULT 'Active',
	CreatedAt datetime NOT NULL DEFAULT GETDATE(),
	CONSTRAINT PK_MCP_Test_Customers PRIMARY KEY CLUSTERED (CustomerID),
	CONSTRAINT UQ_MCP_Test_Customers_Email UNIQUE (Email),
	CONSTRAINT CK_MCP_Test_Customers_Status CHECK (Status IN ('Active', 'Inactive', 'Suspended'))
	);

	-- Test table with FK to Customers
	CREATE TABLE MCP_Test_Orders (
	OrderID int IDENTITY(1,1) NOT NULL,
	CustomerID int NOT NULL,
	OrderDate datetime NOT NULL DEFAULT GETDATE(),
	Total decimal(18,4) NOT NULL DEFAULT 0,
	CONSTRAINT PK_MCP_Test_Orders PRIMARY KEY CLUSTERED (OrderID),
	CONSTRAINT FK_MCP_Test_Orders_Customer FOREIGN KEY (CustomerID)
	    REFERENCES MCP_Test_Customers(CustomerID)
	);

	-- Test view joining Customers + Orders
	CREATE VIEW MCP_Test_CustomerOrders AS
	SELECT c.CustomerID, c.Name, c.Email, o.OrderID, o.OrderDate, o.Total
	FROM MCP_Test_Customers c
	LEFT JOIN MCP_Test_Orders o ON c.CustomerID = o.CustomerID;

	-- Test stored procedure
	CREATE PROCEDURE MCP_Test_GetCustomerCount
	@Status varchar(20) = NULL
	AS
	BEGIN
	IF @Status IS NULL
	    SELECT COUNT(*) AS CustomerCount FROM MCP_Test_Customers;
	ELSE
	    SELECT COUNT(*) AS CustomerCount FROM MCP_Test_Customers WHERE Status = @Status;
	END;
