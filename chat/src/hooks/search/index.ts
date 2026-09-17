import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import type { Message, SearchHit } from '@react-chat/shared';

import fetch from 'config/fetchInstance';
import { queryKeys } from 'config/queryKeys';

/** Espera o usuário parar de digitar antes de perguntar ao servidor. */
const DEBOUNCE_MS = 250;

/** Abaixo disto o servidor devolve vazio; não vale a viagem. */
const MIN_TERM = 2;

/** O termo, mas só depois que a digitação parou. */
function useDebounced(value: string, delay = DEBOUNCE_MS): string {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);

  return settled;
}

/**
 * Busca por conteúdo em todas as conversas: chatId -> ocorrência mais recente.
 *
 * Antes a busca da lista percorria as mensagens que estavam em memória — as
 * últimas 30 de cada conversa —, então procurar algo de duas semanas atrás não
 * achava nada. Agora quem procura é o banco, e o resultado fica no cache: o
 * mesmo termo digitado de novo não custa outra viagem.
 */
export function useChatSearch(term: string): Record<string, Message> {
  const needle = useDebounced(term.trim());

  const query = useQuery({
    queryKey: queryKeys.search(needle),
    enabled: needle.length >= MIN_TERM,
    queryFn: () =>
      fetch
        .get<{ results: SearchHit[] }>(`/api/me/search?q=${encodeURIComponent(needle)}`)
        .then((response) => response.data.results),
    // Mantém o resultado anterior enquanto o novo vem: a lista não pisca a
    // cada tecla.
    placeholderData: keepPreviousData,
  });

  return useMemo(() => {
    if (needle.length < MIN_TERM) return {};
    return Object.fromEntries((query.data ?? []).map((hit) => [hit.chatId, hit.message]));
  }, [query.data, needle]);
}

export interface MessageSearch {
  results: Message[];
  isSearching: boolean;
}

/** Busca dentro de uma conversa, em todo o histórico visível. */
export function useMessageSearch(
  chatId: string | undefined,
  term: string,
): MessageSearch {
  const needle = useDebounced(term.trim());
  const isEnabled = Boolean(chatId) && needle.length >= MIN_TERM;

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
