import { useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { Chat } from '@react-chat/shared';

import useChatList from 'hooks/chatList';
import { useUiStore } from 'store/ui';
import { chatIdFromPath, chatPath } from 'utils/chatRoute';

/**
 * A conversa aberta.
 *
 * Ela mora na URL (`/c/:chatId`), e não num estado da aba. Antes vivia no
 * store: um F5 caía na lista vazia, o link da notificação não levava a lugar
 * nenhum, e no Android o botão voltar saía do app — porque nunca houve o que
 * voltar.
 *
 * A conversa em si continua vindo do cache da lista, que é quem o socket mantém
 * em dia. Antes uma cópia inteira do objeto vivia num contexto à parte, e ela
 * envelhecia: o cabeçalho mostrava o nome antigo do grupo depois de renomeado.
 *
 * O id sai do `pathname`, e não do `useParams`: é a mesma leitura que o
 * `currentChatId` faz fora do React (ver utils/chatRoute), e assim as duas não
 * têm como divergir.
 */
export default function useOpenChat() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { chats } = useChatList();

  const openChatId = chatIdFromPath(pathname);

  const chat = useMemo(
    () => chats.find((item) => item.id === openChatId) ?? null,
    [chats, openChatId],
  );

  /**
   * Empilha no histórico, e não substitui: é o empilhamento que dá ao botão
   * voltar para onde voltar.
   */
  const openChat = useCallback(
    (next: Chat | string) =>
      navigate(chatPath(typeof next === 'string' ? next : next.id)),
    [navigate],
  );

  const closeChat = useCallback(() => navigate('/'), [navigate]);

  /**
   * Abre a conversa já pedindo o salto até uma mensagem — o "Abrir na conversa"
   * das salvas e o resultado da busca global.
   *
   * O alvo continua no store, e não na URL: ele vale uma vez só, é consumido
   * pelo Display assim que o histórico chega e some. Um endereço que se apaga
   * ao ser lido não seria um endereço.
   */
  const openChatAt = useCallback(
    (chatId: string, messageId: string) => {
      useUiStore.getState().requestFocus(messageId);
      navigate(chatPath(chatId));
    },
    [navigate],
  );

  return { chatId: openChatId, chat, openChat, openChatAt, closeChat };
}
