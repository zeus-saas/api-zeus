import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { initializeDatabase } from './database';
import { loadAllSessionsFromDatabase } from './whatsapp/manager';

// Importação das configurações
import { swaggerDocs, swaggerAuth, swaggerUi } from './config/swagger';

// Importação das rotas modularizadas
import saasRoutes from './routes/saas.routes';
import adminRoutes from './routes/admin.routes';
import sessionRoutes from './routes/session.routes';
import messageRoutes from './routes/message.routes';

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// ==========================================
// DOCUMENTAÇÃO E SWAGGER
// ==========================================
app.use('/api-docs', swaggerAuth, swaggerUi.serve, swaggerUi.setup(swaggerDocs));

// ==========================================
// ROTAS DO SISTEMA
// ==========================================

// 1. Módulo SaaS (Público e Protegido por JWT)
app.use('/api/saas', saasRoutes);

// 2. Administração da Infraestrutura (Protegido por Master Key)
app.use('/api/v1/admin', adminRoutes);

// 3. Gestão de Sessões do WhatsApp (Protegido por API Key)
app.use('/api/v1/sessions', sessionRoutes);

// 4. Filas e Disparos de Mensagens (Protegido por API Key)
app.use('/api/v1/sessions', messageRoutes); 

// ==========================================
// INICIALIZAÇÃO
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    console.log(`🚀 Gateway rodando na porta ${PORT}`);
    
    await initializeDatabase();
    await loadAllSessionsFromDatabase();
});