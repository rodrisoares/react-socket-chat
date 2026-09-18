import { useQuery } from '@tanstack/react-query';
import type { ChatGallery } from '@react-chat/shared';

import fetch from 'config/fetchInstance';
import { queryKeys } from 'config/queryKeys';

/**
 * Mídia, arquivos e links de uma conversa.
 *
 * As três listas numa resposta só, porque as três abas do painel são a mesma
 * visita — separá-las custaria uma ida ao servidor para trocar de aba.
 *
 * Em cache, e não num `useState`: fechar e reabrir o painel de detalhes da
 * mesma conversa deixou de custar uma nova busca, e uma mensagem nova com
 * anexo invalida a galeria junto com o resto da conversa.
 */
export default function useChatGallery(chatId: string) {
  const query = useQuery({
    queryKey: queryKeys.chatGallery(chatId),
    queryFn: () =>
      fetch
        .get<ChatGallery>(`/api/chats/${chatId}/media`)
        .then((response) => response.data),
  });

  return {
    gallery: query.data ?? null,
    isLoading: query.isPending,
    isFailed: query.isError,
  };
}
