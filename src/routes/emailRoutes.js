import { Router } from 'express';
import {
  deleteInbox,
  deleteMessageById,
  generate,
  health,
  inbox,
  messageById,
  publicDomains
} from '../controllers/emailController.js';
import {
  adminAddDomain,
  adminDeleteDomain,
  adminDeleteDomainMessages,
  adminListDomains
} from '../controllers/adminController.js';
import { requireAdmin } from '../middleware/adminAuth.js';

export const emailRoutes = Router();

emailRoutes.get('/generate', generate);
emailRoutes.get('/inbox', inbox);
emailRoutes.delete('/inbox', requireAdmin, deleteInbox);
emailRoutes.get('/messages/:id', messageById);
emailRoutes.delete('/messages/:id', requireAdmin, deleteMessageById);
emailRoutes.get('/domains', publicDomains);
emailRoutes.get('/health', health);

emailRoutes.get('/admin/domains', requireAdmin, adminListDomains);
emailRoutes.post('/admin/domains', requireAdmin, adminAddDomain);
emailRoutes.delete('/admin/domains/:domain', requireAdmin, adminDeleteDomain);
emailRoutes.delete('/admin/domains/:domain/messages', requireAdmin, adminDeleteDomainMessages);
