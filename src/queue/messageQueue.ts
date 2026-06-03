import { Queue, Worker, Job } from 'bullmq';
import { redisConnection } from './redis';
import { getSession, validateAndGetJid } from '../whatsapp/manager';
import { pool } from '../database';
import { sendCampaignToSingleContact } from '../services/batch-campaign.service';

// Interface para mensagens avulsas (Sua estrutura atual)
interface MessagePayload {
    tenantId: string;
    number: string;
    text?: string;
    mediaUrl?: string;
    mediaType?: 'image' | 'video' | 'audio' | 'document';
    mimetype?: string;
    metadata?: {
        ip: string;
        region: string;
        date: string;
        time: string;
    };
}

// Interface para Campanhas em Lote (Nova estrutura)
interface CampaignPayload {
    tenantId: string;
    contact: string;
    messages: Array<{
        type: 'text' | 'media' | 'audio';
        content: string;
        fileName?: string;
        caption?: string;
    }>;
}

// ==========================================
// 1. FILA E WORKER: MENSAGENS AVULSAS (PADRÃO)
// ==========================================
export const messageQueue = new Queue<MessagePayload>('whatsapp-messages', {
    connection: redisConnection,
    defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: 'exponential',
            delay: 2000,
        },
        removeOnComplete: true,
    },
});

const messageWorker = new Worker<MessagePayload>(
    'whatsapp-messages',
    async (job: Job<MessagePayload>) => {
        const { tenantId, number, text, mediaUrl, mediaType, mimetype, metadata } = job.data;
        const session = getSession(tenantId);

        if (!session || session.status !== 'CONNECTED' || !session.sock) {
            throw new Error(`Sessão do tenant ${tenantId} não está conectada.`);
        }

        // 🔥 O WORKER AGORA CHAMA O VERIFICADOR INTELIGENTE (CACHED)
        const validJid = await validateAndGetJid(tenantId, number);
        
        if (!validJid) {
            console.error(`[Worker] ❌ Abortado: O número ${number} não possui WhatsApp ativo (Tenant: ${tenantId})`);
            return; 
        }
        
        let sentMsg;
        let contentStr = text || `[Mídia: ${mediaType}]`;

        try {
            if (mediaUrl && mediaType) {
                let messageContent: any = {};
                
                if (mediaType === 'image') messageContent = { image: { url: mediaUrl }, caption: text };
                else if (mediaType === 'video') messageContent = { video: { url: mediaUrl }, caption: text };
                else if (mediaType === 'audio') messageContent = { audio: { url: mediaUrl }, ptt: true }; 
                else if (mediaType === 'document') messageContent = { document: { url: mediaUrl }, mimetype: mimetype || 'application/pdf', fileName: text || 'documento' };

                sentMsg = await session.sock.sendMessage(validJid, messageContent);
                console.log(`[Worker] ✅ Mídia (${mediaType}) enviada para ${validJid} (Tenant: ${tenantId})`);
            } else if (text) {
                sentMsg = await session.sock.sendMessage(validJid, { text });
                console.log(`[Worker] ✅ Texto enviado para ${validJid} (Tenant: ${tenantId})`);
            }
        } catch (err: any) {
            console.error(`[Worker] ❌ Erro ao enviar mensagem para ${validJid} (Tenant: ${tenantId}):`, err.message);
            throw err;
        }

        if (sentMsg?.key?.id && metadata) {
            try {
                await pool.query(
                    `INSERT INTO messages_log 
                    (tenant_id, remote_jid, message_id, direction, status, content, original_content, api_ip, api_region, event_date, event_time) 
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
                    [
                        tenantId, 
                        validJid, 
                        sentMsg.key.id, 
                        'SENT_API', 
                        'SENT', 
                        contentStr, 
                        contentStr, 
                        metadata.ip, 
                        metadata.region, 
                        metadata.date, 
                        metadata.time
                    ]
                );
            } catch (dbErr: any) {
                console.error('[Worker] Falha ao registrar log de disparo:', dbErr.message);
            }
        }
    },
    { 
        connection: redisConnection,
        concurrency: 5 
    }
);

messageWorker.on('failed', (job, err) => {
    console.error(`[Worker] ❌ Falha ao enviar job ${job?.id}:`, err.message);
});


// ==========================================
// 2. FILA E WORKER: CAMPANHAS EM MASSA (NOVO)
// ==========================================
export const campaignQueue = new Queue<CampaignPayload>('whatsapp-campaigns', {
    connection: redisConnection,
    defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: 'exponential',
            delay: 10000, // Espera 10 segundos antes de tentar de novo se o celular desconectar temporariamente
        },
        removeOnComplete: true,
    },
});

const campaignWorker = new Worker<CampaignPayload>(
    'whatsapp-campaigns',
    async (job: Job<CampaignPayload>) => {
        const { tenantId, contact, messages } = job.data;
        
        try {
            console.log(`[Worker Campanhas] 🚀 Processando contato da fila: ${contact} (Tenant: ${tenantId})`);
            await sendCampaignToSingleContact(tenantId, contact, messages);
        } catch (err: any) {
            console.error(`[Worker Campanhas] ❌ Erro no disparo para ${contact}:`, err.message);
            throw err;
        }
    },
    {
        connection: redisConnection,
        concurrency: 1 // Concorrência 1 garante processamento sequencial estrito por thread da fila
    }
);

campaignWorker.on('failed', (job, err) => {
    console.error(`[Worker Campanhas] ❌ Job de campanha falhou permanentemente para o ID ${job?.id}:`, err.message);
});