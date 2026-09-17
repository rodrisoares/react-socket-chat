import 'components/SavedMessages/styles.scss';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiStar, FiMessageSquare } from 'react-icons/fi';

import fetch from 'config/fetchInstance';
import useChatList from 'hooks/chatList';
import useOpenChat from 'hooks/openChat';
import useSaved from 'hooks/saved';
import { dayLabel, timeLabel } from 'utils/dayLabel';
import { attachmentTypeLabel } from 'utils/messagePreview';
import type { SavedMessage } from '@react-chat/shared';

/**
 * As mensagens salvas, em página própria.
 *
 * Era um modal aberto pelo menu do avatar — duas camadas de clique para uma
 * lista que é um arquivo de consulta. Como destino do rail, ela tem endereço,
 * volta pelo botão do navegador e não cobre a conversa.
 */
export default function Saved() {
  const { chats } = useChatList();
  const { openChatAt } = useOpenChat();
  const { toggleSaved } = useSaved();
  const navigate = useNavigate();
  const [items, setItems] = useState<SavedMessage[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    fetch
      .get<{ saved: SavedMessage[] }>('/api/me/saved')
      .then((response) => {
        if (!cancelled) setItems(response.data.saved);
      })
      .catch(() => {
        if (!cancelled) setError('Não foi possível carregar as mensagens salvas.');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  /** Tira da lista e do servidor. A lista é o único lugar que mostra isto. */
  function remove(messageId: string) {
    toggleSaved(messageId);
    setItems((old) => old?.filter((item) => item.message.id !== messageId) ?? null);
  }

  /** Abre a conversa já rolando até a mensagem, e sai desta página. */
  function open(item: SavedMessage) {
    const target = chats.find((chat) => chat.id === item.chatId);
    if (!target) {
      setError('A conversa desta mensagem não está mais na sua lista.');
      return;
    }

    openChatAt(target.id, item.message.id);
    void navigate('/');
  }

  /** O nome do grupo, ou o da conversa como ela aparece na lista. */
  function chatLabel(item: SavedMessage): string {
    return item.chatName ?? chats.find((chat) => chat.id === item.chatId)?.name ?? 'Conversa';
  }

  return (
    <div className='saved-page'>
      <header className='saved-page-head'>
        <h1>Mensagens salvas</h1>
        <p>Só você vê esta lista. A estrela na barra de ações de cada mensagem guarda ela aqui.</p>
      </header>

      {error && <p className='saved-messages-error'>{error}</p>}
      {!items && !error && <p className='saved-messages-empty'>Carregando…</p>}

      {items?.length === 0 && (
        <p className='saved-messages-empty'>Nada salvo ainda.</p>
      )}

      {items && items.length > 0 && (
        <ul className='saved-messages'>
          {items.map((item) => (
            <li key={item.message.id} className='saved-messages-item'>
              <div className='saved-messages-head'>
                <strong>{chatLabel(item)}</strong>
                <span>
                  {item.message.name} · {dayLabel(item.message.createdAt)} às{' '}
                  {timeLabel(item.message.createdAt)}
                </span>
              </div>

              <p className='saved-messages-text'>
                {item.message.text || attachmentTypeLabel(item.message.attachment)}
              </p>

              <div className='saved-messages-actions'>
                <button type='button' onClick={() => open(item)}>
                  <FiMessageSquare size={14} /> Abrir na conversa
                </button>
                <button
                  type='button'
                  className='saved-messages-remove'
                  onClick={() => remove(item.message.id)}
                >
                  <FiStar size={14} /> Remover
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
