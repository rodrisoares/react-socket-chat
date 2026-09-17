/**
 * O contrato entre o servidor e o cliente.
 *
 * Os tipos da API eram copiados à mão em `chat/src/types/api.ts`: o servidor
 * mudava o payload e o cliente só descobria em produção. Aqui eles são os
 * mesmos nos dois lados — o servidor tipa o que serializa, o cliente tipa o
 * que recebe, e o `tsc` acusa a diferença.
 *
 * Os schemas Zod moram em `@react-chat/shared/schemas`, num ponto de entrada
 * separado: só o servidor valida, e assim o `zod` não entra no pacote que vai
 * para o navegador.
 */
export * from './api.js';
export * from './events.js';
export * from './limits.js';
export * from './mentions.js';
export * from './password.js';
export * from './status.js';
