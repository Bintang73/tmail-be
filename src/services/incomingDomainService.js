import { checkDomainMx } from './domainService.js';
import { getRedis } from '../storage/redis.js';
import { getDomainFromEmail, isValidDomain, normalizeDomain, normalizeEmail } from '../utils/email.js';

const incomingDomainsKey = 'domains:incoming:mx_valid';
const incomingDomainCountKey = (domain) => `domain_incoming_count:${normalizeDomain(domain)}`;

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

export const listIncomingDomains = async ({ page = 1, limit = 20 } = {}) => {
  const safePage = Math.max(1, Number.parseInt(page, 10) || 1);
  const safeLimit = Math.min(20, Math.max(1, Number.parseInt(limit, 10) || 20));
  const offset = (safePage - 1) * safeLimit;
  const redis = getRedis();

  const [total, domains] = await Promise.all([
    redis.zcard(incomingDomainsKey),
    redis.zrevrange(incomingDomainsKey, offset, offset + safeLimit - 1, 'WITHSCORES')
  ]);

  const rows = [];
  for (let index = 0; index < domains.length; index += 2) {
    const domain = domains[index];
    rows.push({
      domain,
      last_seen_at: Number(domains[index + 1] || 0),
      total_messages: Number(await redis.get(incomingDomainCountKey(domain))) || 0,
      mx_valid: true
    });
  }

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
