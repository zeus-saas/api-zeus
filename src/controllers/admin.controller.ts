import { Request, Response } from 'express';
import crypto from 'crypto';
import { pool } from '../database';
import { getSession } from '../whatsapp/manager';

export class AdminController {
    
    // Helper privado para gerar IDs únicos
    private static generateTenantId(): string {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        let llll = '';
        for (let i = 0; i < 4; i++) {
            llll += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        const now = new Date();
        const dd = String(now.getDate()).padStart(2, '0');
        const aaaa = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        return `${llll}${dd}${aaaa}${mm}`;
    }

    private static async ensureStatusColumn() {
        try {
            await pool.query('ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT \'ACTIVE\'');
        } catch (e) {
            console.log("Aviso: Falha ao checar coluna status.");
        }
    }

    // CREATE: Criar Tenant
    static async create(req: Request, res: Response) {
        let tenantId = '';
        let isUnique = false;
        let attempts = 0;

        try {
            await AdminController.ensureStatusColumn();
            while (!isUnique && attempts < 10) {
                tenantId = AdminController.generateTenantId();
                const check = await pool.query('SELECT 1 FROM api_keys WHERE tenant_id = $1', [tenantId]);
                if (check.rowCount === 0) isUnique = true;
                attempts++;
            }

            if (!isUnique) return res.status(500).json({ error: 'Falha ao gerar ID único.' });

            const newApiKey = 'sk_live_wa_' + crypto.randomBytes(16).toString('hex');
            await pool.query(
                `INSERT INTO api_keys (tenant_id, api_key, status) VALUES ($1, $2, 'ACTIVE')`,
                [tenantId, newApiKey]
            );

            res.json({ success: true, message: `Instância '${tenantId}' criada!`, tenantId, apiKey: newApiKey });
        } catch (error: any) {
            res.status(500).json({ error: 'Erro ao gerar API Key', details: error.message });
        }
    }

    // DELETE: Excluir Tenant
    static async delete(req: Request, res: Response) {
        const { tenantId } = req.params;
        try {
            const result = await pool.query('DELETE FROM api_keys WHERE tenant_id = $1 RETURNING *', [tenantId]);
            if (result.rowCount === 0) return res.status(404).json({ error: 'Instância não encontrada.' });

            const session = getSession(tenantId);
            if (session?.sock) await session.sock.logout();
            
            res.json({ success: true, message: `Instância '${tenantId}' excluída.` });
        } catch (error: any) {
            res.status(500).json({ error: 'Erro ao excluir.', details: error.message });
        }
    }

    // SUSPEND/REACTIVATE: Suspender
    static async toggleSuspend(req: Request, res: Response) {
        const { tenantId } = req.params;
        const { action } = req.body; 

        if (action !== 'suspend' && action !== 'reactivate') {
            return res.status(400).json({ error: 'Ação inválida.' });
        }

        const newStatus = action === 'reactivate' ? 'ACTIVE' : 'SUSPENDED';

        try {
            await AdminController.ensureStatusColumn();
            const result = await pool.query('UPDATE api_keys SET status = $1 WHERE tenant_id = $2 RETURNING *', [newStatus, tenantId]);
            
            if (result.rowCount === 0) return res.status(404).json({ error: 'Instância não encontrada.' });

            if (newStatus === 'SUSPENDED') {
                const session = getSession(tenantId);
                if (session?.sock) await session.sock.logout();
            }

            res.json({ success: true, message: `Status '${tenantId}' alterado para ${newStatus}.` });
        } catch (error: any) {
            res.status(500).json({ error: 'Erro ao alterar status.', details: error.message });
        }
    }

    // LOGS: Gerar extrato
    static async getLogs(req: Request, res: Response) {
        const { tenantId } = req.params;
        try {
            await AdminController.ensureStatusColumn();
            const result = await pool.query('SELECT * FROM api_keys WHERE tenant_id = $1', [tenantId]);
            
            if (result.rowCount === 0) return res.status(404).json({ error: 'Instância não encontrada.' });

            const dbData = result.rows[0];
            const session = getSession(tenantId);
            const statusMemoria = session ? session.status : 'DESCONECTADO';
            
            const logData = `ZEUS - EXTRATO DE AUDITORIA\nID: ${tenantId}\nStatus: ${dbData.status}\nStatus Sessão: ${statusMemoria}`;

            res.setHeader('Content-disposition', `attachment; filename=log_${tenantId}.txt`);
            res.setHeader('Content-type', 'text/plain; charset=utf-8');
            res.send(logData);
        } catch (error: any) {
            res.status(500).json({ error: 'Erro ao emitir extrato', details: error.message });
        }
    }
}