import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import type {
  Chat,
  MessageUpdatedEvent,
  NewMessageEvent,
  ReadMessageEvent,
  TypingEvent,
  User,
  UserLogoffEvent,
} from '@react-chat/shared';

import fetch from 'config/fetchInstance';
import { queryKeys } from 'config/queryKeys';
import { connectSocket, socket } from 'config/socket';
import { currentChatId, goToChat } from 'utils/chatRoute';
import { patchChatInCache, refreshChat } from 'hooks/chatList';
import { appendMessage, replaceMessage } from 'hooks/messageHistory/cache';
import useNotifications from 'hooks/notifications';
import useSession from 'hooks/session';
import { useUiStore } from 'store/ui';
import { attachmentLabel } from 'utils/messagePreview';

/**
 * A ponte entre o socket e o cache.
 *
 * Cada evento do servidor vira uma mexida no cache do Query ou no store da
 * UI. Era a metade de um provider de 730 linhas; aqui não há estado próprio —
 * o dono de cada dado continua sendo quem o busca.
 */

/**
 * Sem notícia por este tempo, o "digitando…" some. O aviso de que a pessoa
 * parou pode nunca chegar — a aba dela fechou no meio da frase —, e quem
 * digita renova o aviso a cada 2 s (ver hooks/typing).
 */
const TYPING_TTL_MS = 5000;

/**
 * Folga antes de marcar como lida a conversa aberta: mensagens em rajada viram
 * uma ida só ao servidor.
 */
const READ_DEBOUNCE_MS = 400;

/** Troca os dados de uma pessoa em todas as conversas em que ela aparece. */
function applyUserToChats(queryClient: QueryClient, updated: User, myId?: number): void {
  const cache = queryClient.getQueryData<{ pages: { chats: Chat[] }[] }>(queryKeys.chats);
  if (!cache) return;

  for (const page of cache.pages) {
    for (const chat of page.chats) {
      // O próprio usuário fica de fora: numa conversa direta ele também está
      // em `participants`, e sem esta condição trocar o próprio nome renomearia
      // as conversas dele para o nome dele mesmo.
      const isTheirDirect =
        chat.type === 'DIRECT' &&
        updated.id !== myId &&
        chat.participants.includes(updated.id);

      const members = chat.members.map((member) =>
        member.id === updated.id
          ? { ...member, ...updated, image: updated.image ?? undefined }
          : member,
      );

      patchChatInCache(queryClient, chat.id, {
        members,
        ...(isTheirDirect
          ? {
              name: updated.name,
              image: updated.image ?? undefined,
              status: updated.status,
              lastSeenAt: updated.lastSeenAt ?? null,
            }
          : {}),
      });
    }
  }
}

/** Presença de alguém, na lista e nos membros de cada conversa. */
function applyPresence(
  queryClient: QueryClient,
  userId: number,
  isOnline: boolean,
  lastSeenAt: string | null,
): void {
  const cache = queryClient.getQueryData<{ pages: { chats: Chat[] }[] }>(queryKeys.chats);
  if (!cache) return;

  for (const page of cache.pages) {
    for (const chat of page.chats) {
      const isTheirDirect = chat.type === 'DIRECT' && chat.participants.includes(userId);

      patchChatInCache(queryClient, chat.id, {
        members: chat.members.map((member) =>
          member.id === userId ? { ...member, isOnline, lastSeenAt } : member,
        ),
        ...(isTheirDirect ? { isLogged: isOnline, lastSeenAt } : {}),
      });
    }
  }
}

export default function useSocketEvents(): void {
  const queryClient = useQueryClient();
  const { user } = useSession();
  const { notify } = useNotifications();

  /** Prazo de cada "digitando…" em curso, por `chatId:userId`. */
  const typingTimers = useRef(new Map<string, number>());
  /** Leituras agendadas da conversa aberta, por conversa. */
  const readTimers = useRef(new Map<string, number>());
  /**
   * O primeiro connect de cada sessão é a entrada, com tudo recém-carregado;
   * os seguintes são a volta de uma queda, e aí é preciso ressincronizar.
   */
  const hasConnected = useRef(false);

  /**
   * Liga o socket assim que há sessão.
   *
   * Ele nasce com `autoConnect: false`, e até agora só o login o ligava. Depois
   * de um F5 a sessão voltava pelo cookie, mas o tempo real não: o socket ficava
   * parado, nenhum evento chegava, e mensagem nova só aparecia recarregando a
   * página de novo. Nem a faixa de conexão reclamava — ela começa em 'idle',
   * cujo rótulo é vazio.
   *
   * Parte daqui porque esta ponte é montada uma vez só, no Layout, que só
   * existe com alguém logado. Sem sessão não há token para o handshake, e o
   * servidor recusaria a conexão.
   *
   * A guarda é `Boolean(user)`, e não o objeto: ele troca de identidade a cada
   * refetch da sessão, e o efeito re-rodaria sem necessidade.
   */
  const hasSession = Boolean(user);

  useEffect(() => {
    if (hasSession) connectSocket();
  }, [hasSession]);

  // A aba à frente decide se a mensagem que chega conta como lida.
  useEffect(() => {
    function onVisibility() {
      useUiStore.getState().setVisible(document.visibilityState === 'visible');
    }

    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    const myId = user?.id;
    const timers = typingTimers.current;
    const reads = readTimers.current;

    /** Marca a conversa como lida no servidor, com folga para juntar rajadas. */
    function scheduleRead(chatId: string) {
      window.clearTimeout(reads.get(chatId));
      reads.set(
        chatId,
        window.setTimeout(() => {
          reads.delete(chatId);
          void fetch.post(`/api/chats/${chatId}/readMessages`);
        }, READ_DEBOUNCE_MS),
      );
    }

    function onNewMessage({ chatId, newMessage, mentions }: NewMessageEvent) {
      // A conversa aberta sai do endereço, e não de um espelho no store: é a
      // mesma leitura que a tela faz, então as duas não podem divergir.
      const { isVisible } = useUiStore.getState();
      const openChatId = currentChatId();
      const isMine = newMessage.userId === myId;
      // Aberta e com a aba à frente: a mensagem está sendo vista agora.
      const isSeen = chatId === openChatId && isVisible;

      /*
       * Esta mensagem me chama pelo nome?
       *
       * Os ids vêm do servidor, no evento: ele resolveu os `@` contra os
       * membros do grupo no envio. Procurar o próprio nome no texto aqui
       * erraria com nome composto, com homônimo e depois de uma troca de nome.
       *
       * Serve a duas coisas logo abaixo — furar o silêncio da notificação e
       * marcar o card —, e por isso é calculado uma vez só.
       */
      const mentionsMe = myId !== undefined && (mentions?.includes(myId) ?? false);

      appendMessage(queryClient, chatId, newMessage);

      const chats = queryClient.getQueryData<{ pages: { chats: Chat[] }[] }>(queryKeys.chats);
      const current = chats?.pages
        .flatMap((page) => page.chats)
        .find((chat) => chat.id === chatId);

      patchChatInCache(queryClient, chatId, {
        lastMessage: newMessage,
        /*
         * O card diz "Fulano mencionou você" — e deixa de dizer.
         *
         * O servidor calcula isto ao listar as conversas, mas a mensagem que
         * chega ao vivo não passa por lá: sem esta linha, uma menção com a
         * conversa fechada só apareceria depois de um F5.
         *
         * Escrever `false` importa tanto quanto escrever `true`: sem isso o
         * card ficaria preso no chamado de uma mensagem antiga, anunciando algo
         * que a mensagem seguinte já substituiu.
         */
        mentionsMe,
        // Repete a regra do servidor: mensagem posterior ao arquivamento tira
        // a conversa do arquivo.
        isArchived: false,
        unreadMessages:
          isMine || isSeen
            ? (current?.unreadMessages ?? 0)
            : (current?.unreadMessages ?? 0) + 1,
      });

      // Vista agora: o servidor precisa saber, senão o ✓✓ de quem enviou nunca
      // acende — e depois do F5 a conversa volta com não lidas já lidas.
      if (!isMine && isSeen) scheduleRead(chatId);

      /*
       * A menção fura o silêncio.
       *
       * Silenciar uma conversa é dizer "não me avise do que rolar aqui" — mas
       * ser chamado pelo nome é exatamente o caso em que a pessoa quer saber.
       * É a mesma regra do WhatsApp e do Slack.
       */
      if (!isMine && (!current?.isMuted || mentionsMe)) {
        notify(
          newMessage.name,
          newMessage.attachment && !newMessage.text
            ? attachmentLabel(newMessage)
            : newMessage.text,
          {
            chatId,
            // A mensagem já está na tela: o bip a cada linha digitada ao vivo
            // vira barulho.
            silent: isSeen,
            // Navega de verdade: o clique na notificação passa a abrir a
            // conversa pelo endereço dela, que é o que o item pedia.
            onOpen: () => goToChat(chatId),
          },
        );
      }
    }

    function onMessageUpdated({ chatId, message }: MessageUpdatedEvent) {
      replaceMessage(queryClient, chatId, message);

      const chats = queryClient.getQueryData<{ pages: { chats: Chat[] }[] }>(queryKeys.chats);
      const current = chats?.pages
        .flatMap((page) => page.chats)
        .find((chat) => chat.id === chatId);

      // A prévia do card também mostra a mensagem editada ou apagada.
      if (current?.lastMessage?.id === message.id) {
        patchChatInCache(queryClient, chatId, { lastMessage: message });
      }

      // E o banner da fixada, que mostrava a versão de quando ela foi fixada:
      // editar não mudava o texto ali, e apagar deixava o topo da conversa
      // anunciando uma mensagem que não existe mais. Apagada, o pino cai — é o
      // que o servidor faz no banco (onDelete: SetNull).
      if (current?.pinnedMessage?.id === message.id) {
        patchChatInCache(queryClient, chatId, {
          pinnedMessage: message.isDeleted ? null : message,
        });
      }
    }

    function onTyping({ chatId, userId }: TypingEvent) {
      // A outra aba desta mesma pessoa digitando não é "alguém digitando".
      if (userId === myId) return;

      useUiStore.getState().startTyping(chatId, userId);

      // Cada aviso renova o prazo; sem aviso novo, o "digitando…" some sozinho.
      const key = `${chatId}:${userId}`;
      window.clearTimeout(timers.get(key));
      timers.set(
        key,
        window.setTimeout(() => {
          timers.delete(key);
          useUiStore.getState().stopTyping(chatId, userId);
        }, TYPING_TTL_MS),
      );
    }

    function onStopTyping({ chatId, userId }: TypingEvent) {
      const key = `${chatId}:${userId}`;
      window.clearTimeout(timers.get(key));
      timers.delete(key);

      useUiStore.getState().stopTyping(chatId, userId);
    }

    function onReadMessage({ chatId, id, readAt }: ReadMessageEvent) {
      useUiStore.getState().markRead(chatId, id, readAt);
    }

    function onUserUpdated(updated: User) {
      if (updated.id === myId) {
        queryClient.setQueryData(queryKeys.session, (old: User | null) =>
          old ? { ...old, ...updated } : old,
        );
      }

      applyUserToChats(queryClient, updated, myId);
    }

    function onLogin(id: number) {
      if (id !== myId) applyPresence(queryClient, id, true, null);
    }

    function onLogoff({ id, lastSeenAt }: UserLogoffEvent) {
      applyPresence(queryClient, id, false, lastSeenAt);
    }

    /**
     * Mudou uma conversa: busca só ela, pelo resumo — ver `refreshChat`.
     *
     * Era uma invalidação da chave `['chats', chatId]`, que nenhuma query usa,
     * seguida da invalidação da lista inteira. O resumo existia no servidor
     * desde sempre para evitar exatamente esse custo.
     */
    function onChatUpdated({ chatId }: { chatId: string }) {
      void refreshChat(queryClient, chatId);
    }

    function onChatCreated() {
      void queryClient.invalidateQueries({ queryKey: queryKeys.chats });
    }

    /**
     * Volta de uma queda: o que aconteceu enquanto o socket esteve fora não é
     * entregue depois. Invalidar é o bastante — o Query rebusca o que a tela
     * estiver mostrando, e só isso.
     */
    function onConnect() {
      if (!hasConnected.current) {
        hasConnected.current = true;
        return;
      }

      useUiStore.getState().clearTyping();
      void queryClient.invalidateQueries();
    }

    socket.on('new-message', onNewMessage);
    socket.on('message-updated', onMessageUpdated);
    socket.on('typing', onTyping);
    socket.on('stop-typing', onStopTyping);
    socket.on('read-message', onReadMessage);
    socket.on('user-updated', onUserUpdated);
    socket.on('new-login', onLogin);
    socket.on('user-logoff', onLogoff);
    socket.on('chat-created', onChatCreated);
    socket.on('chat-updated', onChatUpdated);
    socket.on('connect', onConnect);

    return () => {
      socket.off('new-message', onNewMessage);
      socket.off('message-updated', onMessageUpdated);
      socket.off('typing', onTyping);
      socket.off('stop-typing', onStopTyping);
      socket.off('read-message', onReadMessage);
      socket.off('user-updated', onUserUpdated);
      socket.off('new-login', onLogin);
      socket.off('user-logoff', onLogoff);
      socket.off('chat-created', onChatCreated);
      socket.off('chat-updated', onChatUpdated);
      socket.off('connect', onConnect);
    };
  }, [queryClient, notify, user?.id]);

  // Os timers morrem com o componente: um "digitando…" agendado não pode
  // disparar depois que a tela saiu.
  useEffect(() => {
    const timers = typingTimers.current;
    const reads = readTimers.current;

    return () => {
      for (const timer of timers.values()) window.clearTimeout(timer);
      for (const timer of reads.values()) window.clearTimeout(timer);
      timers.clear();
      reads.clear();
    };
  }, []);
}
