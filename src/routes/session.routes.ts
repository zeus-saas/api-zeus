import { Router } from 'express';
import { SessionController } from '../controllers/session.controller';
import { apiKeyAuth } from '../middleware/auth';

const router = Router();

// Aplica a segurança da API Key para as rotas do motor
router.use(apiKeyAuth);

router.post('/:tenantId/start', SessionController.start);
router.post('/:tenantId/pairing-code', SessionController.pairingCode);
router.get('/:tenantId/check-number/:phoneNumber', SessionController.checkNumber);
router.get('/:tenantId', SessionController.getStatusHtml);
router.get('/', SessionController.list);
router.delete('/:tenantId', SessionController.logout);

export default router;