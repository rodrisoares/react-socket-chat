import { useEffect, useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

import CardChat from 'components/CardChat';
import useSession from 'hooks/session';
import useChatList from 'hooks/chatList';
import usePresence from 'hooks/presence';
import { useDrafts } from 'store/ui';
import filterChats from 'utils/chatFilter';
import { typingPreview } from 'utils/typingLabel';
import { useChatSearch } from 'hooks/search';
import type { Chat } from '@react-chat/shared';

export type ChatFilterTab = 'all' | 'unread' | 'groups' | 'archived';

interface ChatListProps {
  filter: string;
  tab: ChatFilterTab;
  activeChatId?: string;
  /**
   * Recebido do Home para que escolher a conversa feche a gaveta no mobile.
   * Com `messageId` — um resultado da busca —, a conversa abre já na mensagem.
   */
  onSelect: (chat: Chat, messageId?: string) => void;
  onMarkRead: (chat: Chat) => void;
  onMarkUnread: (chat: Chat) => void;
  onTogglePin: (chat: Chat) => void;
  onToggleArchive: (chat: Chat) => void;
  onToggleMute: (chat: Chat) => void;
  /** Silenciar por um prazo; `null` é o "até eu desfazer". */
  onMuteFor: (chat: Chat, minutes: number | null) => void;
  onClearHistory: (chat: Chat) => void;
  onDelete: (chat: Chat) => void;
}

/** Uma linha da lista virtual: o título de uma seção, uma conversa, ou o fim. */
type Row =
  | { kind: 'header'; id: string; label: string }
  | { kind: 'chat'; id: string; chat: Chat; matchText?: string; matchId?: string }
  | { kind: 'more'; id: string };

/** Altura de chute de cada tipo de linha, até a medição real. */
const CARD_HEIGHT = 68;
const HEADER_HEIGHT = 28;

/**
 * Rodapé da lista: pede a página seguinte ao ser montado.
 *
 * Ele só existe no DOM quando o virtualizador o alcança, então "montar" já é
 * "chegou ao fim da rolagem" — não há listener de scroll nenhum.
 */
function MoreChats({
  onReach,
  isLoading,
}: {
  onReach: () => Promise<void>;
  isLoading: boolean;
}) {
  useEffect(() => {
    void onReach();
  }, [onReach]);

  return (
    <p className='home-chat-list-more'>{isLoading ? 'Carregando conversas…' : ' '}</p>
  );
}

/** Lista única: as abas substituíram os títulos "Mensagens Diretas"/"Grupos". */
export default function ChatList({
  filter,
  tab,
  activeChatId,
  onSelect,
  onMarkRead,
  onMarkUnread,
  onTogglePin,
  onToggleArchive,
  onToggleMute,
  onMuteFor,
  onClearHistory,
  onDelete,
}: ChatListProps) {
  const { user } = useSession();
  const { chats, loadMoreChats, hasMoreChats, isLoadingChats } = useChatList();
  const { typing } = usePresence();
  /** O que ficou escrito e não foi enviado, por conversa. */
  const drafts = useDrafts();
  const myId = user?.id;
  const scrollRef = useRef<HTMLDivElement>(null);

  // As ocorrências no conteúdo vêm do servidor; o nome casa aqui mesmo.
  const hits = useChatSearch(filter);

  /**
   * Filtrar puxa o resto da lista.
   *
   * O nome da conversa é casado aqui, no client, então filtrar com páginas
   * faltando esconderia conversas que existem. Enquanto há filtro, as páginas
   * restantes vão sendo buscadas — uma por vez, porque cada uma depende do
   * cursor da anterior.
   */
  useEffect(() => {
    if (!filter.trim() || !hasMoreChats || isLoadingChats) return;
    void loadMoreChats();
  }, [filter, hasMoreChats, isLoadingChats, loadMoreChats]);

  const matches = useMemo(() => {
    const byTab = chats.filter((chat) => {
      // Arquivada só aparece na própria aba: nas outras ela some, inclusive
      // com mensagem por ler — senão o arquivo não esconderia nada.
      if (tab === 'archived') return chat.isArchived;
      if (chat.isArchived) return false;
      if (tab === 'unread') return chat.unreadMessages > 0;
      if (tab === 'groups') return chat.type === 'GROUP';
      return true;
    });
    return filterChats(byTab, filter, hits);
  }, [chats, filter, tab, hits]);

  /**
   * As fixadas ganham um título próprio: elas já subiam para o topo, mas nada
   * na tela explicava o salto na ordem por data. O título de baixo só aparece
   * quando há um de cima — sozinho, "Conversas" não separaria nada.
   */
  const rows = useMemo<Row[]>(() => {
    const pinned = matches.filter((match) => match.chat.isPinned);
    const rest = matches.filter((match) => !match.chat.isPinned);

    const toRow = ({ chat, matchText, matchId }: (typeof matches)[number]): Row => ({
      kind: 'chat',
      id: chat.id,
      chat,
      ...(matchText ? { matchText } : {}),
      ...(matchId ? { matchId } : {}),
    });

    // A última linha é o gatilho do carregamento: entrar na tela é o que pede
    // a página seguinte, sem botão nem rolagem monitorada à parte.
    const tail: Row[] = hasMoreChats ? [{ kind: 'more', id: 'more' }] : [];

    if (pinned.length === 0) return [...rest.map(toRow), ...tail];

    return [
      { kind: 'header', id: 'header-pinned', label: 'Fixadas' },
      ...pinned.map(toRow),
      ...(rest.length > 0
        ? [{ kind: 'header', id: 'header-rest', label: 'Conversas' } as Row]
        : []),
      ...rest.map(toRow),
      ...tail,
    ];
  }, [matches, hasMoreChats]);

  /**
   * Lista virtualizada, como a de mensagens: com muitas conversas todos os
   * cards iam para o DOM, e cada card carrega avatar, menu e prévia.
   */
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) =>
      rows[index]?.kind === 'chat' ? CARD_HEIGHT : HEADER_HEIGHT,
    overscan: 6,
    getItemKey: (index) => rows[index]?.id ?? index,
  });

  /** Quem está digitando, já resolvido para o texto que o card exibe. */
  function typingLabelFor(chat: Chat): string {
    const ids = typing[chat.id] ?? [];
    const others = ids.filter((userId) => userId !== myId);

    const names = others.flatMap((userId) => {
      const name = chat.members.find((member) => member.id === userId)?.name;
      return name ? [name] : [];
    });

    // Sem nenhum nome conhecido, o aviso ainda vale: alguém está digitando.
    if (others.length > 0 && names.length === 0) return 'digitando…';
    return typingPreview(names, chat.type === 'GROUP');
  }

  if (rows.length === 0 || (rows.length === 1 && rows[0]?.kind === 'more')) {
    return (
      <p className='home-chat-empty'>
        {filter
          ? 'Nenhuma conversa encontrada.'
          : tab === 'unread'
            ? 'Nada por ler. 🎉'
            : tab === 'groups'
              ? 'Você ainda não está em nenhum grupo.'
              : tab === 'archived'
                ? 'Nenhuma conversa arquivada.'
                : 'Nenhuma conversa ainda. Use o + para começar uma.'}
      </p>
    );
  }

  return (
    <div className='home-chat-list' ref={scrollRef}>
      <div
        className='home-chat-list-canvas'
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((item) => {
          const row = rows[item.index];
          if (!row) return null;

          const draft = row.kind === 'chat' ? drafts[row.chat.id] : undefined;

          return (
            <div
              key={item.key}
              data-index={item.index}
              ref={virtualizer.measureElement}
              className='home-chat-list-row'
              style={{ transform: `translateY(${item.start}px)` }}
            >
              {row.kind === 'more' ? (
                <MoreChats onReach={loadMoreChats} isLoading={isLoadingChats} />
              ) : row.kind === 'header' ? (
                <h3 className='home-chat-list-title'>{row.label}</h3>
              ) : (
                <CardChat
                  chat={row.chat}
                  onClick={(chat) => onSelect(chat, row.matchId)}
                  isActive={row.chat.id === activeChatId}
                  typingLabel={typingLabelFor(row.chat)}
                  {...(row.matchText ? { matchText: row.matchText } : {})}
                  {...(draft ? { draft } : {})}
                  {...(myId !== undefined ? { myId } : {})}
                  onMarkRead={onMarkRead}
                  onMarkUnread={onMarkUnread}
                  onTogglePin={onTogglePin}
                  onToggleArchive={onToggleArchive}
                  onToggleMute={onToggleMute}
                  onMuteFor={onMuteFor}
                  onClearHistory={onClearHistory}
                  onDelete={onDelete}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
