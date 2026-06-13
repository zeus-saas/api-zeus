import { pool } from '../database';

/**
 * Busca o tenant ID exclusivo vinculado a uma empresa.
 * @param companyId O ID da empresa extraído do token JWT.
 */
export async function getTenantByCompanyId(companyId: string): Promise<string> {
    const result = await pool.query(
        'SELECT whatsapp_tenant_id FROM saas_companies WHERE id = $1',
        [companyId]
    );

    if (result.rows.length === 0 || !result.rows[0].whatsapp_tenant_id) {
        throw new Error('Empresa não possui um Tenant de WhatsApp configurado.');
    }

    return result.rows[0].whatsapp_tenant_id;
}