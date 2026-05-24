import { readEmailFileById } from '../services/fileStorageService.js';
import { getDomainStatus, getPublicDomainForGenerate, listDomains } from '../services/domainService.js';
import { getInboxMessages } from '../services/inboxService.js';
import { listIncomingDomains } from '../services/incomingDomainService.js';
import { deleteInboxEverywhere, deleteMessageEverywhere } from '../services/messageDeleteService.js';
import { getRedis } from '../storage/redis.js';
import { generateRandomEmail, isValidDomain, isValidEmail, normalizeDomain, normalizeEmail } from '../utils/email.js';

export const generate = async (req, res, next) => {
  try {
    const domain = await getPublicDomainForGenerate(req.query.domain);
    res.json({ email: generateRandomEmail(domain), domain });
  } catch (error) {
    return next(error);
  }
};

export const inbox = async (req, res, next) => {
  try {
    const email = normalizeEmail(req.query.email);
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Invalid email' });
    }

    const messages = await getInboxMessages(email);
    return res.json({ email, messages });
  } catch (error) {
    return next(error);
  }
};

export const messageById = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      return res.status(400).json({ error: 'Invalid message id' });
    }

    const message = await readEmailFileById(id);
    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    return res.json({
      ...message,
      is_otp: Boolean(message.is_otp),
      otp: message.is_otp ? message.otp || null : null
    });
  } catch (error) {
    return next(error);
  }
};

export const deleteMessageById = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      return res.status(400).json({ error: 'Invalid message id' });
    }

    const result = await deleteMessageEverywhere(id);
    return res.status(result.deleted ? 200 : 404).json(result);
  } catch (error) {
    return next(error);
  }
};

export const deleteInbox = async (req, res, next) => {
  try {
    const email = normalizeEmail(req.query.email);
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Invalid email' });
    }

    const result = await deleteInboxEverywhere(email);
    return res.json(result);
  } catch (error) {
    return next(error);
  }
};

export const publicDomains = async (req, res, next) => {
  try {
    const domains = await listDomains({ includePrivate: false });
    return res.json({ domains });
  } catch (error) {
    return next(error);
  }
};

export const incomingDomains = async (req, res, next) => {
  try {
    const result = await listIncomingDomains({
      page: req.query.page,
      limit: req.query.limit
    });

    return res.json(result);
  } catch (error) {
    return next(error);
  }
};

export const domainStatus = async (req, res, next) => {
  try {
    const domain = normalizeDomain(req.query.domain || req.params.domain);
    if (!isValidDomain(domain)) {
      return res.status(400).json({ error: 'Invalid domain' });
    }

    const status = await getDomainStatus(domain);
    return res.json(status);
  } catch (error) {
    return next(error);
  }
};

export const health = async (req, res) => {
  let redis = 'ok';
  try {
    await getRedis().ping();
  } catch (error) {
    redis = 'error';
  }

  res.status(redis === 'ok' ? 200 : 503).json({
    api: 'ok',
    redis,
    smtp: 'ok'
  });
};
