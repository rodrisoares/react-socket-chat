/**
 * A sessão desta aba, só na memória.
 *
 * O access token e o refresh ficavam no localStorage: qualquer XSS lia os dois
 * e levava a conta inteira — o refresh vale 30 dias. Agora o refresh viaja num
 * cookie httpOnly, que o JavaScript da página não alcança, e o access token
 * mora aqui, numa variável de módulo: ele morre junto com a aba, e o F5 pede um
 * novo apresentando o cookie.
 *
 * O `sessionId` acompanha o token porque a tela de dispositivos precisa saber
 * qual da lista é "este aqui" — e ele não é segredo.
 */
let token: string | null = null;
let sessionId: string | null = null;

export interface StoredSession {
  token: string;
  sessionId: string;
}

export function getToken(): string | null {
  return token;
}

/**
 * Esta aba tem sessão agora.
 *
 * As consultas autenticadas perguntam antes de sair. Sem isto, a lista de
 * conversas disparava já no primeiro render — antes de a sessão ser conhecida —,
 * tomava um 401 garantido, e o interceptador concluía que a sessão havia
 * expirado: numa primeira visita, a tela de login abria dizendo que a sessão
 * tinha acabado, sem nunca ter existido uma.
 */
export function hasSession(): boolean {
  return token !== null;
}

export function getSessionId(): string | null {
  return sessionId;
}

export function setSession(session: StoredSession): void {
  token = session.token;
  sessionId = session.sessionId;
}

/** Sair da conta. Quem apaga o cookie é o servidor, no /api/auth/logout. */
export function clearSession(): void {
  token = null;
  sessionId = null;
}
