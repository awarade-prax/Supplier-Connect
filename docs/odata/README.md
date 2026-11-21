# Supplier onboarding OData reference

- Metadata file: `YY1_SUPPLIER_ONBOARDING_CDS.metadata.xml` (copied from the supplied `Metadata New.xml`).
- Status value list response: `supplier-onboarding-status-values.json` (provided with the request; entity set `YY1_SUPPLIERONBOARDINGSTATUS`).
- Parent entity set: `YY1_SUPPLIER_ONBOARDING`.
- Parent status fields: `Status` (`Edm.String`, max length 30, text association `Status_Text`) and `Status_Text` (read-only description).
- Purchase decision log entity set: `YY1_PURCHASEAPPROVAL_SUPPLI000`; navigation `to_PurchaseApproval`; properties `ActionID`, `SupplierID`, `ActionTakenBy`, `ActionTakenOn`, `PurchaseApprComment`, `Status`.
- Finance decision log entity set: `YY1_FINANCEAPPROVAL_SUPPLIER_O`; navigation `to_FinanceApproval`; properties `ActionID`, `SupplierID`, `ActionTakenBy`, `ActionTakenOn`, `FinanceApprComment`, `Status`.

## Workflow status codes

| Code | Description |
|---|---|
| 1 | Submitted |
| 2 | Drafted by Supplier |
| 3 | Under Review of Purchase |
| 4 | Approved by Purchase |
| 5 | Rejected by Purchase |
| 6 | Sent Back by Purchase |
| 7 | Under Review of Finance |
| 8 | Approved by Finance |
| 9 | Rejected by Finance |
| 10 | Sent Back by Finance |
| 11 | Overall Approved |

Supplier draft save sets parent status `2`; supplier submission sets `3`. Purchase decisions are logged under `to_PurchaseApproval` and set statuses `4`/`5`/`6`. Finance decisions are logged under `to_FinanceApproval` and set statuses `8`/`9`/`10`.


## Business Partner creation reference

- Metadata file: `API_BUSINESS_PARTNER.metadata.xml` (copied from the supplied `BP Metadata.xml`).
- Service root: `https://<SAP host>/sap/opu/odata/sap/API_BUSINESS_PARTNER`.
- Business Partner creation entity: `A_BusinessPartner`.
- Supplier data entity: `A_Supplier`; purchasing organization relationship: `to_SupplierPurchasingOrg`.
- Deep insert relationships used for supplier creation: `to_BusinessPartnerRole`, `to_BusinessPartnerAddress`, `to_EmailAddress`, `to_PhoneNumber`, and `to_BusinessPartnerBank`.
- The portal uses `BusinessPartnerIDByExtSystem` with the CBO onboarding ID as an idempotency key, and requests both `BusinessPartner` and `Supplier` in the response/readback.
- CBO SAP Creation entity: `YY1_SAPCREATION_SUPPLIER_ONBOA`; parent navigation: `to_SAPCreation`; fields written: `SupplierID`, `BPNumber`, `SupplierNumber`, and `ErrorMessage`.

The service root defaults to the same host as `SAP_ODATA_SERVICE_ROOT`. Set `SAP_BP_ODATA_SERVICE_ROOT` in `.env` or the Cloud Foundry app environment if the Business Partner service is hosted elsewhere.

## RFQ service reference

- Metadata file: `Z_RFQ_SUPP_PORTAL_SB.metadata.xml` (copied from the supplied `RFQ Metadata.xml`).
- Service root: `https://<SAP host>/sap/opu/odata/sap/Z_RFQ_SUPP_PORTAL_SB`.
- Entity sets: `RFQ_Header`, `RFQ_Bidder`, and `RFQ_Item`. The metadata marks these sets read-only.
- The RFQ Inbox uses the header set with server-side filters and paging. Opening an RFQ reads its header, item rows, and bidder rows.
- Bulk and detail-page Send Email actions verify each bidder against `RFQ_Bidder` and use the supplier name from that record. The bidder entity has no email property. Bidders linked to Supplier Registration use its email and access token, resolved through the SAP Creation CBO. Bidders without a linked onboarding record get a token scoped to their RFQ and supplier, and the portal sends their invitations to `a.warade@praxisinfosolutions.com`.
- Before sending, the portal creates or reuses the `YY1_RFQ_PORTAL` header by `RFQNumber`. A new header stores `RFQNumber`, `RFQdueDate`, and `Currency` from `RFQ_Header`. Each bidder has a `to_ItemNode` row with `RFQNumber`, `Supplier`, `SupplierName`, `SupplierEmail`, and `AccessToken`. If the recipient address exceeds the 30-character `SupplierEmail` limit, the item field is blank and SMTP uses the complete address. This applies to the 32-character fallback address.
- New items start with `EmailSent = No`. After SMTP accepts an invitation, the portal updates that bidder's item to `EmailSent = Yes`, with `LastEmailSentOnDate` and `LastEmailSentatTime`. The Company view asks for confirmation when selected RFQs already have a CBO header. Retries and resends reuse the existing supplier item and its generated token.
- The RFQ Inbox shows the most recent send recorded on a supplier item for each RFQ. RFQs without a sent item show `No` with a blank date and time.
- The service root defaults to the same SAP host as `SAP_ODATA_SERVICE_ROOT`. Configure `SAP_RFQ_ODATA_SERVICE_ROOT` in `.env` or the Cloud Foundry app environment when it differs.

## Supplier quotation service

- Metadata file: `YY1_RFQ_PORTAL_CDS.metadata.xml` (copied from the supplied `YY1_RFQ_PORTAL_CDS.xml`).
- Service root environment variable: `SAP_RFQ_PORTAL_ODATA_SERVICE_ROOT`.
- Headers are looked up by the semantic key `RFQNumber`. New headers use POST `YY1_RFQ_PORTAL`. Updates use PATCH `YY1_RFQ_PORTAL(guid'...')` with the stored UUID and ETag when available.
- The generated `YY1_RFQ_PORTALSap_upsert` function import is not used: live read-only URI validation confirmed that a null date parameter returns `Invalid key predicate`. Entity JSON writes accept nullable dates; a live no-op header PATCH and item PATCH both returned HTTP 204 with unchanged business values on read-back.
- `InvitationID` comes from the verified onboarding UUID or, for an RFQ-specific token, the verified supplier item UUID. The server resolves supplier identity and checks that the supplier is an assigned bidder before saving a quotation.
- Header dates use the OData V2 JSON `/Date(milliseconds)/` representation or JSON null for blank dates. The current item node stores supplier invitations.

## Open purchase orders (OData V4)

`Z_OPENPO_SUPP_PORTAL.xml` defines `OpenPOHeader` (20 fields), `OpenPOItem` (66 fields), `OpenPOItemHistorySum` (8 fields), and `OpenPOItemScheduleSum` (7 fields). The report uses all 101 scalar fields. Header fields appear in the overview; item fields appear in grouped expandable details; all history and schedule summary fields appear in labeled detail sections. The report reads all four published collections filtered by `PurchaseOrder`.

Configure `SAP_OPEN_PO_ODATA_SERVICE_ROOT` if the service differs from `/sap/opu/odata4/sap/z_openpo_supp_portal_sb/srvd_a2x/sap/z_openpo_supp_portal_sd/0001` on the configured SAP tenant. The integration is GET-only and uses V4 `Edm.Date`, `value`, `@odata.count`, and `@odata.nextLink`. Continuation links are validated and rewritten through the same proxy. Field coverage is checked against the supplied XML by `npm test`.
