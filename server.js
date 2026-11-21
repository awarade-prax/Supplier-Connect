'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { getSmtpConfig, sendMail, mailError } = require('./lib/mail');
const { prepareQuotation } = require('./lib/quotation');

const cliPort = process.argv[2] && /^\d+$/.test(process.argv[2]) ? Number(process.argv[2]) : undefined;
const PORT = Number(process.env.PORT || cliPort || 3000);
const ROOT = __dirname;
const SERVICE_ROOT = (process.env.SAP_ODATA_SERVICE_ROOT || 'https://my426023-api.s4hana.cloud.sap/sap/opu/odata/sap/YY1_SUPPLIER_ONBOARDING_CDS').replace(/\/$/, '');
const BP_SERVICE_ROOT = (process.env.SAP_BP_ODATA_SERVICE_ROOT || `${new URL(SERVICE_ROOT).origin}/sap/opu/odata/sap/API_BUSINESS_PARTNER`).replace(/\/$/, '');
const RFQ_SERVICE_ROOT = (process.env.SAP_RFQ_ODATA_SERVICE_ROOT || `${new URL(SERVICE_ROOT).origin}/sap/opu/odata/sap/Z_RFQ_SUPP_PORTAL_SB`).replace(/\/$/, '');
const RFQ_PORTAL_SERVICE_ROOT = (process.env.SAP_RFQ_PORTAL_ODATA_SERVICE_ROOT || `${new URL(SERVICE_ROOT).origin}/sap/opu/odata/sap/YY1_RFQ_PORTAL_CDS`).replace(/\/$/, '');
const OPEN_PO_SERVICE_ROOT = (process.env.SAP_OPEN_PO_ODATA_SERVICE_ROOT || `${new URL(SERVICE_ROOT).origin}/sap/opu/odata4/sap/z_openpo_supp_portal_sb/srvd_a2x/sap/z_openpo_supp_portal_sd/0001`).replace(/\/$/, '');
const OPEN_PO_ENTITY_SETS = new Set(['OpenPOHeader', 'OpenPOItem', 'OpenPOItemHistorySum', 'OpenPOItemScheduleSum']);
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
  const response = await fetch(`${serviceRoot}/${encodeURIComponent(entity)}?$top=1`, { headers: { Authorization: `Basic ${Buffer.from(`${SAP_USERNAME}:${SAP_PASSWORD}`).toString('base64')}`, 'X-CSRF-Token': 'Fetch', Accept: 'application/json' } });
  const token = response.headers.get('x-csrf-token');
  await sapJson(response, 'SAP CSRF token request');
  if (!token) throw new Error('SAP did not provide a CSRF token. Check write access for this service.');
  const cookies = (response.headers.getSetCookie ? response.headers.getSetCookie() : [response.headers.get('set-cookie')].filter(Boolean)).map(value => value.split(';')[0]).join('; ');
  return { token, cookies };
}

function sapConnectionError(error) {
  const code = error.cause?.code || error.code;
  if (code === 'ENOTFOUND') return 'SAP hostname could not be resolved. Check the SAP service URLs in .env; replace your-sap-host with the actual SAP tenant hostname.';
  if (['CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY'].includes(code)) return 'SAP TLS certificate verification failed. Configure the trusted corporate CA with NODE_EXTRA_CA_CERTS if your office network inspects HTTPS.';
  if (['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'ECONNREFUSED', 'ECONNRESET'].includes(code)) return 'Could not connect to SAP. Check office network, VPN, firewall, and proxy access to the SAP tenant.';
  return error.message === 'fetch failed' ? 'Could not connect to SAP. Run npm run check:sap for connection diagnostics.' : error.message;
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

async function resolveRfqSupplierByAccessToken(accessToken) {
  const parent = await getSupplierByAccessToken(accessToken);
  if (!parent?.SAP_UUID) throw Object.assign(new Error('The supplier invitation token is invalid.'), { statusCode: 401 });
  const filter = `SAP_PARENT_UUID eq guid'${String(parent.SAP_UUID).toLowerCase()}'`;
  const records = await readSapCollection(SERVICE_ROOT, 'YY1_SAPCREATION_SUPPLIER_ONBOA', `?$filter=${encodeURIComponent(filter)}&$select=SupplierNumber,BPNumber&$top=10`);
  const supplierNumber = String(records.find(record => record.SupplierNumber)?.SupplierNumber || records.find(record => record.BPNumber)?.BPNumber || '').trim();
  if (!supplierNumber) throw Object.assign(new Error('This supplier invitation is not linked to an SAP supplier number yet.'), { statusCode: 409 });
  return { parent, supplierNumber };
}

function rfqEmailDateTime(date) {
  const pad = value => String(value).padStart(2, '0');
  const dateMilliseconds = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return {
    EmailDate: `/Date(${dateMilliseconds})/`,
    EmailTime: `PT${pad(date.getHours())}H${pad(date.getMinutes())}M${pad(date.getSeconds())}S`
  };
}

function rfqDateIso(value) {
  if (!value) return '';
  const match = typeof value === 'string' && value.match(/^\/Date\((-?\d+)/);
  const date = match ? new Date(Number(match[1])) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('SAP returned an invalid RFQ quotation deadline.');
  return date.toISOString().slice(0, 10);
}

function rfqDateEdmValue(value) {
  const [year, month, day] = value.split('-').map(Number);
  return `/Date(${Date.UTC(year, month - 1, day)})/`;
}

async function findRfqPortalParents(rfqNumber, supplierNumber) {
  const quote = value => String(value).replace(/'/g, "''");
  const filters = [`RFQNumber eq '${quote(rfqNumber)}'`];
  if (supplierNumber) filters.push(`Supplier eq '${quote(supplierNumber)}'`);
  return readSapCollection(
    RFQ_PORTAL_SERVICE_ROOT,
    'YY1_RFQ_PORTAL',
    `?$filter=${encodeURIComponent(filters.join(' and '))}&$select=SAP_UUID,RFQNumber,Supplier&$top=100`
  );
}

async function findExistingRfqNumbers(rfqNumbers) {
  const existing = [];
  for (const rfqNumber of rfqNumbers) {
    const parents = await findRfqPortalParents(rfqNumber);
    if (parents.length) existing.push(rfqNumber);
  }
  return existing;
}

function rfqEmailSentAt(details) {
  const dateMatch = typeof details.EmailDate === 'string' && details.EmailDate.match(/^\/Date\((-?\d+)/);
  const date = dateMatch ? Number(dateMatch[1]) : Date.parse(details.EmailDate);
  const timeMatch = String(details.EmailTime || '').match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  const timeSeconds = timeMatch
    ? Number(timeMatch[1] || 0) * 3600 + Number(timeMatch[2] || 0) * 60 + Number(timeMatch[3] || 0)
    : 0;
  return Number.isNaN(date) ? 0 : date + timeSeconds * 1000;
}

async function findRfqEmailDetails(rfqNumbers) {
  const statuses = Object.fromEntries(rfqNumbers.map(rfqNumber => [
    rfqNumber,
    { emailSend: 'No', emailDate: '', emailTime: '' }
  ]));
  const quote = value => String(value).replace(/'/g, "''");
  const rfqFilter = rfqNumbers.map(rfqNumber => `RFQNumber eq '${quote(rfqNumber)}'`).join(' or ');
  const parents = await readSapCollection(
    RFQ_PORTAL_SERVICE_ROOT,
    'YY1_RFQ_PORTAL',
    `?$filter=${encodeURIComponent(rfqFilter)}&$select=SAP_UUID,RFQNumber&$top=5000`
  );
  const parentGroups = new Map();
  for (const parent of parents) {
    const rfqNumber = String(parent.RFQNumber || '').trim();
    const parentUuid = String(parent.SAP_UUID || '');
    if (!statuses[rfqNumber] || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parentUuid)) continue;
    if (!parentGroups.has(rfqNumber)) parentGroups.set(rfqNumber, []);
    parentGroups.get(rfqNumber).push(parentUuid);
  }

  const parentUuids = [...parentGroups.values()].flat();
  const emailDetails = [];
  for (let offset = 0; offset < parentUuids.length; offset += 50) {
    const parentFilter = parentUuids.slice(offset, offset + 50)
      .map(parentUuid => `SAP_PARENT_UUID eq guid'${parentUuid}'`)
      .join(' or ');
    emailDetails.push(...await readSapCollection(
      RFQ_PORTAL_SERVICE_ROOT,
      'YY1_EMAILDETAILS_RFQ_PORTAL',
      `?$filter=${encodeURIComponent(parentFilter)}&$select=SAP_PARENT_UUID,EmailSend,EmailDate,EmailTime&$top=1000`
    ));
  }

  const uuidToRfq = new Map();
  for (const [rfqNumber, uuids] of parentGroups) {
    for (const uuid of uuids) uuidToRfq.set(uuid.toLowerCase(), rfqNumber);
  }
  const latestSentAt = new Map();
  for (const details of emailDetails) {
    if (String(details.EmailSend || '').trim().toLowerCase() !== 'yes') continue;
    const rfqNumber = uuidToRfq.get(String(details.SAP_PARENT_UUID || '').toLowerCase());
    if (!rfqNumber) continue;
    const sentAt = rfqEmailSentAt(details);
    if (latestSentAt.has(rfqNumber) && latestSentAt.get(rfqNumber) > sentAt) continue;
    latestSentAt.set(rfqNumber, sentAt);
    statuses[rfqNumber] = {
      emailSend: 'Yes',
      emailDate: details.EmailDate || '',
      emailTime: details.EmailTime || ''
    };
  }
  return statuses;
}

async function saveRfqInvitationItems(parentUuid, sourceItems, csrf) {
  const parentFilter = `SAP_PARENT_UUID eq guid'${parentUuid.toLowerCase()}'`;
  const existingItems = await readSapCollection(
    RFQ_PORTAL_SERVICE_ROOT,
    'YY1_ITEMNODE_RFQ_PORTAL',
    `?$filter=${encodeURIComponent(parentFilter)}&$select=SAP_UUID,RFQItem&$top=1000`
  );
  const existingByItem = new Map();
  for (const item of existingItems) {
    const key = String(item.RFQItem || '').trim();
    if (!key) continue;
    if (!existingByItem.has(key)) existingByItem.set(key, []);
    existingByItem.get(key).push(item);
  }
  const headers = { ...sapAuthHeaders(), 'X-CSRF-Token': csrf.token, ...(csrf.cookies ? { Cookie: csrf.cookies } : {}), 'Content-Type': 'application/json' };
  for (const source of sourceItems) {
    const rfqItem = String(source.RequestForQuotationItem || '').trim();
    if (!rfqItem) throw new Error('An SAP RFQ item is missing its item number.');
    const data = {
      RFQItem: rfqItem,
      MaterialDescription: String(source.ShortText || source.Material || '').slice(0, 500)
    };
    if (source.RequestedQuantity !== undefined && source.RequestedQuantity !== null && source.RequestedQuantity !== '')
      data.RequestedQuantity = source.RequestedQuantity;
    const deliveryDate = rfqDateIso(source.DeliveryDate);
    if (deliveryDate) data.DeliveryDate = rfqDateEdmValue(deliveryDate);

    const existing = existingByItem.get(rfqItem)?.shift();
    if (existing && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(existing.SAP_UUID || '')))
      throw new Error(`SAP returned an invalid CBO UUID for RFQ item ${rfqItem}.`);
    const target = existing
      ? `${RFQ_PORTAL_SERVICE_ROOT}/YY1_ITEMNODE_RFQ_PORTAL(guid'${existing.SAP_UUID}')`
      : `${RFQ_PORTAL_SERVICE_ROOT}/YY1_RFQ_PORTAL(guid'${parentUuid}')/to_ItemNode`;
    const response = await fetch(target, {
      method: existing ? 'PATCH' : 'POST',
      headers: existing ? { ...headers, 'If-Match': '*' } : headers,
      body: JSON.stringify(data)
    });
    await sapJson(response, existing ? 'Update RFQ CBO item' : 'Create RFQ CBO item');
  }
}

async function prepareRfqInvitationCboData(rfqNumber, supplierNumber, resend) {
  const parents = await findRfqPortalParents(rfqNumber, supplierNumber);
  if (parents.length > 1) throw new Error('SAP returned multiple RFQ CBO records for the same supplier and RFQ.');
  if (parents.length) {
    const parentUuid = String(parents[0].SAP_UUID || '');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parentUuid))
      throw new Error('SAP returned an invalid RFQ CBO record UUID.');
    if (!resend) throw Object.assign(new Error('RFQ details already exist in the CBO. Confirm before resending the invitation.'), { statusCode: 409 });
    return parentUuid;
  }

  const quote = value => String(value).replace(/'/g, "''");
  const filter = `RequestForQuotation eq '${quote(rfqNumber)}'`;
  const [rfqHeaders, sourceItems] = await Promise.all([
    readSapCollection(RFQ_SERVICE_ROOT, 'RFQ_Header', `?$filter=${encodeURIComponent(filter)}&$select=RequestForQuotation,QuotationDeadline,DocumentCurrency&$top=1`),
    readSapCollection(RFQ_SERVICE_ROOT, 'RFQ_Item', `?$filter=${encodeURIComponent(filter)}&$select=RequestForQuotationItem,ShortText,Material,RequestedQuantity,DeliveryDate&$top=500`)
  ]);
  if (!rfqHeaders.length) throw new Error('The RFQ header could not be found in SAP.');
  if (sourceItems.length >= 500) throw new Error('This RFQ has 500 or more items; the CBO item sync limit was reached.');
  const dueDate = rfqDateIso(rfqHeaders[0].QuotationDeadline);
  const csrf = await getCsrf('YY1_RFQ_PORTAL', RFQ_PORTAL_SERVICE_ROOT);
  const parentData = { RFQNumber: rfqNumber, Supplier: supplierNumber };
  if (dueDate) parentData.RFQdueDate = rfqDateEdmValue(dueDate);
  const currency = String(rfqHeaders[0].DocumentCurrency || '').trim().slice(0, 5);
  if (currency) parentData.Currency = currency;
  const response = await fetch(`${RFQ_PORTAL_SERVICE_ROOT}/YY1_RFQ_PORTAL`, {
    method: 'POST',
    headers: { ...sapAuthHeaders(), 'X-CSRF-Token': csrf.token, ...(csrf.cookies ? { Cookie: csrf.cookies } : {}), 'Content-Type': 'application/json' },
    body: JSON.stringify(parentData)
  });
  const parent = await sapJson(response, 'Create RFQ CBO header');
  const locationUuid = response.headers.get('location')?.match(/guid'([0-9a-f-]{36})'/i)?.[1];
  const parentUuid = String(parent?.SAP_UUID || locationUuid || '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parentUuid))
    throw new Error('SAP did not return a valid RFQ CBO record UUID after creating the header.');

  await saveRfqInvitationItems(parentUuid, sourceItems, csrf);
  return parentUuid;
}

async function saveRfqInvitationEmailDetails(parentUuid) {
  const csrf = await getCsrf('YY1_RFQ_PORTAL', RFQ_PORTAL_SERVICE_ROOT);
  const details = await readSapCollection(
    RFQ_PORTAL_SERVICE_ROOT,
    'YY1_EMAILDETAILS_RFQ_PORTAL',
    `?$filter=${encodeURIComponent(`SAP_PARENT_UUID eq guid'${parentUuid.toLowerCase()}'`)}&$select=SAP_UUID&$top=1`
  );
  const timestamp = rfqEmailDateTime(new Date());
  const requestHeaders = {
    ...sapAuthHeaders(),
    'X-CSRF-Token': csrf.token,
    ...(csrf.cookies ? { Cookie: csrf.cookies } : {}),
    'Content-Type': 'application/json'
  };
  let response;
  let operation;
  if (details.length) {
    const detailUuid = String(details[0].SAP_UUID || '');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(detailUuid))
      throw new Error('SAP returned an invalid email-details node UUID.');
    response = await fetch(`${RFQ_PORTAL_SERVICE_ROOT}/YY1_EMAILDETAILS_RFQ_PORTAL(guid'${detailUuid}')`, {
      method: 'PATCH',
      headers: { ...requestHeaders, 'If-Match': '*' },
      body: JSON.stringify(timestamp)
    });
    operation = 'Update RFQ invitation email details';
  } else {
    response = await fetch(`${RFQ_PORTAL_SERVICE_ROOT}/YY1_RFQ_PORTAL(guid'${parentUuid}')/to_EmailDetails`, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify({ EmailSend: 'Yes', ...timestamp })
    });
    operation = 'Create RFQ invitation email details';
  }
  await sapJson(response, operation);
}

async function saveSupplierQuotation(req, res, cors) {
  const token = String(req.headers['x-supplier-access-token'] || '');
  if (!token) return send(res, 401, JSON.stringify({ error: 'A supplier invitation token is required.' }), undefined, cors);
  if (!SAP_USERNAME || !SAP_PASSWORD) return send(res, 503, JSON.stringify({ error: 'SAP credentials are missing.' }), undefined, cors);
  let body;
  try {
    body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
  } catch { return send(res, 400, JSON.stringify({ error: 'Quotation must contain a valid JSON object.' }), undefined, cors); }
  try {
    const { supplierNumber, parent } = await resolveRfqSupplierByAccessToken(token);
    const rfqNumber = String(body.RFQNumber || '').trim();
    if (!rfqNumber || rfqNumber.length > 10) return send(res, 400, JSON.stringify({ error: 'Select a valid RFQ number.' }), undefined, cors);
    const bidderFilter = `RequestForQuotation eq '${rfqNumber.replace(/'/g, "''")}' and Supplier eq '${supplierNumber.replace(/'/g, "''")}'`;
    if (!(await readSapCollection(RFQ_SERVICE_ROOT, 'RFQ_Bidder', `?$filter=${encodeURIComponent(bidderFilter)}&$top=1`)).length)
      return send(res, 403, JSON.stringify({ error: 'This RFQ is not assigned to your supplier account.' }), undefined, cors);
    const rfqHeaders = await readSapCollection(RFQ_SERVICE_ROOT, 'RFQ_Header', `?$filter=${encodeURIComponent(`RequestForQuotation eq '${rfqNumber.replace(/'/g, "''")}'`)}&$top=1`);
    if (!rfqHeaders.length) return send(res, 404, JSON.stringify({ error: 'The selected RFQ no longer exists in SAP.' }), undefined, cors);
    const { header, items, status } = prepareQuotation({ ...body, RFQNumber: rfqNumber }, { supplierNumber, parent, rfqHeader: rfqHeaders[0] });
    const quotationFilter = `RFQNumber eq '${rfqNumber.replace(/'/g, "''")}' and Supplier eq '${supplierNumber.replace(/'/g, "''")}'`;
    const matches = await readSapCollection(RFQ_PORTAL_SERVICE_ROOT, 'YY1_RFQ_PORTAL', `?$filter=${encodeURIComponent(quotationFilter)}&$top=2`);
    if (matches.length > 1) throw new Error('SAP returned multiple quotations for this supplier and RFQ. Resolve the duplicate records before saving.');
    const previousHeader = matches[0];
    if (previousHeader && !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(previousHeader.SAP_UUID || '')) throw new Error('SAP returned a quotation without a valid UUID.');
    const csrf = await getCsrf('YY1_RFQ_PORTAL', RFQ_PORTAL_SERVICE_ROOT);
    const headerPath = previousHeader ? `YY1_RFQ_PORTAL(guid'${previousHeader.SAP_UUID}')` : 'YY1_RFQ_PORTAL';
    const upstream = await fetch(`${RFQ_PORTAL_SERVICE_ROOT}/${headerPath}`, {
      method: previousHeader ? 'PATCH' : 'POST',
      headers: { ...sapAuthHeaders(), 'X-CSRF-Token': csrf.token, ...(csrf.cookies ? { Cookie: csrf.cookies } : {}), 'Content-Type': 'application/json', ...(previousHeader ? { 'If-Match': previousHeader.__metadata?.etag || '*' } : {}) },
      body: JSON.stringify(header), redirect: 'manual'
    });
    const writtenHeader = await sapJson(upstream, 'Save quotation header');
    const saved = previousHeader ? { ...previousHeader, ...header, ...writtenHeader } : writtenHeader;
    const uuid = String(saved?.SAP_UUID || '');
    if (items.length && !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(uuid)) throw new Error('SAP saved the quotation header but did not return a valid UUID, so quotation items were not saved.');
    if (items.length) {
      const itemPath = `${RFQ_PORTAL_SERVICE_ROOT}/YY1_RFQ_PORTAL(guid'${uuid}')/to_ItemNode`;
      const existingResponse = await fetch(`${itemPath}?$top=500`, { headers: sapAuthHeaders() });
      const existingData = await sapJson(existingResponse, 'Load saved quotation items');
      const existing = Array.isArray(existingData?.results) ? existingData.results : [];
      for (const item of items) {
        const previous = existing.find(row => String(row.RFQItem) === item.RFQItem);
        const target = previous ? `${RFQ_PORTAL_SERVICE_ROOT}/YY1_ITEMNODE_RFQ_PORTAL(guid'${previous.SAP_UUID}')` : itemPath;
        const response = await fetch(target, { method: previous ? 'PATCH' : 'POST', headers: { ...sapAuthHeaders(), 'X-CSRF-Token': csrf.token, ...(csrf.cookies ? { Cookie: csrf.cookies } : {}), 'Content-Type': 'application/json', ...(previous ? { 'If-Match': previous.__metadata?.etag || '*' } : {}) }, body: JSON.stringify(item) });
        await sapJson(response, 'Save quotation item');
      }
    }
    return send(res, 200, JSON.stringify({ success: true, status, record: saved }), undefined, cors);
  } catch (error) {
    console.error('Supplier quotation save failed:', error.message);
    return send(res, error.statusCode || 502, JSON.stringify({ error: error.statusCode ? error.message : error.message || 'Quotation could not be saved.' }), undefined, cors);
  }
}

async function readSupplierRfqPage(supplierNumber, query) {
  const quoteValue = value => String(value || '').replace(/'/g, "''");
  const url = new URL(`${RFQ_SERVICE_ROOT}/RFQ_Bidder`);
  const params = new URLSearchParams(query || '');
  const suppliedFilter = params.get('$filter');
  const bidderFilter = `Supplier eq '${quoteValue(supplierNumber)}'`;
  params.set('$filter', suppliedFilter ? `(${bidderFilter}) and (${suppliedFilter})` : bidderFilter);
  params.set('$select', 'RequestForQuotation,Supplier,SupplierName,PartnerFunction,PartnerCounter');
  params.set('$orderby', 'RequestForQuotation desc');
  params.set('$inlinecount', 'allpages');
  const top = Math.min(Math.max(Number(params.get('$top')) || 50, 1), 100);
  const skip = Math.min(Math.max(Number(params.get('$skip')) || 0, 0), 1000000);
  params.set('$top', String(top));
  params.set('$skip', String(skip));
  url.search = params.toString();
  const response = await fetch(url, { headers: sapAuthHeaders(), redirect: 'follow' });
  const page = await sapJson(response, 'SAP supplier RFQ lookup');
  const bidders = Array.isArray(page?.results) ? page.results : [];
  const requestNumbers = [...new Set(bidders.map(row => String(row.RequestForQuotation || '').trim()).filter(Boolean))];
  const headers = [];
  for (let index = 0; index < requestNumbers.length; index += 20) {
    const batch = requestNumbers.slice(index, index + 20);
    const filter = batch.map(number => `RequestForQuotation eq '${quoteValue(number)}'`).join(' or ');
    headers.push(...await readSapCollection(RFQ_SERVICE_ROOT, 'RFQ_Header', `?$filter=${encodeURIComponent(filter)}&$top=20`));
  }
  const byNumber = new Map(headers.map(row => [String(row.RequestForQuotation), row]));
  const results = requestNumbers.map(number => byNumber.get(number)).filter(Boolean);
  const count = Number(page?.__count || skip + bidders.length);
  return { d: { results, __count: String(count) } };
}

async function resolveRfqSupplier(rfqNumber, supplierNumber) {
  const quote = value => String(value || '').replace(/'/g, "''");
  const bidderFilter = `RequestForQuotation eq '${quote(rfqNumber)}' and Supplier eq '${quote(supplierNumber)}'`;
  const bidders = await readSapCollection(RFQ_SERVICE_ROOT, 'RFQ_Bidder', `?$filter=${encodeURIComponent(bidderFilter)}&$top=1`);
  if (!bidders.length) throw Object.assign(new Error('This supplier is not listed as a bidder for the selected RFQ.'), { statusCode: 409 });
  const creationFilter = `SupplierNumber eq '${quote(supplierNumber)}' or BPNumber eq '${quote(supplierNumber)}'`;
  const creations = await readSapCollection(SERVICE_ROOT, 'YY1_SAPCREATION_SUPPLIER_ONBOA', `?$filter=${encodeURIComponent(creationFilter)}&$top=50`);
  const creation = creations.find(record => record.SAP_PARENT_UUID && String(record.SupplierNumber || '').trim() === supplierNumber)
    || creations.find(record => record.SAP_PARENT_UUID && !String(record.SupplierNumber || '').trim() && String(record.BPNumber || '').trim() === supplierNumber);
  if (!creation?.SAP_PARENT_UUID) throw Object.assign(new Error(`Supplier ${supplierNumber} has no linked portal onboarding record. Complete Supplier Registration and link its SAP supplier number before sending an RFQ invitation.`), { statusCode: 409 });
  const onboardingFilter = `SAP_UUID eq guid'${String(creation.SAP_PARENT_UUID).toLowerCase()}'`;
  const onboardings = await readSapCollection(SERVICE_ROOT, 'YY1_SUPPLIER_ONBOARDING', `?$filter=${encodeURIComponent(onboardingFilter)}&$top=1`);
  const onboarding = onboardings.find(record => String(record.SAP_UUID || '').toLowerCase() === String(creation.SAP_PARENT_UUID).toLowerCase());
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(onboarding?.SupplierEmail || '').trim()) || !/^[a-f0-9]{64}$/i.test(onboarding?.AccessToken || '')) throw Object.assign(new Error(`Supplier ${supplierNumber} needs a valid email address and portal access token in Supplier Registration before an RFQ invitation can be sent.`), { statusCode: 409 });
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
  if (url.pathname.startsWith('/api/open-po/')) {
    const cors = corsHeaders(req);
    let supplierContext = Boolean(req.headers['x-supplier-access-token']) || url.searchParams.has('token');
    try { supplierContext ||= new URL(req.headers.referer).searchParams.has('token'); } catch { /* No referring page. */ }
    if (supplierContext) return send(res, 403, JSON.stringify({ error: 'Open PO Report is available only in company view.' }), undefined, cors);
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    if (req.method !== 'GET') return send(res, 405, JSON.stringify({ error: 'Open PO Report is read-only.' }), undefined, cors);
    const entity = url.pathname.slice('/api/open-po/'.length);
    if (!OPEN_PO_ENTITY_SETS.has(entity)) return send(res, 404, JSON.stringify({ error: 'Unknown Open PO entity.' }), undefined, cors);
    if (!SAP_USERNAME || !SAP_PASSWORD) return send(res, 503, JSON.stringify({ error: 'SAP credentials are missing.' }), undefined, cors);
    const allowedOptions = new Set(['$filter', '$orderby', '$top', '$skip', '$count', '$skiptoken']);
    if ([...url.searchParams.keys()].some(key => !allowedOptions.has(key))) return send(res, 400, JSON.stringify({ error: 'Unsupported Open PO query option.' }), undefined, cors);
    const top = Number(url.searchParams.get('$top') || 50);
    if (!Number.isInteger(top) || top < 1 || top > 100) return send(res, 400, JSON.stringify({ error: 'Open PO page size must be between 1 and 100.' }), undefined, cors);
    url.searchParams.set('$top', String(top));
    try {
      const upstream = await fetch(`${OPEN_PO_SERVICE_ROOT}/${entity}?${url.searchParams}`, { headers: sapAuthHeaders(), signal: AbortSignal.timeout(30000) });
      const payload = await upstream.json();
      if (payload['@odata.nextLink']) {
        const next = new URL(payload['@odata.nextLink'], `${OPEN_PO_SERVICE_ROOT}/${entity}`);
        if (next.origin !== new URL(OPEN_PO_SERVICE_ROOT).origin || next.pathname !== new URL(`${OPEN_PO_SERVICE_ROOT}/${entity}`).pathname) throw new Error('SAP returned an unexpected Open PO continuation link.');
        payload['@odata.nextLink'] = `/api/open-po/${entity}${next.search}`;
      }
      return send(res, upstream.status, JSON.stringify(payload), undefined, cors);
    } catch (error) {
      console.error('Open PO request failed:', error.message);
      return send(res, 502, JSON.stringify({ error: sapConnectionError(error) }), undefined, cors);
    }
  }
  if (url.pathname === '/api/rfq/quotation') {
    const cors = corsHeaders(req);
    if (req.method === 'OPTIONS') { res.writeHead(204, { ...cors, 'Access-Control-Max-Age': '600' }); return res.end(); }
    if (req.method !== 'POST') return send(res, 405, JSON.stringify({ error: 'POST is required.' }), undefined, cors);
    return saveSupplierQuotation(req, res, cors);
  }
  if (url.pathname === '/api/rfq/supplier') {
    const cors = corsHeaders(req);
    if (req.method === 'OPTIONS') { res.writeHead(204, { ...cors, 'Access-Control-Max-Age': '600' }); return res.end(); }
    if (req.method !== 'GET') return send(res, 405, JSON.stringify({ error: 'Supplier RFQ access is read-only.' }), undefined, cors);
    if (!SAP_USERNAME || !SAP_PASSWORD) return send(res, 503, JSON.stringify({ error: 'SAP credentials are missing. For local use, copy .env.example to .env, set SAP_USERNAME and SAP_PASSWORD to valid SAP credentials, then restart the server. For deployment, set both server environment variables and restart the app.' }), undefined, cors);
    const token = String(req.headers['x-supplier-access-token'] || '');
    if (!token) return send(res, 401, JSON.stringify({ error: 'A supplier invitation token is required.' }), undefined, cors);
    try {
      const { supplierNumber } = await resolveRfqSupplierByAccessToken(token);
      const page = await readSupplierRfqPage(supplierNumber, url.search);
      return send(res, 200, JSON.stringify(page), undefined, cors);
    } catch (error) {
      return send(res, error.statusCode || 502, JSON.stringify({ error: error.statusCode ? error.message : 'Supplier RFQ records could not be loaded from SAP.' }), undefined, cors);
    }
  }

  if (url.pathname.startsWith('/api/rfq/odata/')) {
    const cors = corsHeaders(req);
    if (req.method === 'OPTIONS') { res.writeHead(204, { ...cors, 'Access-Control-Max-Age': '600' }); return res.end(); }
    if (req.method !== 'GET') return send(res, 405, JSON.stringify({ error: 'The RFQ service is read-only; GET is the only supported method.' }), undefined, cors);
    if (!SAP_USERNAME || !SAP_PASSWORD) return send(res, 503, JSON.stringify({ error: 'SAP credentials are missing. For local use, copy .env.example to .env, set SAP_USERNAME and SAP_PASSWORD to valid SAP credentials, then restart the server. For deployment, set both server environment variables and restart the app.' }), undefined, cors);
    let entity;
    try { entity = decodeURIComponent(url.pathname.slice('/api/rfq/odata/'.length)); }
    catch { return send(res, 400, JSON.stringify({ error: 'Invalid RFQ entity path encoding.' }), undefined, cors); }
    if (!RFQ_ENTITY_SETS.has(entity)) return send(res, 404, JSON.stringify({ error: 'Unknown RFQ entity set.' }), undefined, cors);
    try {
      let upstreamUrl = `${RFQ_SERVICE_ROOT}/${entity}${url.search}`;
      const supplierToken = String(req.headers['x-supplier-access-token'] || '');
      if (supplierToken) {
        const { supplierNumber } = await resolveRfqSupplierByAccessToken(supplierToken);
        const suppliedFilter = url.searchParams.get('$filter') || '';
        if (entity === 'RFQ_Bidder') {
          const params = new URLSearchParams(url.searchParams);
          const supplierFilter = `Supplier eq '${String(supplierNumber).replace(/'/g, "''")}'`;
          params.set('$filter', suppliedFilter ? `(${supplierFilter}) and (${suppliedFilter})` : supplierFilter);
          upstreamUrl = `${RFQ_SERVICE_ROOT}/${entity}?${params}`;
        } else {
          const requestMatch = suppliedFilter.match(/RequestForQuotation\s+eq\s+'((?:[^']|'')+)'/i);
          if (!requestMatch) return send(res, 400, JSON.stringify({ error: 'Supplier RFQ details require a specific RFQ number.' }), undefined, cors);
          const requestedNumber = requestMatch[1].replace(/''/g, "'");
          const bidderFilter = `RequestForQuotation eq '${String(requestedNumber).replace(/'/g, "''")}' and Supplier eq '${String(supplierNumber).replace(/'/g, "''")}'`;
          const assigned = await readSapCollection(RFQ_SERVICE_ROOT, 'RFQ_Bidder', `?$filter=${encodeURIComponent(bidderFilter)}&$top=1`);
          if (!assigned.length) return send(res, 403, JSON.stringify({ error: 'This RFQ is not assigned to this supplier.' }), undefined, cors);
          const params = new URLSearchParams(url.searchParams);
          const boundFilter = `RequestForQuotation eq '${String(requestedNumber).replace(/'/g, "''")}'`;
          params.set('$filter', suppliedFilter ? `(${boundFilter}) and (${suppliedFilter})` : boundFilter);
          upstreamUrl = `${RFQ_SERVICE_ROOT}/${entity}?${params}`;
        }
      }
      const upstream = await fetch(upstreamUrl, {
        headers: { Accept: req.headers.accept || 'application/json', Authorization: `Basic ${Buffer.from(`${SAP_USERNAME}:${SAP_PASSWORD}`).toString('base64')}` },
        redirect: 'follow'
      });
      const body = Buffer.from(await upstream.arrayBuffer());
      return send(res, upstream.status, body, upstream.headers.get('content-type') || 'application/json; charset=utf-8', { ...cors, ...(upstream.headers.get('etag') ? { ETag: upstream.headers.get('etag') } : {}) });
    } catch (error) {
      console.error('RFQ OData proxy request failed:', sapConnectionError(error));
      return send(res, 502, JSON.stringify({ error: sapConnectionError(error) }), undefined, cors);
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
      console.error('OData proxy request failed:', sapConnectionError(error));
      return send(res, 502, JSON.stringify({ error: sapConnectionError(error) }), undefined, cors);
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
    let payload;
    try { payload = JSON.parse((await readBody(req)).toString('utf8') || '{}'); }
    catch { return send(res, 400, JSON.stringify({ error: 'Request must contain valid JSON.' })); }
    try {
      const email = cleanHeader(payload.toEmail);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return send(res, 400, JSON.stringify({ error: 'A valid supplier email is required.' }));
      if (!payload.accessToken) return send(res, 400, JSON.stringify({ error: 'An access token is required.' }));
      const config = getSmtpConfig();
      if (!config.SMTP_HOST || !config.SMTP_USER || !config.SMTP_PASSWORD) return send(res, 503, JSON.stringify({ error: 'The supplierportal-smtp-credentials binding or SMTP environment variables are missing.' }));
      const supplierName = cleanHeader(payload.supplierName) || 'Supplier';
      const senderName = cleanHeader(config.SMTP_SENDER_NAME) || 'Supplier Portal';
      const baseUrl = process.env.PORTAL_BASE_URL || `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000'}`;
      const portalUrl = `${baseUrl.replace(/\/$/, '')}/?token=${encodeURIComponent(payload.accessToken)}#/registration/complete-registration`;
      const detail = (label, value) => `<p><b>${label}:</b> ${escapeHtml(value || '-')}</p>`;
      await sendMail(config, {
        from: `"${senderName}" <${config.SMTP_USER}>`, to: email,
        subject: cleanHeader(`Supplier Onboarding Request Received - ${supplierName}`),
        html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#333"><p>Dear ${escapeHtml(supplierName)},</p><p>Thank you for submitting a supplier onboarding request.</p><p>Please use the link below to continue the supplier onboarding process.</p><p style="margin:25px 0"><a href="${escapeHtml(portalUrl)}" style="background:#123c61;color:#fff;padding:12px 24px;text-decoration:none;border-radius:4px;display:inline-block;font-weight:bold">Open Supplier Onboarding</a></p>${detail('Supplier Name', supplierName)}${detail('Supplier Email', payload.supplierEmail)}${detail('Purchasing Organization', payload.purchasingOrganization)}${detail('Supplier Category', payload.supplierCategory)}<p>Our team will review your request and get back to you shortly.</p><p>Regards,<br>${escapeHtml(senderName)}</p></div>`
      });
      return send(res, 200, JSON.stringify({ status: 'success', message: 'Mail sent successfully.' }));
    } catch (error) {
      console.error('Supplier onboarding confirmation email failed:', error.message);
      return send(res, error.statusCode || 502, JSON.stringify({ error: mailError(error) }));
    }
  }

  if (url.pathname === '/api/rfq/email-status') {
    if (req.method !== 'POST') return send(res, 405, JSON.stringify({ error: 'POST is required.' }));
    let payload;
    try {
      payload = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    } catch {
      return send(res, 400, JSON.stringify({ error: 'Request must contain valid JSON.' }));
    }
    if (!Array.isArray(payload.rfqNumbers)) return send(res, 400, JSON.stringify({ error: 'RFQ numbers must be provided as an array.' }));
    const rfqNumbers = [...new Set(payload.rfqNumbers.map(value => cleanHeader(value)))];
    if (!rfqNumbers.length || rfqNumbers.length > 50 || rfqNumbers.some(value => !value || value.length > 10))
      return send(res, 400, JSON.stringify({ error: 'Provide between 1 and 50 valid RFQ numbers.' }));
    if (!SAP_USERNAME || !SAP_PASSWORD) return send(res, 503, JSON.stringify({ error: 'SAP credentials are not configured on the server.' }));
    try {
      const existingRfqs = await findExistingRfqNumbers(rfqNumbers);
      return send(res, 200, JSON.stringify({ existingRfqs }));
    } catch (error) {
      console.error('RFQ invitation status lookup failed:', error.message);
      return send(res, 502, JSON.stringify({ error: 'Existing RFQ CBO records could not be checked.' }));
    }
  }

  if (url.pathname === '/api/rfq/email-details') {
    if (req.method !== 'POST') return send(res, 405, JSON.stringify({ error: 'POST is required.' }));
    let payload;
    try {
      payload = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    } catch {
      return send(res, 400, JSON.stringify({ error: 'Request must contain valid JSON.' }));
    }
    if (!Array.isArray(payload.rfqNumbers)) return send(res, 400, JSON.stringify({ error: 'RFQ numbers must be provided as an array.' }));
    const rfqNumbers = [...new Set(payload.rfqNumbers.map(value => cleanHeader(value)))];
    if (!rfqNumbers.length || rfqNumbers.length > 50 || rfqNumbers.some(value => !value || value.length > 10))
      return send(res, 400, JSON.stringify({ error: 'Provide between 1 and 50 valid RFQ numbers.' }));
    if (!SAP_USERNAME || !SAP_PASSWORD) return send(res, 503, JSON.stringify({ error: 'SAP credentials are not configured on the server.' }));
    try {
      const statuses = await findRfqEmailDetails(rfqNumbers);
      return send(res, 200, JSON.stringify({ statuses }));
    } catch (error) {
      console.error('RFQ CBO email details lookup failed:', error.message);
      return send(res, 502, JSON.stringify({ error: 'RFQ CBO email details could not be loaded.' }));
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
      let supplier;
      try { supplier = await resolveRfqSupplier(rfqNumber, supplierNumber); }
      catch (error) {
        if (!error.statusCode) {
          error.message = `SAP supplier lookup failed: ${sapConnectionError(error)}`;
          error.statusCode = 502;
        }
        throw error;
      }
      let parentUuid;
      try {
        parentUuid = await prepareRfqInvitationCboData(rfqNumber, supplierNumber, payload.resend === true);
      } catch (cboError) {
        if (cboError.statusCode) throw cboError;
        throw Object.assign(new Error(`RFQ details could not be saved to the CBO before sending: ${cboError.message}`), { statusCode: 502 });
      }
      const supplierName = cleanHeader(supplier.name).slice(0, 80) || 'Supplier';
      const senderName = cleanHeader(config.SMTP_SENDER_NAME) || 'Supplier Portal';
      const baseUrl = process.env.PORTAL_BASE_URL || `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000'}`;
      const portalUrl = `${baseUrl.replace(/\/$/, '')}/?token=${encodeURIComponent(supplier.token)}#/rfq/rfq-inbox/${encodeURIComponent(rfqNumber)}`;
      const deadline = cleanHeader(payload.quotationDeadline).slice(0, 80) || 'the stated deadline';
      const subject = cleanHeader(`Submit Your Quotation for RFQ - ${rfqNumber}`);
      await sendMail(config, {
        from: `"${senderName}" <${config.SMTP_USER}>`, to: supplier.email, subject,
        html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#333"><p>Dear ${escapeHtml(supplierName)},</p><p>Please submit your quotation for Request for Quotation <b>${escapeHtml(rfqNumber)}</b>.</p><p>Include unit price and currency, delivery date or lead time, payment terms, quotation validity, and technical specifications or deviations.</p><p>Please submit your response by <b>${escapeHtml(deadline)}</b>.</p><p style="margin:25px 0"><a href="${escapeHtml(portalUrl)}" style="background:#123c61;color:#fff;padding:12px 24px;text-decoration:none;border-radius:4px;display:inline-block;font-weight:bold">Open Supplier Portal</a></p><p>For clarification, contact the Purchase Department.</p><p>Regards,<br>${escapeHtml(senderName)}</p></div>`
      });
      try {
        await saveRfqInvitationEmailDetails(parentUuid);
      } catch (trackingError) {
        const error = new Error(`Invitation email was sent to ${supplier.email}, but RFQ CBO email details could not be saved: ${trackingError.message}`);
        error.emailSent = true;
        error.email = supplier.email;
        throw error;
      }
      return send(res, 200, JSON.stringify({ status: 'success', message: 'RFQ invitation sent successfully.', email: supplier.email }));
    } catch (error) {
      console.error('RFQ invitation processing failed:', error.message);
      const response = { error: error.emailSent ? error.message : mailError(error) };
      if (error.emailSent) Object.assign(response, { emailSent: true, trackingSaved: false, email: error.email });
      return send(res, error.statusCode || 502, JSON.stringify(response));
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

server.listen(PORT, '0.0.0.0', () => console.log(`Supplier Connect listening on port ${server.address().port}`));
