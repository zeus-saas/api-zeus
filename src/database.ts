import { Pool } from 'pg';
import 'dotenv/config';

export const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});

pool.on('connect', () => {});

pool.on('error', (err) => {
    console.error('❌ Erro inesperado no pool do PostgreSQL', err);
    process.exit(-1);
});

export const initializeDatabase = async () => {
    try {
        // ==========================================
        // MÓDULO: CORE SAAS (Planos, Empresas, Usuários)
        // ==========================================
        await pool.query(`
            CREATE TABLE IF NOT EXISTS saas_plans (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                max_whatsapp_connections INT DEFAULT 1,
                max_users INT DEFAULT 1,
                monthly_price NUMERIC(10,2) DEFAULT 0.00,
                features JSONB DEFAULT '{}',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS saas_companies (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                name VARCHAR(255) NOT NULL,
                document VARCHAR(20) UNIQUE NOT NULL, -- CNPJ ou CPF
                status VARCHAR(20) DEFAULT 'ACTIVE',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS saas_users (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                company_id UUID REFERENCES saas_companies(id) ON DELETE CASCADE,
                name VARCHAR(255) NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                role VARCHAR(50) DEFAULT 'USER', -- ADMIN ou USER
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS saas_subscriptions (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                company_id UUID REFERENCES saas_companies(id) ON DELETE CASCADE,
                plan_id INT REFERENCES saas_plans(id),
                status VARCHAR(20) DEFAULT 'TRIAL', -- TRIAL, ACTIVE, PAST_DUE, CANCELED
                expires_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // ==========================================
        // MÓDULO: API DE MENSAGERIA E ECONODATA B2B
        // ==========================================
        await pool.query(`
            CREATE TABLE IF NOT EXISTS api_keys (
                tenant_id VARCHAR(255) PRIMARY KEY,
                api_key VARCHAR(255) UNIQUE NOT NULL,
                status VARCHAR(20) DEFAULT 'ACTIVE',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS messages_log (
                id SERIAL PRIMARY KEY,
                tenant_id VARCHAR(255) NOT NULL,
                remote_jid VARCHAR(255) NOT NULL,
                message_id VARCHAR(255) NOT NULL,
                direction VARCHAR(50) NOT NULL, 
                status VARCHAR(50) DEFAULT 'PENDING',
                content TEXT,
                media_url TEXT,
                is_deleted BOOLEAN DEFAULT FALSE,
                is_edited BOOLEAN DEFAULT FALSE,
                original_content TEXT,
                api_ip VARCHAR(100),
                api_region VARCHAR(255),
                event_date VARCHAR(20),
                event_time VARCHAR(20),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(tenant_id, message_id)
            );
            CREATE INDEX IF NOT EXISTS idx_messages_tenant ON messages_log(tenant_id);
            CREATE INDEX IF NOT EXISTS idx_messages_jid ON messages_log(remote_jid);
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS contacts (
                id SERIAL PRIMARY KEY,
                tenant_id VARCHAR(255) NOT NULL,
                original_number VARCHAR(50) NOT NULL,
                wa_jid VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(tenant_id, original_number)
            );
            CREATE INDEX IF NOT EXISTS idx_contacts_tenant_number ON contacts(tenant_id, original_number);
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS b2b_leads (
                id SERIAL PRIMARY KEY,
                tenant_id VARCHAR(255) NOT NULL,
                cnpj VARCHAR(20) NOT NULL,
                razao_social VARCHAR(255) NOT NULL,
                nome_fantasia VARCHAR(255),
                telefone_principal VARCHAR(50),
                telefones_secundarios JSONB DEFAULT '[]',
                email VARCHAR(255),
                cnae_principal VARCHAR(255),
                cnaes_secundarios JSONB DEFAULT '[]',
                capital_social NUMERIC(15,2),
                situacao_cadastral VARCHAR(50),
                endereco_completo TEXT,
                cidade VARCHAR(100),
                estado VARCHAR(2),
                cep VARCHAR(20),
                data_abertura DATE,
                is_whatsapp_valid BOOLEAN DEFAULT NULL,
                wa_jid VARCHAR(255),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(tenant_id, cnpj)
            );
            CREATE INDEX IF NOT EXISTS idx_b2b_leads_cidade_estado ON b2b_leads(cidade, estado);
            CREATE INDEX IF NOT EXISTS idx_b2b_leads_cnae ON b2b_leads(cnae_principal);
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS whatsapp_sessions_v2 (
                tenant_id VARCHAR(255) NOT NULL,
                key_id TEXT NOT NULL,
                data TEXT NOT NULL,
                PRIMARY KEY (tenant_id, key_id)
            );
        `);

        console.log('📦 Banco de dados (Módulos Disparo + B2B + SaaS Auth) inicializado com sucesso.');
    } catch (error: any) {
        console.error('❌ Erro ao inicializar o banco de dados:', error.message);
    }
};