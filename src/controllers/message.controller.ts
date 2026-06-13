import { Request, Response } from 'express';
import { messageQueue, campaignQueue } from '../queue/messageQueue';
import { getSession } from '../whatsapp/manager';
import { getIpLocation, getBrDateTime } from '../utils/helpers';

export class MessageController {

    static async sendMessage(req: Request, res: Response) {
        const { tenantId } = req.params;
        const { number, text, mediaUrl, mediaType, mimetype } = req.body;

        const session = getSession(tenantId);
        if (!session || session.status !== 'CONNECTED') {
            return res.status(400).json({ error: 'Sessão não conectada ou inexistente.' });
        }

        const clientRawIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1';
        const { ip, region } = await getIpLocation(clientRawIp);
        const { date, time } = getBrDateTime();

        try {
            const job = await messageQueue.add('send-message', {
                tenantId,
                number,
                text,
                mediaUrl,
                mediaType,
                mimetype,
                metadata: { ip, region, date, time }
            });

            return res.json({ 
                success: true, 
                message: 'Mensagem adicionada à fila auditada.', 
                jobId: job.id 
            });
        } catch (error: any) {
            return res.status(500).json({ error: 'Erro ao enfileirar mensagem', details: error.message });
        }
    }

    static async sendCampaignBatch(req: Request, res: Response) {
        const { tenantId } = req.params;
        const { contacts, messages } = req.body;

        if (!contacts || !Array.isArray(contacts) || !messages || !Array.isArray(messages)) {
            return res.status(400).json({ error: 'Parâmetros inválidos (contacts e messages são arrays).' });
        }

        const session = getSession(tenantId);
        if (!session || session.status !== 'CONNECTED') {
            return res.status(400).json({ error: 'Sessão não conectada.' });
        }

        const DELAY_ENTRE_CONTATOS_MS = 25000; 

        try {
            for (let i = 0; i < contacts.length; i++) {
                await campaignQueue.add('send-campaign-job', {
                    tenantId,
                    contact: contacts[i],
                    messages
                }, {
                    delay: i * DELAY_ENTRE_CONTATOS_MS 
                });
            }
            return res.json({ success: true, message: `Campanha iniciada com ${contacts.length} contatos.` });
        } catch (error: any) {
            return res.status(500).json({ error: 'Erro ao processar lote.', details: error.message });
        }
    }
}