const path = require('node:path');

const rootDir = path.resolve(__dirname, '../..');
let services;

const loadServices = async () => {
  if (!services) {
    services = {
      ...(await import(path.join(rootDir, 'src/services/mxService.js'))),
      ...(await import(path.join(rootDir, 'src/utils/email.js')))
    };
  }

  return services;
};

exports.register = function register() {
  this.register_hook('rcpt', 'hook_rcpt');
};

exports.hook_rcpt = async function hookRcpt(next, connection, params) {
  const { getDomainFromEmail, validateDomainMx } = await loadServices();
  const recipient = params?.[0]?.address?.();
  const domain = getDomainFromEmail(recipient);

  try {
    const valid = await validateDomainMx(domain);
    if (!valid) {
      connection.logwarn(this, `reject recipient domain=${domain}`);
      return next(DENY, 'Recipient domain is not configured for this MX');
    }

    connection.transaction.notes.valid_recipients ||= [];
    connection.transaction.notes.valid_recipients.push(recipient.toLowerCase());
    return next(OK);
  } catch (error) {
    connection.logerror(this, `MX validation failed: ${error.message}`);
    return next(DENYSOFT, 'Temporary recipient validation error');
  }
};
