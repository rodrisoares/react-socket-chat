/**
 * Os schemas Zod, num ponto de entrada só do servidor.
 *
 * Separados do `index.ts` de propósito: quem valida é o servidor, e assim o
 * `zod` não entra no pacote que vai para o navegador — o cliente importa só
 * tipos e constantes, que somem na compilação.
 */
export * from './auth.js';
export * from './chat.js';
export * from './openapi.js';
export * from './user.js';
