import { Router } from 'express';
import { SaasController } from '../controllers/saas.controller';
import { MessageController } from '../controllers/message.controller';
import { TenantController } from '../controllers/tenant.controller';
import { saasAuthMiddleware } from '../middleware/auth';
import { superAdminMiddleware } from '../middleware/admin';

const router = Router();

// Públicas
router.post('/api/saas/register', SaasController.registerCompany);
router.post('/api/saas/login', SaasController.login);

// Admin Master (Protegidas)
router.post('/api/v1/admin/tenants', saasAuthMiddleware, superAdminMiddleware, TenantController.create);

// Clientes (Protegidas por JWT)
router.get('/api/saas/profile', saasAuthMiddleware, SaasController.getProfile);
router.post('/api/v1/client/send-message', saasAuthMiddleware, MessageController.sendMessage);

export default router;