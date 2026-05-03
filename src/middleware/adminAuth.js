import { config } from '../utils/config.js';

export const requireAdmin = (req, res, next) => {
  if (!config.adminToken) {
    return res.status(503).json({ error: 'Admin API is not configured' });
  }

  const token = req.get('x-admin-token') || '';
  if (token !== config.adminToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  return next();
};
