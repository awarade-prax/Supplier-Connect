'use strict';

const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const { getSmtpConfig, createMailTransport, mailError } = require('../lib/mail');

(async () => {
  let transport;
  try {
    transport = createMailTransport(getSmtpConfig());
    await transport.verify();
    console.log('PASS SMTP connection, TLS and authentication. No email was sent; delivery and recipient acceptance require an actual send.');
  } catch (error) {
    console.error(`FAIL ${mailError(error)}${error.code ? ` (${error.code})` : ''}`);
    process.exitCode = 1;
  } finally {
    transport?.close();
  }
})();
