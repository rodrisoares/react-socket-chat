import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import type { Chat, ChatPage } from '@react-chat/shared';

import { hasSession } from 'config/auth';
import fetch from 'config/fetchInstance';
import { queryKeys } from 'config/queryKeys';

/**
 * A lista de conversas e tudo que se faz com uma conversa inteira.
 *
 * O cache é do TanStack Query: paginação por cursor, uma busca só por chave e
 * invalidação quando o socket avisa que algo mudou. As ações são otimistas e
 * desfazem sozinhas se o servidor recusar — antes elas disparavam um
 * `void fetch.post(...)` sem `catch`, e a tela ficava mentindo em silêncio.
 */

type ChatsCache = InfiniteData<ChatPage, string | null>;

/** Muda uma conversa no cache, sem tocar nas outras páginas. */
export function patchChatInCache(
  queryClient: QueryClient,
  chatId: string,
  patch: Partial<Chat>,
): void {
  queryClient.setQueryData<ChatsCache>(queryKeys.chats, (old) =>
    old
      ? {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            chats: page.chats.map((chat) =>
              chat.id === chatId ? { ...chat, ...patch } : chat,
            ),
          })),
        }
      : old,
  );
}

/**
 * Põe a conversa nova no lugar da antiga — inteira, e não por cima.
 *
 * O `patchChatInCache` espalha campos sobre o que já estava lá, e é o certo
 * para uma mudança conhecida. Aqui o objeto veio inteiro do servidor, e o que
 * ele **não** traz também é informação: um grupo que perdeu a foto manda
 * `image` ausente, e um merge manteria a foto antiga na lista até o próximo F5.
 */
function replaceChatInCache(queryClient: QueryClient, next: Chat): void {
  queryClient.setQueryData<ChatsCache>(queryKeys.chats, (old) =>
    old
      ? {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            chats: page.chats.map((chat) => (chat.id === next.id ? next : chat)),
          })),
        }
      : old,
  );
}

/** Tira a conversa da lista — "excluir" é só para quem pediu. */
function removeChatFromCache(queryClient: QueryClient, chatId: string): void {
  queryClient.setQueryData<ChatsCache>(queryKeys.chats, (old) =>
    old
      ? {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            chats: page.chats.filter((chat) => chat.id !== chatId),
          })),
        }
      : old,
  );
}

/**
 * Uma conversa mudou: busca só ela, e não a lista inteira.
 *
 * É para isto que existe `GET /api/chats/:id/summary` — ele devolve a conversa
 * no mesmo formato do card. Até agora ninguém o chamava: o `chat-updated`
 * invalidava a chave da lista, e cada renomeação de grupo, cada entrada e cada
 * saída custavam um refetch de todas as páginas já carregadas.
 *
 * Três casos, e os três importam:
 *
 * - A conversa não está no cache. É o caso de quem acabou de ser adicionado a
 *   um grupo: não há o que remendar, e aí sim a lista é buscada.
 * - O servidor devolve `null`. A conversa deixou de existir para este usuário
 *   — ele a excluiu noutro dispositivo —, e ela sai da lista.
 * - Caso comum: o objeto novo entra por cima do antigo.
 *
 * A falha cai no caminho antigo de propósito: uma tela desatualizada é pior do
 * que uma requisição a mais.
 */
export async function refreshChat(
  queryClient: QueryClient,
  chatId: string,
): Promise<void> {
  const cache = queryClient.getQueryData<ChatsCache>(queryKeys.chats);
  const isKnown = cache?.pages.some((page) =>
    page.chats.some((chat) => chat.id === chatId),
  );

  if (!isKnown) {
    await queryClient.invalidateQueries({ queryKey: queryKeys.chats });
    return;
  }

  try {
    const { data } = await fetch.get<{ chat: Chat | null }>(
      `/api/chats/${chatId}/summary`,
    );

    if (data.chat) replaceChatInCache(queryClient, data.chat);
    else removeChatFromCache(queryClient, chatId);
  } catch {
    await queryClient.invalidateQueries({ queryKey: queryKeys.chats });
  }
}

/**
 * Semeia a lista com a primeira página que veio junto do login (ou do /me).
 * Sem isto a tela abriria vazia e pediria ao servidor o que ele acabou de
 * mandar.
 */
export function seedChatList(queryClient: QueryClient, page: ChatPage): void {
  queryClient.setQueryData<ChatsCache>(queryKeys.chats, {
    pages: [page],
    pageParams: [null],
  });
}

function fetchChats(cursor: string | null): Promise<ChatPage> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  return fetch.get<ChatPage>(`/api/me/chats${query}`).then((response) => response.data);
}

export default function useChatList() {
  const queryClient = useQueryClient();

  const query = useInfiniteQuery({
    queryKey: queryKeys.chats,
    // O Layout chama este hook no topo, antes de saber se há alguém logado.
    // Sem esta guarda a lista saía no primeiro render, sem token, e o 401 dela
    // mandava a primeira visita para o login com "sua sessão expirou".
    enabled: hasSession(),
    queryFn: ({ pageParam }) => fetchChats(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });

  const chats = useMemo(
    () => query.data?.pages.flatMap((page) => page.chats) ?? [],
    [query.data],
  );

  /**
   * Toda ação de conversa segue o mesmo desenho: muda o cache na hora, manda
   * para o servidor, e volta atrás se ele recusar.
   */
  const action = useMutation({
    mutationFn: ({ request }: { chatId: string; patch: Partial<Chat>; request: Promise<unknown> }) =>
      request,
    onMutate: async ({ chatId, patch }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.chats });
      const previous = queryClient.getQueryData<ChatsCache>(queryKeys.chats);

      patchChatInCache(queryClient, chatId, patch);
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(queryKeys.chats, context.previous);
    },
  });

  const run = useCallback(
    (chatId: string, patch: Partial<Chat>, request: Promise<unknown>) => {
      action.mutate({ chatId, patch, request });
    },
    [action],
  );

  /**
   * Ler zera o não-lido e apaga o "mencionou você".
   *
   * Os dois juntos porque são a mesma coisa vista de dois ângulos: o chamado
   * pendente deixa de ser pendente no instante em que a conversa é lida. Sem o
   * `mentionsMe` aqui, o badge sumiria na hora e o "Fulano mencionou você"
   * ficaria no card até o próximo refetch — o servidor já aplica a mesma regra
   * ao montar a lista.
   */
  const markChatRead = useCallback(
    (chatId: string) =>
      run(
        chatId,
        { unreadMessages: 0, mentionsMe: false },
        fetch.post(`/api/chats/${chatId}/readMessages`),
      ),
    [run],
  );

  const markChatUnread = useCallback(
    (chatId: string) =>
      run(
        chatId,
        { unreadMessages: 1 },
        fetch.post(`/api/chats/${chatId}/unreadMessages`),
      ),
    [run],
  );

  const markChatPinned = useCallback(
    (chatId: string, isPinned: boolean) =>
      run(
        chatId,
        { isPinned },
        isPinned
          ? fetch.post(`/api/chats/${chatId}/pin`)
          : fetch.delete(`/api/chats/${chatId}/pin`),
      ),
    [run],
  );

  const markChatArchived = useCallback(
    (chatId: string, isArchived: boolean) =>
      run(
        chatId,
        { isArchived },
        isArchived
          ? fetch.post(`/api/chats/${chatId}/archive`)
          : fetch.delete(`/api/chats/${chatId}/archive`),
      ),
    [run],
  );

  /**
   * Silenciar, com ou sem prazo.
   *
   * Sem `minutes` é o "até eu desfazer"; com, é o prazo — 8 horas, uma semana.
   * O `mutedUntil` otimista é calculado aqui só para o menu já poder dizer
   * "silenciada até as 15h" antes da resposta; o valor que vale é o que o
   * servidor devolve no `chat-updated` logo em seguida, e é dele que sai a hora
   * exata (o relógio desta máquina pode estar adiantado).
   */
  const markChatMuted = useCallback(
    (chatId: string, isMuted: boolean, minutes?: number) =>
      run(
        chatId,
        {
          isMuted,
          mutedUntil:
            isMuted && minutes
              ? new Date(Date.now() + minutes * 60_000).toISOString()
              : null,
        },
        isMuted
          ? fetch.post(`/api/chats/${chatId}/mute`, minutes ? { minutes } : {})
          : fetch.delete(`/api/chats/${chatId}/mute`),
      ),
    [run],
  );

  /**
   * Limpar esvazia a conversa e o histórico dela, mas ela fica na lista.
   *
   * Mutação própria porque são dois caches a desfazer: o da lista e o do
   * histórico. Pelo `run` genérico só a lista voltava, e a conversa continuava
   * vazia na tela mesmo depois de o servidor recusar a limpeza.
   */
  const clearHistory = useMutation({
    mutationFn: (chatId: string) => fetch.post(`/api/chats/${chatId}/clear`),
    onMutate: async (chatId) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.chats });

      const previousChats = queryClient.getQueryData<ChatsCache>(queryKeys.chats);
      const previousMessages = queryClient.getQueryData(queryKeys.messages(chatId));

      patchChatInCache(queryClient, chatId, { lastMessage: null, unreadMessages: 0 });
      queryClient.setQueryData(queryKeys.messages(chatId), {
        pages: [{ messages: [], hasMore: false }],
        pageParams: [null],
      });

      return { previousChats, previousMessages };
    },
    onError: (_error, chatId, context) => {
      if (context?.previousChats) {
        queryClient.setQueryData(queryKeys.chats, context.previousChats);
      }
      if (context?.previousMessages !== undefined) {
        queryClient.setQueryData(queryKeys.messages(chatId), context.previousMessages);
      }
    },
  });

  const deleteChat = useMutation({
    mutationFn: (chatId: string) => fetch.delete(`/api/chats/${chatId}`),
    onMutate: async (chatId) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.chats });
      const previous = queryClient.getQueryData<ChatsCache>(queryKeys.chats);

      removeChatFromCache(queryClient, chatId);
      queryClient.removeQueries({ queryKey: queryKeys.messages(chatId) });

      return { previous };
    },
    onError: (_error, _chatId, context) => {
      if (context?.previous) queryClient.setQueryData(queryKeys.chats, context.previous);
    },
  });

  /**
   * Busca a lista de novo, agora — e devolve o que chegou.
   *
   * `refetchQueries`, e não `fetchInfiniteQuery`, por dois motivos. O primeiro é
   * o bug que isto corrige: o `fetchInfiniteQuery` respeita o `staleTime`, que
   * aqui é de 30 s, e dentro dessa janela ele devolvia o cache sem falar com o
   * servidor. Para o que emite evento de socket isso passava despercebido — o
   * evento invalidava o cache por outro caminho. Já bloquear e desbloquear são
   * privados e não emitem nada: a tela só mudava depois de um F5.
   *
   * O segundo é a paginação: o `fetchInfiniteQuery` sem a opção `pages` traz só
   * a primeira e substitui o cache com ela, então quem tivesse rolado a lista
   * perderia o resto a cada recarga. O `refetchQueries` refaz as páginas que já
   * estavam carregadas.
   */
  const reloadChats = useCallback(async (): Promise<Chat[]> => {
    await queryClient.refetchQueries({ queryKey: queryKeys.chats });

    const fresh = queryClient.getQueryData<ChatsCache>(queryKeys.chats);
    return fresh?.pages.flatMap((page) => page.chats) ?? [];
  }, [queryClient]);

  const loadMoreChats = useCallback(async (): Promise<void> => {
    if (!query.hasNextPage || query.isFetchingNextPage) return;
    await query.fetchNextPage();
  }, [query]);

  return {
    chats,
    isLoadingChats: query.isPending || query.isFetchingNextPage,
    hasMoreChats: query.hasNextPage,
    loadMoreChats,
    reloadChats,
    patchChat: (chatId: string, patch: Partial<Chat>) =>
      patchChatInCache(queryClient, chatId, patch),
    markChatRead,
    markChatUnread,
    markChatPinned,
    markChatArchived,
    markChatMuted,
    clearChatHistory: (chatId: string) => clearHistory.mutate(chatId),
    deleteChat: (chatId: string) => deleteChat.mutate(chatId),
  };
}
