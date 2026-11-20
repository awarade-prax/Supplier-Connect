'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const path = require('node:path');
const fs = require('node:fs');

test('OData forwarding, email workflows, and quotation draft/submission', { timeout: 15000 }, async t => {
  const uuid = '11111111-1111-1111-1111-111111111111';
  const token = 'a'.repeat(64);
  const parent = { SAP_UUID: uuid, Status: '1', AccessToken: token, SupplierEmail: 'supplier@example.test' };
  const writes = [];
  const quotationItems = [];
  let quotationSaves = 0;
  let quotationPatches = 0;
  let quotationHeader;
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
    if (req.method === 'POST' && requestUrl.pathname === '/sap/YY1_RFQ_PORTALSap_upsert') {
      // Reproduce the live Gateway behavior that the previous mock missed.
      res.statusCode = 400;
      return res.end(JSON.stringify({ error: { message: { value: 'Invalid key predicate' } } }));
    }
    if (requestUrl.pathname === '/sap/YY1_RFQ_PORTAL' || /^\/sap\/YY1_RFQ_PORTAL\(guid'[^']+'\)$/.test(requestUrl.pathname)) {
      if (req.method === 'GET') return res.end(JSON.stringify({ d: { results: quotationHeader ? [quotationHeader] : [] } }));
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const payload = JSON.parse(Buffer.concat(chunks));
      assert.deepEqual(Object.keys(payload).sort(), [...parameterNames].sort());
      assert.equal(payload.InvitationID, uuid);
      assert.equal(payload.Supplier, '1001');
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
      if (req.method === 'GET') return res.end(JSON.stringify({ d: { results: quotationItems } }));
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const item = JSON.parse(Buffer.concat(chunks));
      assert.equal(item.DeliveryDate, `/Date(${Date.parse('2026-12-20T00:00:00Z')})/`);
      assert.equal(typeof item.Price, 'string');
      assert.equal(req.headers['x-csrf-token'], 'test-csrf');
      if (req.method === 'POST') {
        quotationItems.push({ ...item, SAP_UUID: uuid, __metadata: { etag: 'W/"item-etag"' } });
        res.statusCode = 201;
        return res.end(JSON.stringify({ d: quotationItems[0] }));
      }
      assert.equal(req.method, 'PATCH');
      assert.equal(req.headers['if-match'], 'W/"item-etag"');
      quotationPatches++;
      res.statusCode = 204;
      return res.end();
    }
    if (req.method === 'GET') {
      res.setHeader('ETag', 'W/"test-etag"');
      if (req.url.startsWith('/sap/YY1_SAPCREATION_SUPPLIER_ONBOA')) {
        if (decodeURIComponent(req.url).includes("'no-link'")) return res.end(JSON.stringify({ d: { results: [] } }));
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
    assert.equal((await response.json()).d.results[0].SAP_UUID, uuid);
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
  const missing = await mail('send-rfq-invitation', { rfqNumber: '7000000001', supplierNumber: 'missing' });
  assert.equal(missing.status, 409);
  assert.match((await missing.json()).error, /not listed as a bidder/);
  const unlinked = await mail('send-rfq-invitation', { rfqNumber: '7000000001', supplierNumber: 'no-link' });
  assert.equal(unlinked.status, 409);
  assert.match((await unlinked.json()).error, /Complete Supplier Registration/);
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
  const quotation = { RFQNumber: '7000000001', InvitationID: 'untrusted-browser-value', Supplier: 'untrusted',
    HeaderRemarks: "Supplier's quotation", Items: [{ RFQItem: '00010', QuotedQuantity: 5, Price: '25.50', DeliveryDate: '2026-12-20' }] };
  const draft = await saveQuotation({ ...quotation, Status: '02' });
  assert.equal(draft.status, 200, await draft.text());
  const submitted = await saveQuotation({ ...quotation, Status: '03' });
  assert.equal(submitted.status, 200, await submitted.text());
  assert.equal(quotationSaves, 2);
  assert.equal(quotationItems.length, 1, 'resaving must not append duplicate items');
  assert.equal(quotationPatches, 1);
  const invalid = await saveQuotation({ ...quotation, Items: [{ RFQItem: '00010', DeliveryDate: '2026-02-30' }] });
  assert.equal(invalid.status, 400);
  await invalid.arrayBuffer();
  assert.equal(quotationSaves, 2, 'invalid dates must fail before writing the header');
});
