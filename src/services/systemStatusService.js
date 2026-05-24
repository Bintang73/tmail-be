import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import { emailQueueGroup, emailQueueStream } from './emailQueueService.js';
import { getRedis } from '../storage/redis.js';
import { config } from '../utils/config.js';
import { getHarakaSmtpEnv } from '../utils/harakaConfig.js';

const bytesToMb = (value) => Math.round((value / 1024 / 1024) * 100) / 100;
const percent = (value) => Math.round(value * 10000) / 100;

const parseRedisInfo = (info) => {
  const parsed = {};
  for (const line of String(info || '').split('\r\n')) {
    if (!line || line.startsWith('#')) continue;
    const separatorIndex = line.indexOf(':');
    if (separatorIndex === -1) continue;
    parsed[line.slice(0, separatorIndex)] = line.slice(separatorIndex + 1);
  }
  return parsed;
};

const cpuSnapshot = () =>
  os.cpus().map((cpu) => {
    const times = cpu.times;
    const idle = times.idle;
    const total = Object.values(times).reduce((sum, time) => sum + time, 0);
    return { idle, total };
  });

const getCpuUsage = async () => {
  const first = cpuSnapshot();
  await new Promise((resolve) => setTimeout(resolve, 120));
  const second = cpuSnapshot();

  const cores = second.map((current, index) => {
    const previous = first[index] || current;
    const idle = current.idle - previous.idle;
    const total = current.total - previous.total;
    const usage = total > 0 ? 1 - idle / total : 0;
    return {
      core: index,
      usage_percent: percent(usage)
    };
  });

  const averageUsage = cores.length
    ? cores.reduce((sum, core) => sum + core.usage_percent, 0) / cores.length
    : 0;

  return {
    cores: os.cpus().length,
    model: os.cpus()[0]?.model || null,
    load_average: os.loadavg(),
    usage_percent: Math.round(averageUsage * 100) / 100,
    per_core: cores
  };
};

const getMemoryUsage = () => {
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;
  const processMemory = process.memoryUsage();

  return {
    system: {
      total_bytes: total,
      used_bytes: used,
      free_bytes: free,
      total_mb: bytesToMb(total),
      used_mb: bytesToMb(used),
      free_mb: bytesToMb(free),
      usage_percent: percent(used / total)
    },
    process: {
      rss_mb: bytesToMb(processMemory.rss),
      heap_total_mb: bytesToMb(processMemory.heapTotal),
      heap_used_mb: bytesToMb(processMemory.heapUsed),
      external_mb: bytesToMb(processMemory.external),
      array_buffers_mb: bytesToMb(processMemory.arrayBuffers || 0)
    }
  };
};

const connectToPort = ({ host, port, timeoutMs = 1500 }) =>
  new Promise((resolve) => {
    const startedAt = Date.now();
    const socket = net.createConnection({ host, port });
    let settled = false;

    const finish = (online, error = null) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({
        online,
        latency_ms: Date.now() - startedAt,
        error: error?.message || null
      });
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false, new Error('Connection timeout')));
    socket.once('error', (error) => finish(false, error));
  });

const getRedisStatus = async () => {
  const redis = getRedis();
  const startedAt = Date.now();

  try {
    const pong = await redis.ping();
    const latencyMs = Date.now() - startedAt;
    const [serverInfo, memoryInfo, clientsInfo, streamInfo, groupInfo] = await Promise.all([
      redis.info('server').catch(() => ''),
      redis.info('memory').catch(() => ''),
      redis.info('clients').catch(() => ''),
      redis.xinfo('STREAM', emailQueueStream).catch(() => null),
      redis.xinfo('GROUPS', emailQueueStream).catch(() => [])
    ]);

    const server = parseRedisInfo(serverInfo);
    const memory = parseRedisInfo(memoryInfo);
    const clients = parseRedisInfo(clientsInfo);
    const queue = Array.isArray(streamInfo)
      ? Object.fromEntries(streamInfo.reduce((rows, value, index) => {
          if (index % 2 === 0) rows.push([value, streamInfo[index + 1]]);
          return rows;
        }, []))
      : {};

    return {
      online: pong === 'PONG',
      latency_ms: latencyMs,
      uptime_seconds: Number(server.uptime_in_seconds || 0),
      version: server.redis_version || null,
      connected_clients: Number(clients.connected_clients || 0),
      used_memory_human: memory.used_memory_human || null,
      used_memory_peak_human: memory.used_memory_peak_human || null,
      queue: {
        stream: emailQueueStream,
        group: emailQueueGroup,
        length: Number(queue.length || 0),
        first_entry_id: queue['first-entry']?.[0] || null,
        last_entry_id: queue['last-entry']?.[0] || null,
        groups: Array.isArray(groupInfo) ? groupInfo : []
      },
      current_downtime: {
        active: false,
        seconds: 0
      }
    };
  } catch (error) {
    return {
      online: false,
      latency_ms: Date.now() - startedAt,
      error: error.message,
      current_downtime: {
        active: true,
        seconds: null
      }
    };
  }
};

const getHarakaStatus = async () => {
  const smtp = getHarakaSmtpEnv();
  const host = process.env.HARAKA_HEALTH_HOST || (smtp.host === '0.0.0.0' ? config.harakaHealthHost : smtp.host);
  const port = smtp.port;
  const connection = await connectToPort({ host, port });

  return {
    online: connection.online,
    host,
    port,
    configured_listen_host: smtp.host,
    configured_nodes: smtp.nodes,
    latency_ms: connection.latency_ms,
    error: connection.error,
    current_downtime: {
      active: !connection.online,
      seconds: connection.online ? 0 : null
    }
  };
};

const getStorageStatus = async () => {
  const dirs = {
    email_storage: config.emailStorageDir,
    email_spool: config.emailSpoolDir
  };
  const rows = {};

  for (const [name, dir] of Object.entries(dirs)) {
    const accessOk = await fs
      .access(dir)
      .then(() => true)
      .catch(() => false);

    let disk = null;
    if (typeof fs.statfs === 'function') {
      const stats = await fs.statfs(dir).catch(() => null);
      if (stats) {
        const totalBytes = Number(stats.blocks) * Number(stats.bsize);
        const freeBytes = Number(stats.bavail) * Number(stats.bsize);
        const usedBytes = totalBytes - freeBytes;
        disk = {
          total_mb: bytesToMb(totalBytes),
          used_mb: bytesToMb(usedBytes),
          free_mb: bytesToMb(freeBytes),
          usage_percent: totalBytes > 0 ? percent(usedBytes / totalBytes) : 0
        };
      }
    }

    rows[name] = {
      path: dir,
      accessible: accessOk,
      disk
    };
  }

  return rows;
};

export const getSystemStatus = async () => {
  const [cpu, redis, haraka, storage] = await Promise.all([
    getCpuUsage(),
    getRedisStatus(),
    getHarakaStatus(),
    getStorageStatus()
  ]);

  const memory = getMemoryUsage();
  const dependenciesOnline = redis.online && haraka.online;

  return {
    status: dependenciesOnline ? 'ok' : 'degraded',
    timestamp: Date.now(),
    app: {
      name: 'tmail-be',
      env: config.nodeEnv,
      pid: process.pid,
      uptime_seconds: Math.floor(process.uptime()),
      current_downtime: {
        active: false,
        seconds: 0
      }
    },
    host: {
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      release: os.release(),
      uptime_seconds: Math.floor(os.uptime())
    },
    cpu,
    memory,
    services: {
      redis,
      haraka,
      api: {
        online: true,
        port: config.port,
        uptime_seconds: Math.floor(process.uptime())
      },
      websocket: {
        enabled: config.wsEnabled
      }
    },
    storage
  };
};
