import { WebSocketServer } from 'ws';
import { createRedisClient, getRedis } from '../storage/redis.js';
import { isValidEmail, normalizeEmail } from '../utils/email.js';

const channel = 'inbox_updates';
const subscriptions = new Map();
let subscriber;

export const attachWebSocketServer = (server) => {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (socket, request) => {
    const url = new URL(request.url, 'http://localhost');
    const email = normalizeEmail(url.searchParams.get('email'));

    if (!isValidEmail(email)) {
      socket.close(1008, 'Invalid email');
      return;
    }

    if (!subscriptions.has(email)) {
      subscriptions.set(email, new Set());
    }

    subscriptions.get(email).add(socket);

    socket.on('close', () => {
      const sockets = subscriptions.get(email);
      if (!sockets) return;
      sockets.delete(socket);
      if (sockets.size === 0) subscriptions.delete(email);
    });
  });

  subscriber = createRedisClient();
  subscriber.subscribe(channel).catch((error) => {
    console.error('[ws] subscribe error', error);
  });

  subscriber.on('message', (receivedChannel, payload) => {
    if (receivedChannel !== channel) return;

    try {
      const update = JSON.parse(payload);
      sendToSubscribers(update.email, update.message);
    } catch (error) {
      console.error('[ws] invalid update payload', error);
    }
  });

  return wss;
};

export const publishInboxUpdate = (email, message) => {
  getRedis()
    .publish(channel, JSON.stringify({ email: normalizeEmail(email), message }))
    .catch((error) => {
      console.error('[ws] publish error', error);
    });
};

const sendToSubscribers = (email, message) => {
  const sockets = subscriptions.get(normalizeEmail(email));
  if (!sockets) return;

  const payload = JSON.stringify({ type: 'message', email: normalizeEmail(email), message });
  for (const socket of sockets) {
    if (socket.readyState === socket.OPEN) {
      socket.send(payload);
    }
  }
};
