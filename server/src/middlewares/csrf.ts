import type { RequestHandler } from 'express';
import { APP_REQUEST_HEADER, APP_REQUEST_VALUE } from '@react-chat/shared';

/**
 * Só aceita a requisição se ela veio da aplicação.
 *
 * Vale para as duas rotas que agem a partir do cookie do refresh — renovar e
 * sair. Elas não exigem o header de autenticação de propósito (quem chama é
 * justamente quem está com o access token vencido), e é essa ausência que as
 * deixaria abertas a um site terceiro quando o cookie é `sameSite=none`.
 *
 * O porquê de um cabeçalho resolver está no `APP_REQUEST_HEADER`, no pacote
 * compartilhado. Em resumo: escrevê-lo obriga o navegador a um preflight, e o
 * preflight morre no CORS.
 *
 * O resto da API não precisa disto: ela é autenticada por `Authorization`, que
 * o navegador nunca anexa sozinho — é o mesmo motivo pelo qual API com token no
 * header não sofre CSRF.
 */
export const requireAppRequest: RequestHandler = (req, res, next) => {
  if (req.get(APP_REQUEST_HEADER) !== APP_REQUEST_VALUE) {
    res.status(403).json({ error: 'Requisição não reconhecida' });
    return;
  }

  next();
};
