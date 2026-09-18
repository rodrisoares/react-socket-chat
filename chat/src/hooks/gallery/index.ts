import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChatGallery, GalleryLink, GalleryTab, Message } from '@react-chat/shared';

import fetch from 'config/fetchInstance';
import { queryKeys } from 'config/queryKeys';

/**
 * O id da última mensagem de uma aba — é dele que a próxima página continua.
 *
 * Nos links, é o da última mensagem que *rendeu* link. Se as mensagens do fim
 * da página só repetiram endereços já listados, elas não aparecem aqui e serão
 * relidas na página seguinte: o avanço continua acontecendo — a janela anda 60
 * mensagens a partir do cursor —, e o repetido é descartado no `concatLinks`.
 */
function cursorOf(gallery: ChatGallery, tab: GalleryTab): string | undefined {
  if (tab === 'links') return gallery.links.at(-1)?.messageId;
  return (tab === 'media' ? gallery.media : gallery.files).at(-1)?.id;
}

/**
 * Junta duas páginas de mensagens sem repetir nenhuma.
 *
 * O `skip: 1` do servidor já evita a emenda repetida; a checagem aqui é contra
 * o caso em que uma mensagem nova chega entre uma página e a seguinte e empurra
 * a janela — ela voltaria nas duas.
 */
function concatMessages(current: Message[], incoming: Message[]): Message[] {
  const seen = new Set(current.map((message) => message.id));
  return [...current, ...incoming.filter((message) => !seen.has(message.id))];
}

/**
 * O mesmo para os links, que se repetem por outro motivo: o servidor descarta
 * o endereço repetido dentro de uma página, mas duas mensagens em páginas
 * diferentes podem citar o mesmo — e só aqui existe a lista inteira.
 */
function concatLinks(current: GalleryLink[], incoming: GalleryLink[]): GalleryLink[] {
  const seen = new Set(current.map((link) => link.url));
  return [...current, ...incoming.filter((link) => !seen.has(link.url))];
}

/**
 * Mídia, arquivos e links de uma conversa.
 *
 * A abertura traz as três listas numa resposta só, porque as três abas do
 * painel são a mesma visita — separá-las custaria uma ida ao servidor para
 * trocar de aba. Daí em diante cada aba pagina sozinha, pelo `loadMore`: a
 * galeria parava nos 60 primeiros de cada uma, calada, e o resto do acervo não
 * tinha como ser alcançado.
 *
 * Em cache, e não num `useState`: fechar e reabrir o painel de detalhes da
 * mesma conversa deixou de custar uma nova busca, e uma mensagem nova com
 * anexo invalida a galeria junto com o resto da conversa. As páginas seguintes
 * são escritas no mesmo cache, então elas sobrevivem a fechar o painel.
 */
export default function useChatGallery(chatId: string) {
  const client = useQueryClient();
  const key = queryKeys.chatGallery(chatId);

  const query = useQuery({
    queryKey: key,
    queryFn: () =>
      fetch
        .get<ChatGallery>(`/api/chats/${chatId}/media`)
        .then((response) => response.data),
  });

  const more = useMutation({
    mutationFn: async (tab: GalleryTab) => {
      const current = client.getQueryData<ChatGallery>(key);
      const cursor = current ? cursorOf(current, tab) : undefined;
      if (!cursor) return;

      const { data } = await fetch.get<ChatGallery>(
        `/api/chats/${chatId}/media?tab=${tab}&cursor=${encodeURIComponent(cursor)}`,
      );

      client.setQueryData<ChatGallery>(key, (old) => {
        if (!old) return old;

        return {
          ...old,
          media: tab === 'media' ? concatMessages(old.media, data.media) : old.media,
          files: tab === 'files' ? concatMessages(old.files, data.files) : old.files,
          links: tab === 'links' ? concatLinks(old.links, data.links) : old.links,
          // Só a aba pedida traz veredito: as outras duas voltam vazias, e o
          // `hasMore` delas na resposta é sempre falso.
          hasMore: { ...old.hasMore, [tab]: data.hasMore[tab] },
        };
      });
    },
  });

  return {
    gallery: query.data ?? null,
    isLoading: query.isPending,
    isFailed: query.isError,
    /** Anexa a próxima página de uma aba ao que já está na tela. */
    loadMore: (tab: GalleryTab) => more.mutate(tab),
    isLoadingMore: more.isPending,
  };
}
