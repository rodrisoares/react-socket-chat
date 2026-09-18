import './styles.scss';
import { lazy, Suspense, useState } from 'react';
import { FiArrowLeft, FiCamera } from 'react-icons/fi';

import Modal from 'components/Modal';
import Avatar from 'components/Avatar';
import fetch from 'config/fetchInstance';
import useContacts from 'hooks/contacts';
import useChatList from 'hooks/chatList';
import {
  GROUP_DESCRIPTION_MAX_LENGTH,
  type Chat,
  type User,
} from '@react-chat/shared';

// As 16 miniaturas só são baixadas se alguém abrir o seletor.
const AvatarPicker = lazy(() => import('components/AvatarPicker'));

interface NewChatModalProps {
  onClose: () => void;
  /**
   * Recebe a conversa já pronta, e não só o id: quem chama procuraria o id na
   * lista de antes do reload, onde a recém-criada ainda não está.
   */
  onCreated: (chat: Chat) => void;
}

type Mode = 'direct' | 'group';

/**
 * Em grupo, criar tem duas etapas: escolher quem entra, e depois dar cara ao
 * grupo. Conversa direta continua numa tela só — ali não há o que nomear.
 */
type Step = 'members' | 'details';

/** Inicia conversa direta ou cria um grupo. */
export default function NewChatModal({ onClose, onCreated }: NewChatModalProps) {
  const { reloadChats } = useChatList();
  const [mode, setMode] = useState<Mode>('direct');
  const [step, setStep] = useState<Step>('members');
  const [search, setSearch] = useState('');
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

  /**
   * A cara do grupo, preenchida na segunda etapa.
   *
   * O grupo nascia pelado — só nome e participantes — e a foto e o assunto
   * dependiam de alguém abrir o painel de detalhes depois. Na lista, grupos sem
   * foto ficam indistinguíveis uns dos outros.
   */
  const [groupName, setGroupName] = useState('');
  const [groupImage, setGroupImage] = useState('');
  const [groupDescription, setGroupDescription] = useState('');
  const [isPickingImage, setIsPickingImage] = useState(false);

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
   * A espera pela digitação e o cache moram no hook — este modal e o painel de
   * detalhes faziam a mesma busca com o mesmo atraso, cada um com a própria
   * cópia do código e do resultado.
   */
  const { contacts, isFailed } = useContacts(search);

  /** Trocar de aba recomeça a escolha, e volta à primeira etapa. */
  function changeMode(next: Mode) {
    setMode(next);
    setStep('members');
    setChosen([]);
    setError('');
  }

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
          // Só o que foi preenchido: campo vazio é ausência, e não uma foto de
          // caminho vazio.
          ...(groupImage ? { image: groupImage } : {}),
          ...(groupDescription.trim() ? { description: groupDescription } : {}),
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

  const isNamingGroup = mode === 'group' && step === 'details';

  /** O que o botão principal faz agora — avançar, ou criar de vez. */
  const canAdvance = mode === 'group' && step === 'members' && selected.length >= 1;
  const canSubmit = isNamingGroup
    ? groupName.trim().length >= 2
    : mode === 'direct' && selected.length === 1;

  return (
    <Modal
      title={isNamingGroup ? 'Dar nome ao grupo' : 'Nova conversa'}
      onClose={onClose}
    >
      {isNamingGroup ? (
        <>
          {/*
            Voltar é o caminho de quem escolheu a pessoa errada. Sem ele, a
            única saída seria fechar o modal e recomeçar a seleção.
          */}
          <button
            type='button'
            className='new-chat-back'
            onClick={() => setStep('members')}
          >
            <FiArrowLeft size={15} /> Escolher participantes
          </button>

          <div className='new-chat-identity'>
            <div className='new-chat-identity-avatar'>
              <Avatar image={groupImage || undefined} kind='group' />
              <button
                type='button'
                onClick={() => setIsPickingImage(true)}
                aria-label={groupImage ? 'Trocar a foto do grupo' : 'Escolher uma foto'}
                title={groupImage ? 'Trocar a foto' : 'Escolher uma foto'}
              >
                <FiCamera size={14} />
              </button>
            </div>
            {/*
              Quem vai entrar, dito na etapa em que já não dá para vê-los na
              lista: criar um grupo sem saber com quem seria o pior tipo de
              engano, porque ele só aparece depois da primeira mensagem.
            */}
            <p className='new-chat-identity-members'>
              {chosen.length === 1
                ? `Com ${chosen[0]?.name ?? ''}`
                : `Com ${String(chosen.length)} pessoas: ${chosen
                    .map((user) => user.name)
                    .join(', ')}`}
            </p>
          </div>

          <input
            className='new-chat-input'
            placeholder='Nome do grupo'
            aria-label='Nome do grupo'
            value={groupName}
            onChange={(event) => setGroupName(event.target.value)}
            autoFocus
          />

          <textarea
            className='new-chat-input new-chat-description'
            rows={3}
            maxLength={GROUP_DESCRIPTION_MAX_LENGTH}
            placeholder='Do que se trata este grupo? (opcional)'
            aria-label='Descrição do grupo'
            value={groupDescription}
            onChange={(event) => setGroupDescription(event.target.value)}
          />
        </>
      ) : (
        <>
          <div className='new-chat-tabs' role='tablist'>
            <button
              type='button'
              role='tab'
              aria-selected={mode === 'direct'}
              className={mode === 'direct' ? 'is-active' : ''}
              onClick={() => changeMode('direct')}
            >
              Conversa direta
            </button>
            <button
              type='button'
              role='tab'
              aria-selected={mode === 'group'}
              className={mode === 'group' ? 'is-active' : ''}
              onClick={() => changeMode('group')}
            >
              Grupo
            </button>
          </div>

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
                {search
                  ? `Ninguém encontrado para “${search}”.`
                  : 'Nenhum contato disponível.'}
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
        </>
      )}

      {(error || isFailed) && (
        <p className='new-chat-error'>
          {error || 'Não foi possível carregar os contatos.'}
        </p>
      )}

      <button
        type='button'
        className='new-chat-submit'
        disabled={(canAdvance ? false : !canSubmit) || isSubmitting}
        onClick={() => {
          if (canAdvance) {
            setStep('details');
            return;
          }
          void submit();
        }}
      >
        {isSubmitting
          ? 'Criando...'
          : mode === 'direct'
            ? 'Conversar'
            : step === 'members'
              ? `Continuar${selected.length > 0 ? ` (${String(selected.length)})` : ''}`
              : 'Criar grupo'}
      </button>

      {isPickingImage && (
        <Suspense fallback={null}>
          <AvatarPicker
            kind='group'
            current={groupImage}
            onSelect={setGroupImage}
            onClose={() => setIsPickingImage(false)}
          />
        </Suspense>
      )}
    </Modal>
  );
}
