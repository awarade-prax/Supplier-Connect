'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const cliPort = process.argv[2] && /^\d+$/.test(process.argv[2]) ? Number(process.argv[2]) : undefined;
const PORT = Number(process.env.PORT || cliPort || 3000);
const ROOT = __dirname;
const SERVICE_ROOT = (process.env.SAP_ODATA_SERVICE_ROOT || 'https://my426023-api.s4hana.cloud.sap/sap/opu/odata/sap/YY1_SUPPLIER_ONBOARDING_CDS').replace(/\/$/, '');
const BP_SERVICE_ROOT = (process.env.SAP_BP_ODATA_SERVICE_ROOT || `${new URL(SERVICE_ROOT).origin}/sap/opu/odata/sap/API_BUSINESS_PARTNER`).replace(/\/$/, '');
const RFQ_SERVICE_ROOT = (process.env.SAP_RFQ_ODATA_SERVICE_ROOT || `${new URL(SERVICE_ROOT).origin}/sap/opu/odata/sap/Z_RFQ_SUPP_PORTAL_SB`).replace(/\/$/, '');
const SAP_USERNAME = process.env.SAP_USERNAME || '';
const SAP_PASSWORD = process.env.SAP_PASSWORD || '';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '';
const CHILD_NAVIGATIONS = new Set(['to_BankData', 'to_Documents', 'to_PurchaseContact', 'to_SAPCreation', 'to_SupplierGeneralData', 'to_TaxRegistration']);
const SUPPLIER_CHILD_SETS = new Set([
  'YY1_SUPPLIERGENERALDATA_SUPPLI', 'YY1_TAXREGISTRATION_SUPPLIER_O',
  'YY1_BANKDATA_SUPPLIER_ONBOARDI', 'YY1_DOCUMENTS_SUPPLIER_ONBOARD',
  'YY1_PURCHASECONTACT_SUPPLIER_O', 'YY1_SAPCREATION_SUPPLIER_ONBOA'
]);
const ENTITY_SETS = new Set([
  'YY1_SUPPLIER_ONBOARDING', 'YY1_SUPPLIERGENERALDATA_SUPPLI', 'YY1_TAXREGISTRATION_SUPPLIER_O',
  'YY1_BANKDATA_SUPPLIER_ONBOARDI', 'YY1_DOCUMENTS_SUPPLIER_ONBOARD', 'YY1_PURCHASECONTACT_SUPPLIER_O',
  'YY1_PURCHASEAPPROVAL_SUPPLI000', 'YY1_FINANCEAPPROVAL_SUPPLIER_O', 'YY1_SAPCREATION_SUPPLIER_ONBOA',
  'YY1_SUPPLIERONBOARDINGSTATUS', 'YY1_SUPPLIERONBOARDINGMSMEFLAG', 'YY1_SUPPLIER_POSTING_STATUS',
  'YY1_SUPPLIER_PUR_FIN_STATUS', 'YY1_SUPPLIER_BANK_ACCOUNTTYPE', 'I_Scbo_ILM_Status_Text', 'P_Scbo_User'
]);
const RFQ_ENTITY_SETS = new Set(['RFQ_Header', 'RFQ_Bidder', 'RFQ_Item']);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.xml': 'application/xml; charset=utf-8', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

function send(res, status, body, contentType = 'application/json; charset=utf-8', extraHeaders = {}) {
  res.writeHead(status, { 'Content-Type': contentType, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extraHeaders });
  res.end(body);
}

function corsHeaders(req) {
  const origin = req.headers.origin;
  if (!origin) return {};
  // The portal and API share this server, so same-origin requests need no CORS headers.
  // Cross-origin browser access is enabled only for the explicitly configured origin.
  if (!ALLOWED_ORIGIN || origin !== ALLOWED_ORIGIN) return {};
  return { 'Access-Control-Allow-Origin': ALLOWED_ORIGIN, 'Vary': 'Origin', 'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Accept, X-CSRF-Token, If-Match, X-Supplier-Access-Token', 'Access-Control-Expose-Headers': 'ETag, X-CSRF-Token' };
}

function getAllowedODataPath(pathname) {
  const decoded = decodeURIComponent(pathname);
  if (ENTITY_SETS.has(decoded)) return { path: decoded, entity: decoded };
  const keyed = decoded.match(/^([A-Za-z0-9_]+)\(guid'[0-9a-fA-F-]{36}'\)$/);
  if (keyed && ENTITY_SETS.has(keyed[1])) return { path: decoded, entity: keyed[1] };
  const child = decoded.match(/^(YY1_SUPPLIER_ONBOARDING\(guid'[0-9a-fA-F-]{36}'\))\/(to_[A-Za-z]+)$/);
  if (child && CHILD_NAVIGATIONS.has(child[2])) return { path: decoded, entity: 'YY1_SUPPLIER_ONBOARDING' };
  return null;
}

function getSmtpConfig() {
  const fromEnv = {
    SMTP_HOST: process.env.SMTP_HOST,
    SMTP_PORT: process.env.SMTP_PORT,
    SMTP_USER: process.env.SMTP_USER,
    SMTP_PASSWORD: process.env.SMTP_PASSWORD,
    SMTP_SENDER_NAME: process.env.SMTP_SENDER_NAME
  };
  try {
    const vcap = JSON.parse(process.env.VCAP_SERVICES || '{}');
    const bindings = Object.values(vcap).flat();
    const binding = bindings.find(service => service.name === 'supplierportal-smtp-credentials')
      || bindings.find(service => service.tags?.includes('supplierportal-smtp-credentials'));
    return { ...(binding?.credentials || {}), ...Object.fromEntries(Object.entries(fromEnv).filter(([, value]) => value)) };
  } catch {
    return fromEnv;
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function cleanHeader(value) { return String(value ?? '').replace(/[\r\n]/g, '').trim(); }

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) { chunks.push(chunk); if (Buffer.concat(chunks).length > 5 * 1024 * 1024) throw new Error('Request body exceeds 5 MB.'); }
  return Buffer.concat(chunks);
}

async function getCsrf(entity, serviceRoot = SERVICE_ROOT) {
  const response = await fetch(`${serviceRoot}/${encodeURIComponent(entity)}`, { headers: { Authorization: `Basic ${Buffer.from(`${SAP_USERNAME}:${SAP_PASSWORD}`).toString('base64')}`, 'X-CSRF-Token': 'Fetch', Accept: 'application/json' } });
  const token = response.headers.get('x-csrf-token');
  if (!response.ok || !token) throw new Error('SAP did not provide a CSRF token.');
  const cookies = (response.headers.getSetCookie ? response.headers.getSetCookie() : [response.headers.get('set-cookie')].filter(Boolean)).map(value => value.split(';')[0]).join('; ');
  return { token, cookies };
}

async function sapJson(response, operation) {
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = {}; }
  if (!response.ok) {
    const primary = payload?.error?.message?.value || payload?.error?.message || payload?.message;
    const details = payload?.error?.innererror?.errordetails;
    const detailMessages = Array.isArray(details) ? details.map(item => item?.message).filter(Boolean) : [];
    const message = [primary, ...detailMessages].map(value => typeof value === 'string' ? value : '').filter((value, index, all) => value && all.indexOf(value) === index).join(' — ');
    throw new Error(`${operation} failed (${response.status})${message ? `: ${message.slice(0, 700)}` : '.'}`);
  }
  return payload?.d || payload;
}

function compactSapPayload(value) {
  if (Array.isArray(value)) return value.map(compactSapPayload).filter(item => item !== undefined);
  if (value && typeof value === 'object') {
    const result = {};
    for (const [key, entry] of Object.entries(value)) {
      const compacted = compactSapPayload(entry);
      if (compacted === '' || compacted === null || compacted === undefined || (Array.isArray(compacted) && !compacted.length)) continue;
      result[key] = compacted;
    }
    return result;
  }
  return value;
}

async function readSapCollection(serviceRoot, entitySet, query) {
  const response = await fetch(`${serviceRoot}/${entitySet}${query}`, { headers: sapAuthHeaders(), redirect: 'follow' });
  const data = await sapJson(response, `SAP read ${entitySet}`);
  return Array.isArray(data?.results) ? data.results : Array.isArray(data) ? data : data ? [data] : [];
}

async function resolveRfqSupplier(rfqNumber, supplierNumber) {
  const quote = value => String(value || '').replace(/'/g, "''");
  const bidderFilter = `RequestForQuotation eq '${quote(rfqNumber)}' and Supplier eq '${quote(supplierNumber)}'`;
  const bidders = await readSapCollection(RFQ_SERVICE_ROOT, 'RFQ_Bidder', `?$filter=${encodeURIComponent(bidderFilter)}&$top=1`);
  if (!bidders.length) throw Object.assign(new Error('This supplier is not listed as a bidder for the selected RFQ.'), { statusCode: 409 });
  const creationFilter = `SupplierNumber eq '${quote(supplierNumber)}'`;
  const creations = await readSapCollection(SERVICE_ROOT, 'YY1_SAPCREATION_SUPPLIER_ONBOA', `?$filter=${encodeURIComponent(creationFilter)}&$top=5`);
  const creation = creations.find(record => String(record.SupplierNumber || '').trim() === supplierNumber);
  if (!creation?.SAP_PARENT_UUID || !creation?.SupplierID) throw Object.assign(new Error('No matching supplier onboarding record was found.'), { statusCode: 409 });
  const onboardingFilter = `SAP_UUID eq guid'${String(creation.SAP_PARENT_UUID).toLowerCase()}' and ID eq '${quote(creation.SupplierID)}'`;
  const onboardings = await readSapCollection(SERVICE_ROOT, 'YY1_SUPPLIER_ONBOARDING', `?$filter=${encodeURIComponent(onboardingFilter)}&$top=1`);
  const onboarding = onboardings.find(record => String(record.SAP_UUID || '').toLowerCase() === String(creation.SAP_PARENT_UUID).toLowerCase() && String(record.ID || '') === String(creation.SupplierID));
  if (!onboarding?.SupplierEmail || !onboarding?.AccessToken) throw Object.assign(new Error('The supplier email or portal access token is missing from the onboarding record.'), { statusCode: 409 });
  return { email: String(onboarding.SupplierEmail).trim(), token: String(onboarding.AccessToken).trim(), name: String(onboarding.SupplierName || bidders[0].SupplierName || 'Supplier').trim() };
}

function sapCountry(input) {
  const country = String(input || '').trim();
  if (!country || /^india$/i.test(country)) return 'IN';
  return country.length <= 3 ? country.toUpperCase() : '';
}

function sapPostalCode(input, country) {
  const postalCode = String(input || '').trim();
  if (country === 'IN') {
    if (!/^\d{6}$/.test(postalCode)) throw new Error('SAP requires a six-digit PIN code for an Indian supplier address. Correct the supplier address before retrying Finance approval.');
    return postalCode;
  }
  return postalCode.slice(0, 10);
}

function sapRegion(input) {
  const code = String(input || '').trim().toUpperCase();
  if (code.length <= 3) return code;
  const indianStates = { 'ANDHRA PRADESH':'AP', 'ARUNACHAL PRADESH':'AR', ASSAM:'AS', BIHAR:'BR', CHHATTISGARH:'CG', GOA:'GA', GUJARAT:'GJ', HARYANA:'HR', 'HIMACHAL PRADESH':'HP', JHARKHAND:'JH', KARNATAKA:'KA', KERALA:'KL', 'MADHYA PRADESH':'MP', MAHARASHTRA:'MH', MANIPUR:'MN', MEGHALAYA:'ML', MIZORAM:'MZ', NAGALAND:'NL', ODISHA:'OD', PUNJAB:'PB', RAJASTHAN:'RJ', SIKKIM:'SK', 'TAMIL NADU':'TN', TELANGANA:'TS', TRIPURA:'TR', 'UTTAR PRADESH':'UP', UTTARAKHAND:'UK', 'WEST BENGAL':'WB', DELHI:'DL' };
  return indianStates[code] || '';
}

async function postBusinessPartner(parent, general, tax, contact, bank) {
  const extId = String(parent.ID || '').trim().slice(0, 20);
  if (!extId) throw new Error('The onboarding ID is required to create a Business Partner.');
  // Validate address data before the idempotency lookup so retries cannot bypass it.
  const countryInput = String(general.Country || '').trim();
  const country = sapCountry(countryInput);
  if (!country) throw new Error(`Country "${countryInput}" is not a valid SAP country code. Enter the SAP two- or three-character country code before retrying Finance approval.`);
  const postalCode = sapPostalCode(general.PINCode, country);
  const escOData = value => String(value || '').replace(/'/g, "''");
  const existingQuery = `?$filter=${encodeURIComponent(`BusinessPartnerIDByExtSystem eq '${escOData(extId)}'`)}&$select=BusinessPartner,Supplier&$top=1`;
  const existing = await readSapCollection(BP_SERVICE_ROOT, 'A_BusinessPartner', existingQuery);
  let bpNumber = existing[0]?.BusinessPartner || '';
  let supplierNumber = existing[0]?.Supplier || '';
  if (!bpNumber) {
    const companyName = String(parent.SupplierName || '').trim();
    const region = sapRegion(general.State);
    const phone = String(contact.Mobile || '').trim().slice(0, 30);
    const payload = {
      BusinessPartnerCategory: '2',
      BusinessPartnerGrouping: 'BP02',
      OrganizationBPName1: companyName.slice(0, 40),
      OrganizationBPName2: companyName.slice(40, 80),
      SearchTerm1: companyName.slice(0, 20).toUpperCase(),
      BusinessPartnerIDByExtSystem: extId,
      YY1_Email_ID_bus: String(parent.SupplierEmail || contact.Email || '').slice(0, 150),
      to_BusinessPartnerRole: [{ BusinessPartnerRole: 'FLVN00' }, { BusinessPartnerRole: 'FLVN01' }],
      to_BusinessPartnerAddress: [{
        Country: country,
        Language: 'EN',
        CityName: String(general.City || '').slice(0, 40),
        PostalCode: postalCode,
        StreetName: String(general.Address1 || '').slice(0, 60),
        District: String(general.District || '').slice(0, 40),
        ...(region ? { Region: region } : {}),
        to_EmailAddress: parent.SupplierEmail || contact.Email ? [{ EmailAddress: String(parent.SupplierEmail || contact.Email).slice(0, 241), IsDefaultEmailAddress: true }] : [],
        to_PhoneNumber: phone ? [{ PhoneNumber: phone, IsDefaultPhoneNumber: true }] : []
      }]
    };
    if (String(tax.MSMEFlag || '') === '01' && tax.MSMEType) payload.YY1_MSMEType1_bus = String(tax.MSMEType).slice(0, 20);
    const account = String(bank.AccountNumber || '').trim();
    const ifsc = String(bank.IFSC || '').trim();
    if (account && ifsc) payload.to_BusinessPartnerBank = [{
      BankIdentification: '0001', BankCountryKey: country, BankName: String(bank.BankName || '').slice(0, 60),
      BankNumber: ifsc.slice(0, 15), BankAccount: account.slice(0, 18),
      BankAccountHolderName: String(bank.AccountHolder || parent.SupplierName || '').slice(0, 60)
    }];

    const csrf = await getCsrf('A_BusinessPartner', BP_SERVICE_ROOT);
    const response = await fetch(`${BP_SERVICE_ROOT}/A_BusinessPartner`, {
      method: 'POST',
      headers: { ...sapAuthHeaders(), 'X-CSRF-Token': csrf.token, ...(csrf.cookies ? { Cookie: csrf.cookies } : {}), 'Content-Type': 'application/json' },
      body: JSON.stringify(compactSapPayload(payload)), redirect: 'manual'
    });
    const created = await sapJson(response, 'SAP Business Partner creation');
    bpNumber = created.BusinessPartner || created.Supplier;
    supplierNumber = created.Supplier || '';
    if (!bpNumber) {
      const afterCreate = await readSapCollection(BP_SERVICE_ROOT, 'A_BusinessPartner', existingQuery);
      bpNumber = afterCreate[0]?.BusinessPartner || '';
      supplierNumber = afterCreate[0]?.Supplier || '';
    }
    if (!bpNumber) throw new Error('SAP created the Business Partner but did not return its number.');
  }
  if (!supplierNumber) supplierNumber = bpNumber;
  const createdSupplier = { bpNumber: String(bpNumber), supplierNumber: String(supplierNumber) };

  const supplierUpdates = {};
  if (tax.PAN) supplierUpdates.BusinessPartnerPanNumber = String(tax.PAN).trim().slice(0, 40);
  if (tax.GSTIN) supplierUpdates.VATRegistration = String(tax.GSTIN).trim().slice(0, 20);
  if (String(tax.MSMEFlag || '') === '01' && tax.MSMEType) supplierUpdates.YY1_MSMEType1_sup = String(tax.MSMEType).slice(0, 20);
  if (Object.keys(supplierUpdates).length) {
    const csrf = await getCsrf('A_Supplier', BP_SERVICE_ROOT);
    const response = await fetch(`${BP_SERVICE_ROOT}/A_Supplier('${encodeURIComponent(supplierNumber)}')`, {
      method: 'PATCH',
      headers: { ...sapAuthHeaders(), 'X-CSRF-Token': csrf.token, ...(csrf.cookies ? { Cookie: csrf.cookies } : {}), 'Content-Type': 'application/json', 'If-Match': '*' },
      body: JSON.stringify(supplierUpdates), redirect: 'manual'
    });
    try { await sapJson(response, 'SAP supplier tax data update'); }
    catch (error) { error.sapCreation = createdSupplier; throw error; }
  }

  const purchasingOrg = String(parent.PurchasingOrganization || '').trim().slice(0, 4);
  if (purchasingOrg) {
    try {
      const supplierPath = `${BP_SERVICE_ROOT}/A_Supplier('${encodeURIComponent(bpNumber)}')`;
      const filter = `?$filter=${encodeURIComponent(`PurchasingOrganization eq '${escOData(purchasingOrg)}'`)}&$top=1`;
      const orgs = await readSapCollection(supplierPath, 'to_SupplierPurchasingOrg', filter);
      if (!orgs.length) {
        const csrf = await getCsrf('A_Supplier', BP_SERVICE_ROOT);
        const response = await fetch(`${supplierPath}/to_SupplierPurchasingOrg`, {
          method: 'POST',
          headers: { ...sapAuthHeaders(), 'X-CSRF-Token': csrf.token, ...(csrf.cookies ? { Cookie: csrf.cookies } : {}), 'Content-Type': 'application/json' },
          body: JSON.stringify({ PurchasingOrganization: purchasingOrg }), redirect: 'manual'
        });
        await sapJson(response, 'SAP supplier purchasing organization creation');
      }
    } catch (error) { console.warn('Supplier was created, but its purchasing organization could not be added:', error.message); }
  }
  return createdSupplier;
}

async function updateOnboardingStatus(parent, status) {
  const path = `YY1_SUPPLIER_ONBOARDING(guid'${String(parent.SAP_UUID).toLowerCase()}')`;
  const csrf = await getCsrf('YY1_SUPPLIER_ONBOARDING');
  const response = await fetch(`${SERVICE_ROOT}/${path}`, {
    method: 'PATCH', headers: { ...sapAuthHeaders(), 'X-CSRF-Token': csrf.token, ...(csrf.cookies ? { Cookie: csrf.cookies } : {}), 'Content-Type': 'application/json', 'If-Match': parent.__metadata?.etag || '*' },
    body: JSON.stringify({ Status: String(status) }), redirect: 'manual'
  });
  await sapJson(response, `SAP onboarding status update to ${status}`);
  parent.Status = String(status);
}

async function upsertSapCreation(parent, result = {}, errorMessage = '') {
  const uuid = String(parent.SAP_UUID).toLowerCase();
  const supplierId = String(parent.ID || '');
  const filter = `SAP_PARENT_UUID eq guid'${uuid}' and SupplierID eq '${supplierId.replace(/'/g, "''")}'`;
  const existing = await readSapCollection(SERVICE_ROOT, 'YY1_SAPCREATION_SUPPLIER_ONBOA', `?$filter=${encodeURIComponent(filter)}&$top=1`);
  const data = { SupplierID: supplierId, BPNumber: result.bpNumber || '', SupplierNumber: result.supplierNumber || '', ErrorMessage: String(errorMessage || '').slice(0, 500) };
  const csrf = await getCsrf('YY1_SAPCREATION_SUPPLIER_ONBOA');
  const headers = { ...sapAuthHeaders(), 'X-CSRF-Token': csrf.token, ...(csrf.cookies ? { Cookie: csrf.cookies } : {}), 'Content-Type': 'application/json' };
  if (existing[0]?.SAP_UUID) {
    const path = `YY1_SAPCREATION_SUPPLIER_ONBOA(guid'${String(existing[0].SAP_UUID).toLowerCase()}')`;
    const response = await fetch(`${SERVICE_ROOT}/${path}`, { method: 'PATCH', headers: { ...headers, 'If-Match': existing[0].__metadata?.etag || '*' }, body: JSON.stringify(data), redirect: 'manual' });
    await sapJson(response, 'SAP Creation status update');
  } else {
    const parentPath = `YY1_SUPPLIER_ONBOARDING(guid'${uuid}')/to_SAPCreation`;
    const response = await fetch(`${SERVICE_ROOT}/${parentPath}`, { method: 'POST', headers, body: JSON.stringify(data), redirect: 'manual' });
    await sapJson(response, 'SAP Creation record creation');
  }
}

async function loadSupplierCreationData(parent) {
  const filter = `SAP_PARENT_UUID eq guid'${String(parent.SAP_UUID).toLowerCase()}'`;
  const sets = { general: 'YY1_SUPPLIERGENERALDATA_SUPPLI', tax: 'YY1_TAXREGISTRATION_SUPPLIER_O', contact: 'YY1_PURCHASECONTACT_SUPPLIER_O', bank: 'YY1_BANKDATA_SUPPLIER_ONBOARDI' };
  const loaded = await Promise.all(Object.entries(sets).map(async ([key, set]) => [key, (await readSapCollection(SERVICE_ROOT, set, `?$filter=${encodeURIComponent(filter)}&$top=1`))[0] || {}]));
  return Object.fromEntries(loaded);
}

async function writeApprovalLog(parent, stage, decision, comment, req) {
  const target = stage === 'purchase'
    ? { navigation: 'to_PurchaseApproval', entitySet: 'YY1_PURCHASEAPPROVAL_SUPPLI000', commentField: 'PurchaseApprComment' }
    : { navigation: 'to_FinanceApproval', entitySet: 'YY1_FINANCEAPPROVAL_SUPPLIER_O', commentField: 'FinanceApprComment' };
  const countUrl = new URL(`${SERVICE_ROOT}/${target.entitySet}`);
  countUrl.searchParams.set('$inlinecount', 'allpages'); countUrl.searchParams.set('$top', '1'); countUrl.searchParams.set('$select', 'ActionID');
  const countResponse = await fetch(countUrl, { headers: sapAuthHeaders(), redirect: 'follow' });
  const countData = await sapJson(countResponse, 'SAP approval log lookup');
  const count = Number(countData.__count);
  if (!Number.isFinite(count)) throw new Error('SAP did not return an approval log count.');
  const csrf = await getCsrf('YY1_SUPPLIER_ONBOARDING');
  const actionBody = {
    ActionID: String(count + 1).padStart(10, '0'),
    SupplierID: String(parent.ID || ''),
    ActionTakenBy: cleanHeader(req.headers['x-forwarded-user'] || req.headers['x-user'] || 'Unknown User').slice(0, 50),
    ActionTakenOn: `/Date(${Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate())})/`,
    [target.commentField]: comment,
    Status: decision === 'Approved' ? '02' : decision === 'Rejected' ? '03' : '01'
  };
  const response = await fetch(`${SERVICE_ROOT}/YY1_SUPPLIER_ONBOARDING(guid'${String(parent.SAP_UUID).toLowerCase()}')/${target.navigation}`, {
    method: 'POST', headers: { ...sapAuthHeaders(), 'X-CSRF-Token': csrf.token, ...(csrf.cookies ? { Cookie: csrf.cookies } : {}), 'Content-Type': 'application/json' },
    body: JSON.stringify(actionBody), redirect: 'manual'
  });
  await sapJson(response, `${stage} approval log creation`);
}

async function approvalDecision(req, res) {
  if (!SAP_USERNAME || !SAP_PASSWORD) return send(res, 503, JSON.stringify({ error: 'SAP credentials are not configured on the server.' }));
  let payload;
  try { payload = JSON.parse((await readBody(req)).toString('utf8') || '{}'); }
  catch { return send(res, 400, JSON.stringify({ error: 'Request must contain valid JSON.' })); }
  const uuid = String(payload.uuid || '');
  const decision = String(payload.decision || '');
  const comment = String(payload.comment || '');
  if (!/^[\da-f-]{36}$/i.test(uuid)) return send(res, 400, JSON.stringify({ error: 'A valid onboarding UUID is required.' }));
  if (comment.length > 500) return send(res, 400, JSON.stringify({ error: 'Comments must be 500 characters or fewer.' }));
  if (!['Approved', 'Rejected', 'Sent Back'].includes(decision)) return send(res, 400, JSON.stringify({ error: 'Choose Approve, Reject, or Send Back.' }));

  try {
    const parentPath = `YY1_SUPPLIER_ONBOARDING(guid'${uuid.toLowerCase()}')`;
    const parentResponse = await fetch(`${SERVICE_ROOT}/${parentPath}`, { headers: sapAuthHeaders(), redirect: 'follow' });
    if (!parentResponse.ok) return send(res, parentResponse.status === 404 ? 404 : 502, JSON.stringify({ error: `SAP could not load this onboarding (${parentResponse.status}).` }));
    const parentData = await parentResponse.json();
    const parent = parentData?.d || parentData;
    const current = String(parent.Status || '');
    const stage = current === '3' ? 'purchase' : ['4', '7'].includes(current) ? 'finance' : '';
    if (!stage) return send(res, 409, JSON.stringify({ error: 'This onboarding is no longer awaiting an approval action.' }));

    const statusByDecision = stage === 'purchase'
      ? { Approved: '4', Rejected: '5', 'Sent Back': '6' }
      : { Approved: '8', Rejected: '9', 'Sent Back': '10' };
    let creation = null;
    let creationError = '';

    // Finance approval is reflected in the CBO before the separate BP OData POST starts.
    if (stage === 'finance' && decision === 'Approved') {
      await updateOnboardingStatus(parent, '8');
      try {
        const { general, tax, contact, bank } = await loadSupplierCreationData(parent);
        creation = await postBusinessPartner(parent, general, tax, contact, bank);
        await upsertSapCreation(parent, creation);
        await writeApprovalLog(parent, stage, decision, comment, req);
        await updateOnboardingStatus(parent, '11');
      } catch (error) {
        creation = error.sapCreation || creation;
        creationError = error.message || 'SAP Business Partner creation failed.';
        try { await upsertSapCreation(parent, creation || {}, creationError); }
        catch (recordError) { creationError += ` SAP Creation error could not be saved: ${recordError.message}`; }
        try { await updateOnboardingStatus(parent, '7'); }
        catch (rollbackError) { creationError += ` Finance review status could not be restored: ${rollbackError.message}`; }
      }
      return send(res, 200, JSON.stringify({ status: parent.Status, stage, decision, creation, creationError }));
    }

    await writeApprovalLog(parent, stage, decision, comment, req);
    await updateOnboardingStatus(parent, statusByDecision[decision]);
    return send(res, 200, JSON.stringify({ status: statusByDecision[decision], stage, decision }));
  } catch (error) {
    console.error('Supplier approval action failed:', error.message);
    return send(res, 502, JSON.stringify({ error: error.message || 'SAP approval action failed.' }));
  }
}

async function retrySupplierCreation(req, res) {
  if (!SAP_USERNAME || !SAP_PASSWORD) return send(res, 503, JSON.stringify({ error: 'SAP credentials are not configured on the server.' }));
  let payload;
  try { payload = JSON.parse((await readBody(req)).toString('utf8') || '{}'); }
  catch { return send(res, 400, JSON.stringify({ error: 'Request must contain valid JSON.' })); }
  const uuid = String(payload.uuid || '');
  if (!/^[\da-f-]{36}$/i.test(uuid)) return send(res, 400, JSON.stringify({ error: 'A valid onboarding UUID is required.' }));
  let parent;
  let priorCreation = {};
  try {
    const parentPath = `YY1_SUPPLIER_ONBOARDING(guid'${uuid.toLowerCase()}')`;
    const response = await fetch(`${SERVICE_ROOT}/${parentPath}`, { headers: sapAuthHeaders(), redirect: 'follow' });
    parent = await sapJson(response, 'Supplier onboarding lookup');
    const status = String(parent.Status);
    const existing = await readSapCollection(SERVICE_ROOT, 'YY1_SAPCREATION_SUPPLIER_ONBOA', `?$filter=${encodeURIComponent(`SAP_PARENT_UUID eq guid'${uuid.toLowerCase()}'`)}&$top=1`);
    priorCreation = existing[0] || {};
    const hasSavedFailure = Boolean(existing[0]?.ErrorMessage);
    if (!['8', '11'].includes(status) || (status === '11' && !hasSavedFailure)) return send(res, 409, JSON.stringify({ error: 'Only a Finance-approved onboarding with a saved SAP creation issue can be retried.' }));
    const { general, tax, contact, bank } = await loadSupplierCreationData(parent);
    const created = await postBusinessPartner(parent, general, tax, contact, bank);
    await upsertSapCreation(parent, created);
    await updateOnboardingStatus(parent, '11');
    return send(res, 200, JSON.stringify({ status: '11', ...created }));
  } catch (error) {
    console.error('SAP supplier creation retry failed:', error.message);
    if (error.sapCreation) priorCreation = { ...priorCreation, BPNumber: error.sapCreation.bpNumber, SupplierNumber: error.sapCreation.supplierNumber };
    const message = error.message || 'SAP supplier creation retry failed.';
    if (parent?.SAP_UUID) {
      try {
        await upsertSapCreation(parent, { bpNumber: priorCreation.BPNumber, supplierNumber: priorCreation.SupplierNumber }, message);
        await updateOnboardingStatus(parent, '7');
        return send(res, 200, JSON.stringify({ status: '7', rolledBack: true, creationError: message }));
      } catch (rollbackError) {
        return send(res, 502, JSON.stringify({ error: `${message} Finance review status could not be restored: ${rollbackError.message}`, status: parent.Status }));
      }
    }
    return send(res, 502, JSON.stringify({ error: message }));
  }
}

function sapAuthHeaders() {
  return { Authorization: `Basic ${Buffer.from(`${SAP_USERNAME}:${SAP_PASSWORD}`).toString('base64')}`, Accept: 'application/json' };
}

async function getSupplierByAccessToken(accessToken) {
  if (!/^[a-f0-9]{64}$/i.test(accessToken)) return null;
  const endpoint = new URL(`${SERVICE_ROOT}/YY1_SUPPLIER_ONBOARDING`);
  endpoint.searchParams.set('$filter', `AccessToken eq '${accessToken}'`);
  endpoint.searchParams.set('$top', '1');
  const response = await fetch(endpoint, { headers: sapAuthHeaders(), redirect: 'follow' });
  if (!response.ok) throw new Error(`SAP invitation lookup returned ${response.status}.`);
  const data = await response.json();
  const value = data?.d || data;
  return (Array.isArray(value?.results) ? value.results : Array.isArray(value) ? value : [value]).find(Boolean) || null;
}

async function hasAddressCorrectionIssue(parent) {
  const uuid = String(parent?.SAP_UUID || '').toLowerCase();
  if (!/^[\da-f-]{36}$/i.test(uuid)) return false;
  const filter = `SAP_PARENT_UUID eq guid'${uuid}'`;
  const records = await readSapCollection(SERVICE_ROOT, 'YY1_SAPCREATION_SUPPLIER_ONBOA', `?$filter=${encodeURIComponent(filter)}&$top=1`);
  return /pin code|postal code|country .*not a valid|address/i.test(String(records[0]?.ErrorMessage || ''));
}

async function authorizeOData(req, url, odata) {
  const token = String(req.headers['x-supplier-access-token'] || '');
  const isParentCreate = req.method === 'POST' && odata.path === 'YY1_SUPPLIER_ONBOARDING';
  if (!token) {
    if (isParentCreate) return { allowed: true };
    if (req.method === 'GET' && odata.path === 'YY1_SUPPLIER_ONBOARDING') return { allowed: true, directSupplierList: true };
    if (req.method === 'GET' && odata.entity === 'YY1_SAPCREATION_SUPPLIER_ONBOA') return { allowed: true, directSapCreationList: true };
    const directFilter = url.searchParams.get('$filter') || '';
    if (req.method === 'GET' && SUPPLIER_CHILD_SETS.has(odata.entity)
        && /(?:^|\s+and\s+)SAP_PARENT_UUID\s+eq\s+guid'[\da-f-]{36}'(?:$|\s+and\s+)/i.test(directFilter)) return { allowed: true };
    return { allowed: false, status: 401, error: 'A supplier invitation token is required for this request.' };
  }

  const parent = await getSupplierByAccessToken(token);
  if (!parent?.SAP_UUID || !/^[\da-f-]{36}$/i.test(parent.SAP_UUID)) return { allowed: false, status: 401, error: 'The supplier invitation token is invalid.' };
  const parentUuid = parent.SAP_UUID.toLowerCase();
  const parentPath = `YY1_SUPPLIER_ONBOARDING(guid'${parentUuid}')`;
  const currentStatus = String(parent.Status || '');
  const correctionAllowed = req.method !== 'GET' && currentStatus === '7' ? await hasAddressCorrectionIssue(parent) : false;
  const supplierCanEdit = ['1', '2', '6', '10'].includes(currentStatus) || correctionAllowed;
  const filter = url.searchParams.get('$filter') || '';
  const exactParentLookup = req.method === 'GET' && odata.path === 'YY1_SUPPLIER_ONBOARDING'
    && filter.replace(/\s+/g, ' ').trim() === `AccessToken eq '${token}'`;
  const keyedParentLookup = req.method === 'GET' && odata.path.toLowerCase() === parentPath.toLowerCase();
  if (exactParentLookup || keyedParentLookup) return { allowed: true, parent };
  const keyedParentPatch = req.method === 'PATCH' && odata.entity === 'YY1_SUPPLIER_ONBOARDING'
    && odata.path.toLowerCase() === parentPath.toLowerCase();
  if (keyedParentPatch && supplierCanEdit) return { allowed: true, parent, supplierStatusPatch: true, correctionAllowed };
  if (keyedParentPatch) return { allowed: false, status: 403, error: 'Supplier changes are not allowed while this onboarding is under review.' };

  const childSets = SUPPLIER_CHILD_SETS;
  const parentFilter = new RegExp(`(?:^|\\s+and\\s+)SAP_PARENT_UUID\\s+eq\\s+guid'${parentUuid}'(?:$|\\s+and\\s+)`, 'i');
  if (req.method === 'GET' && childSets.has(odata.entity) && parentFilter.test(filter)) return { allowed: true, parent };

  const navigationPath = odata.path.match(/^YY1_SUPPLIER_ONBOARDING\(guid'([\da-f-]{36})'\)\/(to_[A-Za-z]+)$/i);
  if (req.method === 'POST' && navigationPath && navigationPath[1].toLowerCase() === parentUuid
      && CHILD_NAVIGATIONS.has(navigationPath[2]) && navigationPath[2] !== 'to_SAPCreation' && supplierCanEdit) return { allowed: true, parent };

  const keyedChild = req.method === 'PATCH' && childSets.has(odata.entity)
    ? odata.path.match(/\(guid'([\da-f-]{36})'\)$/i) : null;
  if (keyedChild) {
    const childUuid = keyedChild[1].toLowerCase();
    const childUrl = new URL(`${SERVICE_ROOT}/${odata.entity}`);
    childUrl.searchParams.set('$filter', `SAP_PARENT_UUID eq guid'${parentUuid}' and SAP_UUID eq guid'${childUuid}'`);
    childUrl.searchParams.set('$top', '1');
    const childResponse = await fetch(childUrl, { headers: sapAuthHeaders(), redirect: 'follow' });
    if (childResponse.ok) {
      const childData = await childResponse.json();
      const childResult = childData?.d || childData;
      const found = Array.isArray(childResult?.results) ? childResult.results.length > 0 : Boolean(childResult?.SAP_UUID);
      if (found && supplierCanEdit) return { allowed: true, parent };
    }
  }

  return { allowed: false, status: 403, error: 'This invitation is limited to its matching supplier registration.' };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/rfq/odata/')) {
    const cors = corsHeaders(req);
    if (req.method === 'OPTIONS') { res.writeHead(204, { ...cors, 'Access-Control-Max-Age': '600' }); return res.end(); }
    if (req.method !== 'GET') return send(res, 405, JSON.stringify({ error: 'The RFQ service is read-only; GET is the only supported method.' }), undefined, cors);
    if (!SAP_USERNAME || !SAP_PASSWORD) return send(res, 503, JSON.stringify({ error: 'SAP credentials are missing. Configure SAP_USERNAME and SAP_PASSWORD on the server.' }), undefined, cors);
    let entity;
    try { entity = decodeURIComponent(url.pathname.slice('/api/rfq/odata/'.length)); }
    catch { return send(res, 400, JSON.stringify({ error: 'Invalid RFQ entity path encoding.' }), undefined, cors); }
    if (!RFQ_ENTITY_SETS.has(entity)) return send(res, 404, JSON.stringify({ error: 'Unknown RFQ entity set.' }), undefined, cors);
    try {
      const upstream = await fetch(`${RFQ_SERVICE_ROOT}/${entity}${url.search}`, {
        headers: { Accept: req.headers.accept || 'application/json', Authorization: `Basic ${Buffer.from(`${SAP_USERNAME}:${SAP_PASSWORD}`).toString('base64')}` },
        redirect: 'follow'
      });
      const body = Buffer.from(await upstream.arrayBuffer());
      return send(res, upstream.status, body, upstream.headers.get('content-type') || 'application/json; charset=utf-8', { ...cors, ...(upstream.headers.get('etag') ? { ETag: upstream.headers.get('etag') } : {}) });
    } catch (error) {
      console.error('RFQ OData proxy request failed:', error.message);
      return send(res, 502, JSON.stringify({ error: 'Could not load RFQ data from SAP. Check the RFQ service configuration and SAP connectivity.' }), undefined, cors);
    }
  }

  if (url.pathname.startsWith('/api/odata/')) {
    const cors = corsHeaders(req);
    if (req.method === 'OPTIONS') { res.writeHead(204, { ...cors, 'Access-Control-Max-Age': '600' }); return res.end(); }
    if (!['GET', 'POST', 'PATCH'].includes(req.method)) return send(res, 405, JSON.stringify({ error: 'Supported OData methods are GET, POST, and PATCH.' }), undefined, cors);
    if (!SAP_USERNAME || !SAP_PASSWORD) return send(res, 503, JSON.stringify({ error: 'SAP credentials are missing. Create a .env file from .env.example and set SAP_USERNAME and SAP_PASSWORD.' }), undefined, cors);
    let odata;
    try { odata = getAllowedODataPath(url.pathname.slice('/api/odata/'.length)); }
    catch { return send(res, 400, JSON.stringify({ error: 'Invalid OData path encoding.' }), undefined, cors); }
    if (!odata) return send(res, 404, JSON.stringify({ error: 'Unknown OData entity set or relationship.' }), undefined, cors);
    try {
      const authorization = await authorizeOData(req, url, odata);
      if (!authorization.allowed) return send(res, authorization.status, JSON.stringify({ error: authorization.error }), undefined, cors);
      if (!req.headers['x-supplier-access-token'] && req.method === 'GET' && odata.path === 'YY1_SUPPLIER_ONBOARDING') {
        url.searchParams.set('$select', 'SAP_UUID,ID,REQID,SupplierName,SupplierEmail,PurchasingOrganization,SupplierCategory,Status,Status_Text,SAP_CreatedDateTime');
        // Keep the direct approvals screen bounded; later pages use SAP's server paging token.
        url.searchParams.set('$top', '50');
        if (!url.searchParams.has('$orderby')) url.searchParams.set('$orderby', 'SAP_CreatedDateTime desc');
      }
      if (authorization.directSapCreationList) {
        url.searchParams.set('$select', 'SAP_UUID,SAP_PARENT_UUID,SupplierID,BPNumber,SupplierNumber,PostingStatus,PostingStatus_Text,ErrorMessage');
        url.searchParams.set('$top', '50');
        if (!url.searchParams.has('$orderby')) url.searchParams.set('$orderby', 'SupplierID desc');
      }
      const upstreamUrl = `${SERVICE_ROOT}/${odata.path}${url.search}`;
      const headers = { Accept: req.headers.accept || 'application/json', Authorization: `Basic ${Buffer.from(`${SAP_USERNAME}:${SAP_PASSWORD}`).toString('base64')}` };
      if (req.headers['if-match']) headers['If-Match'] = req.headers['if-match'];
      if (req.method === 'GET') {
        const upstream = await fetch(upstreamUrl, { method: 'GET', headers, redirect: 'follow' });
        const body = Buffer.from(await upstream.arrayBuffer());
        return send(res, upstream.status, body, upstream.headers.get('content-type') || 'application/json; charset=utf-8', { ...cors, ...(upstream.headers.get('etag') ? { ETag: upstream.headers.get('etag') } : {}) });
      }
      const csrf = await getCsrf(odata.entity);
      headers['X-CSRF-Token'] = csrf.token;
      headers['Content-Type'] = req.headers['content-type'] || 'application/json';
      if (csrf.cookies) headers.Cookie = csrf.cookies;
      const body = await readBody(req);
      if (authorization.supplierStatusPatch) {
        let patch;
        try { patch = JSON.parse(body.toString('utf8') || '{}'); } catch { return send(res, 400, JSON.stringify({ error: 'Status update must contain valid JSON.' }), undefined, cors); }
        const currentStatus = String(authorization.parent?.Status || '');
        const targetStatus = String(patch?.Status || '');
        const validFields = Object.keys(patch).length === 1 && Object.keys(patch)[0] === 'Status';
        const allowedTargets = currentStatus === '10' ? ['10', '7'] : currentStatus === '7' && authorization.correctionAllowed ? ['7'] : ['2', '3'];
        const statusCanEdit = ['1', '2', '6', '10'].includes(currentStatus) || (currentStatus === '7' && authorization.correctionAllowed);
        if (!validFields || !statusCanEdit || !allowedTargets.includes(targetStatus)) {
          return send(res, 403, JSON.stringify({ error: 'This invitation can only save or submit supplier changes while the onboarding is open or returned.' }), undefined, cors);
        }
      }
      const upstream = await fetch(upstreamUrl, { method: req.method, headers, body, redirect: 'manual' });
      const responseBody = Buffer.from(await upstream.arrayBuffer());
      const passHeaders = { ...cors };
      for (const name of ['content-type', 'etag', 'location']) { const value = upstream.headers.get(name); if (value) passHeaders[name] = value; }
      return send(res, upstream.status, responseBody, upstream.headers.get('content-type') || 'application/json; charset=utf-8', passHeaders);
    } catch (error) {
      console.error('OData proxy request failed:', error.message);
      return send(res, 502, JSON.stringify({ error: 'Could not complete the SAP OData request. Check SAP connectivity, authentication, and entity configuration.' }), undefined, cors);
    }
  }

  if (url.pathname === '/api/approvals/decision') {
    if (req.method !== 'POST') return send(res, 405, JSON.stringify({ error: 'POST is required.' }));
    return approvalDecision(req, res);
  }

  if (url.pathname === '/api/sap/supplier-create/retry') {
    if (req.method !== 'POST') return send(res, 405, JSON.stringify({ error: 'POST is required.' }));
    return retrySupplierCreation(req, res);
  }

  if (url.pathname === '/api/mail/send-confirmation') {
    if (req.method !== 'POST') return send(res, 405, JSON.stringify({ error: 'POST is required.' }));
    try {
      const payload = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      const email = cleanHeader(payload.toEmail);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return send(res, 400, JSON.stringify({ error: 'A valid supplier email is required.' }));
      if (!payload.accessToken) return send(res, 400, JSON.stringify({ error: 'An access token is required.' }));
      const config = getSmtpConfig();
      if (!config.SMTP_HOST || !config.SMTP_USER || !config.SMTP_PASSWORD) return send(res, 503, JSON.stringify({ error: 'The supplierportal-smtp-credentials binding or SMTP environment variables are missing.' }));
      const nodemailer = require('nodemailer');
      const port = Number(config.SMTP_PORT || 587);
      const transporter = nodemailer.createTransport({ host: config.SMTP_HOST, port, secure: port === 465, requireTLS: port !== 465, tls: { minVersion: 'TLSv1.2' }, auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD } });
      const supplierName = cleanHeader(payload.supplierName) || 'Supplier';
      const senderName = cleanHeader(config.SMTP_SENDER_NAME) || 'Supplier Portal';
      const baseUrl = process.env.PORTAL_BASE_URL || `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000'}`;
      const portalUrl = `${baseUrl.replace(/\/$/, '')}/?token=${encodeURIComponent(payload.accessToken)}`;
      const detail = (label, value) => `<p><b>${label}:</b> ${escapeHtml(value || '-')}</p>`;
      await transporter.sendMail({
        from: `"${senderName}" <${config.SMTP_USER}>`, to: email,
        subject: cleanHeader(`Supplier Onboarding Request Received - ${supplierName}`),
        html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#333"><p>Dear ${escapeHtml(supplierName)},</p><p>Thank you for submitting a supplier onboarding request.</p><p>Please use the link below to continue the supplier onboarding process.</p><p style="margin:25px 0"><a href="${escapeHtml(portalUrl)}" style="background:#123c61;color:#fff;padding:12px 24px;text-decoration:none;border-radius:4px;display:inline-block;font-weight:bold">Open Supplier Onboarding</a></p>${detail('Supplier Name', supplierName)}${detail('Supplier Email', payload.supplierEmail)}${detail('Purchasing Organization', payload.purchasingOrganization)}${detail('Supplier Category', payload.supplierCategory)}<p>Our team will review your request and get back to you shortly.</p><p>Regards,<br>${escapeHtml(senderName)}</p></div>`
      });
      return send(res, 200, JSON.stringify({ status: 'success', message: 'Mail sent successfully.' }));
    } catch (error) {
      console.error('Supplier onboarding confirmation email failed:', error.message);
      return send(res, 502, JSON.stringify({ error: 'Email could not be sent. Check the SMTP service binding and mail server response.' }));
    }
  }

  if (url.pathname === '/api/mail/send-rfq-invitation') {
    if (req.method !== 'POST') return send(res, 405, JSON.stringify({ error: 'POST is required.' }));
    let payload;
    try {
      payload = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    } catch {
      return send(res, 400, JSON.stringify({ error: 'Request must contain valid JSON.' }));
    }
    try {
      const rfqNumber = cleanHeader(payload.rfqNumber).slice(0, 10);
      const supplierNumber = cleanHeader(payload.supplierNumber).slice(0, 10);
      if (!rfqNumber) return send(res, 400, JSON.stringify({ error: 'An RFQ number is required.' }));
      if (!supplierNumber) return send(res, 400, JSON.stringify({ error: 'A bidder supplier number is required.' }));
      if (!SAP_USERNAME || !SAP_PASSWORD) return send(res, 503, JSON.stringify({ error: 'SAP credentials are not configured on the server.' }));
      const config = getSmtpConfig();
      if (!config.SMTP_HOST || !config.SMTP_USER || !config.SMTP_PASSWORD) return send(res, 503, JSON.stringify({ error: 'The supplierportal-smtp-credentials binding or SMTP environment variables are missing.' }));
      const supplier = await resolveRfqSupplier(rfqNumber, supplierNumber);
      const nodemailer = require('nodemailer');
      const port = Number(config.SMTP_PORT || 587);
      const transporter = nodemailer.createTransport({ host: config.SMTP_HOST, port, secure: port === 465, requireTLS: port !== 465, tls: { minVersion: 'TLSv1.2' }, auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD } });
      const supplierName = cleanHeader(supplier.name).slice(0, 80) || 'Supplier';
      const senderName = cleanHeader(config.SMTP_SENDER_NAME) || 'Supplier Portal';
      const baseUrl = process.env.PORTAL_BASE_URL || `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000'}`;
      const portalUrl = `${baseUrl.replace(/\/$/, '')}/?token=${encodeURIComponent(supplier.token)}`;
      const deadline = cleanHeader(payload.quotationDeadline).slice(0, 80) || 'the stated deadline';
      const subject = cleanHeader(`Submit Your Quotation for RFQ - ${rfqNumber}`);
      await transporter.sendMail({
        from: `"${senderName}" <${config.SMTP_USER}>`, to: supplier.email, subject,
        html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#333"><p>Dear ${escapeHtml(supplierName)},</p><p>Please submit your quotation for Request for Quotation <b>${escapeHtml(rfqNumber)}</b>.</p><p>Include unit price and currency, delivery date or lead time, payment terms, quotation validity, and technical specifications or deviations.</p><p>Please submit your response by <b>${escapeHtml(deadline)}</b>.</p><p style="margin:25px 0"><a href="${escapeHtml(portalUrl)}" style="background:#123c61;color:#fff;padding:12px 24px;text-decoration:none;border-radius:4px;display:inline-block;font-weight:bold">Open Supplier Portal</a></p><p>For clarification, contact the Purchase Department.</p><p>Regards,<br>${escapeHtml(senderName)}</p></div>`
      });
      return send(res, 200, JSON.stringify({ status: 'success', message: 'RFQ invitation sent successfully.', email: supplier.email }));
    } catch (error) {
      console.error('RFQ invitation email failed:', error.message);
      return send(res, error.statusCode || 502, JSON.stringify({ error: error.statusCode ? error.message : 'RFQ email could not be sent. Check the SMTP binding, SAP lookup, and mail server response.' }));
    }
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', 'text/plain; charset=utf-8');
  let requestedPath;
  try { requestedPath = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname); } catch { return send(res, 400, 'Bad request', 'text/plain; charset=utf-8'); }
  const filePath = path.resolve(ROOT, `.${requestedPath}`);
  if (!filePath.startsWith(ROOT + path.sep) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
  const contentType = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(filePath).pipe(res);
});

server.on('error', error => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Stop the other process or start with: npm start -- ${PORT + 1}`);
    process.exitCode = 1;
    return;
  }
  console.error('Could not start the Supplier Connect server:', error.message);
  process.exitCode = 1;
});

server.listen(PORT, '0.0.0.0', () => console.log(`Supplier Connect listening on port ${PORT}`));
