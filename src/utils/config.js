import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config();

const toInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const rootDir = process.cwd();

export const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: toInt(process.env.PORT, 3000),
  baseDomain: (process.env.BASE_DOMAIN || 'thvuinin.my.id').toLowerCase(),
  requiredMxHost: (process.env.REQUIRED_MX_HOST || 'mx.thvuinin.my.id').toLowerCase(),
  redisHost: process.env.REDIS_HOST || '127.0.0.1',
  redisPort: toInt(process.env.REDIS_PORT, 6379),
  redisPassword: process.env.REDIS_PASSWORD || 'd0535500cb173f97',
  redisUrl: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
  emailStorageDir: path.resolve(rootDir, process.env.EMAIL_STORAGE_DIR || './emails'),
  emailSpoolDir: path.resolve(rootDir, process.env.EMAIL_SPOOL_DIR || './spool/emails'),
  emailTtlSeconds: toInt(process.env.EMAIL_TTL_SECONDS, 86400),
  inboxMaxMessages: toInt(process.env.INBOX_MAX_MESSAGES, 20),
  inboxDailyLimit: toInt(process.env.INBOX_DAILY_LIMIT, 50),
  emailQueueBatchSize: toInt(process.env.EMAIL_QUEUE_BATCH_SIZE, 10),
  domainMxCacheTtlSeconds: toInt(process.env.DOMAIN_MX_CACHE_TTL_SECONDS, 300),
  apiRateLimitWindowMs: toInt(process.env.API_RATE_LIMIT_WINDOW_MS, 60000),
  apiRateLimitMax: toInt(process.env.API_RATE_LIMIT_MAX, 120),
  adminToken: process.env.ADMIN_TOKEN || '',
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  openaiModel: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
  otpAiEnabled: process.env.OTP_AI_ENABLED === 'true',
  otpTemplateCacheTtlSeconds: toInt(process.env.OTP_TEMPLATE_CACHE_TTL_SECONDS, 30 * 24 * 60 * 60),
  otpAiMaxBodyChars: toInt(process.env.OTP_AI_MAX_BODY_CHARS, 3000),
  otpAiDailyLimit: toInt(process.env.OTP_AI_DAILY_LIMIT, 500),
  wsEnabled: process.env.WS_ENABLED !== 'false'
};
