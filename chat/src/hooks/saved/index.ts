import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { SavedMessage } from '@react-chat/shared';

import { hasSession } from 'config/auth';
import fetch from 'config/fetchInstance';
import { queryKeys } from 'config/queryKeys';

/**
 * As mensagens salvas — só os ids, que é o que a estrela de cada mensagem
 * precisa. O conteúdo vem do `useSavedMessages`, quando a página abre.
 *
 * Salvar é otimista: a estrela responde ao clique, e esperar a rede faria o
 * botão parecer emperrado. No erro, ela volta.
 */
export default function useSaved() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.savedIds,
    // Como a lista de conversas: nada de sair sem sessão só para tomar 401.
    enabled: hasSession(),
    queryFn: () =>
      fetch.get<{ ids: string[] }>('/api/me/saved/ids').then((response) => response.data.ids),
    /*
     * Volta a conferir ao retomar a aba.
     *
     * Isto era `staleTime: Infinity`: uma vez buscada, a lista nunca mais era
     * conferida. Salvar uma mensagem noutra aba — ou noutro aparelho — deixava
     * a estrela apagada aqui até um F5. É o contrário do resto do app, onde o
     * socket mantém tudo em dia; favorito é privado e não emite evento nenhum,
     * então quem repara é o retorno à aba.
     */
    refetchOnWindowFocus: true,
  });

  const savedIds = useMemo(() => new Set(query.data ?? []), [query.data]);

  const toggle = useMutation({
    mutationFn: (messageId: string) =>
      savedIds.has(messageId)
        ? fetch.delete(`/api/me/saved/${messageId}`)
        : fetch.post(`/api/me/saved/${messageId}`),
    onMutate: async (messageId) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.savedIds });
      const previous = queryClient.getQueryData<string[]>(queryKeys.savedIds) ?? [];

      queryClient.setQueryData<string[]>(queryKeys.savedIds, (old = []) =>
        old.includes(messageId)
          ? old.filter((id) => id !== messageId)
          : [...old, messageId],
      );

      return { previous };
    },
    onError: (_error, _messageId, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.savedIds, context.previous);
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.saved }),
  });

  return { savedIds, toggleSaved: (messageId: string) => toggle.mutate(messageId) };
}

/**
 * A lista inteira, com conteúdo — o que a página de salvas mostra.
 *
 * Em cache, e não num `useState` com bandeira de cancelamento: sair da página e
 * voltar deixou de custar uma busca, e salvar ou remover uma mensagem em
 * qualquer lugar do app invalida esta lista pelo `onSettled` acima.
 */
export function useSavedMessages() {
  const query = useQuery({
    queryKey: queryKeys.saved,
    enabled: hasSession(),
    queryFn: () =>
      fetch
        .get<{ saved: SavedMessage[] }>('/api/me/saved')
        .then((response) => response.data.saved),
    refetchOnWindowFocus: true,
  });

  return {
    saved: query.data ?? null,
    isLoading: query.isPending,
    isFailed: query.isError,
  };
}
