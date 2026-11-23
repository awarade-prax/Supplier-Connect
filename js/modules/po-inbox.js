(() => {
  const esc = Portal.escapeHtml;
  const pageSize = 50;
  const state = { page: 0, po: '', supplier: '' };
  const literal = value => `'${String(value).replace(/'/g, "''")}'`;
  const format = value => value === null || value === undefined || value === '' ? '—' : String(value);
  const supplierKey = value => {
    const normalized = String(value ?? '').trim().toUpperCase();
    return /^\d+$/.test(normalized) ? normalized.replace(/^0+(?=\d)/, '') : normalized;
  };
  const invitationToken = () => new URLSearchParams(location.search).get('token') || '';

  async function request(path) {
    const token = invitationToken();
    if (path.startsWith('/api/open-po/')) {
      const requestUrl = new URL(path, location.origin);
      requestUrl.searchParams.set('poInbox', 'true');
      path = requestUrl.pathname + requestUrl.search;
    }
    const response = await fetch(path, { headers: { Accept: 'application/json', 'X-PO-Inbox-Access': 'true', ...(token ? { 'X-Supplier-Access-Token': token } : {}) } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message?.value || data.error?.message || data.error || `SAP returned HTTP ${response.status}.`);
    return data;
  }

  async function readAllHeaders(params) {
    const rows = [];
    let path = `/api/open-po/OpenPOHeader?${params}`;
    const visited = new Set();
    while (path) {
      if (visited.has(path)) throw new Error('SAP repeated an open PO page. Please retry.');
      visited.add(path);
      const data = await request(path);
      rows.push(...(data.value || []));
      path = data['@odata.nextLink'] || '';
    }
    return rows;
  }

  async function render(content, back, recordId = '') {
    if (!invitationToken()) {
      Portal.$('#page-title').textContent = 'PO Inbox';
      Portal.$('#page-subtitle').textContent = 'Open purchase orders with sent RFQ invitations';
      content.innerHTML = '<section class="card po-section"><p class="po-empty" role="status">Open an RFQ invitation link to view the purchase orders for that supplier.</p></section>';
      return;
    }
    if (recordId) return renderDetails(content, back, recordId);
    Portal.setRoute('po', 'PO Inbox');
    Portal.$('#page-title').textContent = 'PO Inbox';
    Portal.$('#page-subtitle').textContent = 'Open purchase orders with sent RFQ invitations';
    Portal.$('#view-label').textContent = 'SUPPLIER VIEW';
    content.innerHTML = `<section class="po-report po-list"><div class="po-toolbar"><button class="button-secondary" data-po-back>‹ Return to POs</button><button class="button-secondary" data-po-refresh>Refresh</button></div><form class="card po-filters"><label>Purchase order<input class="form-control" name="po" maxlength="10" value="${esc(state.po)}" placeholder="PO number"></label><label>Supplier<input class="form-control" name="supplier" maxlength="10" value="${esc(state.supplier)}" placeholder="Supplier number"></label><button class="button-primary" type="submit">Apply filters</button><button class="button-secondary" type="button" data-po-clear>Clear</button></form><p class="po-message" role="status" aria-live="polite">Loading PO Inbox…</p><section class="card po-results" aria-label="PO Inbox"></section><div class="po-pagination"><button class="button-secondary" data-po-prev>Previous</button><span data-po-page></span><button class="button-secondary" data-po-next>Next</button></div></section>`;
    const root = content.firstElementChild;
    root.querySelector('[data-po-back]').onclick = back;
    const load = async () => {
      const message = root.querySelector('.po-message');
      root.querySelectorAll('.po-pagination button').forEach(button => button.disabled = true);
      message.textContent = 'Checking open POs and RFQ CBO email records…';
      try {
        // The Open PO service rejects page sizes greater than 100.
        const params = new URLSearchParams({ $top: '100', $orderby: 'PurchaseOrderDate desc,PurchaseOrder desc' });
        const filters = [];
        if (state.po) filters.push(`contains(PurchaseOrder,${literal(state.po)})`);
        if (state.supplier) filters.push(`Supplier eq ${literal(state.supplier)}`);
        if (filters.length) params.set('$filter', filters.join(' and '));
        const [poRows, emailData] = await Promise.all([readAllHeaders(params), request('/api/rfq/po-inbox')]);
        const emailRecords = emailData.records || [];
        const suppliers = new Set(emailRecords.map(row => supplierKey(row.Supplier)).filter(Boolean));
        const matchedRows = poRows.filter(row => suppliers.has(supplierKey(row.Supplier)));
        const count = matchedRows.length;
        const rows = matchedRows.slice(state.page * pageSize, (state.page + 1) * pageSize);
        const columns = [['PurchaseOrder', 'Purchase order'], ['Supplier', 'Supplier'], ['CompanyCode', 'Company'], ['PurchaseOrderDate', 'PO date'], ['NumberOfOpenItems', 'Open items'], ['NextScheduleLineDate', 'Next delivery'], ['NetOrderValue', 'Order value'], ['DocumentCurrency', 'Currency']];
        message.textContent = `${count} PO${count === 1 ? '' : 's'} matched an RFQ invitation with EmailSent = Yes.`;
        root.querySelector('.po-results').innerHTML = rows.length ? `<div class="po-table-scroll" tabindex="0" role="region" aria-label="PO Inbox results"><table class="table po-table"><thead><tr>${columns.map(([, label]) => `<th>${esc(label)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${columns.map(([name]) => `<td>${name === 'PurchaseOrder' ? `<button class="po-link" data-po-number="${esc(row.PurchaseOrder)}">${esc(row.PurchaseOrder)}</button>` : esc(format(row[name]))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '<p class="po-empty">No open purchase orders have a sent RFQ invitation for their supplier.</p>';
        root.querySelectorAll('[data-po-number]').forEach(button => button.onclick = () => {
          const selected = rows.find(item => String(item.PurchaseOrder) === button.dataset.poNumber);
          renderDetails(content, back, button.dataset.poNumber, emailRecords.filter(row => supplierKey(row.Supplier) === supplierKey(selected?.Supplier)));
        });
        root.querySelector('[data-po-page]').textContent = `Page ${state.page + 1}`;
        root.querySelector('[data-po-prev]').disabled = state.page === 0;
        root.querySelector('[data-po-next]').disabled = (state.page + 1) * pageSize >= count;
      } catch (error) { message.textContent = `Could not load PO Inbox: ${error.message}`; root.querySelector('.po-results').innerHTML = '<p class="po-empty">Use Refresh to retry.</p>'; }
    };
    root.querySelector('form').onsubmit = event => { event.preventDefault(); state.page = 0; state.po = event.target.elements.po.value.trim(); state.supplier = event.target.elements.supplier.value.trim(); load(); };
    root.querySelector('[data-po-clear]').onclick = () => { state.page = 0; state.po = ''; state.supplier = ''; render(content, back); };
    root.querySelector('[data-po-refresh]').onclick = load;
    root.querySelector('[data-po-prev]').onclick = () => { state.page--; load(); };
    root.querySelector('[data-po-next]').onclick = () => { state.page++; load(); };
    await load();
  }

  function renderDetails(content, back, po, inboxRecords) {
    window.OpenPoReport.renderDetails(content, () => render(content, back), po, { inboxRecords, listLabel: 'PO Inbox', routeTitle: 'PO Inbox', list: () => render(content, back) });
  }

  window.PoInbox = { render };
})();
