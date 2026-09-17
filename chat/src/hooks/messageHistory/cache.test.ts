import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { Message, MessagePage } from '@react-chat/shared';

import { queryKeys } from 'config/queryKeys';
import { appendMessage } from './cache';

const chatId = 'conversa-1';

function makeMessage(id: string): Message {
  return {
    id,
    userId: 2,
    name: 'Marcia',
    type: 'TEXT',
    text: 'agora',
    createdAt: new Date().toISOString(),
    isEdited: false,
    isDeleted: false,
    isForwarded: false,
    reactions: [],
    attachment: null,
    replyTo: null,
  };
}

/** Semeia o histórico com as páginas que o cliente teria em mãos. */
function seed(client: QueryClient, pages: MessagePage[]) {
  client.setQueryData(queryKeys.messages(chatId), {
    pages,
    pageParams: pages.map(() => null),
  });
}

function cached(client: QueryClient): MessagePage[] {
  return (
    client.getQueryData<{ pages: MessagePage[] }>(queryKeys.messages(chatId))?.pages ?? []
  );
}

describe('appendMessage', () => {
  it('poe a mensagem nova no fim da pagina mais recente', () => {
    const client = new QueryClient();
    seed(client, [{ messages: [makeMessage('m1')], hasMore: false }]);

    appendMessage(client, chatId, makeMessage('m2'));

    expect(cached(client)[0]?.messages.map((m) => m.id)).toEqual(['m1', 'm2']);
  });

  /** O socket traz a mesma mensagem que o POST ja devolveu. */
  it('nao duplica o que ja esta no historico', () => {
    const client = new QueryClient();
    seed(client, [{ messages: [makeMessage('m1')], hasMore: false }]);

    appendMessage(client, chatId, makeMessage('m1'));

    expect(cached(client)[0]?.messages).toHaveLength(1);
  });

  /** Conversa nunca aberta: a mensagem solta viraria um historico com buraco. */
  it('nao guarda nada quando nao ha historico carregado', () => {
    const client = new QueryClient();

    appendMessage(client, chatId, makeMessage('m1'));

    expect(client.getQueryData(queryKeys.messages(chatId))).toBeUndefined();
  });

  /**
   * O caso que este arquivo existe para vigiar.
   *
   * Depois de um salto, o cache e a janela do `?around=` — um trecho do meio da
   * conversa, com `hasMoreAfter`. Colar ali a mensagem que chega agora mostraria
   * algo de hoje logo depois de um trecho de semanas atras, sem nada indicando
   * o buraco entre os dois. Ela nao se perde: chega quando o usuario andar ate
   * o fim, ou voltar a ele pelo botao.
   */
  it('nao cola a mensagem nova numa janela que nao termina no presente', () => {
    const client = new QueryClient();
    seed(client, [
      { messages: [makeMessage('antiga')], hasMore: true, hasMoreAfter: true },
    ]);

    appendMessage(client, chatId, makeMessage('agora'));

    expect(cached(client)[0]?.messages.map((m) => m.id)).toEqual(['antiga']);
  });

  /** Alcancado o fim da conversa, a janela volta a ser o presente. */
  it('volta a aceitar quando a janela alcanca o fim da conversa', () => {
    const client = new QueryClient();
    seed(client, [
      { messages: [makeMessage('antiga')], hasMore: true, hasMoreAfter: false },
    ]);

    appendMessage(client, chatId, makeMessage('agora'));

    expect(cached(client)[0]?.messages.map((m) => m.id)).toEqual(['antiga', 'agora']);
  });
});
