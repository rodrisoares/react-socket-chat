import { randomUUID } from 'node:crypto';
import pino from 'pino';
import { pinoHttp } from 'pino-http';

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

/**
 * O log de cada requisição, com um id que costura as linhas de uma mesma.
 *
 * Antes só o que falhava deixava rastro: uma requisição bem-sucedida não
 * aparecia em lugar nenhum, então não havia como responder "o que este usuário
 * fez antes do erro" nem medir quanto uma rota demora. E as linhas de erro que
 * existiam eram soltas — nada ligava o "falha ao medir a imagem" à requisição
 * que o causou.
 *
 * O `x-request-id` de entrada é respeitado quando vem: atrás de um proxy que já
 * numera as requisições, o mesmo id passa a valer dos dois lados. Ele também
 * volta no cabeçalho da resposta, que é o que permite a alguém relatar um
 * problema dizendo qual requisição foi.
 *
 * A sonda de saúde fica de fora do log: ela roda a cada poucos segundos e
 * afogaria o resto.
 */
export const httpLogger = pinoHttp({
  logger,
  genReqId: (req, res) => {
    const received = req.headers['x-request-id'];
    const id = typeof received === 'string' && received ? received : randomUUID();

    res.setHeader('X-Request-Id', id);
    return id;
  },
  autoLogging: { ignore: (req) => req.url === '/health' },
  /** Erro do servidor é `error`; recusa (4xx) é `warn`; o resto, `info`. */
  customLogLevel: (_req, res, error) => {
    if (error || res.statusCode >= 500) return 'error';
    return res.statusCode >= 400 ? 'warn' : 'info';
  },
});
