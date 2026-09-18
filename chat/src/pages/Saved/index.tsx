import 'components/SavedMessages/styles.scss';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiStar, FiMessageSquare } from 'react-icons/fi';
import { IoMdSearch } from 'react-icons/io';

import useChatList from 'hooks/chatList';
import useOpenChat from 'hooks/openChat';
import useSaved, { useSavedMessages } from 'hooks/saved';
import { dayLabel, timeLabel } from 'utils/dayLabel';
import { attachmentTypeLabel } from 'utils/messagePreview';
import { SAVED_LIMIT, type SavedMessage } from '@react-chat/shared';

/** O texto pelo qual a busca procura: o que está escrito e quem escreveu. */
function haystack(item: SavedMessage, chatName: string): string {
  return `${item.message.text} ${item.message.name} ${chatName}`.toLowerCase();
}

/**
 * As mensagens salvas, em página própria.
 *
 * Era um modal aberto pelo menu do avatar — duas camadas de clique para uma
 * lista que é um arquivo de consulta. Como destino do rail, ela tem endereço,
 * volta pelo botão do navegador e não cobre a conversa.
 *
 * A busca, o filtro por conversa e o agrupamento por dia rodam sobre o que já
 * está na tela, e não no servidor: a lista inteira cabe numa resposta — o
 * servidor corta no `SAVED_LIMIT` —, então filtrar aqui é instantâneo e não
 * custa uma ida à rede por tecla digitada. Esse teto, que antes não aparecia
 * em lugar nenhum, agora é dito no rodapé quando a lista bate nele.
 */
export default function Saved() {
  const { chats } = useChatList();
  const { openChatAt } = useOpenChat();
  const { toggleSaved } = useSaved();
  const { saved: items, isFailed } = useSavedMessages();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [term, setTerm] = useState('');
  /** Id da conversa escolhida no filtro; '' é "todas". */
  const [onlyChat, setOnlyChat] = useState('');

  /**
   * Tira do servidor; quem tira da lista é a invalidação que o `toggleSaved`
   * dispara. Antes eram duas remoções — a otimista aqui e a do cache —, e sair
   * da página e voltar ressuscitava o item removido, porque esta lista era
   * estado local e nunca era buscada de novo.
   */
  function remove(messageId: string) {
    toggleSaved(messageId);
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

  /*
   * As conversas que aparecem na lista, e não todas as que existem: um filtro
   * que oferece conversa sem nada salvo é um caminho para uma tela vazia.
   */
  const chatOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const item of items ?? []) {
      if (!seen.has(item.chatId)) seen.set(item.chatId, chatLabel(item));
    }
    return [...seen].map(([id, label]) => ({ id, label }));
    // `chats` entra porque o `chatLabel` recorre a ele quando o salvo não
    // guardou o nome.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, chats]);

  const filtered = useMemo(() => {
    const needle = term.trim().toLowerCase();

    return (items ?? []).filter((item) => {
      if (onlyChat && item.chatId !== onlyChat) return false;
      if (!needle) return true;
      return haystack(item, chatLabel(item)).includes(needle);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, term, onlyChat, chats]);

  /*
   * Agrupado por dia, na ordem em que o servidor mandou — do mais novo para o
   * mais antigo. Sem isso a lista era um muro de cartões sem nenhuma âncora
   * temporal: cada um trazia a sua data em 11px, e nada dizia onde terminava
   * hoje e começava o mês passado.
   */
  const groups = useMemo(() => {
    const result: { label: string; items: SavedMessage[] }[] = [];

    for (const item of filtered) {
      const label = dayLabel(item.message.createdAt);
      const last = result.at(-1);
      if (last?.label === label) last.items.push(item);
      else result.push({ label, items: [item] });
    }

    return result;
  }, [filtered]);

  const isEmpty = items?.length === 0;
  const isFilteredEmpty = !isEmpty && filtered.length === 0;
  const isFiltering = Boolean(term.trim() || onlyChat);

  return (
    <div className='saved-page'>
      <header className='saved-page-head'>
        <h1>Mensagens salvas</h1>
        <p>Só você vê esta lista. A estrela na barra de ações de cada mensagem guarda ela aqui.</p>
      </header>

      {/* Só com algo salvo: filtrar uma lista vazia não leva a lugar nenhum. */}
      {items && items.length > 0 && (
        <div className='saved-page-filters'>
          <div className='saved-page-search'>
            <IoMdSearch className='saved-page-search-icon' />
            <input
              placeholder='Buscar nas salvas'
              aria-label='Buscar nas mensagens salvas'
              value={term}
              onChange={(event) => setTerm(event.target.value)}
            />
          </div>

          {/* Uma conversa só faz do filtro uma escolha sem alternativa. */}
          {chatOptions.length > 1 && (
            <select
              className='saved-page-chat'
              aria-label='Filtrar por conversa'
              value={onlyChat}
              onChange={(event) => setOnlyChat(event.target.value)}
            >
              <option value=''>Todas as conversas</option>
              {chatOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {error && <p className='saved-messages-error'>{error}</p>}
      {isFailed && (
        <p className='saved-messages-error'>
          Não foi possível carregar as mensagens salvas.
        </p>
      )}
      {!items && !isFailed && <p className='saved-messages-empty'>Carregando…</p>}

      {isEmpty && <p className='saved-messages-empty'>Nada salvo ainda.</p>}

      {isFilteredEmpty && (
        <p className='saved-messages-empty'>
          {isFiltering
            ? 'Nenhuma salva com esse filtro.'
            : 'Nada salvo ainda.'}
        </p>
      )}

      {groups.map((group) => (
        <section key={group.label} className='saved-messages-day'>
          <h2 className='saved-messages-day-label'>{group.label}</h2>

          <ul className='saved-messages'>
            {group.items.map((item) => (
              <li key={item.message.id} className='saved-messages-item'>
                <div className='saved-messages-head'>
                  <strong>{chatLabel(item)}</strong>
                  <span>
                    {item.message.name} · {timeLabel(item.message.createdAt)}
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
        </section>
      ))}

      {/*
        O teto do servidor, dito na tela. A lista batia nos 100 e parava sem
        avisar: quem salvasse a de número 101 veria a lista simplesmente não
        crescer, sem nada que explicasse por quê.
      */}
      {items && items.length >= SAVED_LIMIT && (
        <p className='saved-messages-empty'>
          Mostrando as {SAVED_LIMIT} mais recentes. Remova alguma para as mais
          antigas voltarem a aparecer.
        </p>
      )}
    </div>
  );
}
