import Redis from 'ioredis';
import { config } from '../utils/config.js';

let redis;
let lastErrorLogAt = 0;

const redisOptions = {
  maxRetriesPerRequest: 1,
  enableReadyCheck: true,
  lazyConnect: true,
  retryStrategy(times) {
    if (times > 10) return null;
    return Math.min(times * 250, 2000);
  },
  reconnectOnError() {
    return false;
  }
};

const logRedisError = (error) => {
  const now = Date.now();
  if (now - lastErrorLogAt < 5000) return;
  lastErrorLogAt = now;
  console.error('[redis] error', error.message);
};

export const getRedis = () => {
  if (!redis) {
    redis = new Redis(config.redisUrl, redisOptions);
    redis.on('error', logRedisError);
  }

  return redis;
};

export const createRedisClient = () => {
  const client = new Redis(config.redisUrl, redisOptions);
  client.on('error', logRedisError);
  return client;
};

export const assertRedisReady = async () => {
  const client = getRedis();
  if (client.status === 'wait') {
    await client.connect();
  }
  await client.ping();
};

export const closeRedis = async () => {
  if (redis) {
    await redis.quit();
    redis = undefined;
  }
};
