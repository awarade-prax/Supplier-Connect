(() => {
  const children = ['to_BankData', 'to_Documents', 'to_PurchaseContact', 'to_SupplierGeneralData', 'to_TaxRegistration'];
  const token = () => {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
  };
  const unwrap = value => value?.d || value;

  async function submit(form, content, back) {
    const button = form.querySelector('[type="submit"]');
    const status = form.querySelector('[role="status"]');
    const fields = Object.fromEntries(new FormData(form).entries());
    const accessToken = token();
    button.disabled = true;
    status.className = 'form-status info';
    status.textContent = 'Submitting the onboarding request to SAP…';
    try {
      const response = unwrap(await Portal.odata('YY1_SUPPLIER_ONBOARDING', {
        method: 'POST',
        body: {
          SupplierName: fields.supplierName.trim(),
          SupplierEmail: fields.supplierEmail.trim(),
          PurchasingOrganization: fields.purchasingOrganization.trim(),
          SupplierCategory: fields.supplierCategory.trim(),
          Status: '1',
          AccessToken: accessToken
        }
      }));
      const supplierId = response?.ID || '';
      const uuid = response?.SAP_UUID || '';
      const failures = [];

      if (!supplierId) failures.push('SAP did not return the onboarding ID.');
      if (supplierId && /^[\da-f-]{36}$/i.test(uuid)) {
        const parentPath = `YY1_SUPPLIER_ONBOARDING(guid'${uuid}')`;
        const childResults = await Promise.allSettled(children.map(nav => Portal.odata(`${parentPath}/${nav}`, {
          method: 'POST', body: { SupplierID: supplierId }, headers: { 'X-Supplier-Access-Token': accessToken }
        })));
        childResults.forEach((result, index) => {
          if (result.status === 'rejected') failures.push(`${children[index]}: ${result.reason.message}`);
        });
      } else if (supplierId) {
        failures.push('SAP did not return a valid SAP_UUID, so related onboarding entries were not created.');
      }

      let mailSent = false;
      try {
        const mailResponse = await fetch('/api/mail/send-confirmation', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            toEmail: fields.supplierEmail.trim(), supplierName: fields.supplierName.trim(),
            supplierEmail: fields.supplierEmail.trim(), purchasingOrganization: fields.purchasingOrganization.trim(),
            supplierCategory: fields.supplierCategory.trim(), accessToken
          })
        });
        const mailResult = await mailResponse.json().catch(() => ({}));
        if (!mailResponse.ok) failures.push(mailResult.error || 'The invitation email could not be sent.');
        else mailSent = true;
      } catch (error) {
        failures.push(`The invitation email could not be sent: ${error.message}`);
      }

      const allGood = !failures.length && mailSent;
      content.innerHTML = `<section class="card onboarding-result"><div class="result-icon ${allGood ? 'success' : 'warning'}">${allGood ? '✓' : '!'}</div><h2>${allGood ? 'Request submitted' : 'Request saved with follow-up items'}</h2><p>Onboarding request <strong>${Portal.escapeHtml(supplierId || '(ID not returned)')}</strong> was submitted to SAP.</p>${mailSent ? '<p>Invitation email sent to the supplier.</p>' : ''}${failures.length ? `<div class="result-notes"><strong>Follow-up:</strong><ul>${failures.map(item => `<li>${Portal.escapeHtml(item)}</li>`).join('')}</ul></div>` : ''}<button type="button" class="button-primary" data-return>Return to Supplier Registration</button></section>`;
      content.querySelector('[data-return]').addEventListener('click', back);
    } catch (error) {
      status.className = 'form-status error';
      status.textContent = `Submission failed: ${error.message}`;
      button.disabled = false;
    }
  }

  function render(content, back) {
    content.innerHTML = `<div class="feature-toolbar"><button type="button" class="button-secondary" data-return>‹ &nbsp;Return to Supplier Registration</button><span class="supplier-badge">SUPPLIER VIEW</span></div><section class="card onboarding-card"><div class="onboarding-heading"><p class="eyebrow">SUPPLIER ONBOARDING</p><h2>Create Supplier Request</h2><p>Enter the supplier’s contact and purchasing details. Name and email are required.</p></div><form id="onboarding-form" class="row g-3" novalidate><div class="col-12 col-lg-6"><label class="form-label" for="supplier-name">Supplier Name <span class="required-mark">*</span></label><input class="form-control" id="supplier-name" name="supplierName" maxlength="80" autocomplete="organization" required></div><div class="col-12 col-lg-6"><label class="form-label" for="supplier-email">Supplier Email <span class="required-mark">*</span></label><input class="form-control" id="supplier-email" name="supplierEmail" type="email" maxlength="150" autocomplete="email" required></div><div class="col-12 col-lg-6"><label class="form-label" for="purchasing-org">Purchasing Organization</label><input class="form-control" id="purchasing-org" name="purchasingOrganization" maxlength="20"></div><div class="col-12 col-lg-6"><label class="form-label" for="supplier-category">Supplier Category</label><input class="form-control" id="supplier-category" name="supplierCategory" maxlength="40"></div><div class="col-12"><div class="form-status" role="status" aria-live="polite"></div></div><div class="col-12 form-actions"><button type="submit" class="button-primary">Submit Request</button></div></form></section>`;
    content.querySelector('[data-return]').addEventListener('click', back);
    const form = content.querySelector('#onboarding-form');
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      submit(form, content, back);
    });
  }

  window.RegistrationForm = { render };
})();
