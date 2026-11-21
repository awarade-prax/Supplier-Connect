'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');

test('Open PO display schema covers every scalar field of all four service entities', () => {
  const metadata = fs.readFileSync(path.join(__dirname, '..', 'docs', 'odata', 'Z_OPENPO_SUPP_PORTAL.xml'), 'utf8');
  const window = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'modules', 'open-po-schema.js'), 'utf8'), { window });
  let count = 0;
  for (const match of metadata.matchAll(/<EntitySet\b[^>]*Name="([^"]+)"[^>]*EntityType="([^"]+)"/g)) {
    const name = match[1], type = match[2].split('.').pop();
    const entity = metadata.match(new RegExp(`<EntityType Name="${type}"[\\s\\S]*?</EntityType>`))[0];
    const fields = [...entity.matchAll(/<Property\b[^>]*Name="([^"]+)"/g)].map(value => value[1]);
    assert.deepEqual(Array.from(window.OPEN_PO_SCHEMA[name], field => field.name), fields);
    count += fields.length;
  }
  assert.equal(count, 101);
  assert.equal(Object.keys(window.OPEN_PO_SCHEMA).length, 4);
});

test('OData forwarding, email workflows, and quotation draft/submission', { timeout: 15000 }, async t => {
  const uuid = '11111111-1111-1111-1111-111111111111';
  const token = 'a'.repeat(64);
  const parent = { SAP_UUID: uuid, Status: '1', AccessToken: token, SupplierEmail: 'supplier@example.test' };
  const writes = [];
  const quotationItems = [];
  let quotationSaves = 0;
  let quotationPatches = 0;
  let quotationHeader;
  const invitationUuid = '22222222-2222-2222-2222-222222222222';
  let invitationHeader;
  const invitationItems = [];
  const fallbackEmail = 'a.warade@praxisinfosolutions.com';
  let failEmailDetails = false;
  const metadata = fs.readFileSync(path.join(__dirname, '..', 'docs', 'odata', 'YY1_RFQ_PORTAL_CDS.metadata.xml'), 'utf8');
  const importXml = metadata.match(/<FunctionImport Name="YY1_RFQ_PORTALSap_upsert"[\s\S]*?<\/FunctionImport>/)[0];
  const parameterNames = [...importXml.matchAll(/<Parameter Name="([^"]+)"/g)].map(match => match[1]);
  const upstream = http.createServer(async (req, res) => {
    assert.equal(req.headers.authorization, `Basic ${Buffer.from('test-user:test-password').toString('base64')}`);
    res.setHeader('Content-Type', 'application/json');
    if (req.headers['x-csrf-token'] === 'Fetch') {
      assert.equal(new URL(req.url, 'http://localhost').searchParams.get('$top'), '1');
      res.setHeader('X-CSRF-Token', 'test-csrf');
      res.setHeader('Set-Cookie', ['SAP_SESSIONID=test-session; Path=/; HttpOnly', 'sap-usercontext=sap-client=100; Path=/']);
      return res.end(JSON.stringify({ d: { results: [] } }));
    }
    const requestUrl = new URL(req.url, 'http://localhost');
    if (requestUrl.pathname.startsWith('/sap/OpenPO')) {
      const entity = requestUrl.pathname.split('/').pop();
      const payload = { value: [{ PurchaseOrder: '4500000001', PurchaseOrderItem: '00010' }], '@odata.count': 2 };
      if (!requestUrl.searchParams.has('$skip')) payload['@odata.nextLink'] = `${root}/${entity}?$skip=1&$top=1`;
      return res.end(JSON.stringify(payload));
    }
    if (req.method === 'POST' && requestUrl.pathname === '/sap/YY1_RFQ_PORTALSap_upsert') {
      // Reproduce the live Gateway behavior that the previous mock missed.
      res.statusCode = 400;
      return res.end(JSON.stringify({ error: { message: { value: 'Invalid key predicate' } } }));
    }
    if (requestUrl.pathname === '/sap/YY1_RFQ_PORTAL' || /^\/sap\/YY1_RFQ_PORTAL\(guid'[^']+'\)$/.test(requestUrl.pathname)) {
      if (req.method === 'GET') {
        const requestedNumbers = [...(requestUrl.searchParams.get('$filter') || '').matchAll(/RFQNumber eq '((?:[^']|'')+)'/g)]
          .map(match => match[1].replace(/''/g, "'"));
        const found = [invitationHeader, quotationHeader].filter(header => header && requestedNumbers.includes(header.RFQNumber));
        return res.end(JSON.stringify({ d: { results: found } }));
      }
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const payload = JSON.parse(Buffer.concat(chunks));
      if (!('Status' in payload)) {
        assert.equal(req.method, 'POST');
        assert.equal(payload.Supplier, undefined);
        assert.deepEqual(payload, {
          RFQNumber: '7000000001', RFQdueDate: '/Date(1798675200000)/', Currency: 'INR'
        });
        assert.equal(invitationHeader, undefined, 'invitation requests share the same CBO header');
        invitationHeader = { ...payload, SAP_UUID: invitationUuid };
        res.statusCode = 201;
        return res.end(JSON.stringify({ d: invitationHeader }));
      }
      assert.deepEqual(Object.keys(payload).sort(), [...parameterNames].sort());
      if (payload.RFQNumber === invitationHeader?.RFQNumber) {
        assert.equal(req.method, 'PATCH');
        assert.equal(requestUrl.pathname, `/sap/YY1_RFQ_PORTAL(guid'${invitationUuid}')`);
        assert.equal(payload.InvitationID, invitationItems.find(item => item.Supplier === 'no-link').SAP_UUID);
        Object.assign(invitationHeader, payload);
        res.statusCode = 204;
        return res.end();
      }
      assert.equal(payload.InvitationID, uuid);
      assert.equal(payload.Supplier, undefined);
      assert.equal(payload.QuotationValidTill, null);
      assert.equal(payload.PaymentTerms, '');
      assert.equal(payload.RFQdueDate, '/Date(1798675200000)/');
      assert.equal(payload.HeaderRemarks, "Supplier's quotation");
      assert.equal(req.headers['x-csrf-token'], 'test-csrf');
      assert.match(req.headers.cookie, /SAP_SESSIONID=test-session/);
      if (quotationHeader) {
        assert.equal(req.method, 'PATCH');
        assert.equal(requestUrl.pathname, `/sap/YY1_RFQ_PORTAL(guid'${uuid}')`);
        assert.equal(req.headers['if-match'], 'W/"header-etag"');
      } else assert.equal(req.method, 'POST');
      const updating = Boolean(quotationHeader);
      quotationHeader = { ...payload, SAP_UUID: uuid, __metadata: { etag: 'W/"header-etag"' } };
      quotationSaves++;
      res.statusCode = updating ? 204 : 201;
      return res.end(updating ? undefined : JSON.stringify({ d: quotationHeader }));
    }
    if (requestUrl.pathname.endsWith('/to_ItemNode') || requestUrl.pathname.startsWith('/sap/YY1_ITEMNODE_RFQ_PORTAL(')) {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const data = JSON.parse(Buffer.concat(chunks));
      if (req.method === 'POST') {
        assert.equal(requestUrl.pathname, `/sap/YY1_RFQ_PORTAL(guid'${invitationUuid}')/to_ItemNode`);
        assert.equal(data.RFQNumber, '7000000001');
        assert.equal(data.EmailSent, 'No');
        assert.equal('RFQItem' in data, false);
        const item = { ...data, SAP_PARENT_UUID: invitationUuid,
          SAP_UUID: `33333333-3333-3333-3333-33333333333${invitationItems.length}` };
        invitationItems.push(item);
        res.statusCode = 201;
        return res.end(JSON.stringify({ d: item }));
      }

      const item = invitationItems.find(row => requestUrl.pathname.includes(row.SAP_UUID));
      assert.ok(item);
      if ('EmailSent' in data) {
        assert.equal(data.EmailSent, 'Yes');
        assert.match(data.LastEmailSentOnDate, /^\/Date\(\d+\)\/$/);
        assert.match(data.LastEmailSentatTime, /^PT\d{2}H\d{2}M\d{2}S$/);
        if (failEmailDetails) {
          res.statusCode = 500;
          return res.end(JSON.stringify({ error: { message: { value: 'Mock tracking failure' } } }));
        }
      }
      Object.assign(item, data);
      res.statusCode = 204;
      return res.end();
    }
    if (req.method === 'GET') {
      res.setHeader('ETag', 'W/"test-etag"');
      const filter = requestUrl.searchParams.get('$filter') || '';
      if (requestUrl.pathname === '/sap/YY1_ITEMNODE_RFQ_PORTAL') {
        const supplier = filter.match(/Supplier eq '([^']+)'/)?.[1];
        const accessToken = filter.match(/AccessToken eq '([^']+)'/)?.[1];
        const results = invitationItems.filter(item =>
          (!filter.includes('SAP_PARENT_UUID') || filter.includes(item.SAP_PARENT_UUID)) &&
          ((!supplier && !accessToken) || item.Supplier === supplier || item.AccessToken === accessToken) &&
          (!filter.includes('EmailSent eq') || item.EmailSent === 'Yes'));
        return res.end(JSON.stringify({ d: { results } }));
      }
      if (requestUrl.pathname === '/sap/RFQ_Bidder') {
        const supplier = filter.match(/Supplier eq '([^']+)'/)?.[1];
        const rfqNumber = filter.match(/RequestForQuotation eq '([^']+)'/)?.[1];
        const results = ['1001', 'no-link', 'retry'].includes(supplier)
          ? [{ Supplier: supplier, SupplierName: `Bidder ${supplier}`, RequestForQuotation: rfqNumber || '7000000001' }] : [];
        return res.end(JSON.stringify({ d: { results } }));
      }
      if (requestUrl.pathname === '/sap/RFQ_Header') {
        const rfqNumber = filter.match(/RequestForQuotation eq '([^']+)'/)?.[1];
        return res.end(JSON.stringify({ d: { results: [{
          RequestForQuotation: rfqNumber, DocumentCurrency: 'INR', QuotationDeadline: '/Date(1798675200000)/'
        }] } }));
      }
      if (requestUrl.pathname === '/sap/RFQ_Item') return res.end(JSON.stringify({ d: { results: [{ RequestForQuotationItem: '00010', RequestedQuantity: '5.000', DeliveryDate: '/Date(1797724800000)/' }] } }));
      if (req.url.startsWith('/sap/YY1_SAPCREATION_SUPPLIER_ONBOA')) {
        if (/'(?:no-link|retry)'/.test(filter)) return res.end(JSON.stringify({ d: { results: [] } }));
        return res.end(JSON.stringify({ d: { results: [{ BPNumber: '1001', SAP_PARENT_UUID: uuid }] } }));
      }
      if (decodeURIComponent(req.url).includes("Supplier eq 'missing'")) return res.end(JSON.stringify({ d: { results: [] } }));
      return res.end(JSON.stringify({ d: { results: [{ ...parent, DocumentCurrency: 'INR', QuotationDeadline: '/Date(1798675200000)/' }] } }));
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    writes.push({ method: req.method, url: req.url, headers: req.headers, body: JSON.parse(Buffer.concat(chunks)) });
    res.statusCode = req.method === 'POST' ? 201 : 204;
    res.setHeader('ETag', 'W/"updated"');
    res.end(req.method === 'POST' ? JSON.stringify({ d: parent }) : undefined);
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  t.after(() => { upstream.closeAllConnections(); upstream.close(); });

  const root = `http://127.0.0.1:${upstream.address().port}/sap`;
  const child = spawn(process.execPath, ['--require', path.join(__dirname, 'fixtures', 'mail.cjs'), 'server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: '0', SAP_USERNAME: 'test-user', SAP_PASSWORD: 'test-password',
      SMTP_HOST: 'smtp.test.local', SMTP_PORT: '587', SMTP_USER: 'test-user', SMTP_PASSWORD: 'test-password',
      SAP_ODATA_SERVICE_ROOT: root, SAP_RFQ_ODATA_SERVICE_ROOT: root,
      SAP_OPEN_PO_ODATA_SERVICE_ROOT: root,
      SAP_RFQ_PORTAL_ODATA_SERVICE_ROOT: root, SAP_BP_ODATA_SERVICE_ROOT: root },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(() => child.kill());
  // Discover the automatically allocated port without reserving a fixed test port.
  let output = '';
  const ready = new Promise((resolve, reject) => {
    child.stdout.on('data', data => { output += data; const match = output.match(/listening on port (\d+)/); if (match) resolve(Number(match[1])); });
    child.once('error', reject);
    child.once('exit', code => reject(new Error(`Test server exited: ${code}`)));
  });
  const port = await ready;
  const base = `http://127.0.0.1:${port}`;
  for (const endpoint of ['/api/odata/YY1_SUPPLIER_ONBOARDING?$top=50', '/api/rfq/odata/RFQ_Header?$top=50']) {
    const response = await fetch(base + endpoint);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('etag'), 'W/"test-etag"');
    const row = (await response.json()).d.results[0];
    if (endpoint.includes('RFQ_Header')) assert.equal(row.DocumentCurrency, 'INR');
    else assert.equal(row.SAP_UUID, uuid);
  }
  const created = await fetch(`${base}/api/odata/YY1_SUPPLIER_ONBOARDING`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ SupplierName: 'Test only' })
  });
  assert.equal(created.status, 201);
  await created.arrayBuffer();
  const patched = await fetch(`${base}/api/odata/YY1_SUPPLIER_ONBOARDING(guid'${uuid}')`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-Supplier-Access-Token': token, 'If-Match': 'W/"test-etag"' },
    body: JSON.stringify({ Status: '2' })
  });
  assert.equal(patched.status, 204);
  assert.equal(patched.headers.get('etag'), 'W/"updated"');
  assert.deepEqual(writes.map(write => write.method), ['POST', 'PATCH']);
  for (const write of writes) {
    assert.equal(write.headers['x-csrf-token'], 'test-csrf');
    assert.equal(write.headers.cookie, 'SAP_SESSIONID=test-session; sap-usercontext=sap-client=100');
  }
  assert.deepEqual(writes[0].body, { SupplierName: 'Test only' });
  assert.deepEqual(writes[1].body, { Status: '2' });
  assert.equal(writes[1].headers['if-match'], 'W/"test-etag"');

  async function mail(endpoint, body) {
    return fetch(`${base}/api/mail/${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }
  const confirmation = await mail('send-confirmation', { toEmail: parent.SupplierEmail, accessToken: token });
  assert.equal(confirmation.status, 200);
  assert.equal((await confirmation.json()).status, 'success');
  const invitation = await mail('send-rfq-invitation', { rfqNumber: '7000000001', supplierNumber: '1001' });
  assert.equal(invitation.status, 200);
  assert.equal((await invitation.json()).email, parent.SupplierEmail);
  assert.equal(invitationItems.length, 1);
  const onboardedItem = invitationItems[0];
  assert.equal(onboardedItem.SupplierName, 'Bidder 1001');
  assert.equal(onboardedItem.SupplierEmail, parent.SupplierEmail);
  assert.equal(onboardedItem.AccessToken, token);
  assert.equal(onboardedItem.EmailSent, 'Yes');
  const duplicate = await mail('send-rfq-invitation', { rfqNumber: '7000000001', supplierNumber: '1001' });
  assert.equal(duplicate.status, 409);
  assert.match((await duplicate.json()).error, /Confirm before resending/);
  const resend = await mail('send-rfq-invitation', { rfqNumber: '7000000001', supplierNumber: '1001', resend: true });
  assert.equal(resend.status, 200);
  await resend.arrayBuffer();
  assert.equal(invitationItems.length, 1);
  failEmailDetails = true;
  const trackingFailure = await mail('send-rfq-invitation', { rfqNumber: '7000000001', supplierNumber: '1001', resend: true });
  assert.equal(trackingFailure.status, 502);
  const trackingResult = await trackingFailure.json();
  assert.equal(trackingResult.emailSent, true);
  assert.equal(trackingResult.trackingSaved, false);
  failEmailDetails = false;
  const emailStatus = await fetch(`${base}/api/rfq/email-status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rfqNumbers: ['7000000001'] }) });
  assert.equal(emailStatus.status, 200);
  assert.deepEqual((await emailStatus.json()).existingRfqs, ['7000000001']);
  const emailDetailsResponse = await fetch(`${base}/api/rfq/email-details`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rfqNumbers: ['7000000001', '9999999999'] }) });
  assert.equal(emailDetailsResponse.status, 200);
  const emailStatuses = (await emailDetailsResponse.json()).statuses;
  assert.deepEqual(emailStatuses['7000000001'], { emailSend: 'Yes', emailDate: onboardedItem.LastEmailSentOnDate, emailTime: onboardedItem.LastEmailSentatTime });
  assert.deepEqual(emailStatuses['9999999999'], { emailSend: 'No', emailDate: '', emailTime: '' });
  const missing = await mail('send-rfq-invitation', { rfqNumber: '7000000001', supplierNumber: 'missing' });
  assert.equal(missing.status, 409);
  assert.match((await missing.json()).error, /not listed as a bidder/);
  const sendUnlinked = (supplierNumber, resend) => mail('send-rfq-invitation', {
    rfqNumber: '7000000001', supplierNumber, resend
  });
  const [unlinked, retryFailure] = await Promise.all([sendUnlinked('no-link'), sendUnlinked('retry')]);
  assert.equal(unlinked.status, 200);
  assert.equal((await unlinked.json()).email, fallbackEmail);
  const unlinkedItem = invitationItems.find(item => item.Supplier === 'no-link');
  assert.equal(unlinkedItem.SupplierName, 'Bidder no-link');
  assert.equal(unlinkedItem.SupplierEmail, '');
  assert.match(unlinkedItem.AccessToken, /^rfq_[a-f0-9]{64}$/);
  assert.equal(unlinkedItem.EmailSent, 'Yes');
  assert.equal(retryFailure.status, 502);
  const retryItem = invitationItems.find(item => item.Supplier === 'retry');
  assert.equal(retryItem.EmailSent, 'No');
  const retryToken = retryItem.AccessToken;
  assert.notEqual(retryToken, unlinkedItem.AccessToken);
  const retry = await sendUnlinked('retry');
  assert.equal(retry.status, 200);
  assert.equal(retryItem.EmailSent, 'Yes');
  assert.equal(retryItem.AccessToken, retryToken);
  const resendUnlinked = await sendUnlinked('no-link', true);
  assert.equal(resendUnlinked.status, 200);
  assert.equal(invitationItems.length, 3);

  const invitationHeaders = { 'X-Supplier-Access-Token': unlinkedItem.AccessToken };
  const invitedList = await fetch(`${base}/api/rfq/supplier`, { headers: invitationHeaders });
  assert.equal(invitedList.status, 200);
  assert.deepEqual((await invitedList.json()).d.results.map(row => row.RequestForQuotation), ['7000000001']);
  const readInvitedHeader = number => fetch(`${base}/api/rfq/odata/RFQ_Header?$filter=${encodeURIComponent(`RequestForQuotation eq '${number}'`)}`, { headers: invitationHeaders });
  const invitedRfq = await readInvitedHeader('7000000001');
  assert.equal(invitedRfq.status, 200);
  const unrelatedRfq = await readInvitedHeader('7000000002');
  assert.equal(unrelatedRfq.status, 403);
  const unrelatedQuote = await fetch(`${base}/api/rfq/quotation`, {
    method: 'POST', headers: { ...invitationHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ RFQNumber: '7000000002' })
  });
  assert.equal(unrelatedQuote.status, 403);
  const invitedQuote = await fetch(`${base}/api/rfq/quotation`, {
    method: 'POST', headers: { ...invitationHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ RFQNumber: '7000000001' })
  });
  assert.equal(invitedQuote.status, 200);
  assert.equal((await invitedQuote.json()).record.InvitationID, unlinkedItem.SAP_UUID);

  const auth = await mail('send-confirmation', { toEmail: 'auth-error@example.test', accessToken: token });
  assert.equal(auth.status, 502);
  assert.match((await auth.json()).error, /SMTP authentication failed/);
  const rejected = await mail('send-confirmation', { toEmail: 'rejected@example.test', accessToken: token });
  assert.equal(rejected.status, 502);
  assert.match((await rejected.json()).error, /rejected/);

  async function saveQuotation(body) {
    return fetch(`${base}/api/rfq/quotation`, { method: 'POST', headers: {
      'Content-Type': 'application/json', 'X-Supplier-Access-Token': token
    }, body: JSON.stringify(body) });
  }
  const quotation = { RFQNumber: '7000000002', InvitationID: 'untrusted-browser-value', Supplier: 'untrusted',
    HeaderRemarks: "Supplier's quotation", Items: [{ RFQItem: '00010', QuotedQuantity: 5, Price: '25.50', DeliveryDate: '2026-12-20' }] };
  const draft = await saveQuotation({ ...quotation, Status: '02' });
  assert.equal(draft.status, 200, await draft.text());
  const submitted = await saveQuotation({ ...quotation, Status: '03' });
  assert.equal(submitted.status, 200, await submitted.text());
  assert.equal(quotationSaves, 2);
  assert.equal(quotationItems.length, 0, 'the revised CBO stores supplier details only and not quotation lines');
  assert.equal(quotationPatches, 0);
  const invalid = await saveQuotation({ ...quotation, Items: [{ RFQItem: '00010', DeliveryDate: '2026-02-30' }] });
  assert.equal(invalid.status, 400);
  await invalid.arrayBuffer();
  assert.equal(quotationSaves, 2, 'invalid dates must fail before writing the header');

  for (const entity of ['OpenPOHeader', 'OpenPOItem', 'OpenPOItemHistorySum', 'OpenPOItemScheduleSum']) {
    const report = await fetch(`${base}/api/open-po/${entity}?$top=1`);
    assert.equal(report.status, 200);
    const page = await report.json();
    assert.equal(page.value[0].PurchaseOrder, '4500000001');
    assert.equal(page['@odata.nextLink'], `/api/open-po/${entity}?$skip=1&$top=1`);
    const continued = await fetch(base + page['@odata.nextLink']);
    assert.equal(continued.status, 200);
    await continued.arrayBuffer();
  }
  for (const [suffix, options, expected] of [
    ['OpenPOHeader', { headers: { 'X-Supplier-Access-Token': token } }, 403],
    ['OpenPOHeader', { headers: { Referer: `${base}/?token=${token}` } }, 403],
    ['OpenPOHeader?token=', {}, 403],
    ['OpenPOHeader', { method: 'POST' }, 405],
    ['OpenPOHeader?$top=101', {}, 400],
    ['OpenPOHeader?$expand=*', {}, 400],
    ['UnapprovedEntity', {}, 404]
  ]) {
    const denied = await fetch(`${base}/api/open-po/${suffix}`, options);
    assert.equal(denied.status, expected);
    await denied.arrayBuffer();
  }
});
