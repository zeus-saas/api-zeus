import { Request, Response } from 'express';
import crypto from 'crypto';
import { pool } from '../database';

export class TenantController {
    /**
     * Cria um novo Tenant para uma empresa.
     * Apenas para uso do Super Admin.
     */
    static async create(req: Request, res: Response) {
        const { companyId } = req.body;

        if (!companyId) {
            return res.status(400).json({ error: 'companyId é obrigatório.' });
        }

        try {
            // Gera novos identificadores
            const tenantId = 'T-' + crypto.randomBytes(4).toString('hex').toUpperCase();
            const apiKey = 'sk_live_' + crypto.randomBytes(16).toString('hex');

            const client = await pool.connect();
            try {
                await client.query('BEGIN');

                // 1. Registra no motor de WhatsApp
                await client.query(
                    'INSERT INTO api_keys (tenant_id, api_key, status) VALUES ($1, $2, $3)',
                    [tenantId, apiKey, 'ACTIVE']
                );

                // 2. Vincula à empresa
                await client.query(
                    'UPDATE saas_companies SET whatsapp_tenant_id = $1 WHERE id = $2',
                    [tenantId, companyId]
                );

                await client.query('COMMIT');
                
                return res.status(201).json({ 
                    message: 'Tenant criado e vinculado com sucesso', 
                    data: { tenantId, apiKey } 
                });
            } catch (err) {
                await client.query('ROLLBACK');
                throw err;
            } finally {
                client.release();
            }
        } catch (error: any) {
            return res.status(500).json({ error: error.message });
        }
    }
}