import type { RequestHandler } from 'express';
import { tokenFromHeader, verifyToken } from '../config/jwt.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Preenchido pelo requireAuth. */
      userId?: number;
      /** Sessao do dispositivo que fez a requisicao, lida do proprio token. */
      sessionId?: string;
    }
  }
}

export const requireAuth: RequestHandler = (req, res, next) => {
  const token = tokenFromHeader(req.headers.authorization);
  const identity = token ? verifyToken(token) : null;

  if (!identity) {
    res.status(401).json({ error: 'Autenticação necessária' });
    return;
  }

  req.userId = identity.userId;
  req.sessionId = identity.sessionId;
  next();
};

/** Id do usuario autenticado. So use apos o requireAuth. */
export function currentUserId(req: { userId?: number }): number {
  if (!req.userId) throw new Error('currentUserId chamado sem requireAuth');
  return req.userId;
}

/** Sessao do dispositivo autenticado. So use apos o requireAuth. */
export function currentSessionId(req: { sessionId?: string }): string {
  if (!req.sessionId) throw new Error('currentSessionId chamado sem requireAuth');
  return req.sessionId;
}
