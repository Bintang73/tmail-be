import { addDomain, listDomains, removeDomain } from '../services/domainService.js';
import { deleteDomainMessages } from '../services/messageDeleteService.js';
import { isValidDomain, normalizeDomain } from '../utils/email.js';

const handleError = (error, res, next) => {
  if (error.statusCode) {
    return res.status(error.statusCode).json({ error: error.message });
  }

  return next(error);
};

export const adminListDomains = async (req, res, next) => {
  try {
    const domains = await listDomains({ includePrivate: true });
    return res.json({ domains });
  } catch (error) {
    return next(error);
  }
};

export const adminAddDomain = async (req, res, next) => {
  try {
    const domain = normalizeDomain(req.body.domain);
    const visibility = req.body.visibility || req.body.type || 'public';
    const verifyMx = req.body.verify_mx !== false;

    const created = await addDomain({ domain, visibility, verifyMx });
    return res.status(201).json({ domain: created });
  } catch (error) {
    return handleError(error, res, next);
  }
};

export const adminDeleteDomain = async (req, res, next) => {
  try {
    const domain = normalizeDomain(req.params.domain);
    if (!isValidDomain(domain)) {
      return res.status(400).json({ error: 'Invalid domain' });
    }

    const existed = await removeDomain(domain);
    return res.status(existed ? 200 : 404).json({ domain, deleted: existed });
  } catch (error) {
    return handleError(error, res, next);
  }
};

export const adminDeleteDomainMessages = async (req, res, next) => {
  try {
    const domain = normalizeDomain(req.params.domain);
    if (!isValidDomain(domain)) {
      return res.status(400).json({ error: 'Invalid domain' });
    }

    const result = await deleteDomainMessages(domain);
    return res.json(result);
  } catch (error) {
    return next(error);
  }
};
