import { env } from './env.js';

/**
 * As sessões encerradas cujo access token ainda não venceu.
 *
 * O access token é sem estado de propósito: ele não é consultado no banco a
 * cada requisição, e é isso que faz a autenticação custar uma verificação de
 * assinatura em vez de uma ida ao SQLite. O preço era um buraco conhecido:
 * encerrar uma sessão derrubava o socket na hora, mas o aparelho continuava
 * fazendo requisições HTTP até o token vencer — quinze minutos de acesso
 * depois de a pessoa clicar em "encerrar".
 *
 * Esta lista fecha o buraco sem desfazer a escolha. Ela guarda só o `sid` das
 * sessões encerradas, e só até o token daquela sessão vencer: passado o prazo,
 * a entrada não serve para nada — o próprio `verify` já recusa o token — e sai.
 * Ou seja, o tamanho dela é proporcional a quantas sessões foram encerradas
 * nos últimos quinze minutos, e não a quantas existem.
 *
 * Duas limitações, ditas em voz alta:
 *
 * - É memória deste processo. Com mais de uma instância, cada uma conheceria
 *   só as próprias revogações — e aí o lugar disto passa a ser o Redis, junto
 *   com o adapter do socket.io (ver InterServerEvents no pacote compartilhado).
 * - Reiniciar o servidor esquece tudo. O que sobra é o comportamento de antes,
 *   e por no máximo o prazo do token.
 *
 * Quem consulta é o `requireAuth`. O socket não precisa: o handshake dele já
 * confere a sessão no banco.
 */

/** `sid` -> instante em que a entrada deixa de ser necessária. */
const revoked = new Map<string, number>();

/**
 * Tira as entradas vencidas.
 *
 * Roda na escrita, e não num temporizador: o custo é proporcional ao que já se
 * está fazendo, e um mapa que ninguém alimenta não precisa de faxina nenhuma.
 */
function prune(now: number): void {
  for (const [sessionId, expiresAt] of revoked) {
    if (expiresAt <= now) revoked.delete(sessionId);
  }
}

/** Esta sessão acabou de ser encerrada: o token dela não vale mais nada. */
export function revokeSession(sessionId: string): void {
  const now = Date.now();

  prune(now);
  revoked.set(sessionId, now + env.accessTokenMs);
}

/** O mesmo para uma leva — "sair dos outros dispositivos", troca de senha. */
export function revokeSessions(sessionIds: readonly string[]): void {
  for (const sessionId of sessionIds) revokeSession(sessionId);
}

export function isSessionRevoked(sessionId: string): boolean {
  const expiresAt = revoked.get(sessionId);
  if (expiresAt === undefined) return false;

  // Vencida: o `verify` do token já a recusaria, e manter a entrada só ocuparia
  // espaço. Aproveita a consulta para limpá-la.
  if (expiresAt <= Date.now()) {
    revoked.delete(sessionId);
    return false;
  }

  return true;
}

/** Zera a lista. Existe para a suíte não levar revogação de um teste ao outro. */
export function forgetRevokedSessions(): void {
  revoked.clear();
}
