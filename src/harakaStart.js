import { spawn } from 'node:child_process';
import path from 'node:path';
import dotenv from 'dotenv';
import { writeHarakaSmtpConfig } from './utils/harakaConfig.js';

dotenv.config();

const smtp = await writeHarakaSmtpConfig();
console.info(`[haraka] smtp port ${smtp.port}`);

const harakaBin = path.join(process.cwd(), 'node_modules/.bin/haraka');
const child = spawn(harakaBin, ['-c', 'haraka'], {
  stdio: 'inherit',
  env: process.env
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code || 0);
});
