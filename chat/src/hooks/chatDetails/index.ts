import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import type { ChatDetails } from '@react-chat/shared';

import fetch from 'config/fetchInstance';
import { queryKeys } from 'config/queryKeys';

/**
 * Os detalhes de uma conversa: membros, descrição, convite e permissões.
 *
 * Vinha de um `useEffect` que buscava ao abrir o painel e de um `setDetails`
 * repetido depois de cada ação — cinco lugares chamando a mesma rota à mão, e
 * cada um com a chance de esquecer. Aqui a busca é uma só, e quem muda algo
 * apenas invalida.
 *
 * O painel também chamava `reloadChats()` depois de quase toda ação, o que
 * refazia **todas** as páginas da lista. Não precisa: renomear, adicionar,
 * remover, promover e mudar a foto emitem `chat-updated`, e a ponte do socket
 * já busca a conversa que mudou — só ela. O que o socket não cobre é a lista de
 * membros deste painel, e é ela que a invalidação daqui refaz.
 */
export default function useChatDetails(chatId: string) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.chatDetails(chatId),
    queryFn: () =>
      fetch
        .get<ChatDetails>(`/api/chats/${chatId}`)
        .then((response) => response.data),
  });

  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: queryKeys.chatDetails(chatId) }),
    [queryClient, chatId],
  );

  /**
   * Toda ação do painel passa por aqui: manda, e depois refaz os detalhes.
   *
   * O `mutateAsync` devolve a promessa para quem chama poder mostrar o erro do
   * servidor — que importa: "o grupo ficaria sem nenhum administrador" explica
   * a recusa, e um erro genérico deixaria a pessoa tentando de novo.
   */
  const action = useMutation({
    mutationFn: (request: Promise<unknown>) => request,
    onSuccess: () => refresh(),
  });

  return {
    details: query.data ?? null,
    isLoading: query.isPending,
    isFailed: query.isError,
    refresh,
    /** Roda a requisição e atualiza o painel quando ela dá certo. */
    run: (request: Promise<unknown>) => action.mutateAsync(request),
    /** Remenda os detalhes sem ida ao servidor — o convite gerado, por exemplo. */
    patch: (change: (old: ChatDetails) => ChatDetails) =>
      queryClient.setQueryData<ChatDetails>(queryKeys.chatDetails(chatId), (old) =>
        old ? change(old) : old,
      ),
  };
}
