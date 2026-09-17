import jwt from 'jsonwebtoken';
import { env } from './env.js';

export interface TokenPayload {
  sub: number;
  /**
   * Sessao de onde o token nasceu. Sem ela o servidor nao tinha como achar as
   * conexoes de um dispositivo para derruba-las quando a sessao e encerrada.
   */
  sid: string;
}

/** Quem o token identifica: o usuario e o dispositivo. */
export interface TokenIdentity {
  userId: number;
  sessionId: string;
}

export function signToken(userId: number, sessionId: string): string {
  return jwt.sign({ sub: userId, sid: sessionId } satisfies TokenPayload, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn,
  } as jwt.SignOptions);
}

/**
 * Identidade do token, ou null se ele for invalido ou expirado.
 *
 * Token sem `sid` e de antes de as sessoes irem dentro dele e tambem vale
 * null: o client o troca pelo refresh no primeiro 401, sem o usuario notar.
 */
export function verifyToken(token: string): TokenIdentity | null {
  try {
    const payload = jwt.verify(token, env.jwtSecret);
    if (typeof payload === 'string') return null;

    const { sub, sid } = payload as Partial<Record<'sub' | 'sid', unknown>>;
    if (typeof sub !== 'number' || typeof sid !== 'string') return null;

    return { userId: sub, sessionId: sid };
  } catch {
    return null;
  }
}

/** Extrai o token de um header "Authorization: Bearer <token>". */
export function tokenFromHeader(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token;
}
