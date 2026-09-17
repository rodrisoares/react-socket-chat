import { useEffect, useRef } from 'react';
import type { Chat } from '@react-chat/shared';

import { useIsVisible } from 'store/ui';

/**
 * Abrir a conversa marca como lida — a "leitura automática".
 *
 * Vive num hook proprio, e nao solto dentro do Display, porque ali ele era
 * intestavel: o Display depende de sessao, lista, presenca, compositor, busca,
 * socket e store, e montar tudo isso para exercitar tres linhas nao se paga.
 * Foi essa ausencia de teste que deixou a leitura automatica ser removida sem
 * ninguem notar.
 *
 * Aqui entram so as duas coisas que a decisao precisa — a conversa e como
 * marca-la — e a visibilidade da aba, que sai do store.
 */
export default function useAutoRead(
  chat: Chat | null,
  markChatRead: (chatId: string) => void,
): void {
  const isVisible = useIsVisible();

  /**
   * A funcao guardada em ref, e nao lida direto.
   *
   * Ela nasce de um `useCallback` que depende do resultado de um `useMutation`,
   * cuja identidade muda a cada render. Na ref, a instabilidade dela deixa de
   * ser uma armadilha que quem mexer aqui precisa lembrar — o efeito abaixo
   * simplesmente nao pode depender dela.
   */
  const mark = useRef(markChatRead);
  mark.current = markChatRead;

  /*
   * Os gatilhos sao a conversa e a visibilidade. Duas coisas de fora ficam:
   *
   * A aba precisa estar a frente. Com a conversa aberta e a aba atras, mensagem
   * nova incrementa o nao-lido — marcar como lida ali daria por vista uma
   * mensagem que ninguem olhou. E a mesma regra que o socket aplica ao decidir
   * se o que chega ja conta como visto.
   *
   * E o contador de nao lidas, que seria o gatilho obvio, abriria um laco de
   * requisicoes: quando o POST falha, o `onError` do useChatList restaura o
   * cache anterior — devolvendo o contador ao valor de antes. O efeito veria o
   * numero de novo, dispararia de novo, e um blip de rede viraria uma enxurrada
   * contra o servidor. Lido por dentro, ele decide sem provocar reexecucao.
   */
  useEffect(() => {
    if (!chat || chat.unreadMessages === 0 || !isVisible) return;
    mark.current(chat.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat?.id, isVisible]);
}
