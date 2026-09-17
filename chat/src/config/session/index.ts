import axios, { type AxiosError } from 'axios';
import type { RefreshResponse } from '@react-chat/shared';

import { clearSession, setSession } from 'config/auth';
import { API_URL } from 'config/env';

/**
 * Renovação da sessão, fora do axios do app.
 *
 * Usa um cliente cru de propósito: o do app tem o interceptador que chama esta
 * função no 401 — renovar por ele seria um laço.
 *
 * Não há token nenhum para mandar: o refresh vive num cookie httpOnly, e o
 * `withCredentials` é o que faz o navegador enviá-lo para a API, que está noutra
 * origem. A resposta traz o access token novo, que fica só na memória.
 */

/**
 * Como a renovação terminou. A diferença entre os dois fracassos importa: com
 * o refresh recusado a sessão acabou; com o servidor fora do ar ela continua,
 * e mandar para o login seria jogar fora uma sessão boa por um tropeço da
 * rede — com o access token de 15 min, isso deixou de ser raro.
 */
export type RefreshResult = 'renewed' | 'rejected' | 'unavailable';

/** Renovação em andamento nesta aba: quatro 401 juntos pedem uma só. */
let inFlight: Promise<RefreshResult> | null = null;

async function requestRefresh(): Promise<RefreshResult> {
  try {
    const response = await axios.post<RefreshResponse>(
      `${API_URL}/api/auth/refresh`,
      null,
      { withCredentials: true },
    );
    setSession(response.data);
    return 'renewed';
  } catch (error) {
    /*
     * O 401 daqui é resposta, e não falha: significa "não há sessão neste
     * navegador". Ele aparece no console de toda visita sem cookie — como o
     * cookie é httpOnly, perguntar ao servidor é o único jeito de saber se
     * existe sessão. Quem abre já logado recebe 200 e não vê nada.
     *
     * Ou seja: se você veio até aqui investigando um `POST /api/auth/refresh
     * 401` no console de uma aba anônima, ele é esperado.
     */
    const status = (error as AxiosError).response?.status;
    return status === 400 || status === 401 ? 'rejected' : 'unavailable';
  }
}

/** O navegador tem Web Locks? Sem eles, a corrida entre abas é tratada na unha. */
function lockManager(): LockManager | undefined {
  return (navigator as { locks?: LockManager }).locks;
}

/**
 * Uma aba de cada vez.
 *
 * As abas dividem o mesmo cookie e expiram juntas: sem ordenar, duas mandam o
 * mesmo refresh ao mesmo tempo, a rotação da primeira invalida o da segunda, e
 * a segunda concluiria que a sessão acabou. Com o lock, a segunda só entra
 * depois — e aí já manda o cookie novo, que o navegador guardou para todas.
 */
async function oneTabAtATime(task: () => Promise<RefreshResult>): Promise<RefreshResult> {
  const locks = lockManager();
  if (!locks) return task();

  return await locks.request('react-chat:refresh', task);
}

export function refreshSession(): Promise<RefreshResult> {
  inFlight ??= oneTabAtATime(async () => {
    const result = await requestRefresh();

    // Sem Web Locks não há fila: uma recusa pode ser a corrida com outra aba,
    // que acabou de rotacionar. A segunda tentativa já vai com o cookie novo.
    if (result === 'rejected' && !lockManager()) return requestRefresh();

    return result;
  }).finally(() => {
    inFlight = null;
  });

  return inFlight;
}

/**
 * Fim de sessão sem volta: esquece o token desta aba e manda para o login
 * dizendo o que aconteceu. O `expired=1` é o que faz a tela explicar em vez de
 * aparecer do nada — era esse o susto de antes.
 */
export function sessionLost(): void {
  clearSession();
  if (window.location.pathname.startsWith('/login')) return;
  window.location.assign('/login?expired=1');
}
