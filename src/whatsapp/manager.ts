import { makeWASocket, DisconnectReason, fetchLatestBaileysVersion, Browsers } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import axios from 'axios';
import { pool } from '../database';
import { usePostgresAuthState } from './postgresAuth';

const sessions = new Map<string, any>();
const reconnectAttemptsMap = new Map<string, number>(); // MAPA PARA RASTREAR TENTATIVAS DE RECONEXÃO
const logger = pino({ level: 'silent' });

const WEBHOOK_URL = process.env.WEBHOOK_URL || 'http://localhost:3333/api/webhook'; 

// Função auxiliar para data e hora no padrão brasileiro
const getBrDateTime = () => {
    const now = new Date();
    return {
        date: now.toLocaleDateString('pt-BR'),
        time: now.toLocaleTimeString('pt-BR')
    };
};

export const initTenantSession = async (tenantId: string) => {
    const { state, saveCreds, removeCreds } = await usePostgresAuthState(tenantId, pool);
    
    const { version } = await fetchLatestBaileysVersion();
    console.log(`[${tenantId}] Inicializando com WA v${version.join('.')} via PostgreSQL`);

    // Limpa a sessão antiga da memória (Evita Memory Leak)
    if (sessions.has(tenantId)) {
        const oldSession = sessions.get(tenantId);
        if (oldSession?.sock) {
            oldSession.sock.end(undefined);
        }
        sessions.delete(tenantId);
    }

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger,
        // 🔥 ALTERAÇÃO AQUI:
        browser: ['Zeus-API', 'Chrome', '1.0.0'], 
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log(`[${tenantId}] Novo QR Code gerado`);
            sessions.set(tenantId, { ...sessions.get(tenantId), sock, qrCode: qr, status: 'WAITING_QR' });
        }

        if (connection === 'close') {
            const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            
            console.log(`[${tenantId}] Conexão fechada (Código: ${statusCode}). Reconectando: ${shouldReconnect}`);
            
            // Destrói o socket atual antes de tentar reconectar
            sock.end(undefined);

            if (shouldReconnect) {
                // INCREMENTA O CONTADOR DE TENTATIVAS DE RECONEXÃO
                let attempts = reconnectAttemptsMap.get(tenantId) || 0;
                attempts++;
                reconnectAttemptsMap.set(tenantId, attempts);

                if (attempts >= 5) {
                    console.log(`[${tenantId}] ❌ Excesso de tentativas de reconexão (${attempts}). Desconectando forçadamente para evitar bloqueios e sobrecarga.`);
                    await removeCreds();
                    sessions.delete(tenantId);
                    reconnectAttemptsMap.delete(tenantId);
                } else {
                    console.log(`[${tenantId}] 🔄 Tentativa de reconexão ${attempts}/5 em 5 segundos...`);
                    setTimeout(() => initTenantSession(tenantId), 5000); // Tenta novamente
                }
            } else {
                await removeCreds();
                sessions.delete(tenantId);
                reconnectAttemptsMap.delete(tenantId);
                console.log(`[${tenantId}] Sessão encerrada (Logged Out) e dados apagados do PostgreSQL.`);
            }
        } else if (connection === 'open') {
            console.log(`[${tenantId}] Conectado com sucesso!`);
            reconnectAttemptsMap.delete(tenantId); // Reseta o contador de tentativas de erro ao obter sucesso
            sessions.set(tenantId, { sock, status: 'CONNECTED', qrCode: null });
        }
    });

    sock.ev.on('creds.update', saveCreds);
    
    // 🔥 EVENTOS: CAPTURA DE LEITURA E ENTREGA (STATUS)
    sock.ev.on('messages.update', async (updates) => {
        for (const update of updates) {
            const msgId = update.key.id;
            let statusStr = '';

            // Mapeia os status do Baileys para texto
            if (update.update.status === 2) statusStr = 'RECEIVED_BY_SERVER'; // Sent
            if (update.update.status === 3) statusStr = 'DELIVERED'; // Entregue
            if (update.update.status === 4) statusStr = 'READ'; // Lido/Reproduzido

            if (statusStr && msgId) {
                try {
                    await pool.query(
                        `UPDATE messages_log SET status = $1 WHERE tenant_id = $2 AND message_id = $3`,
                        [statusStr, tenantId, msgId]
                    );
                } catch (error) {}
            }
        }
    });

    // 🔥 EVENTOS: RECEBIMENTO, EDIÇÃO E EXCLUSÃO
    sock.ev.on('messages.upsert', async (m) => {
        if (m.type === 'notify') {
            for (const msg of m.messages) {
                const remoteJid = msg.key.remoteJid;
                const messageId = msg.key.id;
                const messageObj = msg.message;
                const { date, time } = getBrDateTime();
                
                if (!messageObj || !remoteJid || !messageId) continue;

                // 1. DETECÇÃO DE MENSAGEM APAGADA PARA TODOS (REVOKE)
                if (messageObj.protocolMessage?.type === 0 || messageObj.protocolMessage?.type === 14) {
                    const deletedMsgId = messageObj.protocolMessage.key?.id;
                    if (deletedMsgId) {
                        console.log(`[${tenantId}] 🗑️ Mensagem Apagada: ${deletedMsgId}`);
                        await pool.query(
                            `UPDATE messages_log SET is_deleted = TRUE WHERE tenant_id = $1 AND message_id = $2`,
                            [tenantId, deletedMsgId]
                        );
                    }
                    continue;
                }

                // 2. DETECÇÃO DE MENSAGEM EDITADA
                if (messageObj.editedMessage) {
                    const editedMsgId = messageObj.protocolMessage?.key?.id;
                    const newContent = messageObj.editedMessage.message?.protocolMessage?.editedMessage?.conversation || 
                                       messageObj.editedMessage.message?.extendedTextMessage?.text || '[Edição Complexa]';
                    
                    if (editedMsgId) {
                        console.log(`[${tenantId}] ✏️ Mensagem Editada: ${editedMsgId} -> ${newContent}`);
                        await pool.query(
                            `UPDATE messages_log SET is_edited = TRUE, content = $1 WHERE tenant_id = $2 AND message_id = $3`,
                            [newContent, tenantId, editedMsgId]
                        );
                    }
                    continue;
                }

                // Ignora mensagens enviadas por nós mesmos se não for edição/deleção
                if (msg.key.fromMe || remoteJid === 'status@broadcast') continue;

                const messageType = Object.keys(messageObj)[0];
                let content = '';

                if (messageType === 'conversation') content = messageObj.conversation || '';
                else if (messageType === 'extendedTextMessage') content = messageObj.extendedTextMessage?.text || '';
                else if (messageType === 'imageMessage') content = '[Imagem]';
                else if (messageType === 'videoMessage') content = '[Vídeo]';
                else if (messageType === 'audioMessage') content = '[Áudio]';
                else if (messageType === 'documentMessage') content = '[Documento]';
                else if (messageType === 'stickerMessage') content = '[Figurinha]';
                else content = `[Outro Formato: ${messageType}]`;

                console.log(`[${tenantId}] 📩 Nova mensagem de ${remoteJid}: ${content}`);

                // Grava a mensagem recebida no banco perpétuo
                try {
                    await pool.query(
                        `INSERT INTO messages_log 
                        (tenant_id, remote_jid, message_id, direction, status, content, original_content, api_ip, api_region, event_date, event_time) 
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                        ON CONFLICT DO NOTHING`,
                        [tenantId, remoteJid, messageId, 'RECEIVED_WA', 'DELIVERED', content, content, 'Rede WhatsApp (E2E)', 'N/A', date, time]
                    );
                } catch (dbErr) {}

                try {
                    await axios.post(WEBHOOK_URL, {
                        tenantId,
                        from: remoteJid,
                        pushName: msg.pushName || 'Desconhecido',
                        messageType,
                        content,
                        timestamp: msg.messageTimestamp,
                        isGroup: remoteJid?.endsWith('@g.us')
                    });
                } catch (error: any) {}
            }
        }
    });

    if (!sessions.has(tenantId)) {
        sessions.set(tenantId, { sock, status: 'INITIALIZING', qrCode: null });
    }

    return sock;
};

export const getSession = (tenantId: string) => sessions.get(tenantId);

export const getAllSessions = () => {
    return Array.from(sessions.entries()).map(([id, data]) => ({
        tenantId: id,
        status: data.status
    }));
};

export const loadAllSessionsFromDatabase = async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS whatsapp_sessions_v2 (
                tenant_id VARCHAR(255) NOT NULL,
                key_id TEXT NOT NULL,
                data TEXT NOT NULL,
                PRIMARY KEY (tenant_id, key_id)
            );
        `);

        const { rows } = await pool.query("SELECT DISTINCT tenant_id FROM whatsapp_sessions_v2 WHERE key_id = 'creds'");

        console.log(`[Autoboot] Encontradas ${rows.length} sessões prontas para restauração no PostgreSQL.`);

        for (const row of rows) {
            console.log(`[Autoboot] Restaurando conexão automática para o Tenant: ${row.tenant_id}`);
            initTenantSession(row.tenant_id).catch(err => {
                console.error(`[Autoboot] Erro ao restaurar o tenant ${row.tenant_id}:`, err.message);
            });
        }
    } catch (error: any) {
        console.error('[Autoboot] Erro ao ler sessões do banco de dados:', error.message);
    }
};

export const generatePairingCode = async (tenantId: string, phoneNumber: string) => {
    const session = sessions.get(tenantId);
    
    if (!session || !session.sock) throw new Error('Sessão não encontrada ou ainda não inicializada.');

    const cleanNumber = phoneNumber.replace(/\D/g, '');
    if (!cleanNumber.startsWith('55') || cleanNumber.length < 12) {
        throw new Error('Número inválido. Certifique-se de incluir o DDI (55) e o DDD.');
    }

    await new Promise(resolve => setTimeout(resolve, 1500));
    const code = await session.sock.requestPairingCode(cleanNumber);
    return code;
};

// 🔥 NOVO MOTOR DE INTELIGÊNCIA: RESOLUÇÃO DE JID E 9º DÍGITO COM CACHE NO BANCO
export const validateAndGetJid = async (tenantId: string, phoneNumber: string): Promise<string> => {
    const session = sessions.get(tenantId);
    if (!session || !session.sock) throw new Error('Sessão não conectada');

    let cleanNumber = phoneNumber.replace(/\D/g, '');
    if (!cleanNumber.startsWith('55')) cleanNumber = '55' + cleanNumber;

    // 1. Verifica cache no banco de dados para extrema velocidade (evita bater na Meta à toa)
    try {
        const dbCheck = await pool.query('SELECT wa_jid FROM contacts WHERE tenant_id = $1 AND original_number = $2', [tenantId, cleanNumber]);
        if (dbCheck.rowCount !== null && dbCheck.rowCount > 0) return dbCheck.rows[0].wa_jid;
    } catch (err) {
        // Se a tabela ainda não estiver pronta, ignora silenciosamente
    }

    // 2. Tenta o número exatamente como o usuário digitou
    let [result] = await session.sock.onWhatsApp(cleanNumber);

    // 3. Estratégia do 9º Dígito (Específico para Brasil - DDI 55)
    if ((!result || !result.exists) && cleanNumber.startsWith('55')) {
        const ddd = cleanNumber.substring(2, 4);
        const numberPart = cleanNumber.substring(4);
        
        if (numberPart.length === 9 && numberPart.startsWith('9')) {
            // Se tem 9, testa sem o 9
            const semNove = `55${ddd}${numberPart.substring(1)}`;
            const [resSemNove] = await session.sock.onWhatsApp(semNove);
            result = resSemNove;
        } else if (numberPart.length === 8) {
            // Se não tem 9, testa colocando o 9
            const comNove = `55${ddd}9${numberPart}`;
            const [resComNove] = await session.sock.onWhatsApp(comNove);
            result = resComNove;
        }
    }

    // 4. Se encontrou, salva a identidade verdadeira no banco
    if (result && result.exists) {
        try {
            await pool.query(
                `INSERT INTO contacts (tenant_id, original_number, wa_jid) VALUES ($1, $2, $3)
                 ON CONFLICT (tenant_id, original_number) DO UPDATE SET wa_jid = EXCLUDED.wa_jid`,
                [tenantId, cleanNumber, result.jid]
            );
            console.log(`[Contato Verificado] ${cleanNumber} vinculado ao JID Real: ${result.jid}`);
        } catch (dbErr) {
            console.error('[Motor AWS] Erro ao gravar JID no cache:', dbErr);
        }
        return result.jid;
    }

    throw new Error(`Número ${cleanNumber} não possui WhatsApp ativo (ou o número não existe).`);
};