import { checkDomainMx } from './domainService.js';
import { getRedis } from '../storage/redis.js';
import { getDomainFromEmail, isValidDomain, normalizeDomain, normalizeEmail } from '../utils/email.js';

const incomingDomainsKey = 'domains:incoming:mx_valid';
const checkedMxDomainsKey = 'domains:checked:mx_valid';
const incomingDomainCountKey = (domain) => `domain_incoming_count:${normalizeDomain(domain)}`;

const buildIncomingDomainRows = async (domainsWithScores, source = null) => {
  const redis = getRedis();
  const rows = [];

  for (let index = 0; index < domainsWithScores.length; index += 2) {
    const domain = domainsWithScores[index];
    const row = {
      domain,
      last_seen_at: Number(domainsWithScores[index + 1] || 0),
      total_messages: Number(await redis.get(incomingDomainCountKey(domain))) || 0,
      mx_valid: true
    };

    if (source) {
      row.source = source;
    }

    rows.push(row);
  }

  return rows;
};

const getMxConnectedDomains = async (domains) => {
  const connected = [];

  for (const domain of domains) {
    try {
      const mx = await checkDomainMx(domain);
      if (mx.valid) connected.push(domain);
    } catch (error) {
      // Invalid or unresolvable domains are intentionally skipped.
    }
  }

  return connected;
};

export const trackIncomingDomains = async (emails = []) => {
  const domains = [
    ...new Set(
      emails
        .map(normalizeEmail)
        .map(getDomainFromEmail)
        .map(normalizeDomain)
        .filter(isValidDomain)
    )
  ];

  if (!domains.length) return [];

  const connectedDomains = await getMxConnectedDomains(domains);
  if (!connectedDomains.length) return [];

  const redis = getRedis();
  const now = Date.now();
  const multi = redis.multi();

  for (const domain of connectedDomains) {
    multi.zadd(incomingDomainsKey, now, domain);
    multi.incr(incomingDomainCountKey(domain));
  }

  await multi.exec();
  return connectedDomains;
};

export const trackCheckedMxDomain = async (domain) => {
  const normalized = normalizeDomain(domain);
  if (!isValidDomain(normalized)) return null;

  await getRedis().zadd(checkedMxDomainsKey, Date.now(), normalized);
  return normalized;
};

export const listIncomingDomains = async ({ page = 1, limit = 20 } = {}) => {
  const safePage = Math.max(1, Number.parseInt(page, 10) || 1);
  const safeLimit = Math.min(20, Math.max(1, Number.parseInt(limit, 10) || 20));
  const offset = (safePage - 1) * safeLimit;
  const redis = getRedis();

  const [total, domains] = await Promise.all([
    redis.zcard(incomingDomainsKey),
    redis.zrevrange(incomingDomainsKey, offset, offset + safeLimit - 1, 'WITHSCORES')
  ]);

  const rows = await buildIncomingDomainRows(domains);

  const totalPages = Math.max(1, Math.ceil(total / safeLimit));

  return {
    page: safePage,
    limit: safeLimit,
    total_domains: total,
    total_pages: totalPages,
    last_page: totalPages,
    domains: rows
  };
};

export const listRandomAvailableDomains = async ({ limit = 10 } = {}) => {
  const safeLimit = Math.min(10, Math.max(1, Number.parseInt(limit, 10) || 10));
  const redis = getRedis();
  const [incomingDomains, checkedDomains] = await Promise.all([
    redis.zrange(incomingDomainsKey, 0, -1, 'WITHSCORES'),
    redis.zrange(checkedMxDomainsKey, 0, -1, 'WITHSCORES')
  ]);
  const rowsByDomain = new Map();
  const incomingRows = await buildIncomingDomainRows(incomingDomains, 'incoming');
  const checkedRows = await buildIncomingDomainRows(checkedDomains, 'mx_status');

  for (const row of incomingRows) {
    rowsByDomain.set(row.domain, row);
  }

  for (const row of checkedRows) {
    if (!rowsByDomain.has(row.domain)) {
      rowsByDomain.set(row.domain, row);
    }
  }

  const rows = [...rowsByDomain.values()];

  for (let index = rows.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [rows[index], rows[randomIndex]] = [rows[randomIndex], rows[index]];
  }

  return {
    limit: safeLimit,
    total_domains: rows.length,
    domains: rows.slice(0, safeLimit)
  };
};
