import type { Request, Response } from 'express';

import { env } from './env.js';

/**
 * O refresh token vive num cookie httpOnly.
 *
 * Ele ficava no localStorage, ao lado do access token: qualquer XSS levava a
 * sessão inteira — e por 30 dias, que é a validade dele. Num cookie httpOnly o
 * JavaScript da página não o alcança, e o `sameSite` impede que outro site o
 * faça viajar.
 *
 * O `path` fecha mais um pouco: o cookie só é enviado para as duas rotas que o
 * usam, /api/auth/refresh e /api/auth/logout. Requisição de mensagem, de
 * upload ou de perfil não o carrega.
 */
const REFRESH_COOKIE = 'react-chat.refresh';
const REFRESH_PATH = '/api/auth';

/** O que define o cookie e o que o apaga precisam bater, ou ele não sai. */
const baseOptions = {
  httpOnly: true,
  sameSite: env.cookieSameSite,
  secure: env.cookieSecure,
  path: REFRESH_PATH,
} as const;

export function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE, token, {
    ...baseOptions,
    maxAge: env.refreshExpiresDays * 24 * 60 * 60 * 1000,
  });
}

/** O token que o navegador mandou, ou null quando não há sessão neste aparelho. */
export function readRefreshCookie(req: Request): string | null {
  const cookies = req.cookies as Record<string, unknown> | undefined;
  const token = cookies?.[REFRESH_COOKIE];

  return typeof token === 'string' && token ? token : null;
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, baseOptions);
}
