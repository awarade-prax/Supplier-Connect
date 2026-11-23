(() => {
  const schema = window.OPEN_PO_SCHEMA;
  const esc = Portal.escapeHtml;
  const state = { page: 0, po: '', supplier: '', company: '', overdue: false };
  const pageSize = 50;
  const literal = value => `'${String(value).replace(/'/g, "''")}'`;
  const field = (entity, name) => schema[entity].find(entry => entry.name === name);

  function format(value, definition) {
    if (value === null || value === undefined || value === '') return '—';
    if (definition?.type === 'Edm.Boolean') return value ? 'Yes' : 'No';
    if (definition?.type === 'Edm.Decimal' && Number.isFinite(Number(value))) return new Intl.NumberFormat('en-IN', { minimumFractionDigits: /Value$|Amount$/.test(definition.name) ? 2 : 0, maximumFractionDigits: 6 }).format(Number(value));
    if (definition?.type === 'Edm.Date' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(`${value}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
    if (definition?.name === 'DeliveryIsOverdue') return value === 'X' ? 'Yes' : 'No';
    if (['DeliveryStatus', 'InvoiceStatus'].includes(definition?.name)) return `${value} · ${{ 1: 'None', 2: 'Partial', 3: 'Complete' }[value] || 'Unknown'}`;
    return String(value);
  }

  async function request(path, signal) {
    if (!path.startsWith('/api/open-po/')) throw new Error('Invalid report continuation URL.');
    const token = new URLSearchParams(location.search).get('token');
    const inboxAccess = location.hash.toLowerCase().includes('/po/po-inbox');
    if (inboxAccess) {
      const requestUrl = new URL(path, location.origin);
      requestUrl.searchParams.set('poInbox', 'true');
      path = requestUrl.pathname + requestUrl.search;
    }
    const response = await fetch(path, { headers: { Accept: 'application/json', ...(inboxAccess ? { 'X-PO-Inbox-Access': 'true' } : {}), ...(token ? { 'X-Supplier-Access-Token': token } : {}) }, signal });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message?.value || data.error?.message || data.error || `SAP returned HTTP ${response.status}.`);
    return data;
  }

  async function allRows(entity, po, signal) {
    const params = new URLSearchParams({ $filter: `PurchaseOrder eq ${literal(po)}`, $top: '100', $count: 'true', $orderby: 'PurchaseOrderItem' });
    let path = `/api/open-po/${entity}?${params}`;
    const result = [], visited = new Set();
    let total;
    while (path) {
      if (visited.has(path)) throw new Error('SAP repeated a report page. Please retry.');
      visited.add(path);
      const data = await request(path, signal);
      if (data['@odata.count'] !== undefined) total = Number(data['@odata.count']);
      result.push(...(data.value || []));
      path = data['@odata.nextLink'] || '';
      if (!path && (Number.isFinite(total) ? result.length < total : data.value?.length === 100)) {
        params.set('$skip', String(result.length));
        path = `/api/open-po/${entity}?${params}`;
      }
    }
    return result;
  }

  function values(entity, row, fields = schema[entity]) {
    return `<dl class="po-field-grid">${fields.map(definition => `<div data-po-field="${esc(entity)}.${esc(definition.name)}"><dt>${esc(definition.label)}</dt><dd>${esc(format(row[definition.name], definition))}</dd></div>`).join('')}</dl>`;
  }

  function summaryDetails(entity, rows) {
    if (!rows.length) return '<p class="po-empty">No records returned for this PO.</p>';
    return rows.map(row => `<section class="po-summary-record"><h3>Item ${esc(row.PurchaseOrderItem)}</h3>${values(entity, row)}</section>`).join('');
  }

  function itemDetails(row) {
    const groups = [
      ['Identity and purchasing', ['PurchaseOrder', 'PurchaseOrderItem', 'PurchaseOrderType', 'CompanyCode', 'PurchasingOrganization', 'PurchasingGroup', 'Supplier', 'PurchaseOrderDate', 'CreationDate', 'CreatedByUser', 'PaymentTerms', 'IncotermsClassification', 'PurchasingProcessingStatus']],
      ['Material and account assignment', ['PurchaseOrderItemText', 'PurchasingDocumentDeletionCode', 'Material', 'MaterialGroup', 'SupplierMaterialNumber', 'ManufacturerMaterial', 'ProductType', 'Plant', 'StorageLocation', 'AccountAssignmentCategory', 'MultipleAcctAssgmtDistribution', 'PartialInvoiceDistribution', 'TaxCode', 'PurchaseContract', 'PurchaseContractItem', 'PurchaseRequisition', 'PurchaseRequisitionItem', 'RequisitionerName', 'RequirementTracking', 'Subcontractor']],
      ['Delivery and invoice controls', ['IsFinallyInvoiced', 'IsCompletelyDelivered', 'GoodsReceiptIsExpected', 'GoodsReceiptIsNonValuated', 'InvoiceIsExpected', 'InvoiceIsGoodsReceiptBased', 'IsReturnsItem', 'OverdelivTolrtdLmtRatioInPct', 'UnderdelivTolrtdLmtRatioInPct', 'UnlimitedOverdeliveryIsAllowed', 'DeliveryIsOverdue', 'DeliveryStatus', 'InvoiceStatus']],
      ['Quantities and schedules', ['PurchaseOrderQuantityUnit', 'OrderPriceUnit', 'OrderQuantity', 'DeliveredQuantity', 'QuantityToBeDelivered', 'InvoicedQuantity', 'QuantityToBeInvoiced', 'NumberOfScheduleLines', 'NextScheduleLineDate', 'LastScheduleLineDate', 'ScheduledQuantity']],
      ['Prices and values', ['DocumentCurrency', 'NetPriceAmount', 'NetPriceQuantity', 'NetOrderValue', 'GrossAmount', 'DeliveredValue', 'ValueToBeDelivered', 'InvoicedValue', 'ValueToBeInvoiced']]
    ];
    const used = new Set(groups.flatMap(([, names]) => names));
    const extra = schema.OpenPOItem.filter(definition => !used.has(definition.name)).map(definition => definition.name);
    if (extra.length) groups.push(['Additional details', extra]);
    return `<details class="po-item"><summary><span><strong>Item ${esc(row.PurchaseOrderItem)}</strong><span>${esc(row.PurchaseOrderItemText || row.Material || 'Purchase order item')}</span></span><span>Open quantity <strong>${esc(format(row.QuantityToBeDelivered, field('OpenPOItem', 'QuantityToBeDelivered')))} ${esc(row.PurchaseOrderQuantityUnit || '')}</strong></span><span>Delivery <strong>${esc(format(row.NextScheduleLineDate, field('OpenPOItem', 'NextScheduleLineDate')))}</strong></span><span class="po-expand">View all fields</span></summary><div class="po-item-body">${groups.map(([title, names]) => `<section><h3>${esc(title)}</h3>${values('OpenPOItem', row, names.map(name => field('OpenPOItem', name)).filter(Boolean))}</section>`).join('')}</div></details>`;
  }

  async function render(content, back, recordId = '') {
    if (new URLSearchParams(location.search).has('token')) {
      content.innerHTML = '<p role="alert">Open PO Report is available only in company view.</p>';
      return;
    }
    if (recordId) return renderDetails(content, back, recordId);
    Portal.setRoute('po', 'Open PO Report');
    Portal.$('#page-title').textContent = 'Open PO Report';
    Portal.$('#page-subtitle').textContent = 'Outstanding deliveries and invoices across purchase orders';
    Portal.$('#view-label').textContent = 'COMPANY VIEW';
    content.innerHTML = `<section class="po-report po-list"><div class="po-toolbar"><button class="button-secondary" data-po-back>‹ Return to POs</button><button class="button-secondary" data-po-refresh>Refresh</button></div><form class="card po-filters"><label>Purchase order<input class="form-control" name="po" maxlength="10" value="${esc(state.po)}" placeholder="PO number"></label><label>Supplier<input class="form-control" name="supplier" maxlength="10" value="${esc(state.supplier)}" placeholder="Supplier number"></label><label>Company code<input class="form-control" name="company" maxlength="4" value="${esc(state.company)}" placeholder="Company code"></label><label class="po-check"><input type="checkbox" name="overdue" ${state.overdue ? 'checked' : ''}> Overdue items only</label><button class="button-primary" type="submit">Apply filters</button><button class="button-secondary" type="button" data-po-clear>Clear</button></form><p class="po-message" role="status" aria-live="polite">Loading open purchase orders…</p><section class="card po-results" aria-label="Open purchase orders"></section><div class="po-pagination"><button class="button-secondary" data-po-prev>Previous</button><span data-po-page></span><button class="button-secondary" data-po-next>Next</button></div></section>`;
    const root = content.firstElementChild;
    const form = root.querySelector('form');
    let controller;
    root.querySelector('[data-po-back]').onclick = back;
    async function load() {
      controller?.abort(); controller = new AbortController();
      const params = new URLSearchParams({ $top: String(pageSize), $skip: String(state.page * pageSize), $count: 'true', $orderby: 'PurchaseOrderDate desc,PurchaseOrder desc' });
      const filters = [];
      if (state.po) filters.push(`contains(PurchaseOrder,${literal(state.po)})`);
      if (state.supplier) filters.push(`Supplier eq ${literal(state.supplier)}`);
      if (state.company) filters.push(`CompanyCode eq ${literal(state.company)}`);
      if (state.overdue) filters.push('NumberOfOverdueItems gt 0');
      if (filters.length) params.set('$filter', filters.join(' and '));
      const message = root.querySelector('.po-message');
      message.textContent = 'Loading open purchase orders…';
      root.querySelectorAll('.po-pagination button').forEach(button => button.disabled = true);
      try {
        const data = await request(`/api/open-po/OpenPOHeader?${params}`, controller.signal);
        if (!root.isConnected) return;
        const rows = data.value || [], count = data['@odata.count'];
        const headings = {PurchaseOrder:'Purchase order',Supplier:'Supplier',CompanyCode:'Company',PurchaseOrderDate:'PO date',NumberOfOpenItems:'Open items',NumberOfOverdueItems:'Overdue',NextScheduleLineDate:'Next delivery',NetOrderValue:'Order value',ValueToBeDelivered:'To deliver',ValueToBeInvoiced:'To invoice',DocumentCurrency:'Currency'};
        const columns = ['PurchaseOrder', 'Supplier', 'CompanyCode', 'PurchaseOrderDate', 'NumberOfOpenItems', 'NumberOfOverdueItems', 'NextScheduleLineDate', 'NetOrderValue', 'ValueToBeDelivered', 'ValueToBeInvoiced', 'DocumentCurrency'];
        message.textContent = `${count === undefined ? rows.length : count} open purchase order${Number(count ?? rows.length) === 1 ? '' : 's'}${state.overdue ? ' with overdue items' : ''}. Select a PO to view all details.`;
        root.querySelector('.po-results').innerHTML = rows.length ? `<div class="po-table-scroll" tabindex="0" role="region" aria-label="Open purchase orders"><table class="table po-table"><thead><tr>${columns.map(name => `<th scope="col">${esc(headings[name])}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${columns.map(name => `<td>${name === 'PurchaseOrder' ? `<button class="po-link" data-po-number="${esc(row.PurchaseOrder)}">${esc(row.PurchaseOrder)}</button>` : name === 'NumberOfOverdueItems' && Number(row[name]) > 0 ? `<span class="po-overdue">${esc(row[name])} overdue</span>` : esc(format(row[name], field('OpenPOHeader', name)))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '<p class="po-empty">No open purchase orders match these filters.</p>';
        root.querySelectorAll('[data-po-number]').forEach(button => button.onclick = () => renderDetails(content, back, button.dataset.poNumber));
        root.querySelector('[data-po-page]').textContent = `Page ${state.page + 1}${count === undefined ? '' : ` of ${Math.max(1, Math.ceil(Number(count) / pageSize))}`}`;
        root.querySelector('[data-po-prev]').disabled = state.page === 0;
        root.querySelector('[data-po-next]').disabled = count === undefined ? rows.length < pageSize : (state.page + 1) * pageSize >= Number(count);
      } catch (error) {
        if (error.name === 'AbortError' || !root.isConnected) return;
        message.textContent = `Could not load open purchase orders: ${error.message}`;
        root.querySelector('.po-results').innerHTML = '<p class="po-empty">Use Refresh to retry.</p>';
      }
    }
    form.onsubmit = event => { event.preventDefault(); Object.assign(state, { page: 0, po: form.elements.po.value.trim(), supplier: form.elements.supplier.value.trim(), company: form.elements.company.value.trim(), overdue: form.elements.overdue.checked }); load(); };
    root.querySelector('[data-po-clear]').onclick = () => { Object.assign(state, { page: 0, po: '', supplier: '', company: '', overdue: false }); render(content, back); };
    root.querySelector('[data-po-refresh]').onclick = load;
    root.querySelector('[data-po-prev]').onclick = () => { state.page--; load(); };
    root.querySelector('[data-po-next]').onclick = () => { state.page++; load(); };
    await load();
  }

  async function renderDetails(content, back, po, options = {}) {
    Portal.setRoute('po', options.routeTitle || 'Open PO Report', po);
    Portal.$('#page-title').textContent = `Purchase Order ${po}`;
    Portal.$('#page-subtitle').textContent = 'Header, items, receipt / invoice totals and schedule summaries';
    const inboxRecords = Array.isArray(options.inboxRecords) ? options.inboxRecords : [];
    content.innerHTML = `<section class="po-report po-detail"><div class="po-toolbar"><button class="button-secondary" data-po-list>‹ ${esc(options.listLabel || 'Open PO list')}</button><button class="button-secondary" data-po-retry>Refresh details</button></div><p class="po-message" role="status" aria-live="polite">Loading purchase order details…</p>${inboxRecords.length ? `<section class="card po-section"><div class="po-section-heading"><h2>RFQ email matches</h2><span>${inboxRecords.length} invitation${inboxRecords.length === 1 ? '' : 's'}</span></div><div class="po-table-scroll" tabindex="0" role="region" aria-label="RFQ email matches"><table class="table po-table"><thead><tr><th>RFQ</th><th>Supplier</th><th>Email</th><th>Email sent</th><th>Date</th><th>Time</th></tr></thead><tbody>${inboxRecords.map(row => `<tr><td>${esc(row.RFQNumber)}</td><td>${esc(row.SupplierName || row.Supplier)}</td><td>${esc(row.SupplierEmail)}</td><td>${esc(row.EmailSent)}</td><td>${esc(format(row.LastEmailSentOnDate, { type: 'Edm.Date' }))}</td><td>${esc(row.LastEmailSentatTime || '—')}</td></tr>`).join('')}</tbody></table></div></section>` : ''}<div data-po-sections></div></section>`;
    const root = content.firstElementChild;
    root.querySelector('[data-po-list]').onclick = () => options.list || render(content, back);
    root.querySelector('[data-po-retry]').onclick = () => renderDetails(content, back, po, options);
    const definitions = [['OpenPOHeader', 'Order overview'], ['OpenPOItem', 'Purchase order items'], ['OpenPOItemHistorySum', 'Goods receipt and invoice totals'], ['OpenPOItemScheduleSum', 'Schedule summaries']];
    const results = await Promise.allSettled(definitions.map(([entity]) => entity === 'OpenPOHeader'
      ? request(`/api/open-po/${entity}?${new URLSearchParams({ $filter: `PurchaseOrder eq ${literal(po)}`, $top: '1' })}`).then(data => data.value || [])
      : allRows(entity, po)));
    if (!root.isConnected) return;
    const failures = results.filter(result => result.status === 'rejected').length;
    root.querySelector('.po-message').textContent = failures ? `${failures} section(s) could not load. Refresh details to retry.` : results[0].value.length ? 'All available fields are shown below. Expand an item to see its complete details.' : 'This PO is no longer in the open order list. Available related records are shown below.';
    root.querySelector('[data-po-sections]').innerHTML = definitions.map(([entity, title], index) => {
      const result = results[index];
      if (result.status === 'rejected') return `<section class="card po-section"><h2>${esc(title)}</h2><p class="po-error" role="alert">${esc(result.reason.message)}</p></section>`;
      const rows = result.value;
      return `<section class="card po-section"><div class="po-section-heading"><h2>${esc(title)}</h2><span>${rows.length} record${rows.length === 1 ? '' : 's'}</span></div>${entity === 'OpenPOHeader' ? rows.map(row => values(entity, row)).join('') || '<p class="po-empty">No open PO header found.</p>' : entity === 'OpenPOItem' ? rows.map(itemDetails).join('') || '<p class="po-empty">No open items returned.</p>' : summaryDetails(entity, rows)}</section>`;
    }).join('');
  }
  window.OpenPoReport = { render, renderDetails };
})();
