'use strict';

const nodemailer = require('nodemailer');

function getSmtpConfig(env = process.env) {
  let bound = {};
  try {
    const services = Object.values(JSON.parse(env.VCAP_SERVICES || '{}')).flat();
    bound = (services.find(service => service.name === 'supplierportal-smtp-credentials')
      || services.find(service => service.tags?.includes('supplierportal-smtp-credentials')))?.credentials || {};
  } catch { /* Local SMTP configuration can be used without Cloud Foundry bindings. */ }
  const config = { ...bound };
  for (const key of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_SENDER_NAME']) {
    if (env[key]) config[key] = env[key];
  }
  return config;
}

function createMailTransport(config) {
  if (!config.SMTP_HOST || !config.SMTP_USER || !config.SMTP_PASSWORD) {
    throw Object.assign(new Error('Configure SMTP_HOST, SMTP_USER and SMTP_PASSWORD in .env or the supplierportal-smtp-credentials binding.'), { statusCode: 503 });
  }
  if (/(^|\.)(yourdomain\.com|example\.com)$/i.test(config.SMTP_HOST)) {
    throw Object.assign(new Error('SMTP_HOST is a template placeholder. Set it to the actual outgoing mail server and restart the application.'), { statusCode: 503 });
  }
  const port = Number(config.SMTP_PORT || 587);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw Object.assign(new Error('SMTP_PORT must be a valid port, usually 587 for STARTTLS or 465 for TLS.'), { statusCode: 503 });
  }
  return nodemailer.createTransport({
    host: config.SMTP_HOST, port, secure: port === 465, requireTLS: port !== 465,
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 30000,
    tls: { minVersion: 'TLSv1.2' }, auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD }
  });
}

async function sendMail(config, message) {
  const transport = createMailTransport(config);
  try {
    const result = await transport.sendMail(message);
    if (!result.accepted?.length) throw Object.assign(new Error('The mail server did not accept the supplier email address.'), { code: 'EENVELOPE' });
    return result;
  } finally {
    transport.close();
  }
}

function mailError(error) {
  if (error.statusCode) return error.message;
  if (error.code === 'EAUTH') return 'SMTP authentication failed. Check SMTP_USER and SMTP_PASSWORD; Google Workspace requires an app password or an approved authentication method.';
  if (error.code === 'EDNS' || error.errno === 'ENOTFOUND') return 'SMTP hostname could not be resolved. Check SMTP_HOST in .env.';
  if (['ETIMEDOUT', 'ECONNECTION', 'ECONNREFUSED', 'ESOCKET'].includes(error.code)) return 'Could not connect securely to the SMTP server. Check SMTP_HOST, SMTP_PORT, and office firewall access to the configured mail server.';
  if (error.code === 'EENVELOPE') return 'The SMTP server rejected the sender or supplier email address. Check the recipient address and sender permissions.';
  if (error.code === 'EMESSAGE') return 'The SMTP server rejected the email message. Check the sender policy and mail server logs.';
  return 'Email could not be sent. Check the server log and run npm run check:mail to verify SMTP configuration.';
}

module.exports = { getSmtpConfig, createMailTransport, sendMail, mailError };
