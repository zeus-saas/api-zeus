import Redis, { RedisOptions } from 'ioredis';
import 'dotenv/config';

const redisConfig: RedisOptions = {
    host: process.env.REDIS_HOST || 'whatsapp_redis',
    port: Number(process.env.REDIS_PORT) || 6379,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy: (times: number) => Math.min(times * 50, 2000)
};

const redisUrl = process.env.REDIS_URL;

// TypeScript agora entende claramente a separação entre string e objeto
export const redisConnection = redisUrl ? new Redis(redisUrl) : new Redis(redisConfig);

redisConnection.on('connect', () => {
    console.log(`✅ [Redis] Conectado com sucesso em ${process.env.REDIS_HOST || 'whatsapp_redis'}`);
});

redisConnection.on('error', (err) => {
    console.error('❌ [Redis] Erro crítico:', err.message);
});