// src/services/batch-campaign.service.ts
import { getSession } from '../whatsapp/manager';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

interface MessageBlock {
  type: 'text' | 'media' | 'audio';
  content: string;
  fileName?: string;
  caption?: string;
}

const formatToJid = (phone: string): string => {
  let cleaned = phone.replace(/\D/g, '');
  if (!cleaned.startsWith('55')) cleaned = '55' + cleaned;
  return `${cleaned}@s.whatsapp.net`;
};

export const sendCampaignToSingleContact = async (tenantId: string, contact: string, messages: MessageBlock[]) => {
  const session = getSession(tenantId);
  const sock = session?.sock;

  // 1. Verificação de Segurança: Se não há sock, encerramos a função aqui.
  if (!sock) {
    console.error(`[Motor AWS] ERRO: Sessão não encontrada ou não conectada para: ${tenantId}`);
    return;
  }

  const formattedJid = formatToJid(contact);
  console.log(`[Motor AWS] Iniciando sequência para: ${formattedJid}`);

  // 2. Loop principal de envio
  for (const msg of messages) {
    try {
      console.log(`[Motor AWS] Processando mensagem tipo: ${msg.type}`);

      // Envio de status de presença
      if (typeof sock.sendPresenceUpdate === 'function') {
        const presenceStatus = msg.type === 'audio' ? 'recording' : 'composing';
        await sock.sendPresenceUpdate(presenceStatus, formattedJid);
        await delay(4000);
      }

      console.log(`[Motor AWS] Executando sendMessage para ${formattedJid}...`);
      
      let sentResult;

      // Execução do envio
      switch (msg.type) {
        case 'text':
          sentResult = await sock.sendMessage(formattedJid, { text: msg.content });
          break;
        case 'media':
          const isPdf = msg.content.toLowerCase().endsWith('.pdf') || msg.fileName?.toLowerCase().endsWith('.pdf');
          sentResult = await sock.sendMessage(formattedJid, {
            [isPdf ? 'document' : 'image']: { url: msg.content },
            mimetype: isPdf ? 'application/pdf' : 'image/jpeg',
            caption: msg.caption
          });
          break;
        case 'audio':
          sentResult = await sock.sendMessage(formattedJid, {
            audio: { url: msg.content },
            mimetype: 'audio/mp4',
            ptt: true
          });
          break;
        default:
          console.warn(`[Motor AWS] Tipo de mensagem não reconhecido: ${msg.type}`);
          continue; // Pula para a próxima mensagem
      }

      // Log de sucesso
      console.log(`[Motor AWS] Resposta do Servidor WA:`, JSON.stringify(sentResult));
      console.log(`[Motor AWS] Mensagem disparada com sucesso!`);

      // Finaliza presença
      if (typeof sock.sendPresenceUpdate === 'function') {
        await sock.sendPresenceUpdate('paused', formattedJid);
      }

      await delay(5000); // Delay entre mensagens

    } catch (err: any) {
      console.error(`[Motor AWS] ERRO CRÍTICO NO ENVIO PARA ${formattedJid}:`, err);
    }
  }
};