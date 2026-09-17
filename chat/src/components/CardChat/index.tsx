import './styles.scss';
import { useRef, useState } from 'react';
import { TbPin } from 'react-icons/tb';
import { FiBellOff, FiBell, FiInbox } from 'react-icons/fi';

import Avatar from 'components/Avatar';
import ChatMenu from 'components/ChatMenu';
import canDeleteChat from 'utils/chatActions';
import { cardTimeLabel } from 'utils/dayLabel';
import { messagePreview } from 'utils/messagePreview';
import type { Chat } from '@react-chat/shared';

/** Deslocamento a partir do qual soltar o dedo dispara a ação. */
const SWIPE_THRESHOLD = 64;

/** Quanto o card anda no máximo: além disso o gesto não fica mais claro. */
const SWIPE_MAX = 96;

interface CardChatProps {
  chat: Chat;
  onClick: (chat: Chat) => void;
  /** Conversa aberta na tela: sem isto não há como saber qual é. */
  isActive?: boolean;
  /** Nome de quem está digitando, ou '' — substitui a prévia enquanto dura. */
  typingLabel?: string;
  /** Trecho da mensagem que casou com a busca, no lugar da última. */
  matchText?: string;
  /**
   * O que ficou escrito e não foi enviado nesta conversa. Aparece no lugar da
   * prévia, como no WhatsApp: sem isso, nada na lista lembrava que havia uma
   * resposta pela metade esperando.
   */
  draft?: string;
  /** Usado só para prefixar a prévia com "Você:". */
  myId?: number;
  /** Sem os três, o card não mostra o menu — é o caso dos testes unitários. */
  onMarkRead?: (chat: Chat) => void;
  onMarkUnread?: (chat: Chat) => void;
  onTogglePin?: (chat: Chat) => void;
  onToggleArchive?: (chat: Chat) => void;
  onToggleMute?: (chat: Chat) => void;
  /** Silenciar por um prazo; `null` é o "até eu desfazer". */
  onMuteFor?: (chat: Chat, minutes: number | null) => void;
  /** Pedem a confirmação; agir de verdade é decisão de quem usa o card. */
  onClearHistory?: (chat: Chat) => void;
  onDelete?: (chat: Chat) => void;
}

export default function CardChat({
  chat,
  onClick,
  isActive = false,
  typingLabel = '',
  matchText,
  draft = '',
  myId,
  onMarkRead,
  onMarkUnread,
  onTogglePin,
  onToggleArchive,
  onToggleMute,
  onMuteFor,
  onClearHistory,
  onDelete,
}: CardChatProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  /** Deslocamento atual do gesto de arrastar, em pixels. 0 = parado. */
  const [swipe, setSwipe] = useState(0);
  /** Ponto onde o dedo tocou; null enquanto não há gesto em andamento. */
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const lastMessage = chat.lastMessage;
  const canMark = Boolean(onMarkRead && onMarkUnread);
  const canSwipe = Boolean(onToggleArchive ?? onToggleMute);

  const preview = matchText ?? messagePreview(chat, myId);

  const classes = [
    'cardChat-wrapper',
    isMenuOpen ? 'is-menu-open' : '',
    isActive ? 'is-active' : '',
    chat.unreadMessages > 0 ? 'is-unread' : '',
    swipe !== 0 ? 'is-swiping' : '',
  ]
    .filter(Boolean)
    .join(' ');

  /**
   * Arrastar o card no toque: para a esquerda arquiva, para a direita
   * silencia. No celular o menu "⋮" depende de um toque preciso num alvo de
   * 20px — o gesto é o caminho que os apps de mensagem ensinaram.
   */
  function onTouchStart(event: React.TouchEvent) {
    if (!canSwipe) return;
    const touch = event.touches[0];
    if (touch) touchStart.current = { x: touch.clientX, y: touch.clientY };
  }

  function onTouchMove(event: React.TouchEvent) {
    const start = touchStart.current;
    const touch = event.touches[0];
    if (!start || !touch) return;

    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;

    // Movimento mais vertical do que horizontal é rolagem da lista, e não
    // gesto no card: desiste em vez de brigar com o scroll.
    if (Math.abs(dy) > Math.abs(dx)) {
      touchStart.current = null;
      setSwipe(0);
      return;
    }

    setSwipe(Math.max(-SWIPE_MAX, Math.min(SWIPE_MAX, dx)));
  }

  function onTouchEnd() {
    const travelled = swipe;
    touchStart.current = null;
    setSwipe(0);

    if (travelled <= -SWIPE_THRESHOLD) onToggleArchive?.(chat);
    else if (travelled >= SWIPE_THRESHOLD) onToggleMute?.(chat);
  }

  return (
    <div
      className={classes}
      onContextMenu={
        canMark
          ? (event) => {
              event.preventDefault();
              setIsMenuOpen(true);
            }
          : undefined
      }
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
    >
      {/* Aparece por trás do card enquanto o dedo arrasta: sem a pista, o
          gesto só se descobre por acidente. */}
      {swipe !== 0 && (
        <div className='cardChat-swipe' aria-hidden='true'>
          <span className='cardChat-swipe-hint cardChat-swipe-hint--mute'>
            {chat.isMuted ? <FiBell size={16} /> : <FiBellOff size={16} />}
            {chat.isMuted ? 'Reativar' : 'Silenciar'}
          </span>
          <span className='cardChat-swipe-hint cardChat-swipe-hint--archive'>
            <FiInbox size={16} />
            {chat.isArchived ? 'Desarquivar' : 'Arquivar'}
          </span>
        </div>
      )}

      <div
        className='cardChat-container'
        style={swipe !== 0 ? { transform: `translateX(${swipe}px)` } : undefined}
        role='button'
        tabIndex={0}
        aria-current={isActive || undefined}
        onClick={() => onClick(chat)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onClick(chat);
          }
        }}
      >
        <div className='cardChat-container-image'>
          <Avatar
            image={chat.image}
            isLogged={chat.isLogged}
            status={chat.status}
            kind={chat.type === 'GROUP' ? 'group' : 'user'}
          />
        </div>
        <div className='cardChat-container-list'>
          <div className='cardChat-content'>
            <h4 className='cardChat-content-name'>
              {chat.isPinned && (
                <TbPin size={13} className='cardChat-content-pin' aria-label='Fixada' />
              )}
              {chat.isMuted && (
                <FiBellOff
                  size={12}
                  className='cardChat-content-muted'
                  aria-label='Silenciada'
                />
              )}
              {chat.name}
            </h4>
            <div
              className={`cardChat-content-message${
                typingLabel ? ' cardChat-content-message--typing' : ''
              }`}
            >
              {/* A ordem diz o que é mais urgente: alguém digitando agora, o
                  trecho que a busca achou, o seu rascunho parado, e só então a
                  última mensagem.

                  A menção não entra nessa disputa: ela é uma propriedade da
                  própria última mensagem, e por isso decora a prévia em vez de
                  substituí-la. O servidor só a marca enquanto a mensagem
                  estiver por ler — abrir a conversa apaga o destaque. */}
              {typingLabel ? (
                typingLabel
              ) : matchText ? (
                matchText
              ) : draft ? (
                <>
                  <em className='cardChat-content-draft'>Rascunho:</em> {draft}
                </>
              ) : chat.mentionsMe ? (
                <>
                  <em className='cardChat-content-mention'>@</em> {preview}
                </>
              ) : (
                preview
              )}
            </div>
          </div>
          <div className='cardChat-metadata'>
            {/* Hoje é a hora; ontem, "Ontem"; na semana, o dia; antes disso, a
                data. Só "HH:mm" não diz nada num card de duas semanas atrás. */}
            <span className='cardChat-metadata-time'>
              {lastMessage ? cardTimeLabel(lastMessage.createdAt) : ''}
            </span>
            {chat.unreadMessages > 0 && (
              <div
                className={`cardChat-metadata-unread${
                  chat.isMuted ? ' is-muted' : ''
                }`}
              >
                {chat.unreadMessages}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Na aba "Arquivadas" desarquivar é a ação óbvia: fica como botão à
          vista, e não escondida atrás do "⋮". */}
      {chat.isArchived && onToggleArchive && (
        <button
          type='button'
          className='cardChat-unarchive'
          aria-label={`Desarquivar conversa com ${chat.name}`}
          title='Desarquivar'
          onClick={(event) => {
            // O card inteiro é clicável: sem isto, desarquivar abriria a conversa.
            event.stopPropagation();
            onToggleArchive(chat);
          }}
        >
          <FiInbox size={15} />
        </button>
      )}

      {canMark && (
        <ChatMenu
          className='cardChat-menu'
          // A lista de conversas rola e recorta: sem isto, o menu das conversas
          // do fim abre para baixo e perde os últimos itens na borda.
          floating
          label={`Opções da conversa com ${chat.name}`}
          isUnread={chat.unreadMessages > 0}
          onMarkRead={() => onMarkRead?.(chat)}
          onMarkUnread={() => onMarkUnread?.(chat)}
          isPinned={chat.isPinned}
          {...(onTogglePin ? { onTogglePin: () => onTogglePin(chat) } : {})}
          isArchived={chat.isArchived}
          {...(onToggleArchive ? { onToggleArchive: () => onToggleArchive(chat) } : {})}
          isMuted={chat.isMuted}
          {...(onToggleMute ? { onToggleMute: () => onToggleMute(chat) } : {})}
          {...(onMuteFor
            ? { onMuteFor: (minutes: number | null) => onMuteFor(chat, minutes) }
            : {})}
          {...(onClearHistory ? { onClearHistory: () => onClearHistory(chat) } : {})}
          {...(onDelete && canDeleteChat(chat) ? { onDelete: () => onDelete(chat) } : {})}
          isOpen={isMenuOpen}
          onOpenChange={setIsMenuOpen}
        />
      )}
    </div>
  );
}
