import { config } from '../utils/config.js';
import { getDomainFromEmail, normalizeDomain, normalizeEmail } from '../utils/email.js';
import { getRedis } from '../storage/redis.js';

const inboxKey = (email) => `inbox:${normalizeEmail(email)}`;
const messageRecipientsKey = (id) => `message_recipients:${id}`;
const activeInboxesKey = 'inboxes:active';
const domainInboxesKey = (domain) => `domain_inboxes:${normalizeDomain(domain)}`;
const dailyLimitKey = (email) => {
  const date = new Date().toISOString().slice(0, 10);
  return `inbox_limit:${date}:${normalizeEmail(email)}`;
};

export const canAcceptInboxMessage = async (email) => {
  const redis = getRedis();
  const key = dailyLimitKey(email);
  const count = await redis.incr(key);

  if (count === 1) {
    await redis.expire(key, config.emailTtlSeconds);
  }

  return count <= config.inboxDailyLimit;
};

export const addInboxMessage = async (email, message) => {
  const redis = getRedis();
  const normalizedEmail = normalizeEmail(email);
  const domain = getDomainFromEmail(normalizedEmail);
  const key = inboxKey(email);

  await redis
    .multi()
    .lpush(key, JSON.stringify(message))
    .ltrim(key, 0, config.inboxMaxMessages - 1)
    .expire(key, config.emailTtlSeconds)
    .sadd(activeInboxesKey, normalizedEmail)
    .sadd(domainInboxesKey(domain), normalizedEmail)
    .sadd(messageRecipientsKey(message.id), normalizedEmail)
    .expire(messageRecipientsKey(message.id), config.emailTtlSeconds)
    .exec();
};

export const getInboxMessages = async (email) => {
  const redis = getRedis();
  const rows = await redis.lrange(inboxKey(email), 0, config.inboxMaxMessages - 1);
  return rows.map((row) => JSON.parse(row));
};

export const removeMessageFromInbox = async (email, messageId) => {
  const redis = getRedis();
  const key = inboxKey(email);
  const rows = await redis.lrange(key, 0, -1);
  const toRemove = rows.filter((row) => {
    try {
      return JSON.parse(row).id === messageId;
    } catch (error) {
      return false;
    }
  });

  if (!toRemove.length) return 0;

  const multi = redis.multi();
  for (const row of toRemove) {
    multi.lrem(key, 0, row);
  }
  await multi.exec();
  return toRemove.length;
};

export const getMessageRecipients = async (messageId) => {
  return getRedis().smembers(messageRecipientsKey(messageId));
};

export const deleteMessageRecipientIndex = async (messageId) => {
  await getRedis().del(messageRecipientsKey(messageId));
};

export const deleteMessageFromKnownInboxes = async (messageId, fallbackRecipients = []) => {
  const recipients = new Set([...(await getMessageRecipients(messageId)), ...fallbackRecipients.map(normalizeEmail)]);
  let removed = 0;

  for (const email of recipients) {
    removed += await removeMessageFromInbox(email, messageId);
  }

  await deleteMessageRecipientIndex(messageId);
  return { removed, recipients: [...recipients] };
};

export const deleteInboxMessages = async (email) => {
  const redis = getRedis();
  const normalizedEmail = normalizeEmail(email);
  const rows = await redis.lrange(inboxKey(normalizedEmail), 0, -1);
  const messageIds = rows
    .map((row) => {
      try {
        return JSON.parse(row).id;
      } catch (error) {
        return null;
      }
    })
    .filter(Boolean);

  await redis.del(inboxKey(normalizedEmail));
  return [...new Set(messageIds)];
};

export const getDomainInboxes = async (domain) => {
  return getRedis().smembers(domainInboxesKey(domain));
};

export const deleteDomainInboxIndex = async (domain) => {
  await getRedis().del(domainInboxesKey(domain));
};
