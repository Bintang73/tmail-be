import net from 'node:net';
import { getRedis } from '../storage/redis.js';

const accessModeKey = 'access_control:mode';
const whitelistKey = 'access_control:ip_whitelist';

export const normalizeClientIp = (ip) => {
  const value = String(ip || '').trim();
  if (!value) return '';
  if (value.startsWith('::ffff:')) return value.slice(7);
  if (value === '::1') return '127.0.0.1';
  return value;
};

export const getAccessControl = async () => {
  const redis = getRedis();
  const [mode, ips] = await Promise.all([redis.get(accessModeKey), redis.smembers(whitelistKey)]);

  return {
    mode: mode === 'whitelist' ? 'whitelist' : 'all',
    whitelist: ips.map(normalizeClientIp).filter(Boolean).sort()
  };
};

export const setAccessMode = async (mode) => {
  const normalizedMode = mode === 'whitelist' ? 'whitelist' : 'all';
  await getRedis().set(accessModeKey, normalizedMode);
  return getAccessControl();
};

export const addWhitelistIp = async (ip) => {
  const normalizedIp = normalizeClientIp(ip);
  if (!net.isIP(normalizedIp)) {
    const error = new Error('Invalid IP');
    error.statusCode = 400;
    throw error;
  }

  await getRedis().sadd(whitelistKey, normalizedIp);
  return getAccessControl();
};

export const removeWhitelistIp = async (ip) => {
  const normalizedIp = normalizeClientIp(ip);
  await getRedis().srem(whitelistKey, normalizedIp);
  return getAccessControl();
};

export const isIpAllowed = async (ip) => {
  const normalizedIp = normalizeClientIp(ip);
  const access = await getAccessControl();
  if (access.mode === 'all') return true;
  return access.whitelist.includes(normalizedIp);
};
