import swaggerJsDoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import { Request, Response, NextFunction } from 'express';

const swaggerOptions = {
    swaggerDefinition: {
        openapi: '3.0.0',
        info: {
            title: 'Zeus SaaS - API Gateway',
            version: '2.0.0',
            description: 'Painel unificado para gestão de empresas, assinaturas, e instâncias do WhatsApp.',
        },
        servers: [
            { url: '/', description: 'Servidor Atual (Auto-detectado)' }
        ],
        components: {
            securitySchemes: {
                bearerAuth: {
                    type: 'http',
                    scheme: 'bearer',
                    bearerFormat: 'JWT / API Key',
                    description: 'Insira o Token JWT retornado no Login ou a API Key da Instância.'
                }
            }
        },
        security: [{ bearerAuth: [] }],
        paths: {
            '/api/saas/plans': {
                post: {
                    summary: '1. Criar Plano de Assinatura (Setup Inicial)',
                    tags: ['Módulo SaaS - Clientes e Faturamento'],
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        name: { type: 'string', example: 'Plano Starter' },
                                        max_whatsapp_connections: { type: 'integer', example: 1 },
                                        max_users: { type: 'integer', example: 3 },
                                        monthly_price: { type: 'number', example: 97.00 }
                                    }
                                }
                            }
                        }
                    },
                    responses: { 201: { description: 'Plano criado com sucesso.' } }
                }
            },
            '/api/saas/register': {
                post: {
                    summary: '2. Cadastrar Nova Empresa (Registro de Cliente)',
                    tags: ['Módulo SaaS - Clientes e Faturamento'],
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        companyName: { type: 'string', example: 'Tech Solutions LTDA' },
                                        document: { type: 'string', example: '12345678000199' },
                                        userName: { type: 'string', example: 'Administrador' },
                                        email: { type: 'string', example: 'admin@techsolutions.com' },
                                        password: { type: 'string', example: 'senha123' },
                                        planId: { type: 'integer', example: 1 }
                                    }
                                }
                            }
                        }
                    },
                    responses: { 201: { description: 'Empresa e Usuário cadastrados.' } }
                }
            },
            '/api/saas/login': {
                post: {
                    summary: '3. Fazer Login no Painel SaaS',
                    tags: ['Módulo SaaS - Clientes e Faturamento'],
                    description: 'Retorna o Token JWT que deve ser inserido no botão "Authorize" no topo do Swagger.',
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        email: { type: 'string', example: 'admin@techsolutions.com' },
                                        password: { type: 'string', example: 'senha123' }
                                    }
                                }
                            }
                        }
                    },
                    responses: { 200: { description: 'Login bem-sucedido com Token JWT.' } }
                }
            },
            '/api/saas/profile': {
                get: {
                    summary: '4. Visualizar Perfil e Assinatura',
                    tags: ['Módulo SaaS - Clientes e Faturamento'],
                    description: 'Requer que você tenha inserido o Token JWT no botão "Authorize".',
                    responses: { 200: { description: 'Dados da Empresa e Status do Plano.' } }
                }
            },
            '/api/v1/admin/tenants': {
                post: {
                    summary: 'Criar uma nova instância de Tenant (Master)',
                    tags: ['Administração Master (Motor WhatsApp)'],
                    description: 'O ID do tenant será gerado automaticamente. Requer Master Key.',
                    responses: { 200: { description: 'Instância criada com sucesso e chave gerada.' } }
                }
            },
            '/api/v1/admin/tenants/{tenantId}': {
                delete: {
                    summary: 'Excluir Instância (Master)',
                    tags: ['Administração Master (Motor WhatsApp)'],
                    parameters: [{ in: 'path', name: 'tenantId', required: true, schema: { type: 'string' } }],
                    responses: { 200: { description: 'Instância excluída com sucesso.' } }
                }
            },
            '/api/v1/admin/tenants/{tenantId}/suspend': {
                post: {
                    summary: 'Suspender ou Reativar Instância (Master)',
                    tags: ['Administração Master (Motor WhatsApp)'],
                    parameters: [{ in: 'path', name: 'tenantId', required: true, schema: { type: 'string' } }],
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    required: ['action'],
                                    properties: { action: { type: 'string', example: 'suspend' } }
                                }
                            }
                        }
                    },
                    responses: { 200: { description: 'Status atualizado com sucesso.' } }
                }
            },
            '/api/v1/admin/tenants/{tenantId}/logs': {
                get: {
                    summary: 'Emitir Extrato de Log .txt (Master)',
                    tags: ['Administração Master (Motor WhatsApp)'],
                    parameters: [{ in: 'path', name: 'tenantId', required: true, schema: { type: 'string' } }],
                    responses: { 200: { description: 'Arquivo .txt gerado' } }
                }
            },
            '/api/v1/sessions/{tenantId}/start': {
                post: {
                    summary: 'Iniciar Sessão Manualmente (Gerar QR Code)',
                    tags: ['Sessão e Conexão (WhatsApp)'],
                    parameters: [{ in: 'path', name: 'tenantId', required: true, schema: { type: 'string' } }],
                    responses: { 200: { description: 'Sessão iniciada com sucesso' } }
                }
            },
            '/api/v1/sessions/{tenantId}/pairing-code': {
                post: {
                    summary: 'Solicitar Código PIN',
                    tags: ['Sessão e Conexão (WhatsApp)'],
                    parameters: [{ in: 'path', name: 'tenantId', required: true, schema: { type: 'string' } }],
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    required: ['phoneNumber'],
                                    properties: { phoneNumber: { type: 'string', example: '5541999999999' } }
                                }
                            }
                        }
                    },
                    responses: { 200: { description: 'Código PIN gerado' } }
                }
            },
            '/api/v1/sessions/{tenantId}/check-number/{phoneNumber}': {
                get: {
                    summary: 'Consultar JID de um Número (Validação)',
                    tags: ['Sessão e Conexão (WhatsApp)'],
                    parameters: [
                        { in: 'path', name: 'tenantId', required: true, schema: { type: 'string' } },
                        { in: 'path', name: 'phoneNumber', required: true, schema: { type: 'string' }, description: 'Ex: 5541999999999' }
                    ],
                    responses: { 200: { description: 'JID retornado com sucesso' } }
                }
            },
            '/api/v1/sessions/{tenantId}/messages': {
                post: {
                    summary: 'Disparar Mensagem (Texto/Mídia)',
                    tags: ['Mensagens (WhatsApp)'],
                    parameters: [{ in: 'path', name: 'tenantId', required: true, schema: { type: 'string' } }],
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    required: ['number'],
                                    properties: {
                                        number: { type: 'string', example: '5541999999999' },
                                        text: { type: 'string', example: 'Olá! Mensagem da API.' },
                                        mediaUrl: { type: 'string', example: '' },
                                        mediaType: { type: 'string', example: 'document' }
                                    }
                                }
                            }
                        }
                    },
                    responses: { 200: { description: 'Mensagem adicionada à fila auditada' } }
                }
            },
            '/api/v1/sessions': {
                get: {
                    summary: 'Listar instâncias ativas na memória',
                    tags: ['Sessão e Conexão (WhatsApp)'],
                    responses: { 200: { description: 'Lista retornada' } }
                }
            }
        }
    },
    apis: [],
};

export const swaggerDocs = swaggerJsDoc(swaggerOptions);

export const swaggerAuth = (req: Request, res: Response, next: NextFunction) => {
    if (req.url.includes('.css') || req.url.includes('.js') || req.url.includes('.png')) {
        return next();
    }
    const { key } = req.query;
    const masterKey = process.env.API_KEY;

    if (!masterKey) return res.status(500).send('Erro: API_KEY Master não configurada no .env');

    if (key === masterKey || req.headers.authorization?.includes(masterKey)) {
        next();
    } else {
        res.status(401).send('Acesso Negado: Forneça a Master Key correta na URL. Exemplo: /api-docs/?key=sua_master_key');
    }
};

export { swaggerUi };