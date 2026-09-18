import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { User } from '@react-chat/shared';

import { hasSession } from 'config/auth';
import fetch from 'config/fetchInstance';
import { queryKeys } from 'config/queryKeys';

/** Espera a digitação parar antes de perguntar ao servidor. */
const DEBOUNCE_MS = 250;

function useDebounced(value: string, delay = DEBOUNCE_MS): string {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);

  return settled;
}

/**
 * Contatos para iniciar conversa ou montar grupo, filtrados no servidor.
 *
 * Eram dois `useEffect` quase iguais — um no "nova conversa", outro no painel
 * de detalhes —, cada um com o próprio `setTimeout` de espera e a própria
 * bandeira de cancelamento. O mesmo termo digitado nos dois custava duas idas
 * ao servidor; agora a segunda encontra a resposta no cache.
 *
 * Sem termo a lista vem assim mesmo: a primeira página, em ordem alfabética.
 * Abrir o seletor e não ver ninguém até digitar seria pior para quem tem três
 * contatos.
 */
export default function useContacts(term: string) {
  const needle = useDebounced(term.trim());

  const query = useQuery({
    queryKey: queryKeys.contacts(needle),
    enabled: hasSession(),
    queryFn: () =>
      fetch
        .get<User[]>(`/api/me/contacts?q=${encodeURIComponent(needle)}`)
        .then((response) => response.data),
    // Mantém o resultado anterior enquanto o novo vem: a lista não pisca a
    // cada tecla.
    placeholderData: keepPreviousData,
  });

  return {
    contacts: query.data ?? [],
    isLoading: query.isPending,
    isFailed: query.isError,
  };
}
