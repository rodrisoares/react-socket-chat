import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import type { Message, MessagePage } from '@react-chat/shared';

import { queryKeys } from 'config/queryKeys';

/**
 * As mexidas no histórico que já está em cache.
 *
 * Ficam fora dos hooks porque duas partes precisam delas: o compositor, que
 * põe a mensagem na tela assim que o servidor confirma, e a ponte do socket,
 * que recebe a mesma mensagem pelo tempo real. As duas são idempotentes — quem
 * chegar depois não duplica nada.
 */

/**
 * O cursor de uma página: uma mensagem que já está na tela, instante **e** id.
 *
 * O id vai junto porque duas mensagens podem nascer no mesmo milissegundo —
 * paginando só pelo instante, a de baixo do corte era pulada entre uma página e
 * a seguinte, e sumia da conversa sem ninguém notar.
 *
 * São dois sentidos porque o histórico anda para os dois lados. Para trás é o
 * caso de sempre: rolar até o topo pede o que veio antes. Para a frente só
 * existe depois de um salto — quem pulou até uma mensagem de semanas atrás
 * está no meio da conversa, e precisa de um caminho de volta até o fim dela.
 */
export interface OlderCursor {
  before: string;
  beforeId: string;
}

export interface NewerCursor {
  after: string;
  afterId: string;
}

export type MessageCursor = OlderCursor | NewerCursor;

/** A página 0 é a mais nova: é nela que a mensagem recém-chegada entra. */
type MessagesCache = InfiniteData<MessagePage, MessageCursor | null>;

function has(cache: MessagesCache, messageId: string): boolean {
  return cache.pages.some((page) => page.messages.some((item) => item.id === messageId));
}

export function appendMessage(
  queryClient: QueryClient,
  chatId: string,
  message: Message,
): void {
  queryClient.setQueryData<MessagesCache>(queryKeys.messages(chatId), (old) => {
    // Conversa nunca aberta: guardar a mensagem solta criaria um histórico com
    // buraco. Ela será buscada inteira quando a conversa abrir.
    const newest = old?.pages[0];
    if (!old || !newest || has(old, message.id)) return old;

    /*
     * O cache não termina no fim da conversa: é a janela de um salto.
     *
     * Colar a mensagem nova no fim dela mostraria algo de agora logo depois de
     * um trecho de semanas atrás, sem nada indicando o buraco entre os dois. A
     * mensagem não se perde — ela chega quando o usuário anda até o fim (ou
     * volta a ele pelo botão), que é quando este trecho volta a ser o presente.
     */
    if (newest.hasMoreAfter) return old;

    return {
      ...old,
      pages: [{ ...newest, messages: [...newest.messages, message] }, ...old.pages.slice(1)],
    };
  });
}

/** Editada, apagada ou com reação nova: a mensagem inteira vem de novo. */
export function replaceMessage(
  queryClient: QueryClient,
  chatId: string,
  message: Message,
): void {
  queryClient.setQueryData<MessagesCache>(queryKeys.messages(chatId), (old) =>
    old
      ? {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            messages: page.messages.map((item) =>
              item.id === message.id ? message : item,
            ),
          })),
        }
      : old,
  );
}

/**
 * "Apagar para mim": a mensagem sai da lista, sem deixar rastro.
 *
 * Diferente do caminho de "apagar para todos", que passa pelo `replaceMessage`:
 * lá a mensagem continua na conversa como "mensagem apagada", porque todo mundo
 * a vê sumir e o buraco precisa de explicação. Aqui ninguém mais sabe de nada —
 * uma lápide anunciaria para você mesmo justamente o que você mandou sumir.
 */
export function removeMessage(
  queryClient: QueryClient,
  chatId: string,
  messageId: string,
): void {
  queryClient.setQueryData<MessagesCache>(queryKeys.messages(chatId), (old) =>
    old
      ? {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            messages: page.messages.filter((item) => item.id !== messageId),
          })),
        }
      : old,
  );
}
