import axios from 'axios';

export const getBrDateTime = () => {
    const now = new Date();
    return {
        date: now.toLocaleDateString('pt-BR'),
        time: now.toLocaleTimeString('pt-BR')
    };
};

export const getIpLocation = async (ip: string): Promise<{ ip: string; region: string }> => {
    if (!ip || ip === '127.0.0.1' || ip === '::1' || ip.startsWith('::ffff:127.0.0.1')) {
        return { ip: '127.0.0.1 (Localhost)', region: 'Ambiente Local / Dev' };
    }
    const cleanIp = ip.replace('::ffff:', '');
    try {
        const response = await axios.get(`http://ip-api.com/json/${cleanIp}?fields=status,country,regionName,city`);
        if (response.data && response.data.status === 'success') {
            return { ip: cleanIp, region: `${response.data.city}, ${response.data.regionName} - ${response.data.country}` };
        }
        return { ip: cleanIp, region: 'Região Não Identificada' };
    } catch (error) {
        return { ip: cleanIp, region: 'Falha no Provedor' };
    }
};