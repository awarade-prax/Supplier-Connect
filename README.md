# Supplier Connect portal

An SAP Fiori-inspired supplier portal built from the supplied slide mockups. It has nine top navigation tabs, a launchpad, separate tab modules, and a same-origin Node.js OData proxy.

## Run locally

Requires Node.js 20 or newer. Create a local `.env` file from `.env.example`, then replace the SAP and mail placeholders with your actual values. The RFQ inbox requires `SAP_USERNAME` and `SAP_PASSWORD`, plus the correct `SAP_RFQ_ODATA_SERVICE_ROOT` for your SAP system. The Node server loads `.env` at startup; restart it after changing the file. The checked-in example file itself is only a template. The onboarding email uses the `supplierportal-smtp-credentials` Cloud Foundry user-provided service, or the SMTP variables in `.env` for local use.

```powershell
Copy-Item .env.example .env
# Edit .env and replace each placeholder with your real SAP and SMTP settings.
npm install
npm start
```

Open `http://localhost:3000`. The UI and `/api/odata/...` endpoint share the same origin, so browser CORS does not block the SAP calls. The server calls SAP from Node and holds the SAP credentials out of the browser. If a separately hosted frontend must call this API, set `ALLOWED_ORIGIN` to that exact trusted origin; cross-origin requests are rejected when it is unset. Prefer same-origin deployment.

When moving to another PC, the ignored `.env` file does not come with the clone. Configure all four SAP service roots for your tenant and the SAP credentials, then restart the server. A hostname such as `your-sap-host` is a placeholder and cannot connect to SAP. Run `npm run check:sap` to verify metadata, entity reads, and CSRF token retrieval for onboarding, RFQ, quotation, and business partner services without changing SAP records. Run `npm test` to verify GET, POST, PATCH, CSRF cookies, and ETag forwarding against a local mock SAP server. Actual write permissions and payload validation still depend on the SAP service and user.

## OData proxy

The POs tab includes **Open PO Report** for direct company view only. It lists open purchase orders with PO, supplier, company, and overdue filters and paging. Open a PO to see every header field, expand each item for its full details, and review the goods receipt/invoice and schedule summaries. All 101 scalar fields across the four service entities are represented in `js/modules/open-po-schema.js`, generated from `docs/odata/Z_OPENPO_SUPP_PORTAL.xml`. Related records are paged until all are loaded. Empty sections and per-section SAP errors are reported explicitly.

Configure `SAP_OPEN_PO_ODATA_SERVICE_ROOT` for the OData V4 service if it differs from the default tenant path. Read-only requests use `/api/open-po/{entity}` with server-held SAP credentials. Supplier email view hides the tile and blocks direct report routes; the API rejects supplier-token headers, token query parameters, and requests referred from a supplier link. As with the current portal, company view means a direct visit without a supplier token; company sign-in remains a separate integration requirement.

`GET`, `POST`, and `PATCH` requests are supported at `/api/odata/{entitySet}`. The onboarding form also posts the six allowed related child records through the onboarding entity's navigation paths. Query strings such as `$filter`, `$select`, `$top`, and `$expand` pass through to SAP. Write requests first fetch an SAP CSRF token and session cookies, then send the request. Add entity sets as the backend service grows. The helper in `js/common.js` exposes `Portal.odata(entity, {method, query, body, headers})`.

The onboarding form is rendered inside the Supplier Registration workspace. It creates the supplier onboarding record, creates bank/documents/contact/SAP/general/tax child placeholders using the returned onboarding key, and sends the supplier confirmation through `/api/mail/send-confirmation`. Mail failure is reported after the SAP record is saved. Bind the existing `supplierportal-smtp-credentials` service before `cf push`, as the manifest expects that service to exist.

Both onboarding and RFQ invitations use the same SMTP configuration. For the Google Workspace sender, set `SMTP_HOST=smtp.gmail.com` and `SMTP_PORT=587` (STARTTLS), with the mailbox address and its app password in `.env`. Restart after changing settings. Run `npm run check:mail` to verify the connection, TLS, and authentication without sending an email. This does not verify recipient acceptance or inbox delivery. Port 465 uses implicit TLS if your mail provider requires it. The office network must allow access to the configured SMTP host and port.

RFQ invitations use the assigned bidders in SAP. Bidders linked to Supplier Registration use their onboarding email and token. Bidders without a linked onboarding record get an RFQ-specific invitation token, and their invitations go to `a.warade@praxisinfosolutions.com`. The fallback mailbox is 32 characters long, so SAP's 30-character `SupplierEmail` field remains blank for those invitations. The full address is used for SMTP delivery.

The SAP technical user needs the correct service authorizations. Configure credentials as Cloud Foundry environment variables or bind a managed credential service; do not commit secrets. For example:

```sh
cf set-env supplier-connect-portal SAP_ODATA_SERVICE_ROOT 'https://your-sap-host/sap/opu/odata/sap/YY1_SUPPLIER_ONBOARDING_CDS'
cf set-env supplier-connect-portal SAP_USERNAME 'your-user'
cf set-env supplier-connect-portal SAP_PASSWORD 'your-password'
cf restage supplier-connect-portal
cf push -f manifest.yaml
```

## Structure

```text
index.html
server.js
manifest.yaml
package.json
css/common.css
css/launchpad.css
css/modules/{registration,rfq,po,delivery,invoice,profile,support,admin}.css
js/common.js
js/modules.js
js/modules/{registration,rfq,po,delivery,invoice,profile,support,admin}.js
js/modules/registration-view.js
js/launchpad.js
```

Each work area has its own module descriptor in `js/modules/` and stylesheet in `css/modules/`. `js/modules.js` gathers those descriptors, shared rendering and OData calls are in `js/common.js`, and launchpad/top navigation behavior is in `js/launchpad.js`.

The slides are conceptual mockups with sample content. Most tile workflows, user authentication, and authorization still need to be connected to the matching SAP services and portal identity model.
