import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
} from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Chat, ChatPage, Message } from '@react-chat/shared';

import { hasSession } from 'config/auth';
import fetch from 'config/fetchInstance';
import { queryKeys } from 'config/queryKeys';

/** Espera o usuário parar de digitar antes de perguntar ao servidor. */
const DEBOUNCE_MS = 250;

/** O termo, mas só depois que a digitação parou. */
function useDebounced(value: string, delay = DEBOUNCE_MS): string {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);

  return settled;
}

export interface FilteredChats {
  chats: Chat[];
  isSearching: boolean;
  hasMore: boolean;
  loadMore: () => Promise<void>;
}

/**
 * A lista de conversas filtrada — por nome **ou** por conteúdo, e paginada.
 *
 * Eram duas fontes. O nome era casado aqui no navegador, sobre as conversas já
 * carregadas, e o conteúdo vinha de uma rota de busca separada. A consequência
 * era uma cascata: para o filtro por nome não esconder conversa que existe, a
 * tela puxava todas as páginas da lista assim que alguém digitava a primeira
 * letra — dezenas de requisições para filtrar o que o banco filtra numa.
 *
 * Agora quem filtra é o servidor, na mesma rota que lista (`?q=`), e o
 * resultado continua paginado. A conversa que casou pelo conteúdo chega com
 * `matchedMessage`; o card mostra esse trecho no lugar da última mensagem.
 *
 * A chave fica sob `['chats', ...]` de propósito: o que mexe no cache das
 * conversas — presença, perfil, mensagem nova — alcança a listagem filtrada
 * pelo mesmo caminho, e ela não congela enquanto se digita.
 */
export function useChatSearch(term: string): FilteredChats {
  const needle = useDebounced(term.trim());
  const isEnabled = hasSession() && needle.length > 0;

  const query = useInfiniteQuery({
    queryKey: queryKeys.chatFilter(needle),
    enabled: isEnabled,
    queryFn: ({ pageParam }) => {
      const cursor = pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : '';

      return fetch
        .get<ChatPage>(`/api/me/chats?q=${encodeURIComponent(needle)}${cursor}`)
        .then((response) => response.data);
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    // Mantém o resultado anterior enquanto o novo vem: a lista não pisca a
    // cada tecla.
    placeholderData: keepPreviousData,
  });

  const chats = useMemo(
    () => query.data?.pages.flatMap((page) => page.chats) ?? [],
    [query.data],
  );

  const loadMore = useCallback(async () => {
    if (!query.hasNextPage || query.isFetchingNextPage) return;
    await query.fetchNextPage();
  }, [query]);

  return {
    chats: isEnabled ? chats : [],
    isSearching: isEnabled && query.isFetching,
    hasMore: isEnabled && query.hasNextPage,
    loadMore,
  };
}

export interface MessageSearch {
  results: Message[];
  isSearching: boolean;
}

/**
 * Busca dentro de uma conversa, em todo o histórico visível.
 *
 * Esta continua sendo rota própria: ela devolve **todas** as ocorrências, em
 * ordem cronológica, porque a tela anda entre elas com as setas — não é a
 * mesma pergunta que a da lista, que quer uma conversa por linha.
 */
export function useMessageSearch(
  chatId: string | undefined,
  term: string,
): MessageSearch {
  const needle = useDebounced(term.trim());
  const isEnabled = Boolean(chatId) && needle.length >= 2;

  const query = useQuery({
    queryKey: queryKeys.chatSearch(chatId ?? '', needle),
    enabled: isEnabled,
    queryFn: () =>
      fetch
        .get<{ messages: Message[] }>(
          `/api/chats/${chatId ?? ''}/search?q=${encodeURIComponent(needle)}`,
        )
        .then((response) => response.data.messages),
    placeholderData: keepPreviousData,
  });

  return {
    results: isEnabled ? (query.data ?? []) : [],
    isSearching: isEnabled && query.isFetching,
  };
}
