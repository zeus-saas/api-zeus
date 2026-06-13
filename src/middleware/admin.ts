import { Response, NextFunction } from 'express';

// Assumindo que o seu objeto req.user contém o role do usuário
export const superAdminMiddleware = (req: any, res: Response, next: NextFunction) => {
    // Verifique se o usuário logado tem a role SUPER_ADMIN
    if (req.user?.role !== 'SUPER_ADMIN') {
        return res.status(403).json({ error: 'Acesso negado: Apenas o Super Admin pode realizar esta ação.' });
    }
    next();
};