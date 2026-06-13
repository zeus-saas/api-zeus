import { Router } from 'express';
import { MessageController } from '../controllers/message.controller';
import { apiKeyAuth } from '../middleware/auth';

const router = Router();

// Aplica a validação da API Key da instância
router.use(apiKeyAuth);

router.post('/:tenantId/messages', MessageController.sendMessage);
router.post('/:tenantId/campaigns/batch', MessageController.sendCampaignBatch);

export default router;