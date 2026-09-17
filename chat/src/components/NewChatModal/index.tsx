import './styles.scss';
import { useEffect, useState } from 'react';

import Modal from 'components/Modal';
import Avatar from 'components/Avatar';
import fetch from 'config/fetchInstance';
import useChatList from 'hooks/chatList';
import type { Chat, User } from '@react-chat/shared';

interface NewChatModalProps {
  onClose: () => void;
  /**
   * Recebe a conversa já pronta, e não só o id: quem chama procuraria o id na
   * lista de antes do reload, onde a recém-criada ainda não está.
   */
  onCreated: (chat: Chat) => void;
}

type Mode = 'direct' | 'group';

/** Inicia conversa direta ou cria um grupo. */
export default function NewChatModal({ onClose, onCreated }: NewChatModalProps) {
  const { reloadChats } = useChatList();
  const [mode, setMode] = useState<Mode>('direct');
  const [search, setSearch] = useState('');
  const [contacts, setContacts] = useState<User[]>([]);
  /**
   * Os escolhidos por inteiro, e não só os ids.
   *
   * Passou a importar quando a lista virou busca. Antes ela trazia todo mundo,
   * então quem foi escolhido continuava à vista. Agora, escolher alguém e
   * digitar outro nome faria o primeiro sumir da lista continuando selecionado:
   * contado no botão, e impossível de desmarcar. Guardados aqui, eles seguem
   * como fichas acima da lista, independentemente do que a busca devolve.
   */
  const [chosen, setChosen] = useState<User[]>([]);
  const [groupName, setGroupName] = useState('');

  const selected = chosen.map((user) => user.id);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  /**
   * A busca acontece no servidor, e não sobre uma lista já baixada.
   *
   * O `/contacts` devolvia todo usuário cadastrado de uma vez, e este modal nem
   * campo de busca tinha: com cem contas eram cem perfis a cada abertura, e a
   * pessoa rolava tudo procurando um nome.
   *
   * Os 250ms esperam a digitação parar. A rota tem limite de busca — uma ida ao
   * servidor por tecla gastaria a cota antes de alguém terminar de escrever um
   * nome, e as respostas ainda poderiam chegar fora de ordem.
   */
  useEffect(() => {
    let cancelled = false;

    const timer = setTimeout(() => {
      fetch
        .get<User[]>(`/api/me/contacts?q=${encodeURIComponent(search)}`)
        .then((response) => {
          if (!cancelled) setContacts(response.data);
        })
        .catch(() => {
          if (!cancelled) setError('Não foi possível carregar os contatos.');
        });
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search]);

  function toggle(user: User) {
    // Conversa direta é com uma pessoa: escolher outra troca, não soma.
    if (mode === 'direct') {
      setChosen([user]);
      return;
    }

    setChosen((old) =>
      old.some((item) => item.id === user.id)
        ? old.filter((item) => item.id !== user.id)
        : [...old, user],
    );
  }

  /** Recarrega e entrega a conversa recém-criada, se ela veio. */
  async function handOver(chatId: string) {
    const fresh = await reloadChats();
    const created = fresh.find((item) => item.id === chatId);
    if (created) onCreated(created);
  }

  async function submit() {
    setError('');
    setIsSubmitting(true);

    try {
      if (mode === 'direct') {
        const otherUserId = selected[0];
        if (otherUserId === undefined) {
          setError('Escolha um contato.');
          return;
        }
        const response = await fetch.post<{ id: string }>('/api/chats', { otherUserId });
        await handOver(response.data.id);
      } else {
        const response = await fetch.post<{ id: string }>('/api/chats/groups', {
          name: groupName,
          memberIds: selected,
        });
        await handOver(response.data.id);
      }
      onClose();
    } catch (err) {
      const data = (err as { response?: { data?: { error?: string; issues?: { mensagem: string }[] } } })
        .response?.data;
      setError(data?.issues?.[0]?.mensagem ?? data?.error ?? 'Não foi possível criar.');
    } finally {
      setIsSubmitting(false);
    }
  }

  const canSubmit =
    mode === 'direct'
      ? selected.length === 1
      : selected.length >= 1 && groupName.trim().length >= 2;

  return (
    <Modal title='Nova conversa' onClose={onClose}>
      <div className='new-chat-tabs' role='tablist'>
        <button
          type='button'
          role='tab'
          aria-selected={mode === 'direct'}
          className={mode === 'direct' ? 'is-active' : ''}
          onClick={() => {
            setMode('direct');
            setChosen([]);
          }}
        >
          Conversa direta
        </button>
        <button
          type='button'
          role='tab'
          aria-selected={mode === 'group'}
          className={mode === 'group' ? 'is-active' : ''}
          onClick={() => {
            setMode('group');
            setChosen([]);
          }}
        >
          Grupo
        </button>
      </div>

      {mode === 'group' && (
        <input
          className='new-chat-input'
          placeholder='Nome do grupo'
          aria-label='Nome do grupo'
          value={groupName}
          onChange={(e) => setGroupName(e.target.value)}
        />
      )}

      <input
        className='new-chat-input'
        type='search'
        placeholder='Buscar contato'
        aria-label='Buscar contato'
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {/*
        Os escolhidos ficam à vista mesmo quando a busca não os devolve — sem
        isto a seleção viraria um número no botão sem ninguém por trás.
      */}
      {mode === 'group' && chosen.length > 0 && (
        <ul className='new-chat-chosen' aria-label='Escolhidos'>
          {chosen.map((user) => (
            <li key={user.id}>
              <button
                type='button'
                onClick={() => toggle(user)}
                aria-label={`Remover ${user.name}`}
              >
                {user.name} <span aria-hidden='true'>×</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <ul className='new-chat-list'>
        {contacts.length === 0 && (
          <li className='new-chat-empty'>
            {search ? `Ninguém encontrado para “${search}”.` : 'Nenhum contato disponível.'}
          </li>
        )}
        {contacts.map((user) => (
          <li key={user.id}>
            <button
              type='button'
              className={selected.includes(user.id) ? 'is-selected' : ''}
              onClick={() => toggle(user)}
              aria-pressed={selected.includes(user.id)}
            >
              <Avatar image={user.image} isLogged={user.isOnline} status={user.status} />
              <span>{user.name}</span>
            </button>
          </li>
        ))}
      </ul>

      {error && <p className='new-chat-error'>{error}</p>}

      <button
        type='button'
        className='new-chat-submit'
        disabled={!canSubmit || isSubmitting}
        onClick={() => void submit()}
      >
        {isSubmitting ? 'Criando...' : mode === 'direct' ? 'Conversar' : 'Criar grupo'}
      </button>
    </Modal>
  );
}
