import {
  useInfiniteQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import type { MessagePage } from '@react-chat/shared';

import fetch from 'config/fetchInstance';
import { queryKeys } from 'config/queryKeys';
import type { MessageCursor } from './cache';

/**
 * O histórico de uma conversa, paginado nos dois sentidos.
 *
 * O cursor é uma mensagem que já está na tela — o instante e o id, não só o
 * instante: duas mensagens do mesmo milissegundo caem do mesmo lado do corte, e
 * uma delas escapava entre as páginas. A conversa nunca aberta não custa nada:
 * sem `chatId`, a consulta fica desligada.
 *
 * Para trás é a paginação de sempre. Para a frente só existe depois de um
 * salto, e é o que faz dele um caminho de ida e volta.
 */
function fetchPage(chatId: string, cursor: MessageCursor | null): Promise<MessagePage> {
  const query = !cursor
    ? ''
    : 'before' in cursor
      ? `?before=${encodeURIComponent(cursor.before)}` +
        `&beforeId=${encodeURIComponent(cursor.beforeId)}`
      : `?after=${encodeURIComponent(cursor.after)}` +
        `&afterId=${encodeURIComponent(cursor.afterId)}`;

  return fetch
    .get<MessagePage>(`/api/chats/${chatId}/messages${query}`)
    .then((response) => response.data);
}

export default function useMessageHistory(chatId: string | undefined) {
  const queryClient = useQueryClient();

  const query = useInfiniteQuery({
    queryKey: queryKeys.messages(chatId ?? ''),
    enabled: Boolean(chatId),
    queryFn: ({ pageParam }) => fetchPage(chatId ?? '', pageParam),
    initialPageParam: null as MessageCursor | null,
    // Só há página seguinte enquanto o servidor disser que sobrou histórico.
    getNextPageParam: (last) => {
      const oldest = last.messages[0];
      if (!last.hasMore || !oldest) return null;

      return { before: oldest.createdAt, beforeId: oldest.id };
    },
    /**
     * A página *anterior* é a mais nova — o sentido do presente.
     *
     * `hasMoreAfter` só vem preenchido na janela do `?around=` e nas páginas
     * que andam para a frente: na paginação normal a primeira página já é o fim
     * da conversa, e a pergunta não existe. É por isso que, fora de um salto,
     * o `hasPreviousPage` fica falso e nada disto aparece na tela.
     */
    getPreviousPageParam: (first) => {
      const newest = first.messages.at(-1);
      if (!first.hasMoreAfter || !newest) return null;

      return { after: newest.createdAt, afterId: newest.id };
    },
  });

  /**
   * As páginas vão da mais nova para a mais antiga; a tela renderiza ao
   * contrário, da primeira mensagem para a última.
   *
   * A ordem se mantém nos dois sentidos: a página mais antiga entra no fim do
   * array e a mais nova no começo, então inverter continua devolvendo a
   * conversa em ordem cronológica.
   */
  const messages = useMemo(() => {
    const pages = query.data?.pages ?? [];
    return [...pages].reverse().flatMap((page) => page.messages);
  }, [query.data]);

  /**
   * Abre o histórico em volta de uma mensagem que não está carregada — o salto
   * até a citação, a fixada, um resultado da busca ou uma salva.
   *
   * O servidor devolve a janela pronta (`?around=`). Antes isto era um laço
   * pedindo página por página até topar com a mensagem, com teto de cinco: uma
   * citação mais funda do que isso não levava a lugar nenhum.
   *
   * Devolve `false` quando a mensagem não existe mais para este usuário — ela
   * pode ter sido apagada, ou estar num trecho que ele limpou.
   */
  const jumpTo = useCallback(
    async (messageId: string): Promise<boolean> => {
      if (!chatId) return false;

      try {
        const { data } = await fetch.get<MessagePage>(
          `/api/chats/${chatId}/messages?around=${encodeURIComponent(messageId)}`,
        );

        // A janela substitui o que estava em cache: manter as páginas antigas
        // deixaria um buraco entre elas e o trecho que acabou de chegar.
        queryClient.setQueryData<InfiniteData<MessagePage, MessageCursor | null>>(
          queryKeys.messages(chatId),
          { pages: [data], pageParams: [null] },
        );

        return true;
      } catch {
        return false;
      }
    },
    [chatId, queryClient],
  );

  /**
   * Volta para o fim da conversa, de uma vez.
   *
   * Andar página por página de volta de um salto fundo seria uma dúzia de
   * requisições; reiniciar a consulta traz a página mais nova numa só, que é o
   * mesmo que abrir a conversa agora. É o que o botão de descer faz quando o
   * que está na tela não é o presente.
   */
  const goToLatest = useCallback(async (): Promise<void> => {
    if (!chatId) return;
    await queryClient.resetQueries({ queryKey: queryKeys.messages(chatId) });
  }, [chatId, queryClient]);

  return {
    messages,
    isLoading: query.isPending,
    hasMore: query.hasNextPage,
    isLoadingMore: query.isFetchingNextPage,
    loadOlder: async () => {
      if (!query.hasNextPage || query.isFetchingNextPage) return;
      await query.fetchNextPage();
    },
    /** Há conversa depois do que está na tela: só acontece depois de um salto. */
    hasNewer: query.hasPreviousPage,
    isLoadingNewer: query.isFetchingPreviousPage,
    loadNewer: async () => {
      if (!query.hasPreviousPage || query.isFetchingPreviousPage) return;
      await query.fetchPreviousPage();
    },
    goToLatest,
    jumpTo,
  };
}
