import { Request, Response } from 'express';
import qrcode from 'qrcode';
import { initTenantSession, getSession, getAllSessions, generatePairingCode, validateAndGetJid } from '../whatsapp/manager';
import { pool } from '../database';

export class SessionController {

    static async start(req: Request, res: Response) {
        const { tenantId } = req.params;
        try {
            const check = await pool.query('SELECT status FROM api_keys WHERE tenant_id = $1', [tenantId]);
            // Correção TS: Garantindo que rowCount não é nulo
            if (check.rowCount !== null && check.rowCount > 0 && check.rows[0].status === 'SUSPENDED') {
                return res.status(403).json({ error: 'Conta suspensa. Regularize para usar o serviço.' });
            }
            let session = getSession(tenantId);
            if (!session) await initTenantSession(tenantId);
            return res.json({ success: true, message: 'Processo de conexão iniciado. Aguardando QR Code.' });
        } catch (error: any) {
            return res.status(500).json({ error: 'Erro ao iniciar sessão.', details: error.message });
        }
    }

    static async pairingCode(req: Request, res: Response) {
        const { tenantId } = req.params;
        const { phoneNumber } = req.body;
        if (!phoneNumber) return res.status(400).json({ error: 'O número de telefone é obrigatório.' });

        try {
            const check = await pool.query('SELECT status FROM api_keys WHERE tenant_id = $1', [tenantId]);
            if (check.rowCount !== null && check.rowCount > 0 && check.rows[0].status === 'SUSPENDED') {
                return res.status(403).json({ error: 'Conta suspensa.' });
            }

            let session = getSession(tenantId);
            if (!session) {
                await initTenantSession(tenantId);
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
            const code = await generatePairingCode(tenantId, phoneNumber);
            return res.json({ success: true, code });
        } catch (error: any) {
            return res.status(500).json({ error: error.message || 'Erro ao gerar o PIN.' });
        }
    }

    static async checkNumber(req: Request, res: Response) {
        const { tenantId, phoneNumber } = req.params;
        try {
            const session = getSession(tenantId);
            if (!session || session.status !== 'CONNECTED') {
                return res.status(400).json({ error: 'Sessão não conectada.' });
            }
            const jid = await validateAndGetJid(tenantId, phoneNumber);
            return res.json({ success: true, originalNumber: phoneNumber, jid: jid });
        } catch (error: any) {
            return res.status(400).json({ error: error.message || 'Erro ao validar número.' });
        }
    }

    static async getStatusHtml(req: Request, res: Response) {
        const { tenantId } = req.params;
        let session = getSession(tenantId);

        if (session?.status === 'CONNECTED') {
            return res.send(`<html><body><h2>✅ Conectado: ${tenantId}</h2></body></html>`);
        }

        if (session?.status === 'WAITING_QR' && session.qrCode) {
            const qrBase64 = await qrcode.toDataURL(session.qrCode);
            return res.send(`<html><body><img src="${qrBase64}" /></body></html>`);
        }

        return res.send(`<html><body>Status: ${session?.status || 'OFFLINE'}</body></html>`);
    }

    static async list(req: Request, res: Response) {
        try {
            const sessions = getAllSessions();
            const { rows } = await pool.query('SELECT tenant_id, api_key, status FROM api_keys');
            return res.json(rows.map(dbRow => ({
                id: dbRow.tenant_id,
                status_memoria: sessions.find(s => s.tenantId.trim() === dbRow.tenant_id.trim())?.status || 'CREATED',
                status_banco: dbRow.status || 'ACTIVE',
                apiKey: dbRow.api_key
            })));
        } catch (error: any) {
            return res.status(500).json({ error: 'Erro ao listar instâncias' });
        }
    }

    static async logout(req: Request, res: Response) {
        const { tenantId } = req.params;
        const session = getSession(tenantId);
        if (session?.sock) {
            await session.sock.logout();
            return res.json({ success: true, message: `Sessão '${tenantId}' encerrada.` });
        } else {
            return res.status(404).json({ error: 'Sessão não encontrada.' });
        }
    }
}