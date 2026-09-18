import './styles.scss';

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { IoChevronDown, IoChevronUp, IoClose } from 'react-icons/io5';
import { FiPlus } from 'react-icons/fi';
import { TbPin } from 'react-icons/tb';

import displayEmpty from 'assets/display-empty.png';
import ChatHeader from 'components/ChatHeader';
import ConfirmDialog from 'components/ConfirmDialog';
import Lightbox from 'components/Lightbox';
import MessageComposer from 'components/MessageComposer';
import MessageList from 'components/MessageList';
import { MessagesSkeleton } from 'components/Skeleton';
import type { Receipt } from 'components/MessageItem';
import useOpenChat from 'hooks/openChat';
import useComposer from 'hooks/composer';
import useTyping from 'hooks/typing';
import useSession from 'hooks/session';
import useChatList from 'hooks/chatList';
import usePresence from 'hooks/presence';
import useSaved from 'hooks/saved';
import useAutoRead from 'hooks/autoRead';
import useEscape from 'hooks/escape';
import { useMessageSearch } from 'hooks/search';
import fetch from 'config/fetchInstance';
import { showToast } from 'store/toasts';
import { useUiStore } from 'store/ui';
import { clearHistoryMessage, deleteChatMessage } from 'utils/chatActions';
import { isPreviewable } from 'utils/media';
import { attachmentTypeLabel } from 'utils/messagePreview';
import {
  DELETE_FOR_EVERYONE_MINUTES,
  EVERYONE_MENTIONS,
  type Message,
} from '@react-chat/shared';

// Painel lateral so aparece ao pedir detalhes: chunk proprio.
const ChatDetails = lazy(() => import('components/ChatDetails'));
// Só aparece ao encaminhar: chunk próprio.
const ForwardModal = lazy(() => import('components/ForwardModal'));
// "Dados da mensagem": raro, e traz a própria lista — chunk próprio também.
const MessageInfo = lazy(() => import('components/MessageInfo'));

interface DisplayProps {
  /**
   * Abre o diálogo de nova conversa. O estado dele vive no Home, que é quem
   * monta o modal — aqui só existe o botão que o chama.
   */
  onNewChat: () => void;
}

export default function Display({ onNewChat }: DisplayProps) {
  const [showDetails, setShowDetails] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [search, setSearch] = useState('');
  /** Ação sem volta esperando confirmação; null = nenhuma. */
  const [pending, setPending] = useState<'clear' | 'delete' | null>(null);
  /** Mensagem escolhida para encaminhar; null = nenhuma. */
  const [forwarding, setForwarding] = useState<Message | null>(null);
  /** Índice da mídia aberta no visor; null = visor fechado. */
  const [mediaIndex, setMediaIndex] = useState<number | null>(null);
  /**
   * Mensagem trazida para a tela — alvo de um salto pela citação ou da
   * navegação entre ocorrências da busca. O `key` muda a cada pedido para o
   * mesmo alvo poder ser pedido duas vezes seguidas.
   */
  const [focus, setFocus] = useState<{ id: string; key: number } | null>(null);
  /** Mensagem esperando confirmação para ser apagada; null = nenhuma. */
  const [deleting, setDeleting] = useState<Message | null>(null);
  /** Mensagem com o painel de "quem leu" aberto; null = fechado. */
  const [infoFor, setInfoFor] = useState<Message | null>(null);
  /**
   * Primeira mensagem por ler quando a conversa foi aberta — o ponto onde
   * entra o divisor. Guardado uma vez: abrir a conversa zera o não-lido no
   * instante seguinte, e depois disso não haveria mais como saber.
   */
  const [dividerId, setDividerId] = useState<string | null>(null);
  const unreadAtOpen = useRef(0);
  /** Ocorrência atual da busca, dentro de found.results. */
  const [resultIndex, setResultIndex] = useState(0);
  const focusKey = useRef(0);

  // A conversa vem do cache da lista, que é quem o socket mantém em dia; o
  // store guarda só qual está aberta.
  const { chat, chatId, openChat: selectChat, closeChat } = useOpenChat();
  const { user } = useSession();
  const { readBy } = usePresence();
  const { savedIds, toggleSaved } = useSaved();
  const {
    patchChat,
    markChatRead,
    markChatUnread,
    markChatArchived,
    markChatMuted,
    clearChatHistory,
    deleteChat,
  } = useChatList();
  const id = user?.id;
  /** Ajuste de privacidade; ausente (perfil ainda carregando) conta como on. */
  const showsReceipts = user?.showReadReceipts !== false;

  const composer = useComposer(chat);
  const typing = useTyping(chat);
  // A busca da conversa agora roda no banco: antes filtrava só as mensagens
  // que estavam na tela, então não achava nada fora da última página.
  const found = useMessageSearch(chat?.id, search);

  /** Fecha a busca e volta à conversa inteira. */
  const closeSearch = useCallback(() => {
    setSearch('');
    setShowSearch(false);
  }, []);

  // Esc na busca fecha a busca — antes ele fechava a conversa inteira junto.
  useEscape(closeSearch, showSearch);

  const isSearching = search.trim().length > 0;
  /** Fora do grupo, ou com o contato bloqueado, a conversa é só leitura. */
  const canWrite = Boolean(chat) && !chat?.hasLeft && !chat?.isBlocked;
  const visibleMessages = isSearching ? found.results : composer.messages;

  /**
   * A mídia navegável pelo visor: a que está na tela, e não todo o histórico
   * — durante a busca as setas andariam por mensagens que não estão listadas.
   */
  const mediaMessages = useMemo(
    () =>
      visibleMessages.filter(
        (message) => !message.isDeleted && isPreviewable(message.attachment?.type),
      ),
    [visibleMessages],
  );

  const focusMessage = useCallback((messageId: string) => {
    focusKey.current += 1;
    setFocus({ id: messageId, key: focusKey.current });
  }, []);

  /**
   * Leva à mensagem citada, fixada ou achada na busca.
   *
   * Quando ela não está na tela, o servidor devolve a janela de histórico em
   * volta dela (`?around=`) e a conversa passa a mostrar esse trecho. Antes o
   * cliente pedia página por página até topar com ela, com teto de cinco: uma
   * citação mais funda do que isso não levava a lugar nenhum.
   */
  async function runJump(messageId: string) {
    // Os avisos agora saem como toast, no canto — ver store/toasts.

    // A busca mostra só os resultados: saltar dentro dela levaria a uma lista
    // onde a mensagem original nem aparece.
    if (isSearching) {
      setSearch('');
      setShowSearch(false);
    }

    if (composer.messages.some((message) => message.id === messageId)) {
      focusMessage(messageId);
      return;
    }

    if (await composer.jumpTo(messageId)) focusMessage(messageId);
    else showToast('A mensagem não está mais disponível nesta conversa.');
  }

  /** O clique não espera a viagem: quem aguarda é o `runJump`. */
  function jumpTo(messageId: string) {
    void runJump(messageId);
  }

  /** Fixa, ou solta se for a que já está fixada. Visível a todos na conversa. */
  function togglePinned(message: Message) {
    if (!chat) return;

    const isCurrent = chat.pinnedMessage?.id === message.id;
    const previous = chat.pinnedMessage;

    // Otimista: o banner responde na hora, e o chat-updated do socket traz a
    // versão do servidor por cima.
    patchChat(chat.id, { pinnedMessage: isCurrent ? null : message });

    void (isCurrent
      ? fetch.delete(`/api/chats/${chat.id}/pinned`)
      : fetch.post(`/api/chats/${chat.id}/pinned`, { messageId: message.id })
    ).catch(() => {
      // Sem desfazer, o topo da conversa passa a anunciar um pino que o
      // servidor recusou — e some um que continua lá para todo mundo.
      patchChat(chat.id, { pinnedMessage: previous });
      showToast('Não foi possível mudar a mensagem fixada.');
    });
  }

  function openMedia(message: Message) {
    const index = mediaMessages.findIndex((item) => item.id === message.id);
    if (index >= 0) setMediaIndex(index);
  }

  /** Vai para a ocorrência `index` da busca, circulando nas pontas. */
  const goToResult = useCallback(
    (index: number) => {
      const list = found.results;
      if (list.length === 0) return;

      const next = ((index % list.length) + list.length) % list.length;
      const target = list[next];
      if (!target) return;

      setResultIndex(next);
      focusMessage(target.id);
    },
    [found.results, focusMessage],
  );

  // Resultado novo: começa na primeira ocorrência.
  useEffect(() => {
    if (found.results.length === 0) {
      setFocus(null);
      setResultIndex(0);
      return;
    }
    goToResult(0);
    // `goToResult` depende da mesma lista; entrar aqui a cada mudança dela
    // reposicionaria o usuário a cada tecla digitada.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [found.results]);

  /*
   * Não há efeito de "rolar para o fim" aqui.
   *
   * Havia um, chamando `scrollIntoView` numa ref que não estava presa a
   * elemento nenhum desde que a lista virou virtualizada — ele não fazia nada
   * fazia tempo. Quem rola é o MessageList, que é quem tem o contêiner rolável
   * e sabe se o usuário está lendo mais acima.
   */

  /**
   * Quantas estavam por ler ao abrir.
   *
   * Roda antes de a conversa ser marcada como lida: é dessa ordem que este
   * número depende.
   */
  useEffect(() => {
    unreadAtOpen.current = chat?.unreadMessages ?? 0;
    setDividerId(null);
    // A conversa é o gatilho; o contador muda sozinho logo em seguida.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat?.id]);

  /**
   * A leitura automática — abrir a conversa marca como lida.
   *
   * Fica depois do efeito acima de propósito: é dele que sai o número de
   * pendentes no instante da abertura, e o divisor "Novas mensagens" depende de
   * capturá-lo antes de o contador zerar. Efeitos rodam na ordem em que os
   * hooks são declarados, então esta linha não pode subir.
   *
   * As regras — aba à frente, e por que o contador não é gatilho — moram no
   * próprio hook, onde há teste para elas.
   */
  useAutoRead(chat, markChatRead);

  /**
   * Com o histórico na mão, marca onde começavam as não lidas.
   *
   * A contagem é de trás para frente, e pula o que o servidor também pula: o
   * aviso do grupo e as próprias mensagens não entram no não-lido, então não
   * podem deslocar o divisor. Contando pelo tamanho da lista — que era como
   * isto funcionava —, um "Fulano entrou no grupo" no meio do trecho empurrava
   * a linha uma mensagem para cima, e duas mensagens suas, duas.
   *
   * Sobrando menos histórico do que pendentes (a página é de 30), o divisor vai
   * para o topo do que foi carregado: é o ponto mais antigo que se pode marcar.
   */
  useEffect(() => {
    const pending = unreadAtOpen.current;
    if (pending === 0 || composer.messages.length === 0) return;

    let remaining = pending;
    let first = composer.messages[0];

    for (let index = composer.messages.length - 1; index >= 0; index -= 1) {
      const message = composer.messages[index];
      if (!message || message.type === 'SYSTEM' || message.userId === id) continue;

      remaining -= 1;
      if (remaining === 0) {
        first = message;
        break;
      }
    }

    setDividerId(first?.id ?? null);
    // Uma vez por conversa: mensagem nova depois disso não empurra o divisor.
    unreadAtOpen.current = 0;
    // O histórico é o gatilho; `id` é quem está logado, e não muda no meio.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composer.messages]);

  /** O `hasNewer` do render anterior: só a virada para falso é gatilho. */
  const hadNewer = useRef(false);

  /**
   * Andando para a frente até reencontrar o fim, o alvo do salto deixa de
   * valer: enquanto ele existe, a lista não acompanha as mensagens novas — é o
   * que impede a conversa de puxar o usuário para baixo no meio da leitura.
   *
   * Só a transição conta. Limpar sempre que `hasNewer` é falso apagaria o
   * destaque de um salto dentro do histórico já carregado no render seguinte ao
   * pedido, que é o caso mais comum de todos.
   */
  useEffect(() => {
    if (hadNewer.current && !composer.hasNewer) setFocus(null);
    hadNewer.current = composer.hasNewer;
  }, [composer.hasNewer]);

  // Trocar de conversa fecha painel, busca e confirmação pendente.
  useEffect(() => {
    setShowDetails(false);
    setShowSearch(false);
    setSearch('');
    setPending(null);
    setForwarding(null);
    setMediaIndex(null);
    setFocus(null);
    setDeleting(null);
    setInfoFor(null);
  }, [chat?.id]);

  /**
   * Salto pedido de fora: "Abrir na conversa" numa mensagem salva, ou um
   * resultado da busca global.
   *
   * O pedido espera no store até o histórico chegar — saltar antes disso
   * competiria com a busca que ainda está a caminho, e a janela recém-posta no
   * cache seria sobrescrita por ela.
   */
  useEffect(() => {
    if (!chatId || composer.isLoading) return;

    const target = useUiStore.getState().takeFocusMessage();
    if (target) void runJump(target);
    // `runJump` nasce de novo a cada render e não é o gatilho: quem manda aqui
    // é a conversa aberta e a chegada do histórico.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, composer.isLoading]);

  /** Já leu quem recebeu — a data da leitura é posterior à da mensagem. */
  function hasRead(readAt: string | undefined, message: Message): boolean {
    return Boolean(readAt) && new Date(readAt ?? 0) >= new Date(message.createdAt);
  }

  /**
   * Recibo: o ✓✓ acende quando *todos* os destinatários leram, e não quando o
   * primeiro leu. Em conversa direta dá no mesmo; em grupo, era o ✓✓ aparecer
   * com uma pessoa de dez tendo aberto.
   */
  function isRead(message: Message): boolean {
    // Recibo desligado: nada de ✓✓ nem para você. O servidor já para de
    // mandar o seu e de contar o dos outros; aqui a tela acompanha.
    if (!showsReceipts) return false;
    if (!chat || message.userId !== id) return false;
    const reads = readBy[chat.id] ?? {};
    const others = chat.participants.filter((participantId) => participantId !== id);

    return (
      others.length > 0 &&
      others.every((participantId) => hasRead(reads[participantId], message))
    );
  }

  /**
   * Quem leu e quem falta, por nome. Só em grupo: na conversa direta o ícone
   * já é a resposta inteira, e um "1/1" ao lado dele seria ruído.
   */
  function receiptOf(message: Message): Receipt | undefined {
    if (!showsReceipts) return undefined;
    if (!chat || message.userId !== id) return undefined;

    const others = chat.members.filter((member) => member.id !== id);
    if (others.length < 2) return undefined;

    const reads = readBy[chat.id] ?? {};
    const readers: string[] = [];
    const pending: string[] = [];

    for (const member of others) {
      if (hasRead(reads[member.id], message)) readers.push(member.name);
      else pending.push(member.name);
    }

    return { readers, pending };
  }

  function send() {
    void composer.submit();
    typing.stop();
  }

  /**
   * "Apagar para todos" só vale na sua mensagem e dentro do prazo.
   *
   * O prazo existe porque apagar sem limite reescreve o passado: daria para
   * sumir com o que se combinou meses atrás, na conversa de todo mundo. O
   * servidor decide de novo — aqui é só para o diálogo não oferecer uma saída
   * que levaria a um erro.
   */
  const minutesOld = deleting
    ? (Date.now() - new Date(deleting.createdAt).getTime()) / 60_000
    : 0;
  const canDeleteForEveryone =
    deleting !== null &&
    deleting.userId === id &&
    minutesOld <= DELETE_FOR_EVERYONE_MINUTES;

  /** O texto diz o efeito de cada saída, e por que uma delas pode faltar. */
  const deleteMessageText = canDeleteForEveryone
    ? 'Apagar para todos some com ela na conversa de todo mundo, na hora, deixando no lugar o aviso de que foi apagada. Apagar para mim tira só da sua tela — ninguém fica sabendo.'
    : deleting?.userId === id
      ? `O prazo de ${DELETE_FOR_EVERYONE_MINUTES} minutos para apagar para todos já passou. Ainda dá para tirar da sua tela: ninguém fica sabendo, e ela continua na conversa dos outros.`
      : 'A mensagem sai só da sua tela. Ninguém fica sabendo, e ela continua na conversa dos outros.';

  if (!chatId || !chat) {
    return (
      <div className='display'>
        <div className='display-empty'>
          <img src={displayEmpty} alt='' />
          {/*
            Uma frase só. As duas de antes diziam a mesma coisa duas vezes — a
            segunda repetia como instrução o que a primeira já constatava. O
            que faltava não era texto, era a saída: para quem ainda não tem
            conversa nenhuma, "selecione uma conversa" não leva a lugar algum.
          */}
          <p>Escolha uma conversa à esquerda para começar a ler.</p>
          <button type='button' className='display-empty-action' onClick={onNewChat}>
            <FiPlus size={16} /> Nova conversa
          </button>
        </div>
      </div>
    );
  }


  return (
    <div className='display-wrapper'>
      <div className='display'>
        <ChatHeader
          chat={chat}
          // No celular a lista e a conversa dividem a mesma tela: o ← é o
          // caminho de volta, no lugar do botão flutuante que ficava sobre o
          // campo de escrita.
          onBack={closeChat}
          onToggleDetails={() => setShowDetails((open) => !open)}
          onToggleSearch={() => setShowSearch((open) => !open)}
          onMarkRead={() => markChatRead(chat.id)}
          onMarkUnread={() => {
            // Fecha antes: com a conversa aberta, a leitura automática
            // desfaria a marcação no mesmo instante.
            closeChat();
            markChatUnread(chat.id);
          }}
          onToggleArchive={() => markChatArchived(chat.id, !chat.isArchived)}
          onToggleMute={() => markChatMuted(chat.id, !chat.isMuted)}
          // `null` das durações é "Sempre"; o hook espera `undefined` para
          // "sem prazo". Converter aqui evita que um null vire prazo zero.
          onMuteFor={(minutes) => markChatMuted(chat.id, true, minutes ?? undefined)}
          onClearHistory={() => setPending('clear')}
          onDelete={() => setPending('delete')}
        />

        {/* Banner da mensagem fixada: clicar leva até ela, como a citação. */}
        {chat.pinnedMessage && (
          <div className='display-pinned'>
            <TbPin size={15} className='display-pinned-icon' />
            <button
              type='button'
              className='display-pinned-body'
              onClick={() => jumpTo(chat.pinnedMessage?.id ?? '')}
              title='Ir para a mensagem fixada'
            >
              <strong>{chat.pinnedMessage.name}</strong>
              <span>
                {chat.pinnedMessage.text ||
                  attachmentTypeLabel(chat.pinnedMessage.attachment)}
              </span>
            </button>
            {canWrite && (
              <button
                type='button'
                className='display-pinned-close'
                onClick={() => chat.pinnedMessage && togglePinned(chat.pinnedMessage)}
                aria-label='Desafixar mensagem'
                title='Desafixar'
              >
                <IoClose size={16} />
              </button>
            )}
          </div>
        )}

        {showSearch && (
          <div className='display-search'>
            <input
              placeholder='Buscar nesta conversa'
              aria-label='Buscar nesta conversa'
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                // ↑ e ↓ andam entre as ocorrências sem tirar a mão do campo;
                // Enter faz o mesmo que ↓, que é o que todo "localizar" faz.
                if (event.key === 'ArrowDown' || (event.key === 'Enter' && !event.shiftKey)) {
                  event.preventDefault();
                  goToResult(resultIndex + 1);
                }
                if (event.key === 'ArrowUp' || (event.key === 'Enter' && event.shiftKey)) {
                  event.preventDefault();
                  goToResult(resultIndex - 1);
                }
              }}
              autoFocus
            />
            {isSearching &&
              (found.isSearching ? (
                <span className='display-search-count'>buscando…</span>
              ) : found.results.length === 0 ? (
                <span className='display-search-count'>sem resultados</span>
              ) : (
                <div className='display-search-nav'>
                  <span className='display-search-count'>
                    {resultIndex + 1}/{found.results.length}
                  </span>
                  <button
                    type='button'
                    onClick={() => goToResult(resultIndex - 1)}
                    aria-label='Ocorrência anterior'
                    title='Anterior (↑)'
                  >
                    <IoChevronUp size={16} />
                  </button>
                  <button
                    type='button'
                    onClick={() => goToResult(resultIndex + 1)}
                    aria-label='Próxima ocorrência'
                    title='Próxima (↓)'
                  >
                    <IoChevronDown size={16} />
                  </button>
                </div>
              ))}
          </div>
        )}

        {visibleMessages.length === 0 ? (
          <div className='display-messages display-messages--empty'>
            {isSearching ? (
              <p className='display-no-results'>
                {found.isSearching ? 'Buscando…' : 'Nenhuma mensagem encontrada.'}
              </p>
            ) : composer.isLoading ? (
              <MessagesSkeleton />
            ) : (
              // Conversa recém-criada ou recém-limpa: sem isto a área ficaria
              // em branco, sem dizer se carregou ou se não há nada.
              <p className='display-no-results'>Nenhuma mensagem por aqui ainda.</p>
            )}
          </div>
        ) : (
          <MessageList
            chatId={chat.id}
            messages={visibleMessages}
            currentUserId={id}
            isRead={isRead}
            receiptOf={receiptOf}
            onOpenMedia={openMedia}
            onJumpTo={jumpTo}
            // Quem reagiu, por nome: os membros da conversa são a única fonte
            // que o balão tem para traduzir um id em gente.
            nameOf={(userId) => chat.members.find((member) => member.id === userId)?.name}
            // E os nomes de todos, para o balão reconhecer uma menção. Sem a
            // lista, `@` seguido de palavra marcaria um e-mail como menção.
            //
            // Em grupo, "todos" e "all" entram como se fossem mais dois nomes:
            // o destaque já sabe casar `@` seguido de um nome conhecido, e o
            // chamado geral é exatamente isso. Fora do grupo eles ficam de
            // fora — numa conversa direta a palavra é texto comum.
            names={[
              ...chat.members.map((member) => member.name),
              ...(chat.type === 'GROUP' ? EVERYONE_MENTIONS : []),
            ]}
            {...(isSearching ? { highlight: search.trim() } : {})}
            focusedId={focus?.id ?? null}
            focusKey={focus?.key ?? 0}
            {...(isSearching ? {} : { dividerId })}
            showDays={!isSearching}
            // Fora do grupo não há o que responder, editar ou apagar: sem os
            // handlers, o MessageItem não desenha as ações.
            {...(canWrite
              ? {
                  onReply: composer.setReplyTo,
                  onEdit: composer.startEdit,
                  onForward: setForwarding,
                  onReact: (m: Message, emoji: string) => void composer.react(m, emoji),
                  onTogglePin: togglePinned,
                }
              : {})}
            /*
              Apagar e ver quem leu ficam fora do `canWrite`.

              Apagar saía junto com o campo de escrita, o que fazia sentido
              quando apagar significava apagar para todos. Com "apagar para
              mim" — privado, e sem tocar na conversa de ninguém — negá-lo num
              grupo que a pessoa deixou a prenderia a mensagens que ela não
              consegue mais tirar da própria tela. O servidor continua
              recusando o que deve: "para todos" exige participante ativo.
            */
            onDelete={setDeleting}
            onShowInfo={setInfoFor}
            // Salvar vale até em conversa só de leitura: é um favorito seu,
            // não uma ação sobre a conversa.
            onToggleSave={(m: Message) => toggleSaved(m.id)}
            savedIds={savedIds}
            pinnedId={chat.pinnedMessage?.id ?? null}
            // Chegar ao topo carrega sozinho — quem observa a rolagem é o
            // MessageList, que é quem tem o container rolável.
            {...(composer.hasMore && !isSearching
              ? { onLoadOlder: () => void composer.loadOlder() }
              : {})}
            isLoadingOlder={composer.isLoadingMore}
            /*
              E o mesmo para a frente, que só existe depois de um salto: com a
              janela do `?around=` na tela, o fim da lista é o meio da conversa.
              Sem isto o salto era uma rua sem volta — dava para carregar mais
              histórico para trás e não havia caminho nenhum de volta ao fim.
            */
            {...(composer.hasNewer && !isSearching
              ? {
                  onLoadNewer: () => void composer.loadNewer(),
                  onGoToLatest: () => {
                    // O alvo do salto sai junto: enquanto ele existe, a lista
                    // não acompanha o fim da conversa (é o que segura a rolagem
                    // durante a leitura), e voltar ao presente é justamente
                    // pedir que ela volte a acompanhar.
                    setFocus(null);
                    void composer.goToLatest();
                  },
                }
              : {})}
            hasNewer={composer.hasNewer && !isSearching}
            isLoadingNewer={composer.isLoadingNewer}
          />
        )}

        {typing.label && <p className='display-typing'>{typing.label}</p>}

        {chat.hasLeft ? (
          <p className='display-readonly'>
            Você saiu deste grupo. O histórico continua aqui até você excluir a
            conversa.
          </p>
        ) : chat.isBlocked ? (
          <p className='display-readonly'>
            Você bloqueou {chat.name}. Desbloqueie nos detalhes do contato para
            voltar a conversar.
          </p>
        ) : (
          <MessageComposer
            text={composer.text}
            onTextChange={composer.setText}
            replyTo={composer.replyTo}
            editing={composer.editing}
            onCancelDraft={composer.cancelDraft}
            file={composer.file}
            onFileChange={composer.setFile}
            onEmoji={composer.appendEmoji}
            onSubmit={send}
            onTyping={typing.signal}
            isSending={composer.isSending}
            progress={composer.progress}
          />
        )}
      </div>

      {showDetails && (
        <Suspense fallback={null}>
          <ChatDetails
            chat={chat}
            onClose={() => setShowDetails(false)}
            // Trocar a conversa aberta já fecha o painel: o efeito acima
            // reage ao chat.id novo.
            onOpenChat={selectChat}
          />
        </Suspense>
      )}

      {mediaIndex !== null && (
        <Lightbox
          items={mediaMessages}
          index={mediaIndex}
          onNavigate={setMediaIndex}
          onClose={() => setMediaIndex(null)}
        />
      )}

      {forwarding && (
        <Suspense fallback={null}>
          <ForwardModal
            message={forwarding}
            fromChatId={chat.id}
            onConfirm={(chatIds) => composer.forward(forwarding, chatIds)}
            onClose={() => setForwarding(null)}
          />
        </Suspense>
      )}

      {deleting && (
        <ConfirmDialog
          title='Apagar mensagem'
          message={deleteMessageText}
          confirmLabel={canDeleteForEveryone ? 'Apagar para todos' : 'Apagar para mim'}
          onConfirm={() => {
            const target = deleting;
            setDeleting(null);
            void composer.remove(target, canDeleteForEveryone ? 'all' : 'me');
          }}
          // A segunda saída só existe quando há de fato duas: fora do prazo, ou
          // na mensagem de outra pessoa, "para mim" já é a ação principal.
          {...(canDeleteForEveryone
            ? {
                secondaryLabel: 'Apagar para mim',
                onSecondary: () => {
                  const target = deleting;
                  setDeleting(null);
                  void composer.remove(target, 'me');
                },
              }
            : {})}
          onCancel={() => setDeleting(null)}
        />
      )}

      {infoFor && (
        <Suspense fallback={null}>
          <MessageInfo
            chatId={chat.id}
            message={infoFor}
            onClose={() => setInfoFor(null)}
          />
        </Suspense>
      )}

      {pending && (
        <ConfirmDialog
          title={pending === 'clear' ? 'Limpar conversa' : 'Excluir conversa'}
          message={
            pending === 'clear' ? clearHistoryMessage(chat) : deleteChatMessage(chat)
          }
          confirmLabel={pending === 'clear' ? 'Limpar' : 'Excluir'}
          onConfirm={() => {
            setPending(null);
            if (pending === 'clear') {
              // Continua aberta: limpar esvazia a conversa, não a remove.
              clearChatHistory(chat.id);
              return;
            }
            // Fecha antes: excluída, ela sai da lista e o Display ficaria
            // apontando para uma conversa que não existe mais.
            closeChat();
            deleteChat(chat.id);
          }}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
}
