import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';

import { queryKeys } from 'config/queryKeys';
import useChatList, { mapChatsInCache, refreshChat } from './index';

const get = vi.fn();

vi.mock('config/fetchInstance', () => ({
  default: {
    get: (url: string) => get(url) as Promise<{ data: unknown }>,
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

// A lista so busca com sessao: sem isto a consulta nasce desligada.
vi.mock('config/auth', () => ({
  hasSession: () => true,
  getToken: () => 'token-de-teste',
}));

/**
 * O mesmo `staleTime` do app (ver config/queryClient). Ele e o assunto deste
 * arquivo: e dentro dessa janela que o `reloadChats` precisa ir ao servidor
 * assim mesmo.
 */
const STALE_TIME = 30_000;

function renderChatList() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: STALE_TIME } },
  });

  function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  }

  return renderHook(() => useChatList(), { wrapper: Wrapper });
}

beforeEach(() => {
  get.mockReset();
  get.mockResolvedValue({ data: { chats: [], nextCursor: null } });
});

describe('reloadChats', () => {
  /**
   * Bloquear e desbloquear sao privados: o servidor nao emite evento nenhum,
   * porque o outro lado nao pode ficar sabendo. Sem evento, o `reloadChats` e o
   * unico caminho de atualizacao da tela — e se ele devolver o cache, a conversa
   * continua deixando escrever para alguem que acabou de ser bloqueado.
   */
  it('vai ao servidor mesmo com o cache ainda fresco', async () => {
    const { result } = renderChatList();

    // A primeira busca e a da montagem.
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));

    await act(async () => {
      await result.current.reloadChats();
    });

    expect(get).toHaveBeenCalledTimes(2);
  });

  /** Quem chama usa o retorno para achar a conversa recem-criada. */
  it('devolve a lista que acabou de chegar', async () => {
    const { result } = renderChatList();
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));

    get.mockResolvedValue({
      data: { chats: [{ id: 'nova', name: 'Marcia' }], nextCursor: null },
    });

    let devolvido: { id: string }[] = [];
    await act(async () => {
      // `Chat[]` ja satisfaz `{ id: string }[]`: o cast so escondia o tipo real.
      devolvido = await result.current.reloadChats();
    });

    expect(devolvido.map((chat) => chat.id)).toEqual(['nova']);
  });
});

/**
 * `chat-updated` buscando so a conversa que mudou.
 *
 * O evento invalidava a lista inteira: cada renomeacao de grupo, cada entrada e
 * cada saida custavam um refetch de todas as paginas ja carregadas. O resumo
 * (`GET /:id/summary`) existia no servidor desde sempre para isto, e ninguem o
 * chamava.
 */
describe('refreshChat', () => {
  const chatId = 'grupo-1';

  function seed(client: QueryClient) {
    client.setQueryData(queryKeys.chats, {
      pages: [
        {
          chats: [
            { id: chatId, name: 'Time', unreadMessages: 0 },
            { id: 'outra', name: 'Marcia', unreadMessages: 3 },
          ],
          nextCursor: null,
        },
      ],
      pageParams: [null],
    });
  }

  function cachedChats(client: QueryClient): { id: string; name: string }[] {
    const data = client.getQueryData<{
      pages: { chats: { id: string; name: string }[] }[];
    }>(queryKeys.chats);

    return data?.pages.flatMap((page) => page.chats) ?? [];
  }

  /**
   * O objeto novo entra inteiro, e nao por cima do antigo: o que o servidor
   * **nao** manda tambem e informacao. Um grupo que perdeu a foto manda `image`
   * ausente, e um merge manteria a foto antiga na lista.
   */
  it('troca so a conversa que mudou, sem tocar nas outras', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    seed(client);

    get.mockResolvedValue({ data: { chat: { id: chatId, name: 'Time novo' } } });

    await refreshChat(client, chatId);

    expect(get).toHaveBeenCalledWith(`/api/chats/${chatId}/summary`);
    expect(cachedChats(client)).toEqual([
      { id: chatId, name: 'Time novo' },
      { id: 'outra', name: 'Marcia', unreadMessages: 3 },
    ]);
  });

  /** O servidor devolve `null` de quem excluiu a conversa noutro aparelho. */
  it('tira da lista a conversa que deixou de existir', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    seed(client);

    get.mockResolvedValue({ data: { chat: null } });

    await refreshChat(client, chatId);

    expect(cachedChats(client).map((chat) => chat.id)).toEqual(['outra']);
  });

  /**
   * A conversa nao esta no cache: e o caso de quem acabou de ser adicionado a
   * um grupo. Nao ha o que remendar, e ai sim a lista inteira e buscada.
   */
  it('busca a lista quando a conversa ainda nao esta nela', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    seed(client);
    const invalidate = vi.spyOn(client, 'invalidateQueries');

    await refreshChat(client, 'recem-criada');

    expect(get).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.chats });
  });

  /** Falhou o resumo: cai no caminho antigo — uma requisicao a mais, e nao uma tela velha. */
  it('busca a lista quando o resumo falha', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    seed(client);
    const invalidate = vi.spyOn(client, 'invalidateQueries');

    get.mockRejectedValue(new Error('sem rede'));

    await refreshChat(client, chatId);

    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.chats });
  });
});

/**
 * Uma escrita so no cache, e nao uma por conversa.
 *
 * Presenca e perfil valem para toda conversa em que a pessoa aparece, e isso
 * era feito chamando o `patchChatInCache` uma vez para cada uma. Como cada
 * chamada clona todas as paginas, o custo era quadratico: com cem conversas,
 * um contato abrindo o app disparava cem clonagens de cem conversas.
 */
describe('mapChatsInCache', () => {
  function seedPages(client: QueryClient) {
    client.setQueryData(queryKeys.chats, {
      pages: [
        { chats: [{ id: 'a', name: 'Ana' }, { id: 'b', name: 'Bento' }], nextCursor: 'b' },
        { chats: [{ id: 'c', name: 'Caio' }], nextCursor: null },
      ],
      pageParams: [null, 'b'],
    });
  }

  function allChats(client: QueryClient): { id: string; name: string }[] {
    const data = client.getQueryData<{
      pages: { chats: { id: string; name: string }[] }[];
    }>(queryKeys.chats);

    return data?.pages.flatMap((page) => page.chats) ?? [];
  }

  it('alcanca todas as paginas', () => {
    const client = new QueryClient();
    seedPages(client);

    mapChatsInCache(client, (chat) => ({ ...chat, name: chat.name.toUpperCase() }));

    expect(allChats(client).map((chat) => chat.name)).toEqual(['ANA', 'BENTO', 'CAIO']);
  });

  /**
   * A identidade do objeto e o que diz ao React que aquele card nao precisa
   * redesenhar: devolver `chat` sem tocar nele e o caminho barato.
   */
  it('mantem a referencia das conversas que a funcao nao mudou', () => {
    const client = new QueryClient();
    seedPages(client);

    const antes = allChats(client);
    mapChatsInCache(client, (chat) =>
      chat.id === 'b' ? { ...chat, name: 'outro' } : chat,
    );
    const depois = allChats(client);

    expect(depois[0]).toBe(antes[0]);
    expect(depois[2]).toBe(antes[2]);
    expect(depois[1]).not.toBe(antes[1]);
  });

  /**
   * A chave casa por prefixo, entao esta atualizacao tambem e oferecida a
   * `['chats', id, 'details']` e companhia. O que nao tem forma de listagem
   * paginada precisa voltar intocado.
   */
  it('nao estraga o que esta sob a mesma chave sem ser listagem', () => {
    const client = new QueryClient();
    seedPages(client);
    client.setQueryData(queryKeys.chatDetails('a'), { id: 'a', members: [] });

    mapChatsInCache(client, (chat) => ({ ...chat, name: 'mudou' }));

    expect(client.getQueryData(queryKeys.chatDetails('a'))).toEqual({
      id: 'a',
      members: [],
    });
  });
});
