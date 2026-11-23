(() => {
  const modules = window.PORTAL_MODULES;
  const nav = Portal.$('#main-nav');
  const content = Portal.$('#content');
  const inviteToken = new URLSearchParams(location.search).get('token');
  const emailMode = Boolean(inviteToken);
  const emailLinkHadRoute = Boolean(location.hash);
  const contextLabel = emailMode ? 'SUPPLIER VIEW' : 'COMPANY VIEW';
  let current = 'home';
  let lastRoutedUrl = '';
  let supplierNameRequest;
  let invitedSupplier;

  function featureSlug(title) {
    return String(title || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  function writeRoute(id, title, replace = false, recordId = '') {
    const path = `#/${id}${title ? `/${featureSlug(title)}` : ''}${recordId ? `/${encodeURIComponent(recordId)}` : ''}`;
    const url = `${location.pathname}${location.search}${path}`;
    if (url === `${location.pathname}${location.search}${location.hash}`) { lastRoutedUrl = location.href; return; }
    history[replace ? 'replaceState' : 'pushState']({ module: id, feature: title || '' }, '', url);
    lastRoutedUrl = location.href;
  }
  Portal.setRoute = (id, title, recordId = '') => writeRoute(id, title, false, recordId);

  function registrationItems() {
    const registration = modules.find(module => module.id === 'registration');
    const items = registration.items.map(item => emailMode && item[1] === 'SAP Creation Status'
      ? [item[0], 'Supplier Creation Status', item[2]]
      : item);
    const emailAllowed = invitedSupplier?.supplierAddressCorrection
      ? ['Track Onboarding Status', 'Change Registration', 'Supplier Creation Status']
      : ['6','10'].includes(String(invitedSupplier?.Status || ''))
      ? ['Track Onboarding Status', 'Change Registration', 'Supplier Creation Status']
      : ['1','2'].includes(String(invitedSupplier?.Status || '1'))
        ? ['Complete Registration', 'Track Onboarding Status', 'Supplier Creation Status']
        : ['Track Onboarding Status', 'Supplier Creation Status'];
    const allowed = emailMode
      ? emailAllowed
      : ['Create Supplier Request', 'Track Onboarding Status', 'Supplier Approvals', 'SAP Creation Status'];
    return items.filter(item => allowed.includes(item[1]));
  }

  function loadSupplierName() {
    if (!emailMode) return Promise.resolve();
    if (inviteToken.startsWith('rfq_')) return Promise.resolve();
    if (!supplierNameRequest) {
      const safeToken = inviteToken.replace(/'/g, "''");
      supplierNameRequest = Portal.odata('YY1_SUPPLIER_ONBOARDING', { query: `?$filter=${encodeURIComponent(`AccessToken eq '${safeToken}'`)}&$top=1` })
        .then(async value => {
          const data = value?.d || value;
          const parent = (Array.isArray(data?.results) ? data.results : Array.isArray(data) ? data : [data]).find(Boolean);
          if (String(parent?.Status || '') === '7' && parent?.SAP_UUID) {
            try {
              const filter = `SAP_PARENT_UUID eq guid'${parent.SAP_UUID}'`;
              const creation = await Portal.odata('YY1_SAPCREATION_SUPPLIER_ONBOA', { query: `?$filter=${encodeURIComponent(filter)}&$top=1` });
              const rows = creation?.d || creation;
              const item = (Array.isArray(rows?.results) ? rows.results : Array.isArray(rows) ? rows : [rows]).find(Boolean);
              parent.supplierAddressCorrection = /pin code|postal code|country .*not a valid|address/i.test(String(item?.ErrorMessage || ''));
            } catch { parent.supplierAddressCorrection = false; }
          }
          invitedSupplier = parent;
          const label = Portal.$('#supplier-company-name');
          if (label) label.textContent = parent?.SupplierName || 'Supplier';
          if (emailMode && !emailLinkHadRoute && String(parent?.Status || '') === '11') {
            setActive('rfq', featureSlug('RFQ Inbox'));
            return;
          }
          if (current === 'registration' && !content.querySelector('#complete-registration-form')) renderModule(modules.find(module => module.id === 'registration'));
        })
        .catch(() => {
          const label = Portal.$('#supplier-company-name');
          if (label) label.textContent = 'Supplier';
        });
    }
    return supplierNameRequest;
  }

  function renderHome() {
    Portal.$('#page-title').textContent = 'Dashboard';
    Portal.$('#page-subtitle').textContent = 'Application Launchpad';
    Portal.$('#view-label').textContent = contextLabel;
    content.innerHTML = `<div class="section-caption"><strong>Choose an application tile to start work</strong><span class="supplier-badge">${contextLabel}</span></div><div class="tile-grid row row-cols-1 row-cols-sm-2 row-cols-xl-3 row-cols-xxl-4 g-3 g-xl-4 launch-grid">${modules.map(module => Portal.iconTile(['▦', module.id === 'home' ? 'Dashboard' : module.title, module.id === 'home' ? 'Metrics & actions' : module.subtitle], module.id)).join('')}</div>`;
    Portal.bindTiles(content);
  }

  function renderModule(module) {
    Portal.$('#page-title').textContent = module.title;
    Portal.$('#page-subtitle').textContent = module.subtitle;
    Portal.$('#view-label').textContent = contextLabel;
    const items = module.id === 'registration' ? registrationItems()
      : module.id === 'rfq' && !emailMode ? module.items.filter(item => ['RFQ Inbox', 'Quotation Tracking'].includes(item[1]))
      : module.id === 'po' ? module.items.filter(item => emailMode ? item[1] !== 'Open PO Report' : item[1] !== 'PO Inbox')
      : module.items;
    content.innerHTML = `<div class="section-caption"><strong>${Portal.escapeHtml(module.subtitle)}</strong><span class="supplier-badge">${contextLabel}</span></div><div class="tile-grid row row-cols-1 row-cols-sm-2 row-cols-xl-3 row-cols-xxl-4 g-3 g-xl-4">${items.map(item => Portal.iconTile(item)).join('')}</div>`;
    Portal.bindTiles(content);
  }

  function showFeature(detail, updateRoute = true, recordId = '') {
    if (current === 'po' && detail.title === 'PO Inbox') {
      if (updateRoute) writeRoute('po', detail.title, false, recordId);
      window.PoInbox.render(content, () => setActive('po'), recordId);
      return;
    }
    if (current === 'po' && detail.title === 'Open PO Report') {
      if (emailMode) { writeRoute('po', '', true); renderModule(modules.find(module => module.id === 'po')); return; }
      if (updateRoute) writeRoute('po', detail.title, false, recordId);
      window.OpenPoReport.render(content, () => setActive('po'), recordId);
      return;
    }
    if (updateRoute) writeRoute(current, detail.title, false, recordId);
    if (current === 'registration' && detail.title === 'Create Supplier Request' && !emailMode) {
      Portal.$('#page-title').textContent = 'Create Supplier Request';
      Portal.$('#page-subtitle').textContent = 'New supplier onboarding request';
      Portal.$('#view-label').textContent = 'SUPPLIER REGISTRATION';
      window.RegistrationForm.render(content, () => setActive('registration'));
      return;
    }
    if (current === 'registration' && ['Complete Registration','Change Registration'].includes(detail.title) && emailMode) {
      const changing = detail.title === 'Change Registration';
      Portal.$('#page-title').textContent = changing ? 'Change Supplier Registration' : 'Complete Supplier Registration';
      Portal.$('#page-subtitle').textContent = changing ? 'Update the returned supplier registration' : 'Supplier details and documents';
      Portal.$('#view-label').textContent = 'SUPPLIER REGISTRATION';
      window.CompleteRegistration.render(content, () => setActive('registration'), inviteToken, changing ? 'change' : 'complete');
      return;
    }
    if (current === 'registration' && detail.title === 'Supplier Approvals' && !emailMode) {
      Portal.$('#page-title').textContent = 'Supplier Onboardings';
      Portal.$('#page-subtitle').textContent = 'Supplier approval records';
      Portal.$('#view-label').textContent = 'SUPPLIER APPROVALS';
      window.SupplierApprovals.renderList(content, () => setActive('registration'), '', recordId);
      return;
    }
    if (current === 'registration' && detail.title === 'SAP Creation Status' && !emailMode) {
      window.SapCreationStatus.renderList(content, () => setActive('registration'));
      return;
    }
    if (current === 'rfq' && detail.title === 'RFQ Inbox') {
      if (emailMode) window.RfqInbox.renderSupplierList(content, () => setActive('rfq'), 1, recordId);
      else window.RfqInbox.renderList(content, () => setActive('rfq'), recordId);
      return;
    }
    if (current === 'rfq' && detail.title === 'Submit Quotation' && emailMode) {
      window.RfqQuotation.render(content, recordId ? {RequestForQuotation:recordId} : {}, () => setActive('rfq'));
      return;
    }
    Portal.showModal(detail.title, detail.description);
  }

  content.addEventListener('portal:feature', event => showFeature(event.detail));
  content.addEventListener('portal:module', event => setActive(event.detail.id));
  window.addEventListener('supplier-onboarding-status-change', event => {
    if (invitedSupplier && event.detail?.status) invitedSupplier.Status = String(event.detail.status);
  });

  function setActive(id, featureTitle = '', updateRoute = true, recordId = '') {
    current = id;
    if (updateRoute) writeRoute(id, featureTitle || '', false, recordId);
    document.body.dataset.module = id;
    const module = modules.find(entry => entry.id === id) || modules[0];
    nav.querySelectorAll('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.module === id));
    id === 'home' ? renderHome() : renderModule(module);
    if (featureTitle) {
      const item = module.items.find(entry => featureSlug(entry[1]) === featureTitle);
      if (item) showFeature({ title: item[1], description: item[2] }, false, recordId);
    }
  }

  function restoreRoute() {
    if (location.href === lastRoutedUrl) return;
    lastRoutedUrl = location.href;
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    const requestedId = parts[0] || '';
    const id = modules.some(module => module.id === requestedId) ? requestedId : (emailMode ? 'registration' : 'home');
    const feature = parts[1] || (emailMode && !location.hash ? featureSlug('Complete Registration') : '');
    let recordId = '';
    try { recordId = parts[2] ? decodeURIComponent(parts.slice(2).join('/')) : ''; } catch { recordId = ''; }
    const module = modules.find(entry => entry.id === id);
    const validFeature = feature && module?.items.some(item => featureSlug(item[1]) === feature) ? feature : '';
    setActive(id, validFeature, false, recordId);
    if (emailMode && id === 'po' && !validFeature) {
      showFeature({ title: 'PO Inbox', description: 'Open purchase orders with sent RFQ invitations' }, false);
    }
    if (emailMode && !location.hash && validFeature) writeRoute(id, module.items.find(item => featureSlug(item[1]) === validFeature)?.[1] || '', true);
    if (feature && !validFeature) writeRoute(id, '', true);
  }

  modules.forEach(module => {
    const button = document.createElement('button');
    button.className = 'nav-item';
    button.dataset.module = module.id;
    button.textContent = module.label;
    button.addEventListener('click', () => setActive(module.id));
    nav.append(button);
  });

  const hash = location.hash.slice(1);
  restoreRoute();
  loadSupplierName();
  window.addEventListener('hashchange', restoreRoute);
  window.addEventListener('popstate', restoreRoute);
})();
