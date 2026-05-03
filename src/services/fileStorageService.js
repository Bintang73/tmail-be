import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../utils/config.js';

const dateFolder = (date = new Date()) => date.toISOString().slice(0, 10);

export const saveEmailFile = async (message) => {
  const folder = path.join(config.emailStorageDir, dateFolder(new Date(message.created_at)));
  await fs.mkdir(folder, { recursive: true });

  const filePath = path.join(folder, `${message.id}.json`);
  await fs.writeFile(filePath, JSON.stringify(message, null, 2), 'utf8');

  return filePath;
};

export const findEmailFileById = async (id) => {
  const folders = await fs.readdir(config.emailStorageDir, { withFileTypes: true }).catch(() => []);

  for (const folder of folders) {
    if (!folder.isDirectory()) continue;

    const filePath = path.join(config.emailStorageDir, folder.name, `${id}.json`);
    try {
      await fs.access(filePath);
      return filePath;
    } catch (error) {
      continue;
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

  const folderPath = path.dirname(filePath);
  const remaining = await fs.readdir(folderPath).catch(() => []);
  if (remaining.length === 0) {
    await fs.rmdir(folderPath).catch(() => {});
  }

  return true;
};

export const cleanupExpiredEmailFiles = async () => {
  const cutoff = Date.now() - config.emailTtlSeconds * 1000;
  const folders = await fs.readdir(config.emailStorageDir, { withFileTypes: true }).catch(() => []);
  let deleted = 0;

  for (const folder of folders) {
    if (!folder.isDirectory()) continue;

    const folderPath = path.join(config.emailStorageDir, folder.name);
    const files = await fs.readdir(folderPath, { withFileTypes: true }).catch(() => []);

    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith('.json')) continue;

      const filePath = path.join(folderPath, file.name);
      const stat = await fs.stat(filePath).catch(() => null);
      if (!stat || stat.mtimeMs >= cutoff) continue;

      await fs.unlink(filePath);
      deleted += 1;
    }

    const remaining = await fs.readdir(folderPath).catch(() => []);
    if (remaining.length === 0) {
      await fs.rmdir(folderPath).catch(() => {});
    }
  }

  return deleted;
};
