import { cleanupExpiredEmailFiles } from '../services/fileStorageService.js';
import { config } from '../utils/config.js';

const intervalMs = 60 * 60 * 1000;

const run = async () => {
  try {
    const deleted = await cleanupExpiredEmailFiles();
    console.info('[cleanup] expired email files deleted', { deleted });
  } catch (error) {
    console.error('[cleanup] error', error);
  }
};

console.info('[cleanup] worker started', {
  storage: config.emailStorageDir,
  ttlSeconds: config.emailTtlSeconds
});

await run();
setInterval(run, intervalMs);
