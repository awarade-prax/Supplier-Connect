// Field contract generated from docs/odata/Z_OPENPO_SUPP_PORTAL.xml.
window.OPEN_PO_SCHEMA = {
  "OpenPOHeader": [
    {
      "name": "PurchaseOrder",
      "type": "Edm.String",
      "label": "Purchase Order"
    },
    {
      "name": "PurchaseOrderType",
      "type": "Edm.String",
      "label": "Purchase Order Type"
    },
    {
      "name": "CompanyCode",
      "type": "Edm.String",
      "label": "Company Code"
    },
    {
      "name": "PurchasingOrganization",
      "type": "Edm.String",
      "label": "Purchasing Organization"
    },
    {
      "name": "PurchasingGroup",
      "type": "Edm.String",
      "label": "Purchasing Group"
    },
    {
      "name": "Supplier",
      "type": "Edm.String",
      "label": "Supplier"
    },
    {
      "name": "PurchaseOrderDate",
      "type": "Edm.Date",
      "label": "Purchase Order Date"
    },
    {
      "name": "CreationDate",
      "type": "Edm.Date",
      "label": "Creation Date"
    },
    {
      "name": "CreatedByUser",
      "type": "Edm.String",
      "label": "Created By User"
    },
    {
      "name": "PaymentTerms",
      "type": "Edm.String",
      "label": "Payment Terms"
    },
    {
      "name": "IncotermsClassification",
      "type": "Edm.String",
      "label": "Incoterms Classification"
    },
    {
      "name": "PurchasingProcessingStatus",
      "type": "Edm.String",
      "label": "Purchasing Processing Status"
    },
    {
      "name": "DocumentCurrency",
      "type": "Edm.String",
      "label": "Document Currency"
    },
    {
      "name": "NumberOfOpenItems",
      "type": "Edm.Int32",
      "label": "Number Of Open Items"
    },
    {
      "name": "NumberOfOverdueItems",
      "type": "Edm.Byte",
      "label": "Number Of Overdue Items"
    },
    {
      "name": "NextScheduleLineDate",
      "type": "Edm.Date",
      "label": "Next Schedule Line Date"
    },
    {
      "name": "LastScheduleLineDate",
      "type": "Edm.Date",
      "label": "Last Schedule Line Date"
    },
    {
      "name": "NetOrderValue",
      "type": "Edm.Decimal",
      "label": "Net Order Value"
    },
    {
      "name": "ValueToBeDelivered",
      "type": "Edm.Decimal",
      "label": "Value To Be Delivered"
    },
    {
      "name": "ValueToBeInvoiced",
      "type": "Edm.Decimal",
      "label": "Value To Be Invoiced"
    }
  ],
  "OpenPOItem": [
    {
      "name": "PurchaseOrder",
      "type": "Edm.String",
      "label": "Purchase Order"
    },
    {
      "name": "PurchaseOrderItem",
      "type": "Edm.String",
      "label": "Purchase Order Item"
    },
    {
      "name": "PurchaseOrderType",
      "type": "Edm.String",
      "label": "Purchase Order Type"
    },
    {
      "name": "CompanyCode",
      "type": "Edm.String",
      "label": "Company Code"
    },
    {
      "name": "PurchasingOrganization",
      "type": "Edm.String",
      "label": "Purchasing Organization"
    },
    {
      "name": "PurchasingGroup",
      "type": "Edm.String",
      "label": "Purchasing Group"
    },
    {
      "name": "Supplier",
      "type": "Edm.String",
      "label": "Supplier"
    },
    {
      "name": "PurchaseOrderDate",
      "type": "Edm.Date",
      "label": "Purchase Order Date"
    },
    {
      "name": "CreationDate",
      "type": "Edm.Date",
      "label": "Creation Date"
    },
    {
      "name": "CreatedByUser",
      "type": "Edm.String",
      "label": "Created By User"
    },
    {
      "name": "PaymentTerms",
      "type": "Edm.String",
      "label": "Payment Terms"
    },
    {
      "name": "IncotermsClassification",
      "type": "Edm.String",
      "label": "Incoterms Classification"
    },
    {
      "name": "PurchasingProcessingStatus",
      "type": "Edm.String",
      "label": "Purchasing Processing Status"
    },
    {
      "name": "PurchaseOrderItemText",
      "type": "Edm.String",
      "label": "Purchase Order Item Text"
    },
    {
      "name": "PurchasingDocumentDeletionCode",
      "type": "Edm.String",
      "label": "Purchasing Document Deletion Code"
    },
    {
      "name": "Material",
      "type": "Edm.String",
      "label": "Material"
    },
    {
      "name": "MaterialGroup",
      "type": "Edm.String",
      "label": "Material Group"
    },
    {
      "name": "SupplierMaterialNumber",
      "type": "Edm.String",
      "label": "Supplier Material Number"
    },
    {
      "name": "ManufacturerMaterial",
      "type": "Edm.String",
      "label": "Manufacturer Material"
    },
    {
      "name": "ProductType",
      "type": "Edm.String",
      "label": "Product Type"
    },
    {
      "name": "Plant",
      "type": "Edm.String",
      "label": "Plant"
    },
    {
      "name": "StorageLocation",
      "type": "Edm.String",
      "label": "Storage Location"
    },
    {
      "name": "AccountAssignmentCategory",
      "type": "Edm.String",
      "label": "Account Assignment Category"
    },
    {
      "name": "MultipleAcctAssgmtDistribution",
      "type": "Edm.String",
      "label": "Multiple Acct Assgmt Distribution"
    },
    {
      "name": "PartialInvoiceDistribution",
      "type": "Edm.String",
      "label": "Partial Invoice Distribution"
    },
    {
      "name": "IsFinallyInvoiced",
      "type": "Edm.Boolean",
      "label": "Is Finally Invoiced"
    },
    {
      "name": "IsCompletelyDelivered",
      "type": "Edm.Boolean",
      "label": "Is Completely Delivered"
    },
    {
      "name": "GoodsReceiptIsExpected",
      "type": "Edm.Boolean",
      "label": "Goods Receipt Is Expected"
    },
    {
      "name": "GoodsReceiptIsNonValuated",
      "type": "Edm.Boolean",
      "label": "Goods Receipt Is Non Valuated"
    },
    {
      "name": "InvoiceIsExpected",
      "type": "Edm.Boolean",
      "label": "Invoice Is Expected"
    },
    {
      "name": "InvoiceIsGoodsReceiptBased",
      "type": "Edm.Boolean",
      "label": "Invoice Is Goods Receipt Based"
    },
    {
      "name": "IsReturnsItem",
      "type": "Edm.Boolean",
      "label": "Is Returns Item"
    },
    {
      "name": "OverdelivTolrtdLmtRatioInPct",
      "type": "Edm.Decimal",
      "label": "Overdeliv Tolrtd Lmt Ratio In Pct"
    },
    {
      "name": "UnderdelivTolrtdLmtRatioInPct",
      "type": "Edm.Decimal",
      "label": "Underdeliv Tolrtd Lmt Ratio In Pct"
    },
    {
      "name": "UnlimitedOverdeliveryIsAllowed",
      "type": "Edm.Boolean",
      "label": "Unlimited Overdelivery Is Allowed"
    },
    {
      "name": "TaxCode",
      "type": "Edm.String",
      "label": "Tax Code"
    },
    {
      "name": "PurchaseContract",
      "type": "Edm.String",
      "label": "Purchase Contract"
    },
    {
      "name": "PurchaseContractItem",
      "type": "Edm.String",
      "label": "Purchase Contract Item"
    },
    {
      "name": "PurchaseRequisition",
      "type": "Edm.String",
      "label": "Purchase Requisition"
    },
    {
      "name": "PurchaseRequisitionItem",
      "type": "Edm.String",
      "label": "Purchase Requisition Item"
    },
    {
      "name": "RequisitionerName",
      "type": "Edm.String",
      "label": "Requisitioner Name"
    },
    {
      "name": "RequirementTracking",
      "type": "Edm.String",
      "label": "Requirement Tracking"
    },
    {
      "name": "Subcontractor",
      "type": "Edm.String",
      "label": "Subcontractor"
    },
    {
      "name": "PurchaseOrderQuantityUnit",
      "type": "Edm.String",
      "label": "Purchase Order Quantity Unit"
    },
    {
      "name": "OrderPriceUnit",
      "type": "Edm.String",
      "label": "Order Price Unit"
    },
    {
      "name": "OrderQuantity",
      "type": "Edm.Decimal",
      "label": "Order Quantity"
    },
    {
      "name": "DeliveredQuantity",
      "type": "Edm.Decimal",
      "label": "Delivered Quantity"
    },
    {
      "name": "QuantityToBeDelivered",
      "type": "Edm.Decimal",
      "label": "Quantity To Be Delivered"
    },
    {
      "name": "InvoicedQuantity",
      "type": "Edm.Decimal",
      "label": "Invoiced Quantity"
    },
    {
      "name": "QuantityToBeInvoiced",
      "type": "Edm.Decimal",
      "label": "Quantity To Be Invoiced"
    },
    {
      "name": "NumberOfScheduleLines",
      "type": "Edm.Int32",
      "label": "Number Of Schedule Lines"
    },
    {
      "name": "NextScheduleLineDate",
      "type": "Edm.Date",
      "label": "Next Schedule Line Date"
    },
    {
      "name": "LastScheduleLineDate",
      "type": "Edm.Date",
      "label": "Last Schedule Line Date"
    },
    {
      "name": "ScheduledQuantity",
      "type": "Edm.Decimal",
      "label": "Scheduled Quantity"
    },
    {
      "name": "DeliveryIsOverdue",
      "type": "Edm.String",
      "label": "Delivery Is Overdue"
    },
    {
      "name": "DocumentCurrency",
      "type": "Edm.String",
      "label": "Document Currency"
    },
    {
      "name": "NetPriceAmount",
      "type": "Edm.Decimal",
      "label": "Net Price Amount"
    },
    {
      "name": "NetPriceQuantity",
      "type": "Edm.Decimal",
      "label": "Net Price Quantity"
    },
    {
      "name": "NetOrderValue",
      "type": "Edm.Decimal",
      "label": "Net Order Value"
    },
    {
      "name": "GrossAmount",
      "type": "Edm.Decimal",
      "label": "Gross Amount"
    },
    {
      "name": "DeliveredValue",
      "type": "Edm.Decimal",
      "label": "Delivered Value"
    },
    {
      "name": "ValueToBeDelivered",
      "type": "Edm.Decimal",
      "label": "Value To Be Delivered"
    },
    {
      "name": "InvoicedValue",
      "type": "Edm.Decimal",
      "label": "Invoiced Value"
    },
    {
      "name": "ValueToBeInvoiced",
      "type": "Edm.Decimal",
      "label": "Value To Be Invoiced"
    },
    {
      "name": "DeliveryStatus",
      "type": "Edm.String",
      "label": "Delivery Status"
    },
    {
      "name": "InvoiceStatus",
      "type": "Edm.String",
      "label": "Invoice Status"
    }
  ],
  "OpenPOItemHistorySum": [
    {
      "name": "PurchaseOrder",
      "type": "Edm.String",
      "label": "Purchase Order"
    },
    {
      "name": "PurchaseOrderItem",
      "type": "Edm.String",
      "label": "Purchase Order Item"
    },
    {
      "name": "PurchaseOrderQuantityUnit",
      "type": "Edm.String",
      "label": "Purchase Order Quantity Unit"
    },
    {
      "name": "DocumentCurrency",
      "type": "Edm.String",
      "label": "Document Currency"
    },
    {
      "name": "GoodsReceiptQuantity",
      "type": "Edm.Decimal",
      "label": "Goods Receipt Quantity"
    },
    {
      "name": "GoodsReceiptAmount",
      "type": "Edm.Decimal",
      "label": "Goods Receipt Amount"
    },
    {
      "name": "InvoicedQuantity",
      "type": "Edm.Decimal",
      "label": "Invoiced Quantity"
    },
    {
      "name": "InvoicedAmount",
      "type": "Edm.Decimal",
      "label": "Invoiced Amount"
    }
  ],
  "OpenPOItemScheduleSum": [
    {
      "name": "PurchaseOrder",
      "type": "Edm.String",
      "label": "Purchase Order"
    },
    {
      "name": "PurchaseOrderItem",
      "type": "Edm.String",
      "label": "Purchase Order Item"
    },
    {
      "name": "PurchaseOrderQuantityUnit",
      "type": "Edm.String",
      "label": "Purchase Order Quantity Unit"
    },
    {
      "name": "NumberOfScheduleLines",
      "type": "Edm.Int32",
      "label": "Number Of Schedule Lines"
    },
    {
      "name": "NextScheduleLineDate",
      "type": "Edm.Date",
      "label": "Next Schedule Line Date"
    },
    {
      "name": "LastScheduleLineDate",
      "type": "Edm.Date",
      "label": "Last Schedule Line Date"
    },
    {
      "name": "ScheduledQuantity",
      "type": "Edm.Decimal",
      "label": "Scheduled Quantity"
    }
  ]
};
