import http from 'node:http';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import morgan from 'morgan';
import { emailRoutes } from './routes/emailRoutes.js';
import { attachWebSocketServer } from './services/realtimeService.js';
import { config } from './utils/config.js';

const app = express();

app.disable('x-powered-by');
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(morgan('combined'));
app.use(
  rateLimit({
    windowMs: config.apiRateLimitWindowMs,
    max: config.apiRateLimitMax,
    standardHeaders: true,
    legacyHeaders: false
  })
);

app.use('/api/v1', emailRoutes);

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((error, req, res, next) => {
  if (error.statusCode) {
    return res.status(error.statusCode).json({ error: error.message });
  }

  console.error('[api] error', error);
  res.status(500).json({ error: 'Internal server error' });
});

const server = http.createServer(app);

if (config.wsEnabled) {
  attachWebSocketServer(server);
}

server.listen(config.port, () => {
  console.info(`[api] listening on :${config.port}`);
});

export { app, server };
