import dns from 'node:dns/promises';
import { config } from '../utils/config.js';
import { isBaseDomain, normalizeDomain } from '../utils/email.js';
import { getRedis } from '../storage/redis.js';
import { isRegisteredDomainActive } from './domainService.js';

const cacheKey = (domain) => `domain_mx:${domain}`;

export const validateDomainMx = async (domain) => {
  const normalized = normalizeDomain(domain);
  if (!normalized) return false;
  if (isBaseDomain(normalized)) return true;
  if (await isRegisteredDomainActive(normalized)) return true;

  const redis = getRedis();
  const key = cacheKey(normalized);
  const cached = await redis.get(key);
  if (cached) return cached === 'valid';

  let valid = false;
  try {
    const records = await dns.resolveMx(normalized);
    valid = records.some((record) => {
      const exchange = String(record.exchange || '').toLowerCase().replace(/\.$/, '');
      return exchange === config.requiredMxHost;
    });
  } catch (error) {
    valid = false;
  }

  await redis.set(key, valid ? 'valid' : 'invalid', 'EX', config.domainMxCacheTtlSeconds);
  return valid;
};
