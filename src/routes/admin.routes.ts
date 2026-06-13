import { Router } from 'express';
import { AdminController } from '../controllers/admin.controller';
import { masterKeyAuth } from '../middleware/master';

const router = Router();

// Aplica a segurança da chave Master em todas as rotas de admin
router.use(masterKeyAuth);

router.post('/tenants', AdminController.create);
router.delete('/tenants/:tenantId', AdminController.delete);
router.post('/tenants/:tenantId/suspend', AdminController.toggleSuspend);
router.get('/tenants/:tenantId/logs', AdminController.getLogs);

export default router;