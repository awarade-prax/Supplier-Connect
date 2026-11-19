(() => {
  const parentSet = 'YY1_SUPPLIER_ONBOARDING';
  const childSets = {
    general: 'YY1_SUPPLIERGENERALDATA_SUPPLI',
    tax: 'YY1_TAXREGISTRATION_SUPPLIER_O',
    bankData: 'YY1_BANKDATA_SUPPLIER_ONBOARDI',
    contact: 'YY1_PURCHASECONTACT_SUPPLIER_O',
    docs: 'YY1_DOCUMENTS_SUPPLIER_ONBOARD',
    sap: 'YY1_SAPCREATION_SUPPLIER_ONBOA'
  };
  const statusLabels = {
    '1':'Submitted','2':'Drafted by Supplier','3':'Under Review of Purchase','4':'Approved by Purchase',
    '5':'Rejected by Purchase','6':'Sent Back by Purchase','7':'Under Review of Finance',
    '8':'Approved by Finance','9':'Rejected by Finance','10':'Sent Back by Finance','11':'Overall Approved'
  };
  const statusOptions = Object.entries(statusLabels);
  const icons = {
    building:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 21V7h6v14M7 7h.01M17 7h.01M7 11h.01M17 11h.01M7 15h.01M17 15h.01"/>',
    document:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h8"/>',
    pin:'<path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
    leaf:'<path d="M20 4c-8 0-14 3-14 10a6 6 0 0 0 6 6c7 0 8-8 8-16Z"/><path d="M4 21c3-5 7-8 13-11"/>',
    user:'<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    bank:'<path d="m3 9 9-6 9 6M4 10h16M5 10v9m4-9v9m6-9v9m4-9v9M3 21h18M3 19h18"/>',
    clip:'<path d="m21 11.5-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-9 9a2 2 0 0 1-3-3l8-8"/>',
    check:'<circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/>'
  };
  const icon = name => `<svg class="section-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
  const esc = Portal.escapeHtml;
  const unwrap = value => value?.d || value;
  const rows = value => { const data=unwrap(value);return Array.isArray(data?.results)?data.results:Array.isArray(data)?data:(data?[data]:[]); };
  const value = input => input === null || input === undefined || input === '' ? '—' : String(input);

  function statusFor(row) {
    const code=String(row.Status ?? '1');
    return row.Status_Text || statusLabels[code] || 'Submitted';
  }
  function dateFor(input) {
    if(!input)return '—';
    const match=typeof input==='string'&&input.match(/^\/Date\((-?\d+)/);
    const date=match?new Date(Number(match[1])):new Date(input);
    return Number.isNaN(date.getTime())?String(input):new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeZone:'UTC'}).format(date);
  }
  function cell(label,val) { return `<div class="approval-detail-field"><span>${esc(label)}</span><strong>${esc(value(val))}</strong></div>`; }
  function card(title, iconName, content) { return `<section class="card approval-detail-card"><h2><span class="panel-icon">${icon(iconName)}</span>${title}</h2><div class="approval-detail-grid">${content}</div></section>`; }
  function approvalStage(status) {
    if (String(status)==='3') return {name:'Purchase',actions:['Approved','Rejected','Sent Back']};
    if (['4','7'].includes(String(status))) return {name:'Finance',actions:['Approved','Rejected','Sent Back']};
    return null;
  }
  async function renderList(content, back, notice='', selectedUuid='') {
    Portal.$('#page-title').textContent='Supplier Onboardings';
    Portal.$('#page-subtitle').textContent='Supplier approval records';
    Portal.$('#view-label').textContent='SUPPLIER APPROVALS';
    content.innerHTML=`<div class="approval-toolbar"><button type="button" class="button-secondary" data-approval-back>‹ &nbsp;Return to Supplier Registration</button><button type="button" class="button-secondary" data-refresh-list>Refresh</button></div>${notice?`<div class="alert alert-warning" role="status">${esc(notice)}</div>`:''}<section class="card approval-list-card"><div class="approval-list-heading"><div><h2>Supplier Onboardings</h2><p>Search and review supplier registration records.</p></div><div class="approval-filterbar"><label class="approval-search"><span class="visually-hidden">Search onboardings</span><input type="search" class="form-control" placeholder="Search supplier, ID or status" data-approval-search></label><label class="approval-status-filter"><span>Status</span><select class="form-select" data-status-filter><option value="">All statuses</option>${statusOptions.map(([code,label])=>`<option value="${code}">${esc(label)}</option>`).join('')}</select></label></div></div><div class="approval-message" role="status" aria-live="polite">Loading supplier onboardings…</div><div class="approval-table-wrap"><table class="table approval-table"><thead><tr><th>Request ID</th><th>Supplier Name</th><th>Email</th><th>Purchasing Organization</th><th>Status</th><th>Submitted</th><th><span class="visually-hidden">Details</span></th></tr></thead><tbody data-approval-rows></tbody></table></div><div class="approval-pagination"><button type="button" class="button-secondary" data-page-previous disabled>Previous</button><span data-page-label>Page 1</span><button type="button" class="button-secondary" data-page-next disabled>Next</button></div></section>`;
    content.querySelector('[data-approval-back]').addEventListener('click',back);
    content.querySelector('[data-refresh-list]').addEventListener('click',()=>load());
    let currentQuery=selectedUuid&&/^[\da-f-]{36}$/i.test(selectedUuid)?`?$filter=${encodeURIComponent(`SAP_UUID eq guid'${selectedUuid}'`)}&$top=1`:'?$top=50&$orderby=SAP_CreatedDateTime%20desc';let nextQuery='';let pageNumber=1;const previousQueries=[];let debounce;let loadSequence=0;let restoredDetail=false;
    function renderRows(shown){
      const tbody=content.querySelector('[data-approval-rows]');
      tbody.innerHTML=shown.map(row=>`<tr><td>${esc(value(row.REQID||row.ID))}</td><td>${esc(value(row.SupplierName))}</td><td>${esc(value(row.SupplierEmail))}</td><td>${esc(value(row.PurchasingOrganization))}</td><td><span class="approval-status" data-status="${esc(String(row.Status||'1'))}">${esc(statusFor(row))}</span></td><td>${esc(dateFor(row.SAP_CreatedDateTime))}</td><td><button type="button" class="approval-open" aria-label="Open ${esc(value(row.SupplierName))} details" data-record-uuid="${esc(row.SAP_UUID||'')}">›</button></td></tr>`).join('');
      content.querySelector('.approval-message').textContent=shown.length?`Showing ${shown.length} onboarding record${shown.length===1?'':'s'} on this page.`:'No supplier onboardings found.';
      const openRecord=uuid=>{const selected=records.find(row=>row.SAP_UUID===uuid);if(selected){Portal.setRoute('registration','Supplier Approvals',selected.SAP_UUID);renderDetail(content,selected,()=>{Portal.setRoute('registration','Supplier Approvals');renderList(content,back)})}};
      tbody.querySelectorAll('tr').forEach(tr=>tr.addEventListener('click',event=>{if(event.target.closest('button,a,input,select,textarea,label'))return;openRecord(tr.querySelector('[data-record-uuid]')?.dataset.recordUuid)}));
      tbody.querySelectorAll('[data-record-uuid]').forEach(button=>button.addEventListener('click',()=>openRecord(button.dataset.recordUuid)));
    }
    let records=[];
    content.querySelector('[data-page-previous]').addEventListener('click',()=>{if(!previousQueries.length)return;currentQuery=previousQueries.pop();pageNumber=Math.max(1,pageNumber-1);load(currentQuery,false)});
    content.querySelector('[data-page-next]').addEventListener('click',()=>{if(!nextQuery)return;previousQueries.push(currentQuery);currentQuery=nextQuery;pageNumber++;load(currentQuery,false)});
    content.querySelector('[data-approval-search]').addEventListener('input',event=>{clearTimeout(debounce);debounce=setTimeout(()=>search(event.target.value),350)});
    content.querySelector('[data-status-filter]').addEventListener('change',()=>search(content.querySelector('[data-approval-search]').value));
    function search(text){
      const term=String(text||'').trim().replace(/'/g,"''");previousQueries.length=0;pageNumber=1;
      const filters=[];if(term)filters.push(`(${["SupplierName","SupplierEmail","REQID","ID"].map(field=>`substringof('${term}',${field})`).join(' or ')})`);const status=content.querySelector('[data-status-filter]').value;if(status)filters.push(`Status eq '${status}'`);
      const filter=filters.length?`&$filter=${encodeURIComponent(filters.join(' and '))}`:'';
      currentQuery=`?$top=50&$orderby=SAP_CreatedDateTime%20desc${filter}`;load(currentQuery,false);
    }
    async function load(query=currentQuery,reset=true){
      if(reset){previousQueries.length=0;pageNumber=1;currentQuery=query}
      const sequence=++loadSequence;
      const message=content.querySelector('.approval-message');if(!message)return;
      message.textContent='Loading supplier onboardings…';content.querySelector('[data-page-previous]').disabled=previousQueries.length===0;content.querySelector('[data-page-next]').disabled=true;
      try{
        const data=await Portal.odata(parentSet,{query});if(sequence!==loadSequence||!content.querySelector('.approval-list-card'))return;const unwrapped=unwrap(data);records=rows(data);
        const nextLink=unwrapped?.__next||data?.__next||'';nextQuery='';
        if(nextLink){const link=new URL(nextLink,location.origin);const params=new URLSearchParams();const token=link.searchParams.get('$skiptoken');const skip=link.searchParams.get('$skip');if(token)params.set('$skiptoken',token);else if(skip)params.set('$skip',skip);const filter=link.searchParams.get('$filter');if(filter)params.set('$filter',filter);params.set('$top','50');const order=link.searchParams.get('$orderby');if(order)params.set('$orderby',order);nextQuery=`?${params.toString()}`}
        renderRows(records);content.querySelector('[data-page-next]').disabled=!nextQuery;content.querySelector('[data-page-previous]').disabled=previousQueries.length===0;content.querySelector('[data-page-label]').textContent=`Page ${pageNumber}`;
        if(selectedUuid&&!restoredDetail){restoredDetail=true;const selected=records.find(row=>String(row.SAP_UUID).toLowerCase()===selectedUuid.toLowerCase());if(selected)renderDetail(content,selected,()=>{Portal.setRoute('registration','Supplier Approvals');renderList(content,back)})}
      }catch(error){if(sequence!==loadSequence||!content.querySelector('.approval-list-card'))return;message.textContent=`Could not load supplier onboardings: ${error.message}`;content.querySelector('[data-approval-rows]').replaceChildren()}
    }
    await load();
  }

  async function renderDetail(content,parent,back){
    Portal.setRoute('registration','Supplier Approvals',parent.SAP_UUID);
    Portal.$('#page-title').textContent=`${parent.SupplierName||'Supplier'} — Onboarding Details`;
    Portal.$('#page-subtitle').textContent=`Request ${parent.REQID||parent.ID||''}`;
    Portal.$('#view-label').textContent='SUPPLIER APPROVALS';
    const stage=approvalStage(parent.Status);
    content.innerHTML=`<div class="approval-toolbar"><button type="button" class="button-secondary" data-list-back>‹ &nbsp;Back to Supplier Onboardings</button><div class="approval-toolbar-actions">${stage?stage.actions.map(action=>`<button type="button" class="${action==='Approved'?'button-primary':'button-secondary'}" data-open-decision="${action}">${action==='Approved'?'Approve':action==='Rejected'?'Reject':'Send Back'}</button>`).join(''):''}</div></div><div class="approval-detail-summary card"><div>${cell('Supplier Name',parent.SupplierName)}${cell('Supplier Email',parent.SupplierEmail)}${cell('Purchasing Organization',parent.PurchasingOrganization)}${cell('Supplier Category',parent.SupplierCategory)}${cell('Request ID',parent.REQID||parent.ID)}${cell('Submitted',dateFor(parent.SAP_CreatedDateTime))}</div><span class="approval-status" data-status="${esc(String(parent.Status||'1'))}">${esc(statusFor(parent))}</span></div><div class="approval-detail-grid-layout"><div class="approval-detail-loading" role="status">Loading supplier details…</div></div><div class="modal fade" tabindex="-1" aria-labelledby="approval-modal-title" aria-hidden="true" data-approval-modal><div class="modal-dialog modal-dialog-centered"><div class="modal-content"><div class="modal-header"><h2 class="modal-title fs-5" id="approval-modal-title">Confirm decision</h2><button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button></div><div class="modal-body"><section class="approval-modal-description"><strong data-decision-summary></strong><p data-decision-description></p></section><label for="approval-comment" class="form-label">Comment <span class="text-secondary">(optional, up to 500 characters)</span></label><textarea class="form-control" id="approval-comment" maxlength="500" rows="4" placeholder="Add a comment for the supplier"></textarea><div class="approval-modal-message" role="status" aria-live="polite"></div></div><div class="modal-footer"><button type="button" class="button-secondary" data-bs-dismiss="modal">Cancel</button><button type="button" class="button-primary" data-confirm-decision>Confirm</button></div></div></div></div>`;
    content.querySelector('[data-list-back]').addEventListener('click',back);
    const modalElement=content.querySelector('[data-approval-modal]');const modal=bootstrap.Modal.getOrCreateInstance(modalElement);let selectedDecision='';
    const descriptions={Approved:stage?.name==='Finance'?'Finance approval will create the supplier as a Business Partner in SAP.':'Purchase approval will move this onboarding to Finance review.',Rejected:'This decision rejects the onboarding at the current review stage.', 'Sent Back':'This decision returns the onboarding to the supplier for corrections.'};
    content.querySelectorAll('[data-open-decision]').forEach(button=>button.addEventListener('click',()=>{selectedDecision=button.dataset.openDecision;content.querySelector('[data-decision-summary]').textContent=`${stage.name}: ${selectedDecision==='Approved'?'Approve':selectedDecision==='Rejected'?'Reject':'Send Back'} ${parent.SupplierName||'this supplier'}?`;content.querySelector('[data-decision-description]').textContent=descriptions[selectedDecision];content.querySelector('[data-confirm-decision]').disabled=false;content.querySelector('.approval-modal-message').textContent='';content.querySelector('#approval-comment').value='';modal.show()}));
    content.querySelector('[data-confirm-decision]').addEventListener('click',()=>submitDecision(selectedDecision));
    async function submitDecision(decision){
      const message=content.querySelector('.approval-modal-message');
      const confirm=content.querySelector('[data-confirm-decision]');
      confirm.disabled=true;message.textContent=`Saving ${decision.toLowerCase()}…`;
      try{
        const response=await fetch('/api/approvals/decision',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({uuid:parent.SAP_UUID,decision,comment:content.querySelector('#approval-comment')?.value||''})});
        const result=await response.json().catch(()=>({}));
        if(!response.ok)throw new Error(result.error||`Approval could not be saved (${response.status}).`);
        const hidden=new Promise(resolve=>modalElement.addEventListener('hidden.bs.modal',resolve,{once:true}));modal.hide();await hidden;
        Portal.setRoute('registration','Supplier Approvals');
        await renderList(content,back,result.creationError?`Finance approval was saved, but SAP supplier creation needs attention: ${result.creationError}`:'');
      }catch(error){message.textContent=error.message;confirm.disabled=false}
    }
    try{
      const uuid=String(parent.SAP_UUID||'');if(!/^[\da-f-]{36}$/i.test(uuid))throw new Error('This onboarding does not have a valid SAP UUID.');
      const filter=`SAP_PARENT_UUID eq guid'${uuid}'`;
      const entries=Object.entries(childSets);
      const loaded=await Promise.all(entries.map(async([key,set])=>{
        try{const data=await Portal.odata(set,{query:`?$filter=${encodeURIComponent(filter)}&$top=1`});return[key,rows(data)[0]||{}]}
        catch{return[key,{}]}
      }));
      const child=Object.fromEntries(loaded);
      const general=child.general||{};const tax=child.tax||{};const bank=child.bankData||{};const contact=child.contact||{};const docs=child.docs||{};const sap=child.sap||{};
      const flag=tax.MSMEFlag_Text||({'01':'Yes','02':'No'}[String(tax.MSMEFlag)]||tax.MSMEFlag);
      const accountType=bank.AccountType_Text||({'01':'Savings','02':'Current'}[String(bank.AccountType)]||bank.AccountType);
      const body=`<div class="approval-detail-grid-layout">
        ${card('Company Details','building',cell('Company Name',parent.SupplierName)+cell('Supplier Email',parent.SupplierEmail)+cell('Purchasing Organization',parent.PurchasingOrganization)+cell('Supplier Category',parent.SupplierCategory)+cell('Onboarding ID',parent.ID))}
        ${card('Tax & Statutory Details','document',cell('GSTIN',tax.GSTIN)+cell('PAN',tax.PAN))}
        ${card('Registered Address','pin',cell('Address Line 1',general.Address1)+cell('Address Line 2',general.Address2)+cell('City',general.City)+cell('District',general.District)+cell('State',general.State)+cell('Country',general.Country)+cell('PIN Code',general.PINCode))}
        ${card('Udyam / MSME Details','leaf',cell('MSME / Udyam Registered',flag)+cell('Udyam Registration No.',tax.MSMENumber)+cell('MSME Type',tax.MSMEType)+cell('Validity / Renewal Date',dateFor(tax.MSMEValidTill)))}
        ${card('Contact Person Details','user',cell('Contact Person Name',contact.Name)+cell('Designation',contact.Designation)+cell('Contact Email',contact.Email)+cell('Phone / Mobile',contact.Mobile))}
        ${card('Bank Details','bank',cell('Account Holder',bank.AccountHolder)+cell('Bank Name',bank.BankName)+cell('Account Number',bank.AccountNumber)+cell('IFSC',bank.IFSC)+cell('Account Type',accountType))}
        ${card('Document References','clip',cell('GST Registration Certificate',docs.GSTDocumentID)+cell('Udyam / MSME Certificate',docs.MSMEDocumentID)+cell('Bank Proof',docs.BankChequeDocumentID)+cell('Compliance Certificate 1',docs.PharmaCertificate1ID)+cell('Compliance Certificate 2',docs.PharmaCertificate2ID))}
        ${sap.BPNumber||sap.SupplierNumber||sap.ErrorMessage?card('SAP Creation','check',cell('Business Partner',sap.BPNumber)+cell('Supplier Number',sap.SupplierNumber)+cell('Error Message',sap.ErrorMessage)):''}
      </div>`;
      content.querySelector('.approval-detail-grid-layout').outerHTML=body;
    }catch(error){content.querySelector('.approval-detail-grid-layout').innerHTML=`<div class="approval-message approval-message-error">Supplier details could not be loaded: ${esc(error.message)}</div>`}
  }

  window.SupplierApprovals={renderList};
})();
