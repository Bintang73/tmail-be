import dns from 'node:dns/promises';
import { config } from '../utils/config.js';
import { isBaseDomain, isValidDomain, normalizeDomain } from '../utils/email.js';
import { getRedis } from '../storage/redis.js';

const activeDomainsKey = 'domains:active';
const publicDomainsKey = 'domains:public';
const privateDomainsKey = 'domains:private';
const domainKey = (domain) => `domain:${normalizeDomain(domain)}`;
const domainApprovedAtKey = (domain) => `domain_approved_at:${normalizeDomain(domain)}`;

const formatDuration = (seconds) => {
  const days = Math.floor(seconds / 86400);
  if (days >= 1) return `${days} day${days === 1 ? '' : 's'}`;

  const hours = Math.floor(seconds / 3600);
  if (hours >= 1) return `${hours} hour${hours === 1 ? '' : 's'}`;

  const minutes = Math.floor(seconds / 60);
  if (minutes >= 1) return `${minutes} minute${minutes === 1 ? '' : 's'}`;

  return `${Math.max(0, seconds)} second${seconds === 1 ? '' : 's'}`;
};

const getApprovalStatus = async (domain, active) => {
  const redis = getRedis();
  const key = domainApprovedAtKey(domain);

  if (!active) {
    await redis.del(key);
    return {
      approved: false,
      approved_at: null,
      uptime_seconds: 0,
      uptime_days: 0,
      uptime_label: null,
      status_label: 'Domain inactive'
    };
  }

  const now = Date.now();
  await redis.set(key, String(now), 'NX');

  const approvedAt = Number(await redis.get(key)) || now;
  const uptimeSeconds = Math.max(0, Math.floor((now - approvedAt) / 1000));
  const uptimeDays = Math.floor(uptimeSeconds / 86400);
  const uptimeLabel = formatDuration(uptimeSeconds);

  return {
    approved: true,
    approved_at: approvedAt,
    uptime_seconds: uptimeSeconds,
    uptime_days: uptimeDays,
    uptime_label: uptimeLabel,
    status_label: `Domain approved (uptime ${uptimeLabel})`
  };
};

const hasRequiredMx = async (domain) => {
  if (isBaseDomain(domain)) return true;

  const records = await dns.resolveMx(domain);
  return records.some((record) => {
    const exchange = String(record.exchange || '').toLowerCase().replace(/\.$/, '');
    return exchange === config.requiredMxHost;
  });
};

export const checkDomainMx = async (domain) => {
  const normalized = normalizeDomain(domain);
  if (!isValidDomain(normalized)) {
    const error = new Error('Invalid domain');
    error.statusCode = 400;
    throw error;
  }

  if (isBaseDomain(normalized)) {
    return {
      valid: true,
      records: [],
      required_mx: config.requiredMxHost,
      reason: 'base_domain'
    };
  }

  let records = [];
  try {
    records = await dns.resolveMx(normalized);
  } catch (error) {
    return {
      valid: false,
      records: [],
      required_mx: config.requiredMxHost,
      reason: 'mx_lookup_failed'
    };
  }

  const normalizedRecords = records.map((record) => ({
    exchange: String(record.exchange || '').toLowerCase().replace(/\.$/, ''),
    priority: record.priority
  }));

  return {
    valid: normalizedRecords.some((record) => record.exchange === config.requiredMxHost),
    records: normalizedRecords,
    required_mx: config.requiredMxHost,
    reason: 'dns_mx'
  };
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

export const getDomainStatus = async (domain) => {
  const normalized = normalizeDomain(domain);
  if (!isValidDomain(normalized)) {
    const error = new Error('Invalid domain');
    error.statusCode = 400;
    throw error;
  }

  const registered = await getRegisteredDomain(normalized);
  const registeredActive = await isRegisteredDomainActive(normalized);
  const mx = await checkDomainMx(normalized);
  const active = isBaseDomain(normalized) || registeredActive || mx.valid;
  const approval = await getApprovalStatus(normalized, active);

  return {
    domain: normalized,
    active,
    ...approval,
    registered: Boolean(registered),
    visibility: registered?.visibility || (isBaseDomain(normalized) ? 'public' : null),
    built_in: isBaseDomain(normalized),
    mx_valid: mx.valid,
    mx_records: mx.records,
    required_mx: mx.required_mx,
    active_reason: isBaseDomain(normalized)
      ? 'base_domain'
      : registeredActive
        ? 'registered_domain'
        : mx.valid
          ? 'mx_points_to_required_host'
          : 'inactive',
    created_at: registered?.created_at || (isBaseDomain(normalized) ? 0 : null),
    updated_at: registered?.updated_at || (isBaseDomain(normalized) ? 0 : null)
  };
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
