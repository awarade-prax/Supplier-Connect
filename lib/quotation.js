'use strict';

function invalid(message) { throw Object.assign(new Error(message), { statusCode: 400 }); }

function text(value, field, maxLength) {
  const result = String(value ?? '');
  if (result.length > maxLength) invalid(`${field} must contain at most ${maxLength} characters.`);
  return result;
}

function date(value, field) {
  if (value === '' || value === undefined || value === null) return null;
  const raw = String(value);
  const match = raw.match(/^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/);
  const parsed = new Date(match ? Number(match[1]) : raw);
  if (Number.isNaN(parsed.getTime())) invalid(`${field} must contain a valid date.`);
  const day = parsed.toISOString().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw) && raw !== day) invalid(`${field} must contain a valid calendar date.`);
  return day;
}

function decimal(value, field, precision, scale) {
  if (value === '' || value === undefined || value === null) return undefined;
  const result = String(value);
  if (!/^\d+(?:\.\d+)?$/.test(result)) invalid(`${field} must be a non-negative decimal number.`);
  const [whole, fraction = ''] = result.split('.');
  if (whole.replace(/^0+/, '').length > precision - scale || fraction.length > scale) invalid(`${field} exceeds SAP's ${precision}-digit precision or ${scale} decimal places.`);
  return result;
}

function prepareQuotation(body, { supplierNumber, supplierName, supplierEmail, accessToken, parent, rfqHeader }) {
  // Use entity JSON writes: SAP's generated function import rejects null dates
  // in URL parameters even though the entity properties are nullable.
  // InvitationID is the verified onboarding UUID, never the browser's access token.
  const header = {
    RFQNumber: text(body.RFQNumber, 'RFQNumber', 10).trim(),
    InvitationID: text(parent.SAP_UUID, 'InvitationID', 36),
    Status: body.Status === '03' ? '03' : '02',
    PaymentTerms: text(body.PaymentTerms, 'PaymentTerms', 10),
    SupplyLocation: text(body.SupplyLocation, 'SupplyLocation', 100),
    QuotationValidTill: date(body.QuotationValidTill, 'QuotationValidTill'),
    RFQdueDate: date(rfqHeader.QuotationDeadline, 'RFQdueDate'),
    Currency: text(rfqHeader.DocumentCurrency || body.Currency, 'Currency', 5),
    FreightIncoterms: text(body.FreightIncoterms, 'FreightIncoterms', 10),
    HeaderRemarks: text(body.HeaderRemarks, 'HeaderRemarks', 500),
    SAP_Description: text(body.SAP_Description, 'SAP_Description', 80)
  };
  for (const field of ['QuotationValidTill', 'RFQdueDate']) {
    header[field] = header[field] === null ? null : `/Date(${Date.parse(`${header[field]}T00:00:00Z`)})/`;
  }
  if (body.Items !== undefined && !Array.isArray(body.Items)) invalid('Quotation items must be an array.');
  if (body.Items?.length > 500) invalid('A quotation can contain at most 500 items.');
  const seen = new Set();
  for (const item of body.Items || []) {
    if (!item || typeof item !== 'object') invalid('Each quotation item must be an object.');
    const itemNumber = text(item.RFQItem, 'RFQItem', 5).trim();
    if (!itemNumber || seen.has(itemNumber)) invalid('Each quotation item needs a unique RFQ item number.');
    seen.add(itemNumber);
    for (const field of ['MaterialDescription', 'SpecialConditions']) text(item[field], field, 500);
    for (const field of ['QuotedQuantity', 'RequestedQuantity', 'Price']) {
      decimal(item[field], field, field === 'Price' ? 15 : 13, field === 'Price' ? 2 : 3);
    }
    date(item.DeliveryDate, 'DeliveryDate');
  }
  return { header, items: [], status: header.Status };
}

module.exports = { prepareQuotation };
