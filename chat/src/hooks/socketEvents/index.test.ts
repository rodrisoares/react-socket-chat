import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import type { Chat, Message } from '@react-chat/shared';

import { queryKeys } from 'config/queryKeys';
import useSocketEvents from './index';

/**
 * `vi.hoisted` porque as fábricas de mock são içadas acima dos imports: uma
 * const comum aqui em cima ainda estaria na zona morta temporal quando elas a
 * lessem.
 */
const state = vi.hoisted(() => ({
  connect: vi.fn(),
  user: null as { id: number } | null,
  /**
   * Os handlers que a ponte registra, por nome de evento.
   *
   * O mock descartava tudo: `socket.on` era um `vi.fn()`, e o que ele recebia
   * evaporava. Sem guardar nao ha como disparar um `new-message` a mao — e o
   * que a ponte faz com o cache ao receber um so pode ser observado assim.
   */
  handlers: new Map<string, (payload: unknown) => void>(),
}));

vi.mock('config/socket', () => ({
  // Corpo em bloco de proposito: `connectSocket` devolve void, e uma arrow de
  // corpo unico devolveria o `any` do espiao.
  connectSocket: () => {
    state.connect();
  },
  disconnectSocket: vi.fn(),
  socket: {
    on: (event: string, handler: (payload: unknown) => void) => {
      state.handlers.set(event, handler);
    },
    off: vi.fn(),
    emit: vi.fn(),
  },
}));

vi.mock('hooks/session', () => ({
  default: () => ({ user: state.user }),
}));

vi.mock('hooks/notifications', () => ({
  default: () => ({ notify: vi.fn() }),
}));

vi.mock('config/fetchInstance', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

function renderBridge() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  }

  // O client vai junto: o que estes testes verificam mora no cache, e sem a
  // referencia nao ha como olhar la dentro depois.
  return { ...renderHook(() => useSocketEvents(), { wrapper: Wrapper }), client };
}

beforeEach(() => {
  state.connect.mockReset();
  state.user = null;
  // Sem limpar, um teste dispararia o handler registrado pelo anterior — que
  // aponta para um QueryClient que ja nao existe mais.
  state.handlers.clear();
});

describe('useSocketEvents', () => {
  /**
   * O socket nasce com `autoConnect: false`, e ate agora so o login o ligava.
   * Depois de um F5 a sessao voltava pelo cookie, mas o tempo real ficava
   * morto: mensagem nova so aparecia recarregando a pagina de novo.
   *
   * Esta ponte e montada uma vez so, no Layout, que so existe com alguem
   * logado — e por isso e daqui que a conexao deve partir.
   */
  it('conecta o socket quando ha sessao', () => {
    state.user = { id: 1 };

    renderBridge();

    expect(state.connect).toHaveBeenCalled();
  });

  /** Sem sessao nao ha token para o handshake: conectar seria recusa certa. */
  it('nao conecta sem sessao', () => {
    renderBridge();

    expect(state.connect).not.toHaveBeenCalled();
  });
});

/**
 * "Fulano mencionou voce" no card, para a mensagem que chega ao vivo.
 *
 * O servidor calcula o `mentionsMe` ao listar as conversas — mas a mensagem que
 * chega pelo socket nao passa por la. Sem o remendo aqui, uma mencao com a
 * conversa fechada so apareceria depois de um F5.
 *
 * Estes testes existem porque este efeito e invisivel de qualquer outra forma:
 * ele so se manifesta com uma segunda conta mandando mencao ao vivo.
 */
describe('useSocketEvents · menção no card', () => {
  const chatId = 'grupo-1';

  /**
   * Uma conversa no formato do cache da lista.
   *
   * O objeto e parcial de proposito: o remendo so espalha campos por cima do
   * que ja existe, e montar um `Chat` inteiro aqui esconderia o que o teste de
   * fato observa atras de vinte linhas de preenchimento.
   */
  function seed(client: QueryClient) {
    client.setQueryData(queryKeys.chats, {
      pages: [
        { chats: [{ id: chatId, mentionsMe: false } as Chat], nextCursor: null },
      ],
      pageParams: [null],
    });
  }

  function cached(client: QueryClient): Chat | undefined {
    const data = client.getQueryData<{ pages: { chats: Chat[] }[] }>(queryKeys.chats);
    return data?.pages[0]?.chats[0];
  }

  /** Dispara o `new-message` como o servidor o mandaria. */
  function arrive(mentions?: number[]) {
    state.handlers.get('new-message')?.({
      chatId,
      id: 2,
      newMessage: {
        id: `m${String(mentions?.length ?? 0)}`,
        userId: 2,
        name: 'Marcia',
        type: 'TEXT',
        text: 'oi @Rodrigo',
      } as Message,
      ...(mentions ? { mentions } : {}),
    });
  }

  it('marca o card quando a mensagem menciona voce', () => {
    state.user = { id: 1 };
    const { client } = renderBridge();
    seed(client);

    act(() => {
      arrive([1]);
    });

    expect(cached(client)?.mentionsMe).toBe(true);
  });

  /**
   * O caso que ninguem lembra de escrever.
   *
   * Sem gravar `false`, o card ficaria preso no chamado de uma mensagem que a
   * seguinte ja substituiu — anunciando uma mencao que nao esta mais la.
   */
  it('desmarca quando a mensagem seguinte nao menciona', () => {
    state.user = { id: 1 };
    const { client } = renderBridge();
    seed(client);

    act(() => {
      arrive([1]);
    });
    act(() => {
      arrive();
    });

    expect(cached(client)?.mentionsMe).toBe(false);
  });
});
