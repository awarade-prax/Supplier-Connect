'use strict';

// Loaded only by the integration-test child. No real SMTP connections or sends.
const assert = require('node:assert/strict');
let retryRejected = false;
require('nodemailer').createTransport = options => {
  assert.equal(options.host, 'smtp.test.local');
  assert.equal(options.requireTLS, true);
  assert.equal(options.tls.minVersion, 'TLSv1.2');
  assert.equal(options.connectionTimeout, 10000);
  return {
    async sendMail(message) {
      assert.match(message.from, /test-user/);
      assert.match(message.html, /token=/);
      assert.match(message.subject, /Supplier Onboarding|Submit Your Quotation/);
      if (message.to === 'a.warade@praxisinfosolutions.com') {
        assert.match(message.html, /[?]token=rfq_[a-f0-9]{64}#\/rfq\/rfq-inbox\/7000000001/);
        assert.match(message.html, /2026-12-31/);
        if (message.html.includes('Bidder retry') && !retryRejected) {
          retryRejected = true;
          return { accepted: [], rejected: [message.to] };
        }
      }
      if (message.to === 'auth-error@example.test') throw Object.assign(new Error('Mock SMTP authentication error'), { code: 'EAUTH' });
      if (message.to === 'rejected@example.test') return { accepted: [], rejected: [message.to] };
      return { accepted: [message.to], rejected: [] };
    },
    close() {}
  };
};
