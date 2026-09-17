import './styles.scss';
import { useEffect, useMemo, useState } from 'react';

import Modal from 'components/Modal';
import Avatar from 'components/Avatar';
import useChatList from 'hooks/chatList';
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
   * Puxa o resto da lista enquanto o modal está aberto.
   *
   * A lista de conversas é paginada; aqui ela é o universo de escolha, e
   * oferecer só as 30 primeiras esconderia destinos que existem. Uma página por
   * vez, porque cada uma depende do cursor da anterior.
   */
  useEffect(() => {
    if (!hasMoreChats || isLoadingChats) return;
    void loadMoreChats();
  }, [hasMoreChats, isLoadingChats, loadMoreChats]);

  const options = useMemo(() => {
    const needle = filter.trim().toLowerCase();

    return chats.filter((chat) => {
      // Fora: a origem, grupo de que já saiu (não dá para escrever) e contato
      // bloqueado — o servidor recusaria os três.
      if (chat.id === fromChatId || chat.hasLeft || chat.isBlocked) return false;
      return !needle || chat.name.toLowerCase().includes(needle);
    });
  }, [chats, fromChatId, filter]);

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
