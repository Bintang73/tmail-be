const fs = require('node:fs');
const path = require('node:path');
const Redis = require('ioredis');

require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const redisPassword = process.env.REDIS_PASSWORD || 'd0535500cb173f97';
const queueStream = process.env.EMAIL_QUEUE_STREAM || 'email_queue';
const queueMaxLength = Number.parseInt(process.env.EMAIL_QUEUE_MAXLEN || '100000', 10);
const rootDir = path.resolve(__dirname, '../..');
const spoolDir = path.resolve(rootDir, process.env.EMAIL_SPOOL_DIR || './spool/emails');

let redis;

const getRedis = () => {
  if (!redis) {
    redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
      lazyConnect: true,
      password: redisPassword || undefined,
      retryStrategy(times) {
        if (times > 10) return null;
        return Math.min(times * 250, 2000);
      },
      reconnectOnError() {
        return false;
      }
    });
  }

  return redis;
};

exports.register = function register() {
  this.register_hook('queue', 'queue_email');
};

exports.queue_email = function queueEmail(next, connection) {
  try {
    const transaction = connection.transaction;
    const date = new Date();
    const folder = path.join(
      spoolDir,
      date.toISOString().slice(0, 10),
      String(date.getUTCHours()).padStart(2, '0')
    );
    fs.mkdirSync(folder, { recursive: true });

    const safeUuid = String(transaction.uuid || `${Date.now()}-${Math.random()}`).replace(/[^a-zA-Z0-9.-]/g, '_');
    const spoolPath = path.join(folder, `${safeUuid}.eml`);
    const writable = fs.createWriteStream(spoolPath);

    writable.on('error', (error) => {
      connection.logerror(this, `queue email stream failed: ${error.stack || error.message}`);
      return next(DENYSOFT, 'Temporary queue error');
    });

    writable.on('finish', async () => {
      try {
        const recipients = transaction.notes.valid_recipients || transaction.rcpt_to.map((rcpt) => rcpt.address().toLowerCase());

        const queueId = await getRedis().xadd(
          queueStream,
          'MAXLEN',
          '~',
          queueMaxLength,
          '*',
          'spool_path',
          spoolPath,
          'recipients',
          JSON.stringify(recipients),
          'received_at',
          String(Date.now())
        );

        connection.loginfo(this, `queued email id=${queueId} recipients=${recipients.length}`);
        return next(OK, 'Message Queued');
      } catch (error) {
        connection.logerror(this, `queue email failed: ${error.stack || error.message}`);
        return next(DENYSOFT, 'Temporary queue error');
      }
    });

    transaction.message_stream.pipe(writable);
  } catch (error) {
    connection.logerror(this, `queue email failed: ${error.stack || error.message}`);
    return next(DENYSOFT, 'Temporary queue error');
  }
};
