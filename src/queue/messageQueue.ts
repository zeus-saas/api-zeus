import { Queue, Worker, Job } from 'bullmq';
import { redisConnection } from './redis';
import { getSession } from '../whatsapp/manager';

// =========================================================
// 1. EXPORTAÇÃO DAS FILAS (Isso resolve o erro do terminal)
// =========================================================

// Fila para disparos unitários rápidos
export const messageQueue = new Queue('message-queue', {
    connection: redisConnection,
    defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: true,
        removeOnFail: false
    }
});

// Fila para campanhas em lote (Batch)
export const campaignQueue = new Queue('campaign-queue', {
    connection: redisConnection,
    defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: false
    }
});

// =========================================================
// 2. WORKERS (Os "trabalhadores" que executam o envio)
// =========================================================

const messageWorker = new Worker('message-queue', async (job: Job) => {
    const { tenantId, number, text, mediaUrl, mediaType, mimetype, metadata } = job.data;
    
    const session = getSession(tenantId);
    if (!session || session.status !== 'CONNECTED' || !session.sock) {
        throw new Error(`Sessão não conectada ou indisponível para o tenant ${tenantId}`);
    }

    const jid = `${number}@s.whatsapp.net`;
    
    try {
        if (mediaUrl && mediaType) {
            await session.sock.sendMessage(jid, {
                [mediaType]: { url: mediaUrl },
                caption: text,
                mimetype: mimetype
            } as any);
        } else {
            await session.sock.sendMessage(jid, { text });
        }
        console.log(`[MessageQueue] ✅ Mensagem enviada: ${number} (Tenant: ${tenantId})`);
    } catch (error: any) {
        console.error(`[MessageQueue] ❌ Erro ao enviar para ${number}:`, error.message);
        throw error; // Repassa o erro para o BullMQ tentar novamente
    }
}, { 
    connection: redisConnection, 
    concurrency: 10 // Dispara até 10 mensagens por vez
});

const campaignWorker = new Worker('campaign-queue', async (job: Job) => {
    const { tenantId, contact, messages } = job.data;
    
    const session = getSession(tenantId);
    if (!session || session.status !== 'CONNECTED' || !session.sock) {
        throw new Error(`Sessão não conectada para o tenant ${tenantId}`);
    }

    const jid = `${contact}@s.whatsapp.net`;
    
    try {
        for (const msg of messages) {
            if (msg.mediaUrl && msg.mediaType) {
                await session.sock.sendMessage(jid, {
                    [msg.mediaType]: { url: msg.mediaUrl },
                    caption: msg.text,
                    mimetype: msg.mimetype
                } as any);
            } else {
                await session.sock.sendMessage(jid, { text: msg.text });
            }
            // Delay anti-ban entre as mensagens de um mesmo contato no lote
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
        console.log(`[CampaignQueue] ✅ Lote enviado para: ${contact} (Tenant: ${tenantId})`);
    } catch (error: any) {
        console.error(`[CampaignQueue] ❌ Erro no lote para ${contact}:`, error.message);
        throw error;
    }
}, { 
    connection: redisConnection, 
    concurrency: 2 // Campanhas rodam mais devagar (2 por vez) para evitar ban
});

// Tratamento de falhas nos Workers
messageWorker.on('failed', (job, err) => {
    console.log(`[MessageQueue] Job ${job?.id} falhou: ${err.message}`);
});

campaignWorker.on('failed', (job, err) => {
    console.log(`[CampaignQueue] Job ${job?.id} falhou: ${err.message}`);
});