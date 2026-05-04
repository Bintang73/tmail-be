import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../utils/config.js';
import { getRedis } from '../storage/redis.js';

const dateFolder = (date = new Date()) => date.toISOString().slice(0, 10);
const messageFileKey = (id) => `message_file:${id}`;

const messageFolder = (message) => {
  const first = message.id.slice(0, 2);
  const second = message.id.slice(2, 4);
  return path.join(config.emailStorageDir, dateFolder(new Date(message.created_at)), first, second);
};

const removeEmptyParents = async (folderPath) => {
  let current = folderPath;
  const root = path.resolve(config.emailStorageDir);

  while (current.startsWith(root) && current !== root) {
    const remaining = await fs.readdir(current).catch(() => []);
    if (remaining.length > 0) return;
    await fs.rmdir(current).catch(() => {});
    current = path.dirname(current);
  }
};

export const saveEmailFile = async (message) => {
  const folder = messageFolder(message);
  await fs.mkdir(folder, { recursive: true });

  const filePath = path.join(folder, `${message.id}.json`);
  await fs.writeFile(filePath, JSON.stringify(message, null, 2), 'utf8');
  await getRedis().set(messageFileKey(message.id), filePath, 'EX', config.emailTtlSeconds);

  return filePath;
};

export const findEmailFileById = async (id) => {
  const indexedPath = await getRedis().get(messageFileKey(id));
  if (indexedPath) {
    try {
      await fs.access(indexedPath);
      return indexedPath;
    } catch (error) {
      await getRedis().del(messageFileKey(id));
    }
  }

  const folders = await fs.readdir(config.emailStorageDir, { withFileTypes: true }).catch(() => []);

  for (const folder of folders) {
    if (!folder.isDirectory()) continue;

    const found = await findEmailFileInFolder(path.join(config.emailStorageDir, folder.name), id);
    if (found) {
      await getRedis().set(messageFileKey(id), found, 'EX', config.emailTtlSeconds);
      return found;
    }
  }

  return null;
};

const findEmailFileInFolder = async (folderPath, id) => {
  const entries = await fs.readdir(folderPath, { withFileTypes: true }).catch(() => []);

  for (const entry of entries) {
    const entryPath = path.join(folderPath, entry.name);
    if (entry.isFile() && entry.name === `${id}.json`) return entryPath;
    if (entry.isDirectory()) {
      const found = await findEmailFileInFolder(entryPath, id);
      if (found) return found;
    }
  }

  return null;
};

export const readEmailFileById = async (id) => {
  const filePath = await findEmailFileById(id);
  if (!filePath) return null;

  const content = await fs.readFile(filePath, 'utf8');
  return JSON.parse(content);
};

export const deleteEmailFileById = async (id) => {
  const filePath = await findEmailFileById(id);
  if (!filePath) return false;

  await fs.unlink(filePath);
  await getRedis().del(messageFileKey(id));

  const folderPath = path.dirname(filePath);
  await removeEmptyParents(folderPath);

  return true;
};

export const cleanupExpiredEmailFiles = async () => {
  const cutoff = Date.now() - config.emailTtlSeconds * 1000;
  return cleanupExpiredInFolder(config.emailStorageDir, cutoff);
};

const cleanupExpiredInFolder = async (folderPath, cutoff) => {
  const entries = await fs.readdir(folderPath, { withFileTypes: true }).catch(() => []);
  let deleted = 0;

  for (const entry of entries) {
    const entryPath = path.join(folderPath, entry.name);

    if (entry.isDirectory()) {
      deleted += await cleanupExpiredInFolder(entryPath, cutoff);
      const remaining = await fs.readdir(entryPath).catch(() => []);
      if (remaining.length === 0) {
        await fs.rmdir(entryPath).catch(() => {});
      }
      continue;
    }

    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;

    const stat = await fs.stat(entryPath).catch(() => null);
    if (!stat || stat.mtimeMs >= cutoff) continue;

    await fs.unlink(entryPath);
    await getRedis().del(messageFileKey(path.basename(entry.name, '.json'))).catch(() => {});
    deleted += 1;
  }

  return deleted;
};
