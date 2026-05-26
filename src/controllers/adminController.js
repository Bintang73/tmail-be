import { addDomain, getDomainStatus, listDomains, removeDomain } from '../services/domainService.js';
import { trackCheckedMxDomain } from '../services/incomingDomainService.js';
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
    const status = await getDomainStatus(created.domain);
    if (status.mx_valid) {
      await trackCheckedMxDomain(status.domain);
    }
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

export const adminDomainStatus = async (req, res, next) => {
  try {
    const domain = normalizeDomain(req.params.domain || req.query.domain);
    if (!isValidDomain(domain)) {
      return res.status(400).json({ error: 'Invalid domain' });
    }

    const status = await getDomainStatus(domain);
    if (status.mx_valid) {
      await trackCheckedMxDomain(status.domain);
    }
    return res.json(status);
  } catch (error) {
    return handleError(error, res, next);
  }
};
