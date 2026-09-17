import { io } from 'socket.io-client';
import { getToken } from 'config/auth';
import { API_URL } from 'config/env';
import { refreshSession, sessionLost, type RefreshResult } from 'config/session';

// autoConnect desligado: só conectamos depois de ter token.
export const socket = io(API_URL, {
  autoConnect: false,
  auth: (cb: (data: { token: string | null }) => void) => cb({ token: getToken() }),
});

/** Espera antes de tentar de novo quando o servidor não pôde renovar agora. */
const RETRY_MS = 5000;

/**
 * O que fazer depois de uma renovação pedida pelo socket.
 *
 * Com sessão nova, reconecta. Recusada, a sessão acabou, e o login explica.
 * E com o servidor fora do ar, tenta de novo daqui a pouco: depois de uma
 * recusa no handshake o socket.io não reconecta sozinho, e a tela ficava
 * presa em "sem conexão".
 */
function afterRefresh(result: RefreshResult): void {
  if (result === 'renewed') {
    socket.connect();
    return;
  }

  if (result === 'rejected') {
    sessionLost();
    return;
  }

  window.setTimeout(() => {
    // Saiu da conta enquanto esperava: não há o que reconectar.
    if (getToken() && !socket.connected) socket.connect();
  }, RETRY_MS);
}

/**
 * O handshake do socket também usa o access token, e ele expira como qualquer
 * outro. Sem isto, uma reconexão depois da expiração ficava presa em "sem
 * conexão" para sempre, mesmo com a sessão viva — as requisições HTTP se
 * renovavam sozinhas e o tempo real, não.
 */
let renewing = false;

socket.on('connect_error', (error) => {
  if (renewing || !error.message.toLowerCase().includes('autentica')) return;

  renewing = true;
  void refreshSession()
    .then(afterRefresh)
    .finally(() => {
      renewing = false;
    });
});

/**
 * Derrubado pelo servidor: é o que acontece quando esta sessão é encerrada
 * noutro dispositivo, ou quando a senha é trocada. O socket.io não reconecta
 * sozinho nesse caso. Se a sessão ainda vale, volta; se não, o login explica.
 */
socket.on('disconnect', (reason) => {
  if (reason !== 'io server disconnect') return;
  void refreshSession().then(afterRefresh);
});

export function connectSocket(): void {
  if (!socket.connected) socket.connect();
}

export function disconnectSocket(): void {
  if (socket.connected) socket.disconnect();
}
