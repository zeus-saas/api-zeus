import { Request, Response, NextFunction } from 'express';

export const masterKeyAuth = (req: Request, res: Response, next: NextFunction) => {
    const masterKey = process.env.API_KEY;
    const providedKey = req.headers['x-master-key'] || req.headers.authorization?.replace('Bearer ', '');
    
    if (!masterKey) return res.status(500).json({ error: 'API_KEY Master não configurada no .env.' });
    if (providedKey !== masterKey) {
        return res.status(403).json({ error: 'Acesso Negado: Esta ação exige permissões de Master Admin.' });
    }
    
    next();
};