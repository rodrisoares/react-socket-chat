import './styles.scss';
import { useMemo, useState } from 'react';

import Modal from 'components/Modal';
import Avatar from 'components/Avatar';
import useChatList from 'hooks/chatList';
import { useChatSearch } from 'hooks/search';
import { readApiErrors } from 'utils/apiErrors';
import type { AxiosError } from 'axios';
import { FORWARD_MAX_CHATS, type Chat, type Message } from '@react-chat/shared';

interface ForwardModalProps {
  /** A mensagem que será copiada para cada destino escolhido. */
  message: Message;
  /** Conversa de origem: não faz sentido encaminhar para ela mesma. */
  fromChatId: string;
  onConfirm: (chatIds: string[]) => Promise<void>;
  onClose: () => void;
}

/** O teto vem do pacote compartilhado: o aviso sai antes da viagem. */
const MAX_TARGETS = FORWARD_MAX_CHATS;

/** Escolha de destinos para encaminhar, com seleção múltipla. */
export default function ForwardModal({
  message,
  fromChatId,
  onConfirm,
  onClose,
}: ForwardModalProps) {
  const { chats, loadMoreChats, hasMoreChats, isLoadingChats } = useChatList();
  const [selected, setSelected] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState('');
  const [isSending, setIsSending] = useState(false);

  /**
   * Com termo, quem procura é o servidor; sem termo, vale a lista já carregada.
   *
   * Antes o modal puxava **todas** as páginas ao abrir, porque o filtro era
   * feito aqui e oferecer só as 30 primeiras esconderia destinos que existem.
   * Com a busca no servidor, abrir o modal voltou a custar o que já estava em
   * cache, e quem quiser ver mais rola até o fim ou digita um nome.
   */
  const isFiltering = filter.trim().length > 0;
  const found = useChatSearch(filter);

  const options = useMemo(() => {
    const visible = isFiltering ? found.chats : chats;

    return visible.filter((chat) => {
      // Fora: a origem, grupo de que já saiu (não dá para escrever) e contato
      // bloqueado — o servidor recusaria os três.
      return chat.id !== fromChatId && !chat.hasLeft && !chat.isBlocked;
    });
  }, [chats, found.chats, isFiltering, fromChatId]);

  const hasMore = isFiltering ? found.hasMore : hasMoreChats;
  const isLoadingMore = isFiltering ? found.isSearching : isLoadingChats;

  function toggle(chat: Chat) {
    setError('');
    setSelected((old) =>
      old.includes(chat.id) ? old.filter((id) => id !== chat.id) : [...old, chat.id],
    );
  }

  async function confirm() {
    if (selected.length === 0) return;
    setError('');
    setIsSending(true);

    try {
      await onConfirm(selected);
      onClose();
    } catch (err) {
      setError(
        readApiErrors(err as AxiosError, 'Não foi possível encaminhar.')[0] ??
          'Não foi possível encaminhar.',
      );
    } finally {
      setIsSending(false);
    }
  }

  const preview = message.text || message.attachment?.name || 'Mensagem';

  return (
    <Modal title='Encaminhar mensagem' onClose={onClose}>
      <p className='forward-preview'>{preview}</p>

      <input
        className='forward-input'
        placeholder='Buscar conversa'
        aria-label='Buscar conversa'
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
      />

      <ul className='forward-list'>
        {options.length === 0 && (
          <li className='forward-empty'>Nenhuma conversa disponível.</li>
        )}
        {options.map((chat) => (
          <li key={chat.id}>
            <button
              type='button'
              className={selected.includes(chat.id) ? 'is-selected' : ''}
              onClick={() => toggle(chat)}
              aria-pressed={selected.includes(chat.id)}
            >
              <Avatar
                image={chat.image}
                isLogged={chat.isLogged}
                status={chat.status}
                kind={chat.type === 'GROUP' ? 'group' : 'user'}
              />
              <span>{chat.name}</span>
            </button>
          </li>
        ))}

        {/* Fim da lista carregada: o resto vem a pedido, e não de enfiada ao
            abrir o modal. Digitar um nome costuma ser mais rápido. */}
        {hasMore && (
          <li>
            <button
              type='button'
              className='forward-more'
              disabled={isLoadingMore}
              onClick={() => void (isFiltering ? found.loadMore() : loadMoreChats())}
            >
              {isLoadingMore ? 'Carregando…' : 'Carregar mais conversas'}
            </button>
          </li>
        )}
      </ul>

      {error && <p className='forward-error'>{error}</p>}

      <button
        type='button'
        className='forward-submit'
        disabled={selected.length === 0 || selected.length > MAX_TARGETS || isSending}
        onClick={() => void confirm()}
      >
        {isSending
          ? 'Encaminhando...'
          : selected.length > MAX_TARGETS
            ? `No máximo ${MAX_TARGETS} conversas`
            : `Encaminhar${selected.length > 0 ? ` (${selected.length})` : ''}`}
      </button>
    </Modal>
  );
}
