import { Request, Response, NextFunction } from 'express';
import { pool } from '../database';
import jwt from 'jsonwebtoken';
import 'dotenv/config';

// ==========================================
// 1. AUTENTICAÇÃO DO MOTOR WHATSAPP (API KEY / MASTER KEY)
// ==========================================
export const apiKeyAuth = async (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Token não fornecido' });

    const token = authHeader.split(' ')[1];
    
    // LOG DE SEGURANÇA NO TERMINAL
    console.log(`[AUTH] Tentando acesso em: ${req.originalUrl}`);
    console.log(`[AUTH] Token recebido: ${token}`);

    try {
        if (token === process.env.API_KEY) {
            console.log("[AUTH] Master Key validada com sucesso.");
            return next();
        }

        const { rows } = await pool.query('SELECT tenant_id FROM api_keys WHERE api_key = $1', [token]);
        
        if (rows.length === 0) {
            console.log("[AUTH] Chave não encontrada no banco.");
            return res.status(403).json({ error: 'API Key inválida' });
        }

        const dbTenant = rows[0].tenant_id;
        const urlTenant = req.params.tenantId;

        console.log(`[AUTH] Comparando DB Tenant [${dbTenant}] vs URL Tenant [${urlTenant}]`);

        if (urlTenant && urlTenant !== dbTenant) {
            return res.status(403).json({ error: `Permissão negada. Você é dono de ${dbTenant}, não de ${urlTenant}` });
        }

        next();
    } catch (e) {
        res.status(500).json({ error: 'Erro no auth' });
    }
};

// ==========================================
// 2. AUTENTICAÇÃO DO PAINEL SAAS (JWT TOKEN)
// ==========================================
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_zeus_key_2026';

// Estende a interface do Request do Express para aceitar os dados do Usuário Logado
export interface AuthRequest extends Request {
    user?: {
        userId: string;
        companyId: string;
        role: string;
    };
}

export const saasAuthMiddleware = (req: AuthRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Token de autenticação ausente ou inválido.' });
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, JWT_SECRET) as any;
        req.user = {
            userId: decoded.userId,
            companyId: decoded.companyId,
            role: decoded.role
        };
        next();
    } catch (error) {
        return res.status(401).json({ error: 'Token expirado ou inválido.' });
    }
};