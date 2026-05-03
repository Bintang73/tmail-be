const path = require('node:path');

const rootDir = path.resolve(__dirname, '../..');
let services;

const loadServices = async () => {
  if (!services) {
    services = await import(path.join(rootDir, 'src/services/emailProcessingService.js'));
  }

  return services;
};

exports.register = function register() {
  this.register_hook('data_post', 'hook_data');
};

exports.hook_data = async function hookData(next, connection) {
  try {
    const { processRawEmail } = await loadServices();
    const transaction = connection.transaction;
    const chunks = [];

    for await (const chunk of transaction.message_stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    const raw = Buffer.concat(chunks);
    const recipients = transaction.notes.valid_recipients || transaction.rcpt_to.map((rcpt) => rcpt.address().toLowerCase());

    await processRawEmail({ raw, recipients });
    return next(OK);
  } catch (error) {
    connection.logerror(this, `save email failed: ${error.stack || error.message}`);
    return next(DENYSOFT, 'Temporary storage error');
  }
};
