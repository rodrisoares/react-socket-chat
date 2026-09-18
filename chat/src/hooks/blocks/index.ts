import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { User } from '@react-chat/shared';

import { hasSession } from 'config/auth';
import fetch from 'config/fetchInstance';
import { queryKeys } from 'config/queryKeys';

/**
 * Quem este usuário bloqueou.
 *
 * Vinha de um `useEffect` com `useState` e bandeira de cancelamento, repetido
 * em dois lugares — o painel de detalhes e a tela de configurações —, cada um
 * com a própria cópia da lista. Duas cópias do mesmo dado divergem: bloquear
 * pelo painel não mexia na seção de bloqueados, e vice-versa.
 *
 * A rota devolve as pessoas, e não ids: é o que permite a tela de bloqueados
 * mostrar nomes sem depender da lista de contatos, que vem paginada.
 */
export default function useBlocks() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.blocks,
    enabled: hasSession(),
    queryFn: () =>
      fetch
        .get<{ blocked: User[] }>('/api/me/blocks')
        .then((response) => response.data.blocked ?? []),
  });

  const blocked = useMemo(() => query.data ?? [], [query.data]);
  const blockedIds = useMemo(
    () => new Set(blocked.map((person) => person.id)),
    [blocked],
  );

  /**
   * Bloquear e desbloquear.
   *
   * A direção vem de fora, e isso não é detalhe: quando ela era deduzida da
   * lista e o botão decidia o próprio rótulo por outra fonte, as duas
   * divergiam — e "Desbloquear" mandava um POST que bloqueava de novo.
   *
   * Otimista, porque o servidor não emite nada: bloquear é privado, e o outro
   * lado nunca fica sabendo. Sem o remendo no cache, a tela só mudaria no
   * próximo refetch.
   */
  const toggle = useMutation({
    mutationFn: ({ userId, shouldBlock }: { userId: number; shouldBlock: boolean }) =>
      shouldBlock
        ? fetch.post(`/api/me/blocks/${String(userId)}`)
        : fetch.delete(`/api/me/blocks/${String(userId)}`),
    onMutate: async ({ userId, shouldBlock }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.blocks });
      const previous = queryClient.getQueryData<User[]>(queryKeys.blocks);

      queryClient.setQueryData<User[]>(queryKeys.blocks, (old = []) =>
        shouldBlock ? old : old.filter((person) => person.id !== userId),
      );

      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.blocks, context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.blocks });
      // O `isBlocked` da conversa muda junto, e o servidor não anuncia nada:
      // bloquear é estado privado de quem bloqueou.
      void queryClient.invalidateQueries({ queryKey: queryKeys.chats });
    },
  });

  return {
    blocked,
    blockedIds,
    isLoading: query.isPending,
    isFailed: query.isError,
    setBlocked: (userId: number, shouldBlock: boolean) =>
      toggle.mutateAsync({ userId, shouldBlock }),
  };
}
