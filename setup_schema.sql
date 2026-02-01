
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
