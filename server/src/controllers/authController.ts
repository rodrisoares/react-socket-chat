import type { RequestHandler } from 'express';
import type { LoginInput, RegisterInput } from '@react-chat/shared/schemas';

import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from '../config/cookies.js';
import { AppError } from '../errors/AppError.js';
import { currentUserId } from '../middlewares/requireAuth.js';
import * as authService from '../services/authService.js';

/**
 * Cadastro, entrada, renovação, saída e a restauração da sessão no F5.
 *
 * O refresh token nunca aparece no corpo da resposta: ele entra e sai pelo
 * cookie httpOnly — é o controller que faz essa ponte, e o serviço nem sabe
 * que existe um navegador do outro lado.
 */

export const register: RequestHandler = async (req, res) => {
  const { refreshToken, ...session } = await authService.register(
    req.body as RegisterInput,
    req.get('user-agent'),
  );

  // Mesma ponte do login: o refresh vai para o cookie httpOnly, e o corpo leva
  // só o access token, a sessão e o usuário.
  setRefreshCookie(res, refreshToken);
  res.status(201).json(session);
};

export const login: RequestHandler = async (req, res) => {
  const { email, password } = req.body as LoginInput;
  const { refreshToken, ...session } = await authService.login(
    email,
    password,
    req.get('user-agent'),
  );

  setRefreshCookie(res, refreshToken);
  res.json(session);
};

/**
 * Renova o acesso. Não exige o header de autenticação de propósito: quem chama
 * é justamente quem está com o access token expirado — o cookie é a prova.
 */
export const refresh: RequestHandler = async (req, res) => {
  const current = readRefreshCookie(req);
  if (!current) throw new AppError(401, 'Sessão expirada. Entre de novo.');

  const { refreshToken, ...session } = await authService.refresh(current);

  setRefreshCookie(res, refreshToken);
  res.json(session);
};

export const logout: RequestHandler = async (req, res) => {
  const current = readRefreshCookie(req);
  if (current) await authService.logout(current);

  // Some do navegador mesmo quando não havia sessão viva: sair é sair.
  clearRefreshCookie(res);
  res.json({ ok: true });
};

export const restore: RequestHandler = async (req, res) => {
  res.json(await authService.restore(currentUserId(req)));
};
