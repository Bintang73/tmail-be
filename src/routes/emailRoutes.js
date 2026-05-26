import { Router } from 'express';
import {
  deleteInbox,
  deleteMessageById,
  domainStatus,
  generate,
  health,
  inbox,
  incomingDomains,
  messageById,
  publicDomains,
  randomDomains,
  systemStatus
} from '../controllers/emailController.js';
import {
  adminAddDomain,
  adminDomainStatus,
  adminDeleteDomain,
  adminDeleteDomainMessages,
  adminListDomains
} from '../controllers/adminController.js';
import { swaggerJson, swaggerUi } from '../controllers/swaggerController.js';
import { requireAdmin } from '../middleware/adminAuth.js';

export const emailRoutes = Router();

emailRoutes.get('/generate', generate);
emailRoutes.get('/swagger', swaggerUi);
emailRoutes.get('/swagger.json', swaggerJson);
emailRoutes.get('/inbox', inbox);
emailRoutes.delete('/inbox', requireAdmin, deleteInbox);
emailRoutes.get('/messages/:id', messageById);
emailRoutes.delete('/messages/:id', requireAdmin, deleteMessageById);
emailRoutes.get('/list-domain', incomingDomains);
emailRoutes.get('/domains', publicDomains);
emailRoutes.get('/random-domain', randomDomains);
emailRoutes.get('/domains/status', domainStatus);
emailRoutes.get('/domains/:domain/status', domainStatus);
emailRoutes.get('/health', health);
emailRoutes.get('/system/status', requireAdmin, systemStatus);

emailRoutes.get('/admin/domains', requireAdmin, adminListDomains);
emailRoutes.post('/admin/domains', requireAdmin, adminAddDomain);
emailRoutes.get('/admin/domains/:domain/status', requireAdmin, adminDomainStatus);
emailRoutes.delete('/admin/domains/:domain', requireAdmin, adminDeleteDomain);
emailRoutes.delete('/admin/domains/:domain/messages', requireAdmin, adminDeleteDomainMessages);
