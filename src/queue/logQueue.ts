import { Queue, Worker, Job } from 'bullmq';
import { redisConnection } from './redis';
import { pool } from '../database';

interface DbLogPayload {
    action: 'INSERT_MESSAGE' | 'UPDATE_STATUS' | 'MARK_DELETED' | 'MARK_EDITED';
    tenantId: string;
    messageId: string;
    remoteJid?: string;
    direction?: string;
    status?: string;
    content?: string;
    originalContent?: string;
    apiIp?: string;
    apiRegion?: string;
    eventDate?: string;
    eventTime?: string;
}

export const dbLogQueue = new Queue<DbLogPayload>('database-logs', {
    connection: redisConnection,
    defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: true,
        removeOnFail: false,
    },
});

const dbLogWorker = new Worker<DbLogPayload>(
    'database-logs',
    async (job: Job<DbLogPayload>) => {
        const data = job.data;
        try {
            switch (data.action) {
                case 'INSERT_MESSAGE':
                    await pool.query(
                        `INSERT INTO messages_log 
                        (tenant_id, remote_jid, message_id, direction, status, content, original_content, api_ip, api_region, event_date, event_time) 
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                        ON CONFLICT DO NOTHING`,
                        [data.tenantId, data.remoteJid, data.messageId, data.direction, data.status, data.content, data.originalContent, data.apiIp, data.apiRegion, data.eventDate, data.eventTime]
                    );
                    break;
                case 'UPDATE_STATUS':
                    await pool.query(`UPDATE messages_log SET status = $1 WHERE tenant_id = $2 AND message_id = $3`, [data.status, data.tenantId, data.messageId]);
                    break;
                case 'MARK_DELETED':
                    await pool.query(`UPDATE messages_log SET is_deleted = TRUE WHERE tenant_id = $1 AND message_id = $2`, [data.tenantId, data.messageId]);
                    break;
                case 'MARK_EDITED':
                    await pool.query(`UPDATE messages_log SET is_edited = TRUE, content = $1 WHERE tenant_id = $2 AND message_id = $3`, [data.content, data.tenantId, data.messageId]);
                    break;
            }
        } catch (error: any) {
            console.error(`[Log Worker] Erro:`, error.message);
            throw error;
        }
    },
    { connection: redisConnection, concurrency: 10 }
);