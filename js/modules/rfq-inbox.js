(() => {
  const esc = Portal.escapeHtml;
  const pageSize = 50;
  const headerFields = 'RequestForQuotation,RFQStatus,RFQType,RFQDescription,Language,PurchasingOrganization,PurchasingGroup,CompanyCode,DocumentCurrency,PublishingDate,QuotationDeadline,FollowOnDocumentType,CreatedBy,USerFullName,CreationDate,TargetValue';
  const itemFields = 'RequestForQuotation,RequestForQuotationItem,ScheduleLine,ShortText,Material,MaterialGroup,Plant,RequestedQuantity,OrderQuantityUnit,BaseUnit,DeliveryDate,PurchaseRequisition,PurchaseRequisitionItem,IncotermsClassification,IncotermsLocation1,IncotermsLocation2,Manufacturer,ManufacturerPartNumber';
  const bidderFields = 'RequestForQuotation,Supplier,SupplierName,PartnerFunction,PartnerCounter';
  let remembered = { filterValues: null, query: '', next: '', previous: [], selected: new Map() };

  function unwrap(value) { return value?.d || value; }
  function rows(value) { const data=unwrap(value);return Array.isArray(data?.results)?data.results:Array.isArray(data)?data:(data?[data]:[]); }
  function quote(value) { return String(value||'').trim().replace(/'/g,"''"); }
  function dateValue(input) {
    if (!input) return '';
    const match=typeof input==='string'&&input.match(/^\/Date\((-?\d+)/);
    const date=match?new Date(Number(match[1])):new Date(input);
    return Number.isNaN(date.getTime())?String(input):new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeZone:'UTC'}).format(date);
  }
  function emailTimeValue(input) {
    if (!input) return '';
    const match=String(input).match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
    return match?match.slice(1).map(value=>String(Number(value||0)).padStart(2,'0')).join(':'):String(input);
  }
  function escValue(value) { return value===null||value===undefined||value===''?'—':esc(String(value)); }
  function filtersFromForm(form) {
    const data=new FormData(form);const parts=[];
    const exact=[['RequestForQuotation','rfqNumber'],['RFQType','rfqType'],['PurchasingOrganization','purchasingOrg'],['PurchasingGroup','purchasingGroup'],['CompanyCode','companyCode']];
    exact.forEach(([field,name])=>{const value=String(data.get(name)||'').trim();if(value)parts.push(`${field} eq '${quote(value)}'`)});
    const description=String(data.get('description')||'').trim();if(description)parts.push(`substringof('${quote(description)}',RFQDescription)`);
    const from=String(data.get('deadlineFrom')||'').trim(),to=String(data.get('deadlineTo')||'').trim();
    if(from)parts.push(`QuotationDeadline ge datetime'${from}T00:00:00'`);
    if(to)parts.push(`QuotationDeadline le datetime'${to}T23:59:59'`);
    return parts;
  }
  function queryFor(parts,offset=0) {
    const params=new URLSearchParams();params.set('$select',headerFields);params.set('$top',String(pageSize));params.set('$orderby','CreationDate desc');
    if(parts.length)params.set('$filter',parts.join(' and '));if(offset)params.set('$skip',String(offset));return `?${params.toString()}`;
  }
  function nextQueryFromLink(link,top=pageSize) { if(!link)return '';try{const url=new URL(link,location.origin);url.searchParams.set('$top',String(top));return `?${url.searchParams.toString()}`}catch{return ''} }
  async function readAllRfq(entity,query,top=500) { const collected=[];let next=query;for(let page=0;next&&page<100;page++){const data=unwrap(await Portal.rfqOdata(entity,{query:next}));collected.push(...(Array.isArray(data?.results)?data.results:[]));next=nextQueryFromLink(data?.__next,top);}if(next)throw new Error(`The ${entity} result exceeded the 50,000-row safety limit.`);return collected; }
  function fieldsCard(title,values) { return `<section class="card rfq-card"><h2>${esc(title)}</h2><div class="rfq-meta-grid">${values.map(([label,value])=>`<div><span>${esc(label)}</span><strong>${escValue(value)}</strong></div>`).join('')}</div></section>`; }
  function tableHtml(columns,data,variant='') { return `<div class="rfq-table-wrap"><table class="table rfq-table ${variant}"><thead><tr>${columns.map(col=>`<th>${esc(col.label)}</th>`).join('')}</tr></thead><tbody>${data.length?data.map(row=>`<tr>${columns.map(col=>`<td>${escValue(col.format?col.format(row[col.key]):row[col.key])}</td>`).join('')}</tr>`).join(''):`<tr><td colspan="${columns.length}" class="rfq-empty">No records found.</td></tr>`}</tbody></table></div>`; }

  function addStatusColumn(table) {
    if (!table) return;
    const body=table.querySelector('tbody');
    const observer=new MutationObserver(async()=>{
      observer.disconnect();
      const headerRow=table.querySelector('thead tr');
      const rfqIndex=[...headerRow.children].findIndex(cell=>cell.textContent.trim()==='RFQ');
      if (rfqIndex<0) { observer.observe(body,{childList:true}); return; }
      if (![...headerRow.children].some(cell=>cell.textContent.trim()==='Status')) { const statusHeader=document.createElement('th');statusHeader.textContent='Status';headerRow.insertBefore(statusHeader,headerRow.children[rfqIndex+1]||null); }
      const numbers=[...body.rows].map(row=>row.cells[rfqIndex]?.textContent.trim()).filter(Boolean);
      const rowsMissingStatus=[...body.rows].filter(row=>row.cells.length<headerRow.children.length);
      if (numbers.length&&rowsMissingStatus.length) {
        try {
          const filter=numbers.map(number=>`RequestForQuotation eq '${quote(number)}'`).join(' or ');
          const result=rows(table.classList.contains('rfq-selectable-table')?await Portal.rfqOdata('RFQ_Header',{query:`?$filter=${encodeURIComponent(filter)}&$select=RequestForQuotation,RFQStatus&$top=100`}):await Portal.rfqSupplierList({query:'?$top=100'}));
          const statuses=new Map(result.map(row=>[String(row.RequestForQuotation),row.RFQStatus]));
          rowsMissingStatus.forEach(row=>{const cell=document.createElement('td');cell.textContent=escValue(statuses.get(row.cells[rfqIndex]?.textContent.trim()));row.insertBefore(cell,row.cells[rfqIndex+1]||null)});
        } catch {}
      }
      observer.observe(body,{childList:true});
    });
    observer.observe(body,{childList:true});
  }

  function renderSupplierList(content,back,page=1,detailNumber='') {
    Portal.$('#page-title').textContent='My RFQs';Portal.$('#page-subtitle').textContent='Requests for Quotation assigned to your supplier account';Portal.$('#view-label').textContent='SUPPLIER RFQ DETAILS';
    if(detailNumber){renderDetail(content,{RequestForQuotation:detailNumber},()=>{Portal.setRoute('rfq','RFQ Inbox');renderSupplierList(content,back,page)});return}
    content.innerHTML=`<div class="rfq-toolbar"><button type="button" class="button-secondary" data-supplier-rfq-back>‹ &nbsp;Return to RFQs & Quotes</button><button type="button" class="button-secondary" data-supplier-rfq-refresh>Refresh</button></div><section class="card rfq-card rfq-list-card"><div class="rfq-list-heading"><div><h2>RFQs assigned to your supplier account</h2><p>Select the arrow on a row to review its complete RFQ information.</p></div></div><div class="rfq-message" role="status" aria-live="polite">Loading your RFQs…</div><div class="rfq-table-wrap"><table class="table rfq-table rfq-list-table"><thead><tr><th>RFQ</th><th>Type</th><th>Description</th><th>Purchasing Organization</th><th>Purchasing Group</th><th>Company Code</th><th>Currency</th><th>Target Value</th><th>Quotation Deadline</th><th>Created By</th><th>Created On</th><th></th></tr></thead><tbody data-supplier-rfq-rows></tbody></table></div><div class="rfq-pagination"><span data-supplier-rfq-count></span><div><button type="button" class="button-secondary" data-supplier-rfq-prev>Previous</button><span data-supplier-rfq-page>Page ${page}</span><button type="button" class="button-secondary" data-supplier-rfq-next>Next</button></div></div></section>`;
    addStatusColumn(content.querySelector('.rfq-list-table'));content.querySelector('[data-supplier-rfq-back]').addEventListener('click',back);
    content.querySelector('[data-supplier-rfq-refresh]').addEventListener('click',()=>renderSupplierList(content,back,page));
    content.querySelector('[data-supplier-rfq-prev]').addEventListener('click',()=>{if(page>1)renderSupplierList(content,back,page-1)});
    content.querySelector('[data-supplier-rfq-next]').addEventListener('click',()=>renderSupplierList(content,back,page+1));
    Portal.rfqSupplierList({query:`?$top=${pageSize}&$skip=${(page-1)*pageSize}`}).then(value=>{
      if(!content.querySelector('[data-supplier-rfq-rows]'))return;
      const data=unwrap(value);const items=Array.isArray(data?.results)?data.results:[];const count=Number(data?.__count||items.length);const body=content.querySelector('[data-supplier-rfq-rows]');
      body.innerHTML=items.length?items.map(row=>`<tr><td><strong>${escValue(row.RequestForQuotation)}</strong></td><td>${escValue(row.RFQType)}</td><td>${escValue(row.RFQDescription)}</td><td>${escValue(row.PurchasingOrganization)}</td><td>${escValue(row.PurchasingGroup)}</td><td>${escValue(row.CompanyCode)}</td><td>${escValue(row.DocumentCurrency)}</td><td>${escValue(row.TargetValue)}</td><td>${escValue(dateValue(row.QuotationDeadline))}</td><td>${escValue(row.USerFullName||row.CreatedBy)}</td><td>${escValue(dateValue(row.CreationDate))}</td><td><button type="button" class="rfq-open" aria-label="Open RFQ ${escValue(row.RequestForQuotation)}" data-supplier-rfq-open="${esc(row.RequestForQuotation)}">›</button></td></tr>`).join(''):`<tr><td colspan="12" class="rfq-empty">No RFQs are currently assigned to your supplier account.</td></tr>`;
      content.querySelector('.rfq-message').textContent=`${count} RFQ${count===1?'':'s'} assigned to your supplier account.`;content.querySelector('[data-supplier-rfq-count]').textContent=`${count} RFQ${count===1?'':'s'}`;
      content.querySelector('[data-supplier-rfq-prev]').disabled=page<=1;content.querySelector('[data-supplier-rfq-next]').disabled=page*pageSize>=count;
      const openSupplierRfq=id=>{const row=items.find(item=>String(item.RequestForQuotation)===id);if(row)renderDetail(content,row,()=>{Portal.setRoute('rfq','RFQ Inbox');renderSupplierList(content,back,page)})};
      body.querySelectorAll('tr').forEach(tr=>tr.addEventListener('click',event=>{if(event.target.closest('button,a,input,select,textarea,label'))return;openSupplierRfq(tr.querySelector('[data-supplier-rfq-open]')?.dataset.supplierRfqOpen)}));
      body.querySelectorAll('[data-supplier-rfq-open]').forEach(button=>button.addEventListener('click',()=>openSupplierRfq(button.dataset.supplierRfqOpen)));
    }).catch(error=>{const message=content.querySelector('.rfq-message');if(message)message.textContent=`Could not load your RFQs: ${error.message}`;});
  }

  function renderList(content,back,detailNumber='') {
    Portal.$('#page-title').textContent='RFQ Inbox';Portal.$('#page-subtitle').textContent='Review sourcing requests and invite bidders';Portal.$('#view-label').textContent='RFQS & QUOTATIONS';
    if(detailNumber){renderDetail(content,{RequestForQuotation:detailNumber},()=>{Portal.setRoute('rfq','RFQ Inbox');renderList(content,back)});return}
    content.innerHTML=`<div class="rfq-toolbar"><button type="button" class="button-secondary" data-rfq-back>‹ &nbsp;Return to RFQs & Quotes</button><div><button type="button" class="button-secondary" data-rfq-refresh>Refresh</button><button type="button" class="button-primary" data-rfq-send disabled>Send Emails</button></div></div>
      <section class="card rfq-card rfq-list-card"><div class="rfq-list-heading"><div><h2>Requests for Quotation</h2><p>Select one or more RFQs to email each registered bidder.</p></div><div class="rfq-heading-actions"><button type="submit" form="rfq-filter-form" class="button-primary">Apply Filters</button><button type="reset" form="rfq-filter-form" class="button-secondary" data-rfq-clear>Clear</button></div></div>
      <form id="rfq-filter-form" class="rfq-filters" data-rfq-filters><label>RFQ Number<input class="form-control" name="rfqNumber" maxlength="10" placeholder="Exact RFQ number"></label><label>RFQ Type<input class="form-control" name="rfqType" maxlength="4"></label><label>Description<input class="form-control" name="description" maxlength="40"></label><label>Purchasing Org.<input class="form-control" name="purchasingOrg" maxlength="4"></label><label>Purchasing Group<input class="form-control" name="purchasingGroup" maxlength="3"></label><label>Company Code<input class="form-control" name="companyCode" maxlength="4"></label><label>Deadline from<input class="form-control" type="date" name="deadlineFrom"></label><label>Deadline to<input class="form-control" type="date" name="deadlineTo"></label></form>
      <div class="rfq-message" role="status" aria-live="polite">Loading RFQs…</div><div class="rfq-table-wrap"><table class="table rfq-table rfq-list-table rfq-selectable-table"><thead><tr><th><input type="checkbox" aria-label="Select all RFQs on this page" data-rfq-select-page></th><th>RFQ</th><th>Type</th><th>Description</th><th>Purchasing Organization</th><th>Purchasing Group</th><th>Company Code</th><th>Currency</th><th>Target Value</th><th>Quotation Deadline</th><th>Created By</th><th>Created On</th><th>Email Send</th><th>Email Date</th><th>Email Time</th><th></th></tr></thead><tbody data-rfq-rows></tbody></table></div>
      <div class="rfq-pagination"><span data-rfq-count></span><div><button type="button" class="button-secondary" data-rfq-prev disabled>Previous</button><span data-rfq-page>Page 1</span><button type="button" class="button-secondary" data-rfq-next disabled>Next</button></div></div></section>`;
    addStatusColumn(content.querySelector('.rfq-selectable-table'));content.querySelector('[data-rfq-back]').addEventListener('click',back);
    const form=content.querySelector('[data-rfq-filters]');if(remembered.filterValues)Object.entries(remembered.filterValues).forEach(([key,val])=>{const input=form.elements.namedItem(key);if(input)input.value=val});
    const updateSend=()=>{content.querySelector('[data-rfq-send]').disabled=!remembered.selected.size};
    const renderRows=(items,emailStatuses)=>{const tbody=content.querySelector('[data-rfq-rows]');tbody.innerHTML=items.length?items.map(row=>{const id=String(row.RequestForQuotation||'');const checked=remembered.selected.has(id);const email=emailStatuses[id]||{emailSend:'No',emailDate:'',emailTime:''};return `<tr><td><input type="checkbox" aria-label="Select RFQ ${esc(id)}" data-rfq-check="${esc(id)}" ${checked?'checked':''}></td><td><strong>${escValue(id)}</strong></td><td>${escValue(row.RFQType)}</td><td>${escValue(row.RFQDescription)}</td><td>${escValue(row.PurchasingOrganization)}</td><td>${escValue(row.PurchasingGroup)}</td><td>${escValue(row.CompanyCode)}</td><td>${escValue(row.DocumentCurrency)}</td><td>${escValue(row.TargetValue)}</td><td>${escValue(dateValue(row.QuotationDeadline))}</td><td>${escValue(row.USerFullName||row.CreatedBy)}</td><td>${escValue(dateValue(row.CreationDate))}</td><td>${escValue(email.emailSend)}</td><td>${escValue(dateValue(email.emailDate))}</td><td>${escValue(emailTimeValue(email.emailTime))}</td><td><button type="button" class="rfq-open" data-rfq-open="${esc(id)}" aria-label="Open RFQ ${esc(id)}">›</button></td></tr>`}).join(''):`<tr><td colspan="16" class="rfq-empty">No RFQs match these filters.</td></tr>`;
      content.querySelector('.rfq-message').textContent=items.length?`Loaded ${items.length} RFQ${items.length===1?'':'s'} on this page.`:'No RFQs found.';
      tbody.querySelectorAll('[data-rfq-check]').forEach(box=>box.addEventListener('change',()=>{const row=items.find(item=>String(item.RequestForQuotation)===box.dataset.rfqCheck);if(!row)return;if(box.checked)remembered.selected.set(box.dataset.rfqCheck,row);else remembered.selected.delete(box.dataset.rfqCheck);updateSend();}));
      const openRfq=id=>{const row=items.find(item=>String(item.RequestForQuotation)===id);if(row)renderDetail(content,row,()=>{Portal.setRoute('rfq','RFQ Inbox');renderList(content,back)})};
      tbody.querySelectorAll('tr').forEach(tr=>tr.addEventListener('click',event=>{if(event.target.closest('button,a,input,select,textarea,label'))return;openRfq(tr.querySelector('[data-rfq-open]')?.dataset.rfqOpen)}));
      tbody.querySelectorAll('[data-rfq-open]').forEach(button=>button.addEventListener('click',()=>openRfq(button.dataset.rfqOpen)));
      const selectPage=content.querySelector('[data-rfq-select-page]');selectPage.checked=items.length>0&&items.every(row=>remembered.selected.has(String(row.RequestForQuotation)));selectPage.indeterminate=items.some(row=>remembered.selected.has(String(row.RequestForQuotation)))&&!selectPage.checked;
      selectPage.addEventListener('change',()=>{for(const row of items){const id=String(row.RequestForQuotation||'');if(selectPage.checked)remembered.selected.set(id,row);else remembered.selected.delete(id)}renderRows(items,emailStatuses);updateSend();});
      updateSend();
    };
    async function load(query=remembered.query,reset=false) { const message=content.querySelector('.rfq-message');message.textContent='Loading RFQs from SAP…';content.querySelector('[data-rfq-next]').disabled=true;try{const data=unwrap(await Portal.rfqOdata('RFQ_Header',{query}));const items=Array.isArray(data?.results)?data.results:[];const emailStatuses={};if(items.length){const rfqNumbers=items.map(row=>String(row.RequestForQuotation||'').trim()).filter(Boolean);const response=await fetch('/api/rfq/email-details',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({rfqNumbers})});const result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result.error||`Could not load RFQ email details (${response.status}).`);Object.assign(emailStatuses,result.statuses||{});for(const rfqNumber of rfqNumbers)if(!Object.prototype.hasOwnProperty.call(emailStatuses,rfqNumber))throw new Error(`Email status is missing for RFQ ${rfqNumber}.`);}remembered.query=query;remembered.next=nextQueryFromLink(data?.__next);renderRows(items,emailStatuses);const next=content.querySelector('[data-rfq-next]');next.disabled=!remembered.next;content.querySelector('[data-rfq-prev]').disabled=!remembered.previous.length;content.querySelector('[data-rfq-page]').textContent=`Page ${remembered.previous.length+1}`;content.querySelector('[data-rfq-count]').textContent=data?.__count?`${data.__count} matching RFQs`:`${items.length} RFQs on this page`;}catch(error){message.textContent=`Could not load RFQs: ${error.message}`;content.querySelector('[data-rfq-rows]').innerHTML=`<tr><td colspan="16" class="rfq-empty rfq-error">SAP RFQ data or CBO email details could not be loaded. Check SAP access and the RFQ service configuration.<small>${esc(error.message)}</small></td></tr>`;content.querySelector('[data-rfq-page]').textContent=`Page ${remembered.previous.length+1}`;}}
    form.addEventListener('submit',event=>{event.preventDefault();remembered.filterValues=Object.fromEntries(new FormData(form).entries());remembered.previous=[];remembered.selected.clear();load(queryFor(filtersFromForm(form)),true)});
    content.querySelector('[data-rfq-clear]').addEventListener('click',()=>setTimeout(()=>{remembered.filterValues=null;remembered.previous=[];remembered.selected.clear();load(queryFor([]),true)},0));
    content.querySelector('[data-rfq-refresh]').addEventListener('click',()=>load(remembered.query,true));
    content.querySelector('[data-rfq-next]').addEventListener('click',()=>{if(!remembered.next)return;remembered.previous.push(remembered.query);load(remembered.next)});
    content.querySelector('[data-rfq-prev]').addEventListener('click',()=>{if(!remembered.previous.length)return;const query=remembered.previous.pop();load(query)});
    content.querySelector('[data-rfq-send]').addEventListener('click',()=>sendBatch([...remembered.selected.values()],content));
    if(!remembered.query)remembered.query=queryFor([]);load(remembered.query,true);
  }

  async function renderDetail(content,selected,back) {
    const rfqNumber=String(selected.RequestForQuotation||'');
    Portal.setRoute('rfq','RFQ Inbox',rfqNumber);
    Portal.$('#page-title').textContent=`RFQ ${rfqNumber}`;Portal.$('#page-subtitle').textContent='Request for Quotation details';Portal.$('#view-label').textContent='RFQ DETAILS';
    const supplierMode=Boolean(new URLSearchParams(location.search).get('token'));
    content.innerHTML=`<div class="rfq-toolbar"><button type="button" class="button-secondary" data-rfq-return>‹ &nbsp;Back to RFQ Inbox</button>${supplierMode?'<button type="button" class="button-primary" data-rfq-quote>Submit Quotation</button>':'<button type="button" class="button-primary" data-rfq-send-one>Send Emails</button>'}</div><div class="rfq-message" role="status" aria-live="polite">Loading RFQ details…</div><div data-rfq-detail></div>`;
    content.querySelector('[data-rfq-return]').addEventListener('click',back);if(!supplierMode)content.querySelector('[data-rfq-send-one]').addEventListener('click',()=>sendBatch([selected],content));
    try {
      const filter=`RequestForQuotation eq '${quote(rfqNumber)}'`;
      const [headerData,itemData,bidderData]=await Promise.all([
        Portal.rfqOdata('RFQ_Header',{query:`?$filter=${encodeURIComponent(filter)}&$select=${encodeURIComponent(headerFields)}&$top=1`}),
        readAllRfq('RFQ_Item',`?$filter=${encodeURIComponent(filter)}&$select=${encodeURIComponent(itemFields)}&$top=500`),
        readAllRfq('RFQ_Bidder',`?$filter=${encodeURIComponent(filter)}&$select=${encodeURIComponent(bidderFields)}&$top=500`)
      ]);
      const header=rows(headerData)[0]||selected;const items=itemData;const bidders=bidderData;
      if(supplierMode)content.querySelector('[data-rfq-quote]').addEventListener('click',()=>window.RfqQuotation.render(content,header,back));
      content.querySelector('.rfq-message').textContent='';
      content.querySelector('[data-rfq-detail]').innerHTML=`<div class="rfq-detail-heading"><div><h2>${escValue(header.RFQDescription||'Request for Quotation')}</h2><p>${escValue(header.RequestForQuotation)} <span class="rfq-state">In Preparation</span></p></div></div>
        ${fieldsCard('RFQ Header', [['RFQ Type',header.RFQType],['Language',header.Language],['Purchasing Organization',header.PurchasingOrganization],['Purchasing Group',header.PurchasingGroup],['Company Code',header.CompanyCode],['Document Currency',header.DocumentCurrency],['Target Value',header.TargetValue],['Quotation Deadline',dateValue(header.QuotationDeadline)],['Publishing Date',dateValue(header.PublishingDate)],['Follow-On Document Type',header.FollowOnDocumentType],['Approver','Not started'],['Created By',header.USerFullName||header.CreatedBy],['Created On',dateValue(header.CreationDate)]])}
        <section class="card rfq-card"><div class="rfq-card-heading"><h2>RFQ Items</h2><span>${items.length} item${items.length===1?'':'s'}</span></div>${tableHtml([
          {key:'RequestForQuotationItem',label:'Item'}, {key:'ScheduleLine',label:'Schedule'}, {key:'ShortText',label:'Description'}, {key:'Material',label:'Material'}, {key:'MaterialGroup',label:'Material Group'}, {key:'Plant',label:'Plant'}, {key:'RequestedQuantity',label:'Requested Qty'}, {key:'OrderQuantityUnit',label:'Order Unit'}, {key:'BaseUnit',label:'Base Unit'}, {key:'DeliveryDate',label:'Delivery Date',format:dateValue}, {key:'PurchaseRequisition',label:'Purchase Requisition'}, {key:'PurchaseRequisitionItem',label:'PR Item'}, {key:'IncotermsClassification',label:'Incoterms'}, {key:'IncotermsLocation1',label:'Location 1'}, {key:'IncotermsLocation2',label:'Location 2'}, {key:'Manufacturer',label:'Manufacturer'}, {key:'ManufacturerPartNumber',label:'Manufacturer Part No.'}
        ],items,'rfq-items-table')}</section>
        <section class="card rfq-card"><div class="rfq-card-heading"><h2>RFQ Bidders</h2><span>${bidders.length} bidder${bidders.length===1?'':'s'}</span></div>${tableHtml([{key:'Supplier',label:'Supplier'},{key:'SupplierName',label:'Supplier Name'},{key:'PartnerFunction',label:'Partner Function'},{key:'PartnerCounter',label:'Partner Counter'}],bidders,'rfq-bidders-table')}</section>`;
    } catch(error) { const message=content.querySelector('.rfq-message');message.innerHTML=`<div class="rfq-error">Could not load this RFQ: ${esc(error.message)}</div>`; }
  }

  function createEmailDialog(container) {
    const root=Portal.$('#dialog-root');root.innerHTML=`<div class="modal fade" tabindex="-1" aria-labelledby="rfq-mail-title" aria-hidden="true"><div class="modal-dialog modal-dialog-centered modal-xl"><div class="modal-content"><div class="modal-header"><h2 class="modal-title fs-5" id="rfq-mail-title">Sending RFQ invitations</h2></div><div class="modal-body"><p data-mail-progress role="status" aria-live="polite">Preparing email batch…</p><div class="progress mb-3" role="progressbar" aria-label="Email progress"><div class="progress-bar" data-mail-progressbar style="width:0%">0%</div></div><div class="rfq-table-wrap rfq-mail-table-wrap"><table class="table rfq-table"><thead><tr><th>RFQ</th><th>Supplier</th><th>Email</th><th>Status</th><th>Message</th></tr></thead><tbody data-mail-rows></tbody></table></div></div><div class="modal-footer"><span class="me-auto" data-mail-summary></span><button type="button" class="button-primary" data-mail-close disabled>Close</button></div></div></div></div>`;
    const element=root.firstElementChild;const modal=bootstrap.Modal.getOrCreateInstance(element,{backdrop:'static',keyboard:false});const body=element.querySelector('[data-mail-rows]');const progress=element.querySelector('[data-mail-progress]');const bar=element.querySelector('[data-mail-progressbar]');const close=element.querySelector('[data-mail-close]');const positions=new Map();close.addEventListener('click',()=>modal.hide());element.addEventListener('hidden.bs.modal',()=>root.replaceChildren(),{once:true});modal.show();
    return {progress:(rfqIndex,rfqCount,rfq,supplierIndex,supplierCount,supplier)=>{progress.textContent=`RFQ ${rfqIndex} of ${rfqCount}: ${rfq} — bidder ${supplierIndex} of ${supplierCount}: ${supplier}`;const percent=Math.round(((rfqIndex-1+supplierIndex/supplierCount)/rfqCount)*100);bar.style.width=`${percent}%`;bar.textContent=`${percent}%`;},add:(rfq,supplier,email,status,message)=>{const key=`${rfq}|${supplier}`;positions.set(key,body.children.length);const row=document.createElement('tr');row.innerHTML=`<td>${esc(rfq)}</td><td>${esc(supplier)}</td><td>${esc(email||'—')}</td><td><span class="rfq-mail-status ${status==='Sent'?'is-sent':status==='Failed'?'is-failed':'is-pending'}">${esc(status)}</span></td><td>${esc(message||'')}</td>`;body.append(row);return key;},update:(key,email,status,message)=>{const row=body.children[positions.get(key)];if(!row)return;row.cells[2].textContent=email||'—';row.cells[3].innerHTML=`<span class="rfq-mail-status ${status==='Sent'?'is-sent':'is-failed'}">${esc(status)}</span>`;row.cells[4].textContent=message||'';},complete:(summary)=>{progress.textContent='Email batch complete.';bar.style.width='100%';bar.textContent='100%';element.querySelector('[data-mail-summary]').textContent=summary;close.disabled=false;}};
  }

  function confirmRfqResend(rfqNumbers) {
    return new Promise(resolve=>{
      const root=Portal.$('#dialog-root');
      root.innerHTML=`<div class="modal fade rfq-resend-modal" tabindex="-1" aria-labelledby="rfq-resend-title" aria-describedby="rfq-resend-description" aria-hidden="true"><div class="modal-dialog modal-dialog-centered"><div class="modal-content"><div class="modal-header border-0 pb-0"><span class="rfq-resend-icon" aria-hidden="true">↻</span><div class="flex-grow-1"><p class="rfq-resend-eyebrow">RFQ already in CBO</p><h2 class="modal-title fs-5" id="rfq-resend-title">Resend invitation?</h2></div><button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button></div><div class="modal-body pt-3"><p id="rfq-resend-description">The following RFQ${rfqNumbers.length===1?'':'s'} already ${rfqNumbers.length===1?'Sends Email':'send Email'}:</p><div class="rfq-resend-list">${rfqNumbers.map(number=>`<span>${esc(number)}</span>`).join('')}</div><p class="rfq-resend-note mb-0">If you want to Resend it click on Resend Buttton.</p></div><div class="modal-footer border-0 pt-0"><button type="button" class="button-secondary" data-rfq-resend-cancel>Cancel</button><button type="button" class="button-primary" data-rfq-resend-confirm>Resend Email</button></div></div></div></div>`;
      const element=root.firstElementChild;const modal=bootstrap.Modal.getOrCreateInstance(element,{backdrop:'static',keyboard:false});let confirmed=false;
      element.querySelector('[data-rfq-resend-confirm]').addEventListener('click',()=>{confirmed=true;modal.hide()});
      element.querySelector('[data-rfq-resend-cancel]').addEventListener('click',()=>modal.hide());
      element.addEventListener('hidden.bs.modal',()=>{root.replaceChildren();resolve(confirmed)},{once:true});
      modal.show();
    });
  }

  async function sendBatch(rfqRows,content) {
    if(!rfqRows.length)return;
    const rfqNumbers=[...new Set(rfqRows.map(row=>String(row.RequestForQuotation||'').trim()).filter(Boolean))];
    let existingRfqs=new Set();
    try {
      const response=await fetch('/api/rfq/email-status',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({rfqNumbers})});
      const result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result.error||`Could not check previous invitation status (${response.status}).`);
      existingRfqs=new Set(Array.isArray(result.existingRfqs)?result.existingRfqs:[]);
    } catch(error) {
      const message=content.querySelector('.rfq-message');if(message)message.textContent=`Could not check previous invitation status: ${error.message}`;return;
    }
    const duplicates=rfqNumbers.filter(number=>existingRfqs.has(number));
    if(duplicates.length&&!(await confirmRfqResend(duplicates)))return;
    const email=createEmailDialog(content);let sent=0,failed=0,trackingFailed=0,recipientCount=0;
    try {
      for(const [rfqIndex,rfq] of rfqRows.entries()) {
        const number=String(rfq.RequestForQuotation||'');
        try {
          const filter=`RequestForQuotation eq '${quote(number)}'`;
          const bidders=await readAllRfq('RFQ_Bidder',`?$filter=${encodeURIComponent(filter)}&$select=${encodeURIComponent(bidderFields)}&$top=500`);
          const suppliers=Array.from(new Map(bidders.filter(row=>String(row.Supplier||'').trim()).map(row=>[String(row.Supplier).trim(),row])).values());
          if(!suppliers.length){email.add(number,'—','—','Failed','No bidders are assigned to this RFQ.');failed++;continue;}
          for(const [supplierIndex,bidder] of suppliers.entries()) {
            const supplierNumber=String(bidder.Supplier).trim();const key=email.add(number,supplierNumber,'','Processing','Sending invitation…');recipientCount++;
            email.progress(rfqIndex+1,rfqRows.length,number,supplierIndex+1,suppliers.length,supplierNumber);
            try {
              const response=await fetch('/api/mail/send-rfq-invitation',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({rfqNumber:number,supplierNumber,quotationDeadline:dateValue(rfq.QuotationDeadline),resend:existingRfqs.has(number)})});
              const result=await response.json().catch(()=>({}));if(!response.ok){const error=new Error(result.error||result.message||`Mail service responded with status ${response.status}.`);error.emailSent=Boolean(result.emailSent);error.email=result.email||'';throw error;}
              email.update(key,result.email||'', 'Sent', result.message||'Invitation sent successfully.');sent++;
            } catch(error) { if(error.emailSent){email.update(key,error.email,'Sent',error.message);sent++;trackingFailed++;}else{email.update(key,'','Failed',error.message||'An unexpected error occurred.');failed++;} }
          }
        } catch(error) { email.add(number,'—','—','Failed',error.message||'Could not read RFQ bidders.');failed++; }
      }
    } finally {
      email.complete(`${rfqRows.length} RFQ${rfqRows.length===1?'':'s'} processed · ${sent} sent · ${failed} failed${trackingFailed?` · ${trackingFailed} CBO tracking update${trackingFailed===1?'':'s'} failed`:''}${recipientCount?' · '+recipientCount+' bidder invitations':''}`);
      remembered.selected.clear();
      content.querySelectorAll('[data-rfq-check]').forEach(input=>{input.checked=false});
      const selectPage=content.querySelector('[data-rfq-select-page]');if(selectPage){selectPage.checked=false;selectPage.indeterminate=false;}
      const sendButton=content.querySelector('[data-rfq-send]');if(sendButton)sendButton.disabled=true;
    }
  }

  window.RfqInbox={renderList,renderSupplierList};
})();
