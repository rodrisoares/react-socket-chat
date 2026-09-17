import pino from 'pino';

/**
 * O log do servidor.
 *
 * Era `console.log`/`console.error` espalhado: texto solto, sem nível, sem
 * instante e sem como filtrar. Em produção isso não se consulta — cada linha
 * tem um formato, e não há o que agregar. O pino escreve JSON por linha, que
 * qualquer coletor lê, e o nível permite calar o ruído sem apagar os erros.
 *
 * Silencioso nos testes de propósito: a suíte exercita caminhos de erro de
 * propósito, e o rastro deles esconderia a falha de verdade no meio do texto.
 */
export const logger = pino({
  level: process.env['LOG_LEVEL'] ?? (process.env['NODE_ENV'] === 'test' ? 'silent' : 'info'),
});
