import type { RequestHandler } from 'express';
import { tokenFromHeader, verifyToken } from '../config/jwt.js';
import { isSessionRevoked } from '../config/revokedSessions.js';

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

  /*
   * A assinatura vale, mas a sessão foi encerrada enquanto este token ainda
   * corria — pela lista de dispositivos, pela troca de senha ou pelo logout.
   *
   * Sem esta linha, o aparelho derrubado continuava lendo e escrevendo pelo
   * HTTP até o token vencer. É a única consulta que o `requireAuth` faz, e ela
   * é um `Map` em memória: o token segue sem estado, e a autenticação sem ida
   * ao banco.
   */
  if (isSessionRevoked(identity.sessionId)) {
    res.status(401).json({ error: 'Sessão encerrada. Entre de novo.' });
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
