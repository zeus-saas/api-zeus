import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { pool } from '../database';
import { AuthRequest } from '../middleware/auth';

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_zeus_key_2026';

export class SaasController {
    static async createPlan(req: Request, res: Response) {
        const { name, max_whatsapp_connections, max_users, monthly_price } = req.body;
        try {
            const result = await pool.query(
                `INSERT INTO saas_plans (name, max_whatsapp_connections, max_users, monthly_price) 
                  VALUES ($1, $2, $3, $4) RETURNING *`,
                [name, max_whatsapp_connections, max_users, monthly_price]
            );
            return res.status(201).json({ message: 'Plano criado com sucesso', plan: result.rows[0] });
        } catch (error: any) {
            return res.status(500).json({ error: error.message });
        }
    }

    static async registerCompany(req: Request, res: Response) {
        const { companyName, document, userName, email, password, planId } = req.body;
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');
            
            // 1. Verificação básica
            const emailCheck = await client.query('SELECT id FROM saas_users WHERE email = $1', [email]);
            if (emailCheck.rows.length > 0) throw new Error('E-mail já está em uso.');

            // 2. Gerar identificadores do motor WhatsApp (Tenant)
            const tenantId = 'T-' + crypto.randomBytes(4).toString('hex').toUpperCase();
            const apiKey = 'sk_live_' + crypto.randomBytes(16).toString('hex');

            // 3. Criar registro no motor (tabela api_keys)
            await client.query(
                `INSERT INTO api_keys (tenant_id, api_key, status) VALUES ($1, $2, 'ACTIVE')`,
                [tenantId, apiKey]
            );

            // 4. Criar a Empresa (agora vinculada ao Tenant)
            const companyResult = await client.query(
                `INSERT INTO saas_companies (name, document, whatsapp_tenant_id) VALUES ($1, $2, $3) RETURNING id`,
                [companyName, document, tenantId]
            );
            const companyId = companyResult.rows[0].id;

            // 5. Criar o usuário Admin da empresa
            const salt = await bcrypt.genSalt(10);
            const passwordHash = await bcrypt.hash(password, salt);

            await client.query(
                `INSERT INTO saas_users (company_id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, $5)`,
                [companyId, userName, email, passwordHash, 'ADMIN']
            );

            // 6. Criar Subscription (Trial)
            const expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + 7);

            await client.query(
                `INSERT INTO saas_subscriptions (company_id, plan_id, status, expires_at) VALUES ($1, $2, $3, $4)`,
                [companyId, planId || 1, 'TRIAL', expiresAt]
            );

            await client.query('COMMIT');
            
            return res.status(201).json({ 
                message: 'Empresa e instância WhatsApp criadas com sucesso!', 
                tenantId: tenantId 
            });
        } catch (error: any) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: error.message });
        } finally {
            client.release();
        }
    }

    static async login(req: Request, res: Response) {
        const { email, password } = req.body;
        try {
            const userResult = await pool.query('SELECT * FROM saas_users WHERE email = $1', [email]);
            if (userResult.rows.length === 0) return res.status(401).json({ error: 'Credenciais inválidas.' });

            const user = userResult.rows[0];
            const isMatch = await bcrypt.compare(password, user.password_hash);
            
            if (!isMatch) return res.status(401).json({ error: 'Credenciais inválidas.' });

            const token = jwt.sign(
                { userId: user.id, companyId: user.company_id, role: user.role },
                JWT_SECRET,
                { expiresIn: '1d' }
            );

            return res.json({
                message: 'Login bem-sucedido',
                token,
                user: { id: user.id, name: user.name, role: user.role, companyId: user.company_id }
            });
        } catch (error: any) {
            return res.status(500).json({ error: error.message });
        }
    }

    static async getProfile(req: AuthRequest, res: Response) {
        const companyId = req.user?.companyId;
        try {
            const companyInfo = await pool.query(`
                SELECT c.name, c.document, c.status, c.whatsapp_tenant_id, 
                       s.status as subscription_status, s.expires_at, 
                       p.name as plan_name, p.max_whatsapp_connections
                FROM saas_companies c
                LEFT JOIN saas_subscriptions s ON c.id = s.company_id
                LEFT JOIN saas_plans p ON s.plan_id = p.id
                WHERE c.id = $1
            `, [companyId]);

            const userInfo = await pool.query(`SELECT id, name, email, role FROM saas_users WHERE company_id = $1`, [companyId]);

            return res.json({
                company: companyInfo.rows[0],
                users: userInfo.rows
            });
        } catch (error: any) {
            return res.status(500).json({ error: error.message });
        }
    }
}