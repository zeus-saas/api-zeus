import axios from 'axios';
import { pool } from '../database';
import { validateAndGetJid } from '../whatsapp/manager';

export interface LeadFilters {
    cnae?: string;
    estado?: string;
    cidade?: string;
}

export class LeadEnrichmentService {
    
    /**
     * Enriquecimento de um CNPJ único e salvamento na base do Tenant
     */
    static async enrichAndSaveLead(tenantId: string, cnpj: string): Promise<any> {
        const cleanCnpj = cnpj.replace(/\D/g, '');
        if (cleanCnpj.length !== 14) throw new Error('CNPJ Inválido.');

        try {
            // Utilizando uma API pública gratuita para exemplo (BrasilAPI)
            const response = await axios.get(`https://brasilapi.com.br/api/cnpj/v1/${cleanCnpj}`);
            const data = response.data;

            const razaoSocial = data.razao_social || 'Sem Nome';
            const nomeFantasia = data.nome_fantasia || razaoSocial;
            const telefonePrincipal = data.ddd_telefone_1 || '';
            const email = data.email || '';
            const cnaePrincipal = data.cnae_fiscal_descricao || '';
            const cidade = data.municipio || '';
            const estado = data.uf || '';
            const capitalSocial = data.capital_social || 0;
            const cep = data.cep || '';

            // Tenta descobrir se o telefone tem WhatsApp nativamente (Opcional, pode gastar tempo)
            let isWhatsappValid = false;
            let waJid = null;
            if (telefonePrincipal) {
                try {
                    waJid = await validateAndGetJid(tenantId, telefonePrincipal);
                    isWhatsappValid = !!waJid;
                } catch (e) {
                    isWhatsappValid = false; // Telefone fixo ou sem WA
                }
            }

            const query = `
                INSERT INTO b2b_leads (
                    tenant_id, cnpj, razao_social, nome_fantasia, telefone_principal, 
                    email, cnae_principal, capital_social, cidade, estado, cep, 
                    is_whatsapp_valid, wa_jid
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                ON CONFLICT (tenant_id, cnpj) DO UPDATE SET 
                    telefone_principal = EXCLUDED.telefone_principal,
                    is_whatsapp_valid = EXCLUDED.is_whatsapp_valid,
                    wa_jid = EXCLUDED.wa_jid
                RETURNING *;
            `;

            const values = [
                tenantId, cleanCnpj, razaoSocial, nomeFantasia, telefonePrincipal, 
                email, cnaePrincipal, capitalSocial, cidade, estado, cep, 
                isWhatsappValid, waJid
            ];

            const result = await pool.query(query, values);
            return result.rows[0];

        } catch (error: any) {
            console.error(`[Lead Service] Erro ao enriquecer CNPJ ${cleanCnpj}:`, error.message);
            throw new Error(`Falha ao capturar dados do CNPJ: ${error.message}`);
        }
    }

    /**
     * Busca leads salvos no banco para montar o público-alvo da Campanha
     */
    static async getTargetAudience(tenantId: string, filters: LeadFilters): Promise<any[]> {
        let query = `SELECT * FROM b2b_leads WHERE tenant_id = $1 AND is_whatsapp_valid = TRUE`;
        const values: any[] = [tenantId];
        let index = 2;

        if (filters.estado) {
            query += ` AND estado = $${index}`;
            values.push(filters.estado);
            index++;
        }

        if (filters.cidade) {
            query += ` AND cidade = $${index}`;
            values.push(filters.cidade);
            index++;
        }

        if (filters.cnae) {
            query += ` AND cnae_principal ILIKE $${index}`;
            values.push(`%${filters.cnae}%`);
            index++;
        }

        const result = await pool.query(query, values);
        return result.rows;
    }
}