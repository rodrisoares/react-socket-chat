import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { hasSession } from 'config/auth';
import fetch from 'config/fetchInstance';
import { queryKeys } from 'config/queryKeys';

/**
 * As mensagens salvas — só os ids, que é o que a estrela de cada mensagem
 * precisa. O conteúdo é buscado quando a lista de salvas abre.
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
    staleTime: Infinity,
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
