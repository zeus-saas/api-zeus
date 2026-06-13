import { makeWASocket, DisconnectReason, fetchLatestBaileysVersion, Browsers } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import axios from 'axios';
import { pool } from '../database';
import { usePostgresAuthState } from './postgresAuth';
import { dbLogQueue } from '../queue/logQueue';

const sessions = new Map<string, any>();
const reconnectAttemptsMap = new Map<string, number>(); 
const logger = pino({ level: 'silent' });

const WEBHOOK_URL = process.env.WEBHOOK_URL || 'http://localhost:3333/api/webhook'; 

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
        browser: ['Zeus-SaaS', 'Chrome', '2.0.0'], 
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
            sock.end(undefined);

            if (shouldReconnect) {
                let attempts = reconnectAttemptsMap.get(tenantId) || 0;
                attempts++;
                reconnectAttemptsMap.set(tenantId, attempts);

                if (attempts >= 5) {
                    console.log(`[${tenantId}] ❌ Excesso de tentativas de reconexão (${attempts}). Desconectando forçadamente.`);
                    await removeCreds();
                    sessions.delete(tenantId);
                    reconnectAttemptsMap.delete(tenantId);
                } else {
                    console.log(`[${tenantId}] 🔄 Tentativa de reconexão ${attempts}/5 em 5 segundos...`);
                    setTimeout(() => initTenantSession(tenantId), 5000); 
                }
            } else {
                await removeCreds();
                sessions.delete(tenantId);
                reconnectAttemptsMap.delete(tenantId);
                console.log(`[${tenantId}] Sessão encerrada (Logged Out) e dados apagados.`);
            }
        } else if (connection === 'open') {
            console.log(`[${tenantId}] Conectado com sucesso!`);
            reconnectAttemptsMap.delete(tenantId); 
            sessions.set(tenantId, { sock, status: 'CONNECTED', qrCode: null });
        }
    });

    sock.ev.on('creds.update', saveCreds);
    
    // 🔥 EVENTOS: CAPTURA DE LEITURA (Escrita Assíncrona no DB via Queue)
    sock.ev.on('messages.update', async (updates) => {
        for (const update of updates) {
            const msgId = update.key.id;
            let statusStr = '';

            if (update.update.status === 2) statusStr = 'RECEIVED_BY_SERVER'; 
            if (update.update.status === 3) statusStr = 'DELIVERED'; 
            if (update.update.status === 4) statusStr = 'READ'; 

            if (statusStr && msgId) {
                dbLogQueue.add('update-status', {
                    action: 'UPDATE_STATUS',
                    tenantId,
                    messageId: msgId,
                    status: statusStr
                });
            }
        }
    });

    // 🔥 EVENTOS: RECEBIMENTO, EDIÇÃO E EXCLUSÃO (Escrita Assíncrona)
    sock.ev.on('messages.upsert', async (m) => {
        if (m.type === 'notify') {
            for (const msg of m.messages) {
                const remoteJid = msg.key.remoteJid;
                const messageId = msg.key.id;
                const messageObj = msg.message;
                const { date, time } = getBrDateTime();
                
                if (!messageObj || !remoteJid || !messageId) continue;

                // REVOKE
                if (messageObj.protocolMessage?.type === 0 || messageObj.protocolMessage?.type === 14) {
                    const deletedMsgId = messageObj.protocolMessage.key?.id;
                    if (deletedMsgId) {
                        dbLogQueue.add('mark-deleted', {
                            action: 'MARK_DELETED',
                            tenantId,
                            messageId: deletedMsgId
                        });
                    }
                    continue;
                }

                // EDIÇÃO
                if (messageObj.editedMessage) {
                    const editedMsgId = messageObj.protocolMessage?.key?.id;
                    const newContent = messageObj.editedMessage.message?.protocolMessage?.editedMessage?.conversation || 
                                       messageObj.editedMessage.message?.extendedTextMessage?.text || '[Edição Complexa]';
                    
                    if (editedMsgId) {
                        dbLogQueue.add('mark-edited', {
                            action: 'MARK_EDITED',
                            tenantId,
                            messageId: editedMsgId,
                            content: newContent
                        });
                    }
                    continue;
                }

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

                // Insere log no DB em lote via Queue
                dbLogQueue.add('insert-message', {
                    action: 'INSERT_MESSAGE',
                    tenantId,
                    remoteJid,
                    messageId,
                    direction: 'RECEIVED_WA',
                    status: 'DELIVERED',
                    content,
                    originalContent: content,
                    apiIp: 'Rede WhatsApp (E2E)',
                    apiRegion: 'N/A',
                    eventDate: date,
                    eventTime: time
                });

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
        const { rows } = await pool.query("SELECT DISTINCT tenant_id FROM whatsapp_sessions_v2 WHERE key_id = 'creds'");
        console.log(`[Autoboot] Encontradas ${rows.length} sessões prontas para restauração.`);

        for (const row of rows) {
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
    if (!session || !session.sock) throw new Error('Sessão não encontrada.');

    const cleanNumber = phoneNumber.replace(/\D/g, '');
    if (!cleanNumber.startsWith('55') || cleanNumber.length < 12) {
        throw new Error('Número inválido.');
    }

    await new Promise(resolve => setTimeout(resolve, 1500));
    return await session.sock.requestPairingCode(cleanNumber);
};

export const validateAndGetJid = async (tenantId: string, phoneNumber: string): Promise<string> => {
    const session = sessions.get(tenantId);
    if (!session || !session.sock) throw new Error('Sessão não conectada');

    let cleanNumber = phoneNumber.replace(/\D/g, '');
    if (!cleanNumber.startsWith('55')) cleanNumber = '55' + cleanNumber;

    try {
        const dbCheck = await pool.query('SELECT wa_jid FROM contacts WHERE tenant_id = $1 AND original_number = $2', [tenantId, cleanNumber]);
        if (dbCheck.rowCount !== null && dbCheck.rowCount > 0) return dbCheck.rows[0].wa_jid;
    } catch (err) {}

    let [result] = await session.sock.onWhatsApp(cleanNumber);

    if ((!result || !result.exists) && cleanNumber.startsWith('55')) {
        const ddd = cleanNumber.substring(2, 4);
        const numberPart = cleanNumber.substring(4);
        
        if (numberPart.length === 9 && numberPart.startsWith('9')) {
            const semNove = `55${ddd}${numberPart.substring(1)}`;
            const [resSemNove] = await session.sock.onWhatsApp(semNove);
            result = resSemNove;
        } else if (numberPart.length === 8) {
            const comNove = `55${ddd}9${numberPart}`;
            const [resComNove] = await session.sock.onWhatsApp(comNove);
            result = resComNove;
        }
    }

    if (result && result.exists) {
        try {
            await pool.query(
                `INSERT INTO contacts (tenant_id, original_number, wa_jid) VALUES ($1, $2, $3)
                 ON CONFLICT (tenant_id, original_number) DO UPDATE SET wa_jid = EXCLUDED.wa_jid`,
                [tenantId, cleanNumber, result.jid]
            );
        } catch (dbErr) {}
        return result.jid;
    }

    throw new Error(`Número ${cleanNumber} não possui WhatsApp ativo.`);
};