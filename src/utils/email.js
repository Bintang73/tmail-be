import { randomBytes } from 'node:crypto';
import { config } from './config.js';

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

export const isValidEmail = (email) => {
  const normalized = normalizeEmail(email);
  return normalized.length <= 254 && emailRegex.test(normalized);
};

export const getDomainFromEmail = (email) => {
  const normalized = normalizeEmail(email);
  const atIndex = normalized.lastIndexOf('@');
  return atIndex === -1 ? '' : normalized.slice(atIndex + 1);
};

export const normalizeDomain = (domain) => String(domain || '').trim().toLowerCase().replace(/\.$/, '');

export const isValidDomain = (domain) => {
  const normalized = normalizeDomain(domain);
  if (normalized.length < 3 || normalized.length > 253) return false;
  if (normalized.includes('..')) return false;
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(normalized);
};

export const isBaseDomain = (domain) => {
  const normalized = normalizeDomain(domain);
  return normalized === config.baseDomain || normalized.endsWith(`.${config.baseDomain}`);
};

export const generateRandomEmail = (domain = config.baseDomain) => {
  const localPart = randomBytes(5).toString('hex');
  return `${localPart}@${normalizeDomain(domain)}`;
};
