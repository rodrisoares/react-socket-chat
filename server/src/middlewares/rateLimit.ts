import rateLimit from 'express-rate-limit';
import type { Request } from 'express';

import { env } from '../config/env.js';
import { currentUserId } from './requireAuth.js';

/**
 * Limites das rotas autenticadas. So o login tinha limite; enviar mensagem,
 * criar conversa e subir anexo nao tinham nenhum.
 *
 * A chave e o id do usuario, nao o IP: estes middlewares rodam depois do
 * requireAuth, e limitar por IP puniria todo mundo atras do mesmo NAT.
 */
function byUser(req: Request): string {
  return String(currentUserId(req));
}

/**
 * Limites das rotas abertas, onde nao ha usuario para servir de chave: valem
 * por IP, que e o unico identificador disponivel antes de alguem se autenticar.
 */

/** Freia forca bruta no login sem atrapalhar o uso normal. */
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.loginRateLimit,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Muitas tentativas de login. Tente novamente em alguns minutos.' },
});

/**
 * Cadastro. Era a unica rota aberta sem limite nenhum: um laco criava contas
 * sem parar, enchia a tabela de usuarios e, com ela, a lista de contatos que
 * todo mundo ve.
 */
export const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.registerRateLimit,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Muitas contas criadas deste endereço. Tente mais tarde.' },
});

/**
 * Renovacao de sessao. O refresh token e um segredo de 30 dias que viaja num
 * cookie; sem limite, tentar adivinha-lo sai de graca. Teto alto de proposito:
 * cada aba aberta renova a cada 15 min, e varias pessoas podem dividir o mesmo
 * IP atras de um NAT.
 */
export const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.refreshRateLimit,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Muitas renovações seguidas. Tente novamente em alguns minutos.' },
});

/** Envio e edicao de mensagem — inclui o upload de anexo, que passa aqui. */
export const messageLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: env.messageRateLimit,
  keyGenerator: byUser,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Muitas mensagens seguidas. Espere alguns segundos.' },
});

/**
 * Busca, dentro da conversa e global. Limite alto de proposito: cada tecla
 * digitada pode virar uma requisicao, e travar quem procura seria pior do que
 * o custo que se quer evitar. O que ele barra e o laco automatizado.
 */
export const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: env.searchRateLimit,
  keyGenerator: byUser,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Muitas buscas seguidas. Espere alguns segundos.' },
});

/**
 * Upload de anexo. O messageLimiter ja conta as mensagens, mas um anexo custa
 * disco e banda, e nao um registro no banco — por isso um teto proprio, mais
 * apertado e numa janela mais longa.
 *
 * O `skip` deixa passar a mensagem de texto: so requisicao com arquivo gasta
 * desta cota.
 */
export const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.uploadRateLimit,
  keyGenerator: byUser,
  skip: (req) => !req.is('multipart/form-data'),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Muitos anexos enviados em pouco tempo. Tente mais tarde.' },
});

/** Criar conversa ou grupo: raro no uso normal, barato de abusar. */
export const createChatLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.createChatRateLimit,
  keyGenerator: byUser,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Muitas conversas criadas em pouco tempo. Tente mais tarde.' },
});
