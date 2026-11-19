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

## OData proxy

`GET`, `POST`, and `PATCH` requests are supported at `/api/odata/{entitySet}`. The onboarding form also posts the six allowed related child records through the onboarding entity's navigation paths. Query strings such as `$filter`, `$select`, `$top`, and `$expand` pass through to SAP. Write requests first fetch an SAP CSRF token and session cookies, then send the request. Add entity sets as the backend service grows. The helper in `js/common.js` exposes `Portal.odata(entity, {method, query, body, headers})`.

The onboarding form is rendered inside the Supplier Registration workspace. It creates the supplier onboarding record, creates bank/documents/contact/SAP/general/tax child placeholders using the returned onboarding key, and sends the supplier confirmation through `/api/mail/send-confirmation`. Mail failure is reported after the SAP record is saved. Bind the existing `supplierportal-smtp-credentials` service before `cf push`, as the manifest expects that service to exist.

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
