import './styles.scss';
import { useEffect, useState } from 'react';
import { IoClose } from 'react-icons/io5';
import {
  FiUserPlus,
  FiUserMinus,
  FiEdit2,
  FiArrowLeft,
  FiMessageSquare,
  FiCamera,
  FiSlash,
  FiLink,
  FiCopy,
  FiRefreshCw,
  FiShield,
} from 'react-icons/fi';

import type { AxiosError } from 'axios';

import fetch from 'config/fetchInstance';
import { readApiErrors } from 'utils/apiErrors';
import { presenceLabel } from 'utils/lastSeen';
import Avatar from 'components/Avatar';
import AvatarPicker from 'components/AvatarPicker';
import ChatGallery from 'components/ChatGallery';
import ConfirmDialog from 'components/ConfirmDialog';
import useEscape from 'hooks/escape';
import useSession from 'hooks/session';
import useChatList from 'hooks/chatList';
import {
  GROUP_DESCRIPTION_MAX_LENGTH,
  type ChatDetails as Details,
  type Chat,
  type Member,
  type User,
} from '@react-chat/shared';

/** "No grupo desde": data cheia, sem o "Hoje/Ontem" do separador de mensagens. */
function joinedLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long' }).format(date);
}

interface ChatDetailsProps {
  chat: Chat;
  onClose: () => void;
  /**
   * Abre outra conversa — usado por "Enviar mensagem" no perfil de um membro
   * do grupo. Quem troca a conversa aberta é o Display, não este painel.
   */
  onOpenChat: (chat: Chat) => void;
}

/** Painel de detalhes — substitui o alert("Esta função ainda não existe"). */
export default function ChatDetails({ chat, onClose, onOpenChat }: ChatDetailsProps) {
  const { user } = useSession();
  const { reloadChats } = useChatList();
  const myId = user?.id;
  const [details, setDetails] = useState<Details | null>(null);
  const [contacts, setContacts] = useState<User[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [newName, setNewName] = useState(chat.name);
  /** Rascunho da descrição; null = não está editando. */
  const [draftDescription, setDraftDescription] = useState<string | null>(null);
  /**
   * Termo da busca de contatos para adicionar.
   *
   * Passou a existir quando o `/contacts` virou busca com teto de 30: sem
   * campo, um grupo grande simplesmente não conseguiria achar a 31ª pessoa.
   */
  const [memberSearch, setMemberSearch] = useState('');
  /** "Copiado!" por um instante, como no botão de copiar do balão. */
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [error, setError] = useState('');
  /** Membro cujo perfil está aberto; null = o painel do grupo. */
  const [openMemberId, setOpenMemberId] = useState<number | null>(null);
  const [isOpeningDirect, setIsOpeningDirect] = useState(false);
  const [isPickingImage, setIsPickingImage] = useState(false);
  /** Quem eu bloqueei. Buscado aqui: é o único lugar que oferece a ação. */
  const [blockedIds, setBlockedIds] = useState<number[]>([]);
  /**
   * Ação sem volta esperando confirmação; null = nenhuma.
   *
   * Sair do grupo, remover alguém e bloquear aconteciam no primeiro clique —
   * em botões de 16px encostados em outros que não fazem nada disso.
   */
  const [pending, setPending] = useState<
    | { kind: 'leave' }
    | { kind: 'remove'; member: Member }
    | { kind: 'block'; member: Member }
    | null
  >(null);

  const isGroup = chat.type === 'GROUP';

  /**
   * Presença de um membro, sempre pela lista de conversas.
   *
   * O painel busca os detalhes uma vez, ao abrir; quem acompanha quem entrou,
   * saiu ou trocou de status é o socket, que atualiza a lista. Sem isto a
   * linha congelava no estado do instante em que o painel foi aberto.
   */
  function presenceOf(member: Member): string {
    const live = chat.members.find((item) => item.id === member.id) ?? member;
    return presenceLabel(live.isOnline, live.lastSeenAt, live.status);
  }

  // Derivado, e não copiado para o estado: assim quem sai do grupo ou muda de
  // nome não deixa um perfil congelado na tela.
  const openMember = details?.members.find((m) => m.id === openMemberId) ?? null;
  const showChatPanel = openMember === null;

  // Esc volta um passo: do perfil do membro para o grupo, e do painel para a
  // conversa. Antes ele fechava a conversa inteira, com o painel junto.
  useEscape(() => (openMember ? setOpenMemberId(null) : onClose()));

  useEffect(() => {
    // Trocar de conversa volta ao painel do grupo: o membro aberto era de outra.
    setOpenMemberId(null);

    let cancelled = false;
    fetch
      // A rota devolve as pessoas, e não ids: é o que permite a tela de
      // bloqueados mostrar nomes sem depender da lista de contatos, que agora
      // vem paginada. Aqui só os ids interessam — o painel já tem os membros.
      .get<{ blocked: User[] }>('/api/me/blocks')
      .then((response) => {
        // `?? []` porque uma resposta fora do formato não pode derrubar o
        // painel inteiro — no pior caso o botão de bloquear some.
        if (!cancelled) setBlockedIds((response.data.blocked ?? []).map((who) => who.id));
      })
      .catch(() => {
        // Sem a lista o botão some; melhor do que oferecer uma ação incerta.
      });

    fetch
      .get<Details>(`/api/chats/${chat.id}`)
      .then((response) => {
        if (!cancelled) setDetails(response.data);
      })
      .catch(() => {
        if (!cancelled) setError('Não foi possível carregar os detalhes.');
      });
    return () => {
      cancelled = true;
    };
  }, [chat.id]);

  /**
   * Contatos que ainda não estão no grupo, filtrados no servidor.
   *
   * O `q` não é enfeite: a rota devolve no máximo uma página, e sem termo a
   * 31ª pessoa da agenda seria inalcançável por este painel.
   */
  async function loadContacts(term = '') {
    const response = await fetch.get<User[]>(
      `/api/me/contacts?q=${encodeURIComponent(term)}`,
    );
    const memberIds = new Set(details?.members.map((m) => m.id) ?? []);

    setContacts(response.data.filter((user) => !memberIds.has(user.id)));
    setIsAdding(true);
  }

  /** Salva (ou limpa) a descrição do grupo. String vazia remove. */
  async function saveDescription(value: string) {
    try {
      await fetch.patch(`/api/chats/${chat.id}`, { description: value });
      await reloadChats();
      setDraftDescription(null);
    } catch {
      setError('Não foi possível salvar a descrição.');
    }
  }

  /** Liga/desliga o "só administradores enviam". A leitura continua aberta. */
  async function toggleOnlyAdmins(next: boolean) {
    try {
      await fetch.patch(`/api/chats/${chat.id}`, { onlyAdminsSend: next });
      await reloadChats();
    } catch {
      setError('Não foi possível mudar quem pode enviar.');
    }
  }

  /** Promove ou rebaixa. O servidor recusa rebaixar o último administrador. */
  async function toggleAdmin(member: Member) {
    try {
      await fetch.put(`/api/chats/${chat.id}/members/${member.id}/admin`, {
        isAdmin: !member.isAdmin,
      });
      await reloadChats();
      const response = await fetch.get<Details>(`/api/chats/${chat.id}`);
      setDetails(response.data);
    } catch (err) {
      // Mostra o motivo do servidor: "o grupo ficaria sem nenhum administrador"
      // explica a recusa; um erro genérico deixaria a pessoa tentando de novo.
      setError(
        readApiErrors(err as AxiosError, 'Não foi possível mudar a administração.')[0] ??
          'Não foi possível mudar a administração.',
      );
    }
  }

  /**
   * Gera o convite — ou troca o que existia.
   *
   * Gerar de novo invalida o anterior: é assim que se revoga um link que vazou,
   * e por isso o botão diz "Gerar outro" quando já há um.
   */
  async function createInvite() {
    try {
      const response = await fetch.post<{ inviteUrl: string }>(
        `/api/chats/${chat.id}/invite`,
      );
      setDetails((old) => (old ? { ...old, inviteUrl: response.data.inviteUrl } : old));
    } catch {
      setError('Não foi possível gerar o convite.');
    }
  }

  async function revokeInvite() {
    try {
      await fetch.delete(`/api/chats/${chat.id}/invite`);
      setDetails((old) => (old ? { ...old, inviteUrl: null } : old));
    } catch {
      setError('Não foi possível revogar o convite.');
    }
  }

  /** Como no balão: sem a API de área de transferência, não finge que copiou. */
  async function copyInvite(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedInvite(true);
      window.setTimeout(() => setCopiedInvite(false), 1500);
    } catch {
      setError('Não foi possível copiar. Selecione o link e copie à mão.');
    }
  }

  async function addMember(userId: number) {
    try {
      await fetch.post(`/api/chats/${chat.id}/members`, { memberIds: [userId] });
      await reloadChats();
      const response = await fetch.get<Details>(`/api/chats/${chat.id}`);
      setDetails(response.data);
      setContacts((old) => old.filter((c) => c.id !== userId));
    } catch {
      setError('Não foi possível adicionar.');
    }
  }

  async function removeMember(userId: number) {
    try {
      await fetch.delete(`/api/chats/${chat.id}/members/${userId}`);
      await reloadChats();
      if (userId === myId) {
        onClose();
        return;
      }
      const response = await fetch.get<Details>(`/api/chats/${chat.id}`);
      setDetails(response.data);
    } catch {
      setError('Não foi possível remover.');
    }
  }

  async function rename() {
    try {
      await fetch.patch(`/api/chats/${chat.id}`, { name: newName });
      await reloadChats();
      setIsRenaming(false);
    } catch {
      setError('Não foi possível renomear.');
    }
  }

  /**
   * Abre a conversa direta com um membro do grupo. O POST devolve a existente
   * quando já há uma, então isto serve tanto para começar quanto para retomar.
   */
  async function openDirect(userId: number) {
    setError('');
    setIsOpeningDirect(true);

    try {
      const response = await fetch.post<{ id: string }>('/api/chats', {
        otherUserId: userId,
      });
      // A lista do reload, e não a do render: a conversa pode ter acabado de
      // nascer e não estaria na cópia que este componente tem em mãos.
      const fresh = await reloadChats();
      const target = fresh.find((item) => item.id === response.data.id);

      if (!target) {
        setError('Não foi possível abrir a conversa.');
        return;
      }
      onOpenChat(target);
    } catch (err) {
      // Mostra o motivo que o servidor deu: um erro genérico aqui esconderia
      // exatamente a informação de que se precisa para entender a falha.
      setError(
        readApiErrors(err as AxiosError, 'Não foi possível abrir a conversa.')[0] ??
          'Não foi possível abrir a conversa.',
      );
    } finally {
      setIsOpeningDirect(false);
    }
  }

  /**
   * Bloquear é privado de quem bloqueia: nada é avisado ao outro lado. O
   * reloadChats existe para o `isBlocked` da conversa chegar ao Display, que
   * troca o campo de escrita por um aviso.
   *
   * A direção vem de fora, e isso não é detalhe: antes esta função a deduzia do
   * `blockedIds`, enquanto os botões decidiam o próprio rótulo por outra fonte
   * — `chat.isBlocked`, na conversa direta. Quando as duas divergiam (a lista
   * de bloqueios demora, ou falha em silêncio), "Desbloquear" mandava um POST e
   * bloqueava de novo quem se pediu para desbloquear. Agora cada chamador
   * informa o que o rótulo dele prometeu, e a divergência deixa de ser possível.
   */
  async function toggleBlock(userId: number, shouldBlock: boolean) {
    setError('');

    try {
      if (shouldBlock) await fetch.post(`/api/me/blocks/${userId}`);
      else await fetch.delete(`/api/me/blocks/${userId}`);

      setBlockedIds((old) =>
        shouldBlock ? [...old, userId] : old.filter((id) => id !== userId),
      );
      await reloadChats();
    } catch {
      setError('Não foi possível atualizar o bloqueio.');
    }
  }

  /** Foto do grupo: os mesmos avatares do perfil, escolhidos pelo admin. */
  async function changeImage(image: string) {
    try {
      await fetch.patch(`/api/chats/${chat.id}`, { image });
      await reloadChats();
      const response = await fetch.get<Details>(`/api/chats/${chat.id}`);
      setDetails(response.data);
    } catch {
      setError('Não foi possível trocar a foto.');
    }
  }

  /** Descarta o rascunho e volta o campo para o nome atual do grupo. */
  function cancelRename() {
    setNewName(chat.name);
    setError('');
    setIsRenaming(false);
  }

  // Renomeando, o Esc descarta o rascunho do nome — e só ele: fica acima do
  // painel na pilha, porque abriu depois dele.
  useEscape(cancelRename, isRenaming);

  const other = details?.members.find((m) => m.id !== myId);

  /** O que cada confirmação promete. O texto diz o efeito, não a ação. */
  function confirmText(action: NonNullable<typeof pending>) {
    if (action.kind === 'leave') {
      return {
        title: 'Sair do grupo',
        message: `Você deixa de receber as mensagens de ${chat.name}. O histórico até aqui continua na sua lista, só para leitura, até você excluir a conversa.`,
        confirmLabel: 'Sair',
      };
    }

    if (action.kind === 'remove') {
      return {
        title: 'Remover do grupo',
        message: `${action.member.name} deixa de receber as mensagens do grupo. Só um administrador pode adicionar de volta.`,
        confirmLabel: 'Remover',
      };
    }

    return {
      title: 'Bloquear contato',
      message: `${action.member.name} não é avisado. As mensagens dele param de chegar e você não consegue enviar até desbloquear.`,
      confirmLabel: 'Bloquear',
    };
  }

  const confirm = pending ? confirmText(pending) : null;

  return (
    <aside className='chat-details'>
      <header className='chat-details-header'>
        {openMember && (
          <button
            type='button'
            onClick={() => setOpenMemberId(null)}
            aria-label='Voltar aos detalhes do grupo'
            title='Voltar'
          >
            <FiArrowLeft size={18} />
          </button>
        )}
        <h3>
          {isGroup && showChatPanel ? 'Detalhes do grupo' : 'Detalhes do contato'}
        </h3>
        <button
          type='button'
          onClick={onClose}
          aria-label='Fechar detalhes'
          title='Fechar'
        >
          <IoClose size={20} />
        </button>
      </header>

      {error && <p className='chat-details-error'>{error}</p>}

      {openMember && (
        <>
          <div className='chat-details-identity'>
            <Avatar
              image={openMember.image}
              isLogged={openMember.isOnline}
              status={openMember.status}
            />
            <div className='chat-details-name'>
              <strong>
                {openMember.name}
                {openMember.id === myId && ' (você)'}
              </strong>
            </div>
            <span className='chat-details-status'>
              {presenceOf(openMember)}
              {openMember.isAdmin && ' · admin do grupo'}
            </span>
          </div>

          <section className='chat-details-section'>
            <h4>Bio</h4>
            {openMember.bio ? (
              <p className='chat-details-bio'>{openMember.bio}</p>
            ) : (
              <p className='chat-details-bio chat-details-bio--empty'>
                {openMember.id === myId
                  ? 'Você ainda não escreveu uma bio.'
                  : 'Este contato ainda não escreveu uma bio.'}
              </p>
            )}
          </section>

          <section className='chat-details-section'>
            <h4>No grupo desde</h4>
            <p className='chat-details-bio'>{joinedLabel(openMember.joinedAt)}</p>
          </section>

          {/* Conversar consigo mesmo não existe: a API recusa, e o botão
              também não deve aparecer. */}
          {openMember.id !== myId && (
            <>
              <button
                type='button'
                className='chat-details-action'
                disabled={isOpeningDirect || blockedIds.includes(openMember.id)}
                onClick={() => void openDirect(openMember.id)}
              >
                <FiMessageSquare size={16} />
                {isOpeningDirect ? 'Abrindo...' : 'Enviar mensagem'}
              </button>

              <button
                type='button'
                className='chat-details-action chat-details-action--danger'
                onClick={() => {
                  // Desbloquear não pede confirmação: ele desfaz, não destrói.
                  // A direção sai da mesma fonte que escreveu o rótulo abaixo.
                  if (blockedIds.includes(openMember.id)) {
                    void toggleBlock(openMember.id, false);
                  } else {
                    setPending({ kind: 'block', member: openMember });
                  }
                }}
              >
                <FiSlash size={16} />
                {blockedIds.includes(openMember.id)
                  ? 'Desbloquear contato'
                  : 'Bloquear contato'}
              </button>
            </>
          )}
        </>
      )}

      {showChatPanel && (
        <div className='chat-details-identity'>
          <Avatar
            image={chat.image}
            isLogged={chat.isLogged}
            status={chat.status}
            kind={isGroup ? 'group' : 'user'}
          />
          {isRenaming ? (
            <div className='chat-details-rename'>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  // O Esc que cancela vem da pilha (useEscape acima).
                  if (e.key === 'Enter') void rename();
                }}
                aria-label='Novo nome do grupo'
                autoFocus
              />
              <button type='button' onClick={() => void rename()}>
                Salvar
              </button>
              <button
                type='button'
                className='chat-details-rename-cancel'
                onClick={cancelRename}
              >
                Cancelar
              </button>
            </div>
          ) : (
            <div className='chat-details-name'>
              <strong>{chat.name}</strong>
              {isGroup && chat.isAdmin && (
                <>
                  <button
                    type='button'
                    onClick={() => {
                      setNewName(chat.name);
                      setIsRenaming(true);
                    }}
                    aria-label='Renomear grupo'
                    title='Renomear grupo'
                  >
                    <FiEdit2 size={14} />
                  </button>
                  <button
                    type='button'
                    onClick={() => setIsPickingImage(true)}
                    aria-label='Trocar foto do grupo'
                    title='Trocar foto do grupo'
                  >
                    <FiCamera size={14} />
                  </button>
                </>
              )}
            </div>
          )}
          {!isGroup && other && (
            <span className='chat-details-status'>
              {presenceOf(other)}
            </span>
          )}
        </div>
      )}

      {showChatPanel && !isGroup && (
        <section className='chat-details-section'>
          <h4>Bio</h4>
          {other?.bio ? (
            <p className='chat-details-bio'>{other.bio}</p>
          ) : (
            <p className='chat-details-bio chat-details-bio--empty'>
              {other ? 'Este contato ainda não escreveu uma bio.' : 'Carregando...'}
            </p>
          )}

          {other && (
            <button
              type='button'
              className='chat-details-action chat-details-action--danger'
              onClick={() => {
                // Como acima: só bloquear pede confirmação, e a direção vem do
                // `chat.isBlocked` — a mesma fonte que decide o rótulo.
                if (chat.isBlocked) void toggleBlock(other.id, false);
                else setPending({ kind: 'block', member: other });
              }}
            >
              <FiSlash size={16} />
              {chat.isBlocked ? 'Desbloquear contato' : 'Bloquear contato'}
            </button>
          )}
        </section>
      )}

      {/* A descrição é o "assunto" do grupo: todo mundo lê, só admin escreve. */}
      {showChatPanel && isGroup && (
        <section className='chat-details-section'>
          <h4>Descrição</h4>

          {draftDescription === null ? (
            <>
              {chat.description ? (
                <p className='chat-details-bio'>{chat.description}</p>
              ) : (
                <p className='chat-details-bio chat-details-bio--empty'>
                  {chat.isAdmin
                    ? 'Sem descrição. Escreva do que se trata este grupo.'
                    : 'Este grupo ainda não tem descrição.'}
                </p>
              )}
              {chat.isAdmin && (
                <button
                  type='button'
                  className='chat-details-action'
                  onClick={() => setDraftDescription(chat.description ?? '')}
                >
                  <FiEdit2 size={16} />
                  {chat.description ? 'Editar descrição' : 'Adicionar descrição'}
                </button>
              )}
            </>
          ) : (
            <div className='chat-details-rename'>
              <textarea
                className='chat-details-description-input'
                rows={3}
                maxLength={GROUP_DESCRIPTION_MAX_LENGTH}
                value={draftDescription}
                onChange={(event) => setDraftDescription(event.target.value)}
                aria-label='Descrição do grupo'
                autoFocus
              />
              <button type='button' onClick={() => void saveDescription(draftDescription)}>
                Salvar
              </button>
              <button
                type='button'
                className='chat-details-rename-cancel'
                onClick={() => setDraftDescription(null)}
              >
                Cancelar
              </button>
            </div>
          )}
        </section>
      )}

      {/*
        Convite e permissão de envio: só para quem administra.

        O link não aparece para os demais de propósito — com ele, qualquer um
        entra no grupo, e mostrá-lo a todos seria distribuir a chave junto com a
        porta. O servidor também só o entrega a administrador.
      */}
      {showChatPanel && isGroup && chat.isAdmin && (
        <section className='chat-details-section'>
          <h4>Convite e permissões</h4>

          {details?.inviteUrl ? (
            <>
              <p className='chat-details-invite'>{details.inviteUrl}</p>
              <div className='chat-details-invite-actions'>
                <button
                  type='button'
                  className='chat-details-action'
                  onClick={() => void copyInvite(details.inviteUrl ?? '')}
                >
                  <FiCopy size={16} /> {copiedInvite ? 'Copiado!' : 'Copiar link'}
                </button>
                <button
                  type='button'
                  className='chat-details-action'
                  onClick={() => void createInvite()}
                  title='O link atual deixa de funcionar'
                >
                  <FiRefreshCw size={16} /> Gerar outro
                </button>
                <button
                  type='button'
                  className='chat-details-action chat-details-action--danger'
                  onClick={() => void revokeInvite()}
                >
                  <FiSlash size={16} /> Revogar
                </button>
              </div>
            </>
          ) : (
            <button
              type='button'
              className='chat-details-action'
              onClick={() => void createInvite()}
            >
              <FiLink size={16} /> Gerar link de convite
            </button>
          )}

          <label className='profile-switch'>
            <input
              type='checkbox'
              checked={chat.onlyAdminsSend}
              onChange={(event) => void toggleOnlyAdmins(event.target.checked)}
            />
            <span className='profile-switch-track' aria-hidden='true' />
            <span className='profile-switch-text'>
              <strong>Só administradores enviam</strong>
              <small>
                {chat.onlyAdminsSend
                  ? 'Os demais continuam lendo tudo, mas não conseguem escrever.'
                  : 'Qualquer participante pode escrever no grupo.'}
              </small>
            </span>
          </label>
        </section>
      )}

      {/* Vale para grupo e para conversa direta: o que foi trocado ali é o
          mesmo assunto nos dois casos. */}
      {showChatPanel && <ChatGallery chatId={chat.id} />}

      {showChatPanel && isGroup && (
        <section className='chat-details-section'>
          <h4>{`Participantes (${details?.members.length ?? 0})`}</h4>
          <ul className='chat-details-members'>
            {details?.members.map((member) => (
              <li key={member.id}>
                <Avatar image={member.image} isLogged={member.isOnline} status={member.status} />
                <button
                  type='button'
                  className='chat-details-members-name chat-details-members-open'
                  onClick={() => setOpenMemberId(member.id)}
                  aria-label={`Ver detalhes de ${member.name}`}
                  title='Ver detalhes'
                >
                  {member.name}
                  {member.id === myId && ' (você)'}
                  {member.isAdmin && <em> · admin</em>}
                </button>
                {chat.isAdmin && member.id !== myId && (
                  <>
                    {/* Promover é reversível e não destrói nada: vai direto,
                        sem passar pelo diálogo de confirmação. */}
                    <button
                      type='button'
                      className={member.isAdmin ? 'is-on' : ''}
                      onClick={() => void toggleAdmin(member)}
                      aria-label={
                        member.isAdmin
                          ? `Remover ${member.name} da administração`
                          : `Tornar ${member.name} administrador`
                      }
                      title={
                        member.isAdmin
                          ? 'Remover da administração'
                          : 'Tornar administrador'
                      }
                    >
                      <FiShield size={16} />
                    </button>
                    <button
                      type='button'
                      onClick={() => setPending({ kind: 'remove', member })}
                      aria-label={`Remover ${member.name}`}
                      title={`Remover ${member.name} do grupo`}
                    >
                      <FiUserMinus size={16} />
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {isPickingImage && (
        <AvatarPicker
          kind='group'
          current={chat.image ?? ''}
          onSelect={(image) => void changeImage(image)}
          onClose={() => setIsPickingImage(false)}
        />
      )}

      {showChatPanel && isGroup && (
        <section className='chat-details-section'>
          {chat.isAdmin &&
            (isAdding ? (
              <>
                <input
                  className='chat-details-search'
                  type='search'
                  placeholder='Buscar contato'
                  aria-label='Buscar contato para adicionar'
                  value={memberSearch}
                  onChange={(event) => {
                    setMemberSearch(event.target.value);
                    void loadContacts(event.target.value);
                  }}
                />
                <ul className='chat-details-members'>
                  {contacts.length === 0 && (
                    <li>
                      {memberSearch
                        ? 'Ninguém encontrado com esse nome.'
                        : 'Todos os contatos já estão no grupo.'}
                    </li>
                  )}
                  {contacts.map((user) => (
                    <li key={user.id}>
                      <Avatar
                        image={user.image}
                        isLogged={user.isOnline}
                        status={user.status}
                      />
                      <span className='chat-details-members-name'>{user.name}</span>
                      <button
                        type='button'
                        onClick={() => void addMember(user.id)}
                        aria-label={`Adicionar ${user.name}`}
                        title={`Adicionar ${user.name} ao grupo`}
                      >
                        <FiUserPlus size={16} />
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <button
                type='button'
                className='chat-details-action'
                onClick={() => void loadContacts()}
              >
                <FiUserPlus size={16} /> Adicionar participante
              </button>
            ))}

          {/* Ja saiu: a conversa segue na lista so para leitura, e o que
              resta e excluir — acao do menu, nao daqui. */}
          {!chat.hasLeft && (
            <button
              type='button'
              className='chat-details-action chat-details-action--danger'
              onClick={() => setPending({ kind: 'leave' })}
            >
              <FiUserMinus size={16} /> Sair do grupo
            </button>
          )}
        </section>
      )}

      {pending && confirm && (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.message}
          confirmLabel={confirm.confirmLabel}
          onConfirm={() => {
            const action = pending;
            setPending(null);

            if (action.kind === 'leave') void removeMember(myId ?? 0);
            else if (action.kind === 'remove') void removeMember(action.member.id);
            // Só bloquear passa pelo diálogo: desbloquear vai direto.
            else void toggleBlock(action.member.id, true);
          }}
          onCancel={() => setPending(null)}
        />
      )}
    </aside>
  );
}
