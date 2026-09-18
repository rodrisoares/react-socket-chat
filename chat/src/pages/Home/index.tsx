import './styles.scss';

import { IoMdSearch } from 'react-icons/io';
import { FiPlus, FiInbox, FiArrowLeft, FiChevronRight } from 'react-icons/fi';
import { lazy, Suspense, useMemo, useState } from 'react';

import ChatList, { type ChatFilterTab } from './ChatList';
import Display from './Display';

import ConfirmDialog from 'components/ConfirmDialog';
import useChatList from 'hooks/chatList';
import useOpenChat from 'hooks/openChat';
import { clearHistoryMessage, deleteChatMessage } from 'utils/chatActions';
import { unreadTotal } from 'utils/unread';
import type { Chat } from '@react-chat/shared';

/** As duas ações sem volta do menu passam pela mesma confirmação. */
interface PendingAction {
  chat: Chat;
  kind: 'clear' | 'delete';
}

const NewChatModal = lazy(() => import('components/NewChatModal'));

/**
 * Três abas, e não quatro: "Arquivadas" virou uma linha própria acima da lista,
 * como no WhatsApp e no Telegram.
 *
 * Quatro pílulas de texto não cabem numa linha de 236px, que é o que a sidebar
 * tem na largura mínima — a quarta ficava cortada para fora da área visível.
 * Quebrar em duas linhas custava ~30px de altura permanentes; o arquivo, que é
 * o filtro menos usado, saiu da fileira.
 */
const TABS: { id: ChatFilterTab; label: string }[] = [
  { id: 'all', label: 'Todas' },
  { id: 'unread', label: 'Não lidas' },
  { id: 'groups', label: 'Grupos' },
];

export default function Home() {
  const [filter, setFilter] = useState('');
  const [tab, setTab] = useState<ChatFilterTab>('all');
  const [isCreating, setIsCreating] = useState(false);
  /** Ação sem volta esperando confirmação; null = nenhuma. */
  const [pending, setPending] = useState<PendingAction | null>(null);

  const { chat: openChat, openChat: selectChat, openChatAt, closeChat } = useOpenChat();
  const {
    chats,
    markChatRead,
    markChatUnread,
    markChatPinned,
    markChatArchived,
    markChatMuted,
    clearChatHistory,
    deleteChat,
  } = useChatList();

  // Arquivada fica fora da conta: o badge não pode cobrar leitura de uma
  // conversa que nenhuma aba, fora "Arquivadas", chega a mostrar. As
  // silenciadas também saem — a mesma conta do rail e do título (utils/unread).
  const unread = useMemo(() => unreadTotal(chats), [chats]);

  const archived = useMemo(() => chats.filter((chat) => chat.isArchived), [chats]);

  const archivedUnread = useMemo(
    () => archived.filter((chat) => chat.unreadMessages > 0).length,
    [archived],
  );

  const isArchivedView = tab === 'archived';

  function markUnread(chat: Chat) {
    // Fecha se for a conversa aberta: aberta, ela seria marcada como lida de
    // novo no instante seguinte.
    if (openChat?.id === chat.id) closeChat();
    markChatUnread(chat.id);
  }

  function confirmPending() {
    if (!pending) return;

    if (pending.kind === 'clear') {
      clearChatHistory(pending.chat.id);
    } else {
      // Sai da lista: mantê-la aberta deixaria o Display sem conversa de origem.
      if (openChat?.id === pending.chat.id) closeChat();
      deleteChat(pending.chat.id);
    }

    setPending(null);
  }

  return (
    /*
     * `has-open-chat` só importa no mobile, onde a lista e a conversa dividem
     * uma tela: com conversa aberta aparece a conversa, sem conversa aparece a
     * lista. Era uma gaveta sobre o chat, aberta por um botão flutuante que
     * ficava justamente sobre o campo de escrita.
     */
    <div className={`home-container${openChat ? ' has-open-chat' : ''}`}>
      <div className='home-chat-container'>
        {/* Sem avatar: a identidade mora no rail, onde ela e acao. */}
        <header className='home-chat-identity'>
          <div className='home-chat-identity-text'>
            <strong>Conversas</strong>
            {/* Era um botão "Filtrar não lidas", que fazia o mesmo que a aba
                logo abaixo. Duas portas para a mesma sala: ficou o resumo. */}
            <span className='home-chat-identity-clear'>
              {unread > 0
                ? `${unread} não ${unread === 1 ? 'lida' : 'lidas'}`
                : 'Tudo em dia'}
            </span>
          </div>
          <button
            type='button'
            className='home-chat-new'
            onClick={() => setIsCreating(true)}
            aria-label='Nova conversa'
            title='Nova conversa'
          >
            <FiPlus size={18} />
          </button>
        </header>

        <div className='home-chat-input'>
          <IoMdSearch className='home-chat-input-icon' />
          <input
            placeholder='Buscar conversa ou mensagem'
            aria-label='Buscar conversas'
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>

        {isArchivedView ? (
          /* No arquivo as abas não fazem sentido: o que se espera ali é sair. */
          <>
            <button
              type='button'
              className='home-chat-archived home-chat-archived--back'
              onClick={() => setTab('all')}
            >
              <FiArrowLeft size={15} />
              <span className='home-chat-archived-label'>Arquivadas</span>
              <span className='home-chat-archived-count'>{archived.length}</span>
            </button>

            {/*
              A última discordância entre os dois números da tela.

              O cartão daqui mostra o seu contador de não lidas, e o badge do
              rail não conta nenhuma delas — arquivar é pedir para não ser
              chamado, e silenciar também (ver utils/unread). Sem esta linha, um
              arquivo com três não lidas ao lado de um rail sem badge parece
              defeito, e era exatamente onde a conta parecia não fechar.
            */}
            <p className='home-chat-archived-note'>
              O que está aqui — e o que está silenciado — não entra no contador
              do rail.
            </p>
          </>
        ) : (
          <>
            <div
              className='home-chat-tabs'
              role='tablist'
              aria-label='Filtrar conversas'
            >
              {TABS.map((item) => (
                <button
                  key={item.id}
                  type='button'
                  role='tab'
                  aria-selected={tab === item.id}
                  className={`home-chat-tabs-item${tab === item.id ? ' is-active' : ''}`}
                  onClick={() => setTab(item.id)}
                >
                  {item.label}
                  {item.id === 'unread' && unread > 0 && (
                    <span className='home-chat-tabs-count'>{unread}</span>
                  )}
                </button>
              ))}
            </div>

            {/* Só aparece quando há algo arquivado: uma porta para uma sala
                vazia não ajuda ninguém, e é assim que o WhatsApp faz. */}
            {archived.length > 0 && (
              <button
                type='button'
                className='home-chat-archived'
                onClick={() => setTab('archived')}
              >
                <FiInbox size={15} />
                <span className='home-chat-archived-label'>Arquivadas</span>
                {archivedUnread > 0 && (
                  <span className='home-chat-archived-badge'>{archivedUnread}</span>
                )}
                <span className='home-chat-archived-count'>{archived.length}</span>
                <FiChevronRight size={15} className='home-chat-archived-chevron' />
              </button>
            )}
          </>
        )}

        <div className='home-chat-content'>
          <ChatList
            filter={filter}
            tab={tab}
            {...(openChat?.id ? { activeChatId: openChat.id } : {})}
            // Com o id da mensagem — um resultado da busca —, a conversa abre
            // já rolando até ela, em vez de só no fim do histórico.
            onSelect={(chat, messageId) =>
              messageId ? openChatAt(chat.id, messageId) : selectChat(chat)
            }
            onMarkRead={(chat) => markChatRead(chat.id)}
            onMarkUnread={markUnread}
            onTogglePin={(chat) => markChatPinned(chat.id, !chat.isPinned)}
            onToggleArchive={(chat) => markChatArchived(chat.id, !chat.isArchived)}
            onToggleMute={(chat) => markChatMuted(chat.id, !chat.isMuted)}
            // `null` das durações é "Sempre"; o hook espera `undefined` para
            // "sem prazo". Converter aqui evita que um null vire prazo zero.
            onMuteFor={(chat, minutes) =>
              markChatMuted(chat.id, true, minutes ?? undefined)
            }
            onClearHistory={(chat) => setPending({ chat, kind: 'clear' })}
            onDelete={(chat) => setPending({ chat, kind: 'delete' })}
          />
        </div>
      </div>

      <Display onNewChat={() => setIsCreating(true)} />

      {isCreating && (
        <Suspense fallback={null}>
          <NewChatModal onClose={() => setIsCreating(false)} onCreated={selectChat} />
        </Suspense>
      )}

      {pending && (
        <ConfirmDialog
          title={pending.kind === 'clear' ? 'Limpar conversa' : 'Excluir conversa'}
          message={
            pending.kind === 'clear'
              ? clearHistoryMessage(pending.chat)
              : deleteChatMessage(pending.chat)
          }
          confirmLabel={pending.kind === 'clear' ? 'Limpar' : 'Excluir'}
          onConfirm={confirmPending}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
}
