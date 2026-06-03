import { Pool } from 'pg';
import 'dotenv/config';

export const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

pool.on('connect', () => {});

pool.on('error', (err) => {
    console.error('❌ Erro inesperado no pool do PostgreSQL', err);
    process.exit(-1);
});

export const initializeDatabase = async () => {
    try {
        // Tabela de API Keys
        await pool.query(`
            CREATE TABLE IF NOT EXISTS api_keys (
                tenant_id VARCHAR(255) PRIMARY KEY,
                api_key VARCHAR(255) UNIQUE NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 🔥 Tabela: Log Perpétuo de Mensagens
        await pool.query(`
            CREATE TABLE IF NOT EXISTS messages_log (
                id SERIAL PRIMARY KEY,
                tenant_id VARCHAR(255) NOT NULL,
                remote_jid VARCHAR(255) NOT NULL,
                message_id VARCHAR(255) NOT NULL,
                direction VARCHAR(50) NOT NULL, -- 'SENT_API' ou 'RECEIVED_WA'
                status VARCHAR(50) DEFAULT 'PENDING', -- PENDING, SENT, DELIVERED, READ, PLAYED
                content TEXT,
                media_url TEXT,
                is_deleted BOOLEAN DEFAULT FALSE,
                is_edited BOOLEAN DEFAULT FALSE,
                original_content TEXT,
                api_ip VARCHAR(100),
                api_region VARCHAR(255),
                event_date VARCHAR(20), -- DD/MM/AAAA
                event_time VARCHAR(20), -- HH:MM:SS
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(tenant_id, message_id)
            );
        `);

        // 🔥 NOVA TABELA: Cache de Contatos Inteligente (JID)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS contacts (
                id SERIAL PRIMARY KEY,
                tenant_id VARCHAR(255) NOT NULL,
                original_number VARCHAR(50) NOT NULL,
                wa_jid VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(tenant_id, original_number)
            );
        `);

        console.log('📦 Banco de dados e tabelas de log inicializados com sucesso.');
    } catch (error: any) {
        console.error('❌ Erro ao inicializar o banco de dados:', error.message);
    }
};