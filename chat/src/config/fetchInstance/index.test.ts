import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearSession, setSession } from 'config/auth';

/**
 * O 401 do axios: quando ele é fim de sessão, e quando não é.
 *
 * Este arquivo nasceu de um bug que chegou ao usuário. A lista de conversas
 * saía no primeiro render, antes de a sessão ser conhecida, e tomava um 401
 * garantido; o interceptador tentava renovar, falhava, e concluía que a sessão
 * havia expirado. Resultado: a primeira visita ao app abria o login dizendo
 * "sua sessão expirou", sem nunca ter existido uma.
 *
 * A regra que faltava, e que este arquivo tranca: só é fim de sessão quando a
 * requisição de fato levava um token. Sem token, o 401 significa "não está
 * logado", e disso cuida o redirecionamento do Layout.
 */

type Rejected = (error: unknown) => Promise<unknown>;

/**
 * `vi.hoisted` porque o `create` é chamado no import do módulo sob teste —
 * antes do corpo deste arquivo rodar. Uma const comum aqui em cima ainda
 * estaria na zona morta temporal quando a factory do mock a lesse.
 */
const captured = vi.hoisted(() => ({
  onRejected: null as Rejected | null,
  request: vi.fn(),
}));

const session = vi.hoisted(() => ({
  refreshSession: vi.fn(),
  sessionLost: vi.fn(),
}));

vi.mock('config/session', () => ({
  refreshSession: session.refreshSession,
  sessionLost: session.sessionLost,
}));

vi.mock('axios', () => ({
  default: {
    create: () => ({
      interceptors: {
        request: { use: () => undefined },
        response: {
          use: (_onOk: unknown, onRejected: Rejected) => {
            captured.onRejected = onRejected;
          },
        },
      },
      // O módulo faz `.bind` em cada um destes ao montar o objeto exportado.
      request: captured.request,
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
    }),
  },
}));

// Import só pelo efeito: é ele que registra o interceptador no mock acima.
import 'config/fetchInstance';

/** Um erro de resposta como o interceptador o recebe. */
function failure(status: number, config?: { sentToken?: string | null; retried?: boolean }) {
  return Object.assign(new Error(`HTTP ${status}`), { response: { status }, config });
}

/** Entrega o erro ao interceptador e espera o desfecho, seja qual for. */
async function handle(error: unknown): Promise<unknown> {
  const onRejected = captured.onRejected;
  if (!onRejected) throw new Error('o interceptador de resposta nao foi registrado');

  return onRejected(error).catch((rejected: unknown) => rejected);
}

beforeEach(() => {
  captured.request.mockClear();
  session.sessionLost.mockClear();
  session.refreshSession.mockReset();
  session.refreshSession.mockResolvedValue('rejected');
  clearSession();
});

describe('401 sem sessão', () => {
  /** O bug: a primeira visita era recebida com "sua sessão expirou". */
  it('nao encerra a sessao quando a requisicao saiu sem token', async () => {
    await handle(failure(401, { sentToken: null }));

    expect(session.sessionLost).not.toHaveBeenCalled();
  });

  it('nao encerra quando ja repetiu e nao havia token', async () => {
    await handle(failure(401, { sentToken: null, retried: true }));

    expect(session.sessionLost).not.toHaveBeenCalled();
  });

  /** Sem `config` não há como saber se havia token: na dúvida, não encerra. */
  it('nao encerra um 401 sem config nenhuma', async () => {
    await handle(failure(401));

    expect(session.sessionLost).not.toHaveBeenCalled();
  });
});

describe('401 com sessão', () => {
  it('encerra quando o refresh e recusado', async () => {
    await handle(failure(401, { sentToken: 'antigo' }));

    expect(session.sessionLost).toHaveBeenCalledTimes(1);
  });

  it('encerra quando ja repetiu com token e tomou 401 de novo', async () => {
    await handle(failure(401, { sentToken: 'antigo', retried: true }));

    expect(session.sessionLost).toHaveBeenCalledTimes(1);
  });

  it('renovada, repete a requisicao em vez de encerrar', async () => {
    session.refreshSession.mockResolvedValue('renewed');

    await handle(failure(401, { sentToken: 'antigo' }));

    expect(captured.request).toHaveBeenCalledTimes(1);
    expect(session.sessionLost).not.toHaveBeenCalled();
  });

  /** Tropeço da rede não é fim de sessão — ver config/session. */
  it('servidor fora do ar nao encerra a sessao', async () => {
    session.refreshSession.mockResolvedValue('unavailable');

    await handle(failure(401, { sentToken: 'antigo' }));

    expect(session.sessionLost).not.toHaveBeenCalled();
  });

  /**
   * Outra requisição desta aba renovou depois que esta saiu: o token guardado
   * já é outro, e repetir basta — sem gastar uma renovação.
   */
  it('token trocado no meio do caminho so pede a repeticao', async () => {
    setSession({ token: 'novo', sessionId: 's1' });

    await handle(failure(401, { sentToken: 'antigo' }));

    expect(captured.request).toHaveBeenCalledTimes(1);
    expect(session.refreshSession).not.toHaveBeenCalled();
    expect(session.sessionLost).not.toHaveBeenCalled();
  });
});

describe('outros erros', () => {
  it('nao mexe na sessao fora do 401', async () => {
    await handle(failure(500, { sentToken: 'antigo' }));

    expect(session.sessionLost).not.toHaveBeenCalled();
    expect(session.refreshSession).not.toHaveBeenCalled();
  });
});
