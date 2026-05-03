import dns from 'node:dns/promises';
import { config } from '../utils/config.js';
import { isBaseDomain, isValidDomain, normalizeDomain } from '../utils/email.js';
import { getRedis } from '../storage/redis.js';

const activeDomainsKey = 'domains:active';
const publicDomainsKey = 'domains:public';
const privateDomainsKey = 'domains:private';
const domainKey = (domain) => `domain:${normalizeDomain(domain)}`;

const hasRequiredMx = async (domain) => {
  if (isBaseDomain(domain)) return true;

  const records = await dns.resolveMx(domain);
  return records.some((record) => {
    const exchange = String(record.exchange || '').toLowerCase().replace(/\.$/, '');
    return exchange === config.requiredMxHost;
  });
};

export const getRegisteredDomain = async (domain) => {
  const normalized = normalizeDomain(domain);
  if (!isValidDomain(normalized)) return null;

  const row = await getRedis().hgetall(domainKey(normalized));
  if (!row?.domain) return null;

  return {
    domain: row.domain,
    visibility: row.visibility,
    created_at: Number(row.created_at || 0),
    updated_at: Number(row.updated_at || row.created_at || 0)
  };
};

export const isRegisteredDomainActive = async (domain) => {
  const normalized = normalizeDomain(domain);
  if (!isValidDomain(normalized)) return false;

  const redis = getRedis();
  if ((await redis.sismember(activeDomainsKey, normalized)) === 1) return true;

  const parts = normalized.split('.');
  for (let index = 1; index < parts.length - 1; index += 1) {
    const parent = parts.slice(index).join('.');
    if ((await redis.sismember(activeDomainsKey, parent)) === 1) return true;
  }

  return false;
};

export const addDomain = async ({ domain, visibility = 'public', verifyMx = true }) => {
  const normalized = normalizeDomain(domain);
  if (!isValidDomain(normalized)) {
    const error = new Error('Invalid domain');
    error.statusCode = 400;
    throw error;
  }

  if (!['public', 'private'].includes(visibility)) {
    const error = new Error('visibility must be public or private');
    error.statusCode = 400;
    throw error;
  }

  if (verifyMx) {
    let validMx = false;
    try {
      validMx = await hasRequiredMx(normalized);
    } catch (error) {
      validMx = false;
    }

    if (!validMx) {
      const error = new Error(`Domain MX must point to ${config.requiredMxHost}`);
      error.statusCode = 422;
      throw error;
    }
  }

  const now = Date.now();
  const existing = await getRegisteredDomain(normalized);
  const redis = getRedis();

  await redis
    .multi()
    .hmset(domainKey(normalized), {
      domain: normalized,
      visibility,
      created_at: existing?.created_at || now,
      updated_at: now
    })
    .sadd(activeDomainsKey, normalized)
    .srem(visibility === 'public' ? privateDomainsKey : publicDomainsKey, normalized)
    .sadd(visibility === 'public' ? publicDomainsKey : privateDomainsKey, normalized)
    .del(`domain_mx:${normalized}`)
    .exec();

  return getRegisteredDomain(normalized);
};

export const removeDomain = async (domain) => {
  const normalized = normalizeDomain(domain);
  if (!isValidDomain(normalized)) {
    const error = new Error('Invalid domain');
    error.statusCode = 400;
    throw error;
  }

  if (normalized === config.baseDomain) {
    const error = new Error('Built-in base domain cannot be removed');
    error.statusCode = 409;
    throw error;
  }

  const redis = getRedis();
  const existed = await redis.sismember(activeDomainsKey, normalized);

  await redis
    .multi()
    .srem(activeDomainsKey, normalized)
    .srem(publicDomainsKey, normalized)
    .srem(privateDomainsKey, normalized)
    .del(domainKey(normalized))
    .del(`domain_mx:${normalized}`)
    .exec();

  return existed === 1;
};

export const listDomains = async ({ includePrivate = false } = {}) => {
  const redis = getRedis();
  const domains = includePrivate ? await redis.smembers(activeDomainsKey) : await redis.smembers(publicDomainsKey);
  if (!domains.includes(config.baseDomain)) {
    domains.push(config.baseDomain);
  }

  const sorted = domains.sort();
  const rows = await Promise.all(sorted.map((domain) => getRegisteredDomain(domain)));
  return rows
    .map((row, index) => {
      if (row) return row;
      const domain = sorted[index];
      if (domain !== config.baseDomain) return null;
      return {
        domain: config.baseDomain,
        visibility: 'public',
        created_at: 0,
        updated_at: 0,
        built_in: true
      };
    })
    .filter(Boolean);
};

export const getPublicDomainForGenerate = async (requestedDomain) => {
  const normalized = normalizeDomain(requestedDomain);
  if (requestedDomain) {
    const row = await getRegisteredDomain(normalized);
    if (!row || row.visibility !== 'public') {
      const error = new Error('Domain is not available for public generation');
      error.statusCode = 404;
      throw error;
    }
    return row.domain;
  }

  let publicDomains = [];
  try {
    publicDomains = await listDomains({ includePrivate: false });
  } catch (error) {
    return config.baseDomain;
  }

  return publicDomains[0]?.domain || config.baseDomain;
};
