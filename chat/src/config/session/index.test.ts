import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_REQUEST_HEADER, APP_REQUEST_VALUE } from '@react-chat/shared';

import { getToken, setSession } from 'config/auth';
import { refreshSession } from './index';

const post = vi.fn();

// O `vi.fn()` devolve `any`; o cast mantém o mock dentro do contrato real.
vi.mock('axios', () => ({
  default: {
    post: (url: string, payload: unknown, config: unknown) =>
      post(url, payload, config) as Promise<{ data: unknown }>,
  },
}));

/** Erro no formato do axios, com o status da resposta. */
function httpError(status: number) {
  return Object.assign(new Error(`HTTP ${status}`), { response: { status } });
}

/** O que o /api/auth/refresh devolve agora: o access token e a sessão, e só. */
const renewed = { token: 'acesso-b', sessionId: 's1' };

/**
 * Liga os Web Locks num navegador que não os tem.
 *
 * O jsdom não traz `navigator.locks`, e é a ausência deles que liga a segunda
 * tentativa — os dois caminhos precisam de teste, então cada um instala o seu.
 */
function installLocks(): void {
  const locks = {
    request: <T>(_name: string, task: () => Promise<T>) => task(),
  };

  Object.defineProperty(navigator, 'locks', { value: locks, configurable: true });
}

beforeEach(() => {
  post.mockReset();
  setSession({ token: 'acesso-a', sessionId: 's1' });
});

afterEach(() => {
  Reflect.deleteProperty(navigator, 'locks');
});

describe('refreshSession', () => {
  it('renova e guarda o token novo so na memoria', async () => {
    installLocks();
    post.mockResolvedValue({ data: renewed });

    expect(await refreshSession()).toBe('renewed');
    expect(getToken()).toBe('acesso-b');
  });

  /**
   * Não há token nenhum no corpo: o refresh viaja no cookie httpOnly, e é o
   * `withCredentials` que faz o navegador mandá-lo para a API de outra origem.
   * Sem ele a renovação sai sem credencial e todo 401 vira fim de sessão.
   */
  /**
   * O `withCredentials` e o que faz o cookie do refresh viajar para a API, que
   * esta noutra origem. O cabecalho marca a requisicao como vinda do app: sem
   * ele o servidor recusa com 403, porque esta e uma das duas rotas que um site
   * terceiro conseguiria disparar (ver middlewares/csrf no servidor).
   */
  it('vai sem corpo, com as credenciais ligadas e com a marca do app', async () => {
    installLocks();
    post.mockResolvedValue({ data: renewed });

    await refreshSession();

    expect(post).toHaveBeenCalledWith(
      expect.stringContaining('/api/auth/refresh'),
      null,
      {
        withCredentials: true,
        headers: { [APP_REQUEST_HEADER]: APP_REQUEST_VALUE },
      },
    );
  });

  it('chamadas simultaneas dividem uma ida so', async () => {
    installLocks();
    post.mockResolvedValue({ data: renewed });

    const results = await Promise.all([refreshSession(), refreshSession()]);

    expect(results).toEqual(['renewed', 'renewed']);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('refresh recusado pelo servidor e o fim da sessao', async () => {
    installLocks();
    post.mockRejectedValue(httpError(401));

    expect(await refreshSession()).toBe('rejected');
    // Com a fila dos locks, uma recusa é uma recusa: não há corrida a descontar.
    expect(post).toHaveBeenCalledTimes(1);
  });

  /** Com o token de 15 min, um tropeço da rede deixou de ser raro — e não é fim de sessão. */
  it('servidor fora do ar nao encerra a sessao', async () => {
    installLocks();
    post.mockRejectedValue(new Error('Network Error'));

    expect(await refreshSession()).toBe('unavailable');
    expect(getToken()).toBe('acesso-a');
  });

  /**
   * As abas dividem o mesmo cookie e expiram juntas: a rotação de uma invalida
   * o refresh que a outra acabou de mandar. Sem Web Locks não há fila para
   * evitar isso, então a recusa ganha uma segunda tentativa — que já sai com o
   * cookie novo, e não pode virar "sessão encerrada".
   */
  it('sem Web Locks, a recusa vira nova tentativa com o cookie novo', async () => {
    post.mockRejectedValueOnce(httpError(401)).mockResolvedValueOnce({ data: renewed });

    expect(await refreshSession()).toBe('renewed');
    expect(post).toHaveBeenCalledTimes(2);
    expect(getToken()).toBe('acesso-b');
  });

  it('sem Web Locks, duas recusas seguidas sao recusa mesmo', async () => {
    post.mockRejectedValue(httpError(401));

    expect(await refreshSession()).toBe('rejected');
    expect(post).toHaveBeenCalledTimes(2);
  });
});
