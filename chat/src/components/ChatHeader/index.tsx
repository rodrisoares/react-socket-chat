import { useState } from 'react';
import { IoSearch, IoArrowBack } from 'react-icons/io5';
import { FiInbox } from 'react-icons/fi';

import Avatar from 'components/Avatar';
import ChatMenu from 'components/ChatMenu';
import canDeleteChat from 'utils/chatActions';
import { presenceLabel } from 'utils/lastSeen';
import type { Chat } from '@react-chat/shared';

interface ChatHeaderProps {
  chat: Chat;
  /** Fecha a conversa e devolve a tela à lista. Só aparece no mobile. */
  onBack: () => void;
  onToggleDetails: () => void;
  onToggleSearch: () => void;
  onMarkRead: () => void;
  /** Fecha a conversa: aberta, ela seria marcada como lida de novo na hora. */
  onMarkUnread: () => void;
  onToggleArchive: () => void;
  onToggleMute: () => void;
  /** Silenciar por um prazo; `null` é o "até eu desfazer". */
  onMuteFor: (minutes: number | null) => void;
  /** Pedem a confirmação; agir de verdade fica com o Display. */
  onClearHistory: () => void;
  onDelete: () => void;
}

export default function ChatHeader({
  chat,
  onBack,
  onToggleDetails,
  onToggleSearch,
  onMarkRead,
  onMarkUnread,
  onToggleArchive,
  onToggleMute,
  onMuteFor,
  onClearHistory,
  onDelete,
}: ChatHeaderProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const isGroup = chat.type === 'GROUP';

  const presence = presenceLabel(chat.isLogged, chat.lastSeenAt, chat.status);

  /**
   * A linha sob o nome: quantos participantes, ou o "visto por último".
   *
   * O "· ver detalhes" saiu de todas elas — agora o cabeçalho inteiro é o
   * botão, e repetir o convite em cada linha virou ruído. Ele sobrevive só
   * como último recurso na conversa direta: a presença chega vazia de quem
   * escondeu o campo na privacidade, e aí não haveria o que dizer no lugar.
   */
  const subtitle = chat.hasLeft
    ? 'Você saiu do grupo'
    : isGroup
      ? `${chat.members.length} participantes`
      : presence || 'Ver detalhes';

  return (
    <div className='display-header'>
      <div className='display-header-content'>
        <button
          type='button'
          className='display-header-back'
          onClick={onBack}
          aria-label='Voltar para as conversas'
          title='Voltar'
        >
          <IoArrowBack size={20} />
        </button>
        {/*
          O avatar e o nome abrem os detalhes junto com o subtítulo: antes só
          uma linha de 10px sublinhada era clicável — o alvo mais difícil da
          barra para a ação mais procurada dela.

          `role="button"` num `div`, e não um `<button>` de verdade, porque
          dentro dele há um `h2` e o avatar: título e bloco não são conteúdo
          válido de botão. É o mesmo desenho do card da lista.
        */}
        <div
          className='display-header-open'
          role='button'
          tabIndex={0}
          onClick={onToggleDetails}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onToggleDetails();
            }
          }}
          title={isGroup ? 'Ver detalhes do grupo' : 'Ver detalhes do contato'}
        >
          <Avatar
            image={chat.image}
            isLogged={chat.isLogged}
            status={chat.status}
            kind={isGroup ? 'group' : 'user'}
          />
          <div className='display-header-content-name'>
            <h2>{chat.name}</h2>
            <span>{subtitle}</span>
          </div>
        </div>
      </div>
      <div className='display-header-actions'>
        {/* Conversa arquivada aberta: tirar do arquivo é a ação esperada, e
            merece um botão em vez de uma linha no menu. */}
        {chat.isArchived && (
          <button
            type='button'
            className='display-header-search'
            onClick={onToggleArchive}
            aria-label='Desarquivar conversa'
            title='Desarquivar'
          >
            <FiInbox size={18} />
          </button>
        )}
        <button
          type='button'
          className='display-header-search'
          onClick={onToggleSearch}
          aria-label='Buscar na conversa'
          title='Buscar na conversa'
        >
          <IoSearch size={18} />
        </button>
        <ChatMenu
          label='Opções da conversa'
          isUnread={chat.unreadMessages > 0}
          onMarkRead={onMarkRead}
          onMarkUnread={onMarkUnread}
          isArchived={chat.isArchived}
          onToggleArchive={onToggleArchive}
          isMuted={chat.isMuted}
          onToggleMute={onToggleMute}
          onMuteFor={onMuteFor}
          onClearHistory={onClearHistory}
          {...(canDeleteChat(chat) ? { onDelete } : {})}
          isOpen={isMenuOpen}
          onOpenChange={setIsMenuOpen}
        />
      </div>
    </div>
  );
}
