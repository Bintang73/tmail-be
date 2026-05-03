import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import dotenv from 'dotenv';
import { writeHarakaSmtpConfig } from './utils/harakaConfig.js';

dotenv.config();

const processes = [];
const redisHost = process.env.REDIS_HOST || '127.0.0.1';
const redisPort = Number.parseInt(process.env.REDIS_PORT || '6379', 10);
const redisContainerName = process.env.REDIS_CONTAINER_NAME || 'tmail-redis-dev';
const harakaBin = path.join(process.cwd(), 'node_modules/.bin/haraka');

const run = (name, command, args, options = {}) => {
  const child = spawn(command, args, {
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: process.env.NODE_ENV || 'development',
      ...options.env
    },
    shell: false
  });

  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    if (options.fatal === false) return;
    console.error(`[dev] ${name} exited`, { code, signal });
    shutdown(code || 1);
  });

  processes.push(child);
  return child;
};

let shuttingDown = false;

const shutdown = (code = 0) => {
  shuttingDown = true;
  for (const child of processes) {
    if (!child.killed) child.kill('SIGTERM');
  }
  process.exit(code);
};

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

const canConnect = (host, port) =>
  new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    socket.setTimeout(500);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
  });

const commandExists = (command) =>
  new Promise((resolve) => {
    const child = spawn(command, ['--version'], { stdio: 'ignore' });
    child.once('error', () => resolve(false));
    child.once('exit', (code) => resolve(code === 0));
  });

const commandSucceeds = (command, args) =>
  new Promise((resolve) => {
    const child = spawn(command, args, { stdio: 'ignore' });
    child.once('error', () => resolve(false));
    child.once('exit', (code) => resolve(code === 0));
  });

if (!(await canConnect(redisHost, redisPort))) {
  if (await commandExists('redis-server')) {
    run('redis', 'redis-server', ['--port', String(redisPort), '--save', '', '--appendonly', 'no']);
    await new Promise((resolve) => setTimeout(resolve, 600));
  } else if (await commandExists('docker')) {
    if (!(await commandSucceeds('docker', ['info']))) {
      console.error(`[dev] Redis is not running at ${redisHost}:${redisPort}.`);
      console.error('[dev] Docker is installed but the Docker daemon is not running.');
      console.error('[dev] Start Docker Desktop or install Redis with `brew install redis`, then run `bun dev` again.');
      process.exit(1);
    }

    run('redis', 'docker', [
      'run',
      '--rm',
      '--name',
      redisContainerName,
      '-p',
      `${redisPort}:6379`,
      'redis:7-alpine'
    ], { fatal: false });
    await new Promise((resolve) => setTimeout(resolve, 1500));
  } else {
    console.error(`[dev] Redis is not running at ${redisHost}:${redisPort}.`);
    console.error('[dev] Install Redis or Docker first, then run `bun dev` again. macOS: `brew install redis`.');
    process.exit(1);
  }

  if (!(await canConnect(redisHost, redisPort))) {
    console.error(`[dev] Redis did not become ready at ${redisHost}:${redisPort}.`);
    console.error('[dev] If Docker is pulling redis:7-alpine for the first time, wait for it to finish and run `bun dev` again.');
    shutdown(1);
  }
}

const harakaSmtp = await writeHarakaSmtpConfig();

run('api', 'bun', ['--watch', 'src/app.js']);
run('cleanup', 'bun', ['src/workers/cleanup.js']);
run('haraka', harakaBin, ['-c', 'haraka']);

console.info(`[dev] running redis, api, cleanup worker, and haraka smtp:${harakaSmtp.port}`);
