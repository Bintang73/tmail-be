import { config } from '../utils/config.js';
import { getRedis } from '../storage/redis.js';

export const emailQueueStream = process.env.EMAIL_QUEUE_STREAM || 'email_queue';
export const emailQueueGroup = process.env.EMAIL_QUEUE_GROUP || 'email_processors';
export const emailQueueConsumer = process.env.EMAIL_QUEUE_CONSUMER || `consumer-${process.pid}`;

export const ensureEmailQueueGroup = async () => {
  const redis = getRedis();

  try {
    await redis.xgroup('CREATE', emailQueueStream, emailQueueGroup, '0', 'MKSTREAM');
  } catch (error) {
    if (!String(error.message || '').includes('BUSYGROUP')) {
      throw error;
    }
  }
};

export const readEmailQueueBatch = async ({ blockMs = 5000, count = config.emailQueueBatchSize } = {}) => {
  const redis = getRedis();
  const result = await redis.xreadgroup(
    'GROUP',
    emailQueueGroup,
    emailQueueConsumer,
    'COUNT',
    count,
    'BLOCK',
    blockMs,
    'STREAMS',
    emailQueueStream,
    '>'
  );

  return result?.[0]?.[1] || [];
};

export const ackEmailQueueMessage = async (id) => {
  await getRedis().xack(emailQueueStream, emailQueueGroup, id);
};

export const deleteEmailQueueMessage = async (id) => {
  await getRedis().xdel(emailQueueStream, id);
};

export const decodeEmailQueueFields = (fields) => {
  const row = {};
  for (let index = 0; index < fields.length; index += 2) {
    row[fields[index]] = fields[index + 1];
  }

  return {
    spoolPath: row.spool_path || '',
    raw: row.raw_base64 ? Buffer.from(row.raw_base64, 'base64') : null,
    recipients: JSON.parse(row.recipients || '[]'),
    receivedAt: Number(row.received_at || 0)
  };
};
