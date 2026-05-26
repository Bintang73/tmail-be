import http from 'node:http';
import cors from 'cors';
import express from 'express';
import morgan from 'morgan';
import { adminWebRoutes } from './routes/adminWebRoutes.js';
import { emailRoutes } from './routes/emailRoutes.js';
import { requireWhitelistedIp } from './middleware/ipWhitelist.js';
import { attachWebSocketServer } from './services/realtimeService.js';
import { config } from './utils/config.js';

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', config.trustProxy);
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(morgan('combined'));

app.use('/admin', adminWebRoutes);
app.use(requireWhitelistedIp);
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
