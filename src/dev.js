import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import dotenv from 'dotenv';
import { getCloudflareTunnelArgs } from './utils/cloudflareTunnel.js';
import { writeHarakaSmtpConfig } from './utils/harakaConfig.js';

dotenv.config();

const processes = [];
const redisHost = process.env.REDIS_HOST || '127.0.0.1';
const redisPort = Number.parseInt(process.env.REDIS_PORT || '6379', 10);
const redisPassword = process.env.REDIS_PASSWORD || 'd0535500cb173f97';
const redisContainerName = process.env.REDIS_CONTAINER_NAME || 'tmail-redis-dev';
const harakaBin = path.join(process.cwd(), 'node_modules/.bin/haraka');
const cloudflareTunnelEnabled = process.env.CLOUDFLARE_TUNNEL_ENABLED === 'true';

const run = (name, command, args, options = {}) => {
  const child = spawn(command, args, {
    stdio: options.detached ? 'ignore' : 'inherit',
    env: {
      ...process.env,
      NODE_ENV: process.env.NODE_ENV || 'development',
      ...options.env
    },
    detached: Boolean(options.detached),
    shell: false
  });

  if (options.detached) {
    child.unref();
  }

  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    if (options.fatal === false) return;
    console.error(`[dev] ${name} exited`, { code, signal });
    shutdown(code || 1);
  });

  processes.push({
    child,
    preserveOnShutdown: Boolean(options.preserveOnShutdown)
  });
  return child;
};

let shuttingDown = false;

const shutdown = (code = 0) => {
  shuttingDown = true;
  for (const { child, preserveOnShutdown } of processes) {
    if (preserveOnShutdown) continue;
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

const runOneShot = (command, args) =>
  new Promise((resolve) => {
    const child = spawn(command, args, { stdio: 'ignore' });
    child.once('error', () => resolve(false));
    child.once('exit', (code) => resolve(code === 0));
  });

const ensureDockerRedis = async () => {
  if (await commandSucceeds('docker', ['container', 'inspect', redisContainerName])) {
    return runOneShot('docker', ['start', redisContainerName]);
  }

  return runOneShot('docker', [
    'run',
    '-d',
    '--name',
    redisContainerName,
    '-p',
    `${redisPort}:6379`,
    'redis:7-alpine',
    'redis-server',
    '--requirepass',
    redisPassword,
    '--save',
    '',
    '--appendonly',
    'no'
  ]);
};

if (!(await canConnect(redisHost, redisPort))) {
  if (await commandExists('redis-server')) {
    run('redis', 'redis-server', [
      '--port',
      String(redisPort),
      '--requirepass',
      redisPassword,
      '--save',
      '',
      '--appendonly',
      'no'
    ], { detached: true, fatal: false, preserveOnShutdown: true });
    await new Promise((resolve) => setTimeout(resolve, 600));
  } else if (await commandExists('docker')) {
    if (!(await commandSucceeds('docker', ['info']))) {
      console.error(`[dev] Redis is not running at ${redisHost}:${redisPort}.`);
      console.error('[dev] Docker is installed but the Docker daemon is not running.');
      console.error('[dev] Start Docker Desktop or install Redis with `brew install redis`, then run `bun dev` again.');
      process.exit(1);
    }

    if (!(await ensureDockerRedis())) {
      console.error(`[dev] Failed to start Docker Redis container ${redisContainerName}.`);
      process.exit(1);
    }
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
run('email-queue', 'bun', ['src/workers/emailQueue.js']);
run('haraka', harakaBin, ['-c', 'haraka']);

if (cloudflareTunnelEnabled) {
  if (!(await commandExists('cloudflared'))) {
    console.error('[dev] CLOUDFLARE_TUNNEL_ENABLED=true but `cloudflared` is not installed or not in PATH.');
    shutdown(1);
  }

  run('cloudflared', 'cloudflared', getCloudflareTunnelArgs());
}

console.info(`[dev] running redis, api, workers, and haraka smtp:${harakaSmtp.port}`);
