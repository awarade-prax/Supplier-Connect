'use strict';

const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const root = process.env.SAP_ODATA_SERVICE_ROOT || 'https://my426023-api.s4hana.cloud.sap/sap/opu/odata/sap/YY1_SUPPLIER_ONBOARDING_CDS';
const services = [
  ['Onboarding', root, 'YY1_SUPPLIER_ONBOARDING'],
  ['RFQ', process.env.SAP_RFQ_ODATA_SERVICE_ROOT || `${new URL(root).origin}/sap/opu/odata/sap/Z_RFQ_SUPP_PORTAL_SB`, 'RFQ_Header'],
  ['Quotation', process.env.SAP_RFQ_PORTAL_ODATA_SERVICE_ROOT || `${new URL(root).origin}/sap/opu/odata/sap/YY1_RFQ_PORTAL_CDS`, 'YY1_RFQ_PORTAL'],
  ['Business partner', process.env.SAP_BP_ODATA_SERVICE_ROOT || `${new URL(root).origin}/sap/opu/odata/sap/API_BUSINESS_PARTNER`, 'A_BusinessPartner'],
  ['Open PO', process.env.SAP_OPEN_PO_ODATA_SERVICE_ROOT || `${new URL(root).origin}/sap/opu/odata4/sap/z_openpo_supp_portal_sb/srvd_a2x/sap/z_openpo_supp_portal_sd/0001`, 'OpenPOHeader', false]
];

async function check([name, serviceRoot, entity, checkCsrf = true]) {
  try {
    const url = new URL(serviceRoot);
    if (url.hostname === 'your-sap-host') throw new Error('Replace your-sap-host in .env with your actual SAP tenant hostname.');
    const headers = { Authorization: `Basic ${Buffer.from(`${process.env.SAP_USERNAME}:${process.env.SAP_PASSWORD}`).toString('base64')}`, Accept: 'application/json' };
    for (const suffix of ['$metadata', `${entity}?$top=1`]) {
      const response = await fetch(`${serviceRoot.replace(/\/$/, '')}/${suffix}`, {
        headers: { ...headers, Accept: suffix === '$metadata' ? 'application/xml' : 'application/json', 'X-CSRF-Token': 'Fetch' }, signal: AbortSignal.timeout(20000)
      });
      await response.arrayBuffer();
      if (!response.ok) throw new Error(`HTTP ${response.status} at ${suffix}; check service activation and user authorizations.`);
      if (checkCsrf && suffix !== '$metadata' && !response.headers.get('x-csrf-token')) throw new Error('Read succeeded but SAP did not return a CSRF token for writes.');
    }
    console.log(`PASS ${name}: metadata, entity GET${checkCsrf ? ', and CSRF token retrieval' : ' (read-only)'} (${url.hostname}).`);
  } catch (error) {
    process.exitCode = 1;
    console.error(`FAIL ${name}: ${error.message}${error.cause?.code ? ` (${error.cause.code})` : ''}`);
  }
}

if (!process.env.SAP_USERNAME || !process.env.SAP_PASSWORD) {
  console.error('Set SAP_USERNAME and SAP_PASSWORD in .env before running the SAP checks.');
  process.exitCode = 1;
} else {
  Promise.all(services.map(check));
}
