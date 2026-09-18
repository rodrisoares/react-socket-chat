import './styles.scss';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { IoArrowDown } from 'react-icons/io5';

import MessageItem, { type Receipt } from 'components/MessageItem';
import { dayMarkers } from 'utils/dayLabel';
import type { Message } from '@react-chat/shared';

interface MessageListProps {
  /** Em ordem cronológica: a mais antiga primeiro. */
  messages: Message[];
  currentUserId: number | undefined;
  isRead: (message: Message) => boolean;
  /** Quem já leu cada mensagem; `undefined` esconde o recibo detalhado. */
  receiptOf?: (message: Message) => Receipt | undefined;
  /** Abre a mídia no visor em tela cheia. */
  onOpenMedia?: (message: Message) => void;
  /** Leva à mensagem citada numa resposta. */
  onJumpTo?: (messageId: string) => void;
  /** Termo da busca: as ocorrências são marcadas dentro do balão. */
  highlight?: string;
  /**
   * Mensagem a trazer para a tela — o alvo de um salto ou da navegação entre
   * ocorrências da busca. O `focusKey` muda a cada pedido, inclusive quando é
   * a mesma mensagem duas vezes: sem ele, saltar de novo não faria nada.
   */
  focusedId?: string | null;
  focusKey?: number;
  /**
   * Primeira mensagem que chegou sem ser lida quando a conversa foi aberta:
   * é antes dela que entra o divisor "Novas mensagens".
   */
  dividerId?: string | null;
  /** Some durante a busca: ali a ordem por dia não diz nada. */
  showDays: boolean;
  /** Sem os três, as mensagens ficam só para leitura. */
  onReply?: (message: Message) => void;
  onEdit?: (message: Message) => void;
  onDelete?: (message: Message) => void;
  onForward?: (message: Message) => void;
  onReact?: (message: Message, emoji: string) => void;
  /** Salvar/remover dos favoritos, e quais já estão salvos. */
  onToggleSave?: (message: Message) => void;
  savedIds?: Set<string>;
  /** Fixar/desafixar no topo, e qual está fixada. */
  onTogglePin?: (message: Message) => void;
  pinnedId?: string | null;
  /** Abre "quem leu e quando". O balão só o oferece nas mensagens próprias. */
  onShowInfo?: (message: Message) => void;
  /** Nome de quem reagiu, por id — ver MessageItem. */
  nameOf?: (userId: number) => string | undefined;
  /** Nomes dos membros, para o balão reconhecer as menções. */
  names?: string[];
  /**
   * Pede a página anterior do histórico. Ausente quando não há mais nada para
   * carregar — e é a ausência que tira o sentinela do topo da lista.
   */
  onLoadOlder?: () => void;
  /** Uma página já está a caminho: o aviso aparece e o gatilho não repete. */
  isLoadingOlder?: boolean;
  /**
   * Pede a página seguinte no sentido do presente. Só existe depois de um
   * salto, quando o que está na tela é um trecho do meio da conversa.
   */
  onLoadNewer?: () => void;
  isLoadingNewer?: boolean;
  /**
   * Há conversa depois do que está carregado.
   *
   * Muda o botão de descer: com isto, o fim da lista não é o fim da conversa, e
   * rolar até lá não levaria a lugar nenhum — o botão passa a voltar para o
   * presente de uma vez, em vez de rolar.
   */
  hasNewer?: boolean;
  onGoToLatest?: () => void;
  /** Muda a conversa: reancorar no fim em vez de manter a rolagem. */
  chatId: string | undefined;
}

/** Altura de chute até a primeira medição de cada balão. */
const ESTIMATE = 76;

/**
 * A partir de quantos pixels do fim a conversa deixa de "estar no fim".
 * Uma folga é necessária: o navegador arredonda a rolagem, e exigir zero
 * faria o botão piscar com a lista parada lá embaixo.
 */
const BOTTOM_SLACK = 120;

/**
 * Janela assumida antes da primeira medição do container. Sem ela o primeiro
 * quadro sai vazio — a altura só chega no ResizeObserver, um tick depois.
 */
const INITIAL_RECT = { width: 0, height: 640 };

/**
 * Lista virtualizada: só as mensagens visíveis vão para o DOM.
 *
 * A altura de um balão depende do texto, do anexo e da resposta citada, então
 * ela é medida de verdade — o `measureElement` observa cada item e reage,
 * inclusive quando uma imagem termina de carregar e empurra o resto.
 */
export default function MessageList({
  messages,
  currentUserId,
  isRead,
  receiptOf,
  onOpenMedia,
  onJumpTo,
  highlight,
  focusedId,
  focusKey,
  dividerId,
  showDays,
  onReply,
  onEdit,
  onDelete,
  onForward,
  onReact,
  onToggleSave,
  savedIds,
  onTogglePin,
  pinnedId,
  onShowInfo,
  nameOf,
  names,
  onLoadOlder,
  isLoadingOlder = false,
  onLoadNewer,
  isLoadingNewer = false,
  hasNewer = false,
  onGoToLatest,
  chatId,
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  /** Fica acima das mensagens: entrar na tela é "cheguei ao topo". */
  const topRef = useRef<HTMLDivElement>(null);
  /** E o irmão dele embaixo: entrar na tela é "cheguei ao fim do carregado". */
  const bottomRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ESTIMATE,
    initialRect: INITIAL_RECT,
    overscan: 8,
    getItemKey: (index) => messages[index]?.id ?? index,
  });

  /** Rótulo do dia por índice — ver `dayMarkers` para o porquê de ser assim. */
  const days = useMemo(
    () => dayMarkers(messages.map((message) => message.createdAt)),
    [messages],
  );

  /**
   * Ao carregar mensagens antigas elas entram no topo. Guardamos qual era a
   * primeira para reancorar nela: sem isso a lista salta, e antes disso o
   * efeito de "rolar para o fim" ainda jogava o usuário lá para baixo — quem
   * pediu o histórico ia parar justamente onde não queria.
   */
  const anchorId = useRef<string | null>(null);
  /**
   * O contrário da âncora: a lista vai crescer por baixo e a rolagem fica onde
   * está.
   *
   * É o que acontece ao andar para a frente depois de um salto. Sem isto, o
   * efeito de "descer até a última" logo abaixo levaria o usuário direto para o
   * fim do trecho que acabou de chegar — pulando justamente o que ele pediu
   * para ler.
   */
  const holdOnGrowth = useRef(false);
  const firstId = messages[0]?.id;
  const lastId = messages.at(-1)?.id;

  useLayoutEffect(() => {
    const anchor = anchorId.current;
    if (!anchor) return;

    const index = messages.findIndex((message) => message.id === anchor);
    if (index > 0) {
      virtualizer.scrollToIndex(index, { align: 'start' });
      anchorId.current = null;
    }
    // `firstId` é o gatilho: ele só muda quando algo entrou no topo.
  }, [firstId, messages, virtualizer]);

  /**
   * Traz a mensagem pedida para o meio da tela. Roda depois do efeito de
   * ancoragem acima, então um salto para uma mensagem recém-carregada do
   * histórico ainda encontra o índice certo.
   */
  useLayoutEffect(() => {
    if (!focusedId) return;

    const index = messages.findIndex((message) => message.id === focusedId);
    if (index >= 0) virtualizer.scrollToIndex(index, { align: 'center' });
    // `focusKey` é o gatilho: pedir a mesma mensagem de novo precisa reagir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey, focusedId]);

  /** Longe do fim: o botão de descer aparece e a rolagem automática para. */
  const [isAway, setIsAway] = useState(false);
  /** Quantas chegaram enquanto o usuário estava lendo mais acima. */
  const [missed, setMissed] = useState(0);
  /** Lido pelos efeitos sem virar dependência deles. */
  const isAwayRef = useRef(false);
  isAwayRef.current = isAway;

  const goToBottom = useCallback(() => {
    if (messages.length === 0) return;
    virtualizer.scrollToIndex(messages.length - 1, { align: 'end' });
    setMissed(0);
  }, [messages.length, virtualizer]);

  // Acompanha a distância até o fim.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    function onScroll() {
      if (!element) return;
      const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
      const away = distance > BOTTOM_SLACK;

      setIsAway(away);
      // Chegou no fim: não há mais nada "perdido" lá embaixo.
      if (!away) setMissed(0);
    }

    element.addEventListener('scroll', onScroll, { passive: true });
    return () => element.removeEventListener('scroll', onScroll);
  }, [chatId]);

  // Trocar de conversa começa do zero.
  useEffect(() => {
    setIsAway(false);
    setMissed(0);
  }, [chatId]);

  /**
   * Conversa aberta, ou mensagem nova: o fim é o lugar certo — desde que o
   * usuário esteja lá.
   *
   * Antes a lista descia sozinha em toda mensagem nova, e quem estava lendo o
   * histórico era arrastado para baixo por uma conversa alheia. A sua própria
   * mensagem continua descendo sempre: você acabou de escrevê-la.
   */
  useLayoutEffect(() => {
    // Um salto em andamento manda na rolagem: sem isto, a mensagem nova de
    // outra pessoa jogaria o usuário de volta para o fim no meio da leitura.
    if (messages.length === 0 || anchorId.current || focusedId) return;

    // A lista cresceu porque pediram o trecho seguinte, e não porque chegou
    // mensagem: quem está lendo fica onde está.
    if (holdOnGrowth.current) {
      holdOnGrowth.current = false;
      return;
    }

    const last = messages[messages.length - 1];
    const isMine = last?.userId === currentUserId;

    if (isAwayRef.current && !isMine) {
      setMissed((count) => count + 1);
      return;
    }

    virtualizer.scrollToIndex(messages.length - 1, { align: 'end' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastId, chatId]);

  /**
   * Chegar ao topo carrega o histórico sozinho.
   *
   * Era um botão "Carregar mensagens anteriores" — e quem rolava até o topo
   * encontrava um botão onde esperava mais conversa. O sentinela entrar na
   * tela é o gatilho, com folga para a carga começar antes de a rolagem parar.
   *
   * Duas travas importam. A âncora é guardada **antes** do pedido: é ela que
   * impede o salto quando as mensagens antigas entram no topo (ver o efeito de
   * ancoragem acima). E o gatilho não repete enquanto uma página está a
   * caminho: sem isso, parar no topo puxaria a conversa inteira em cascata.
   */
  const canLoadOlder = Boolean(onLoadOlder);
  const loadOlderRef = useRef(onLoadOlder);
  loadOlderRef.current = onLoadOlder;
  const isLoadingOlderRef = useRef(isLoadingOlder);
  isLoadingOlderRef.current = isLoadingOlder;
  const firstIdRef = useRef(firstId);
  firstIdRef.current = firstId;

  useEffect(() => {
    const sentinel = topRef.current;
    const root = scrollRef.current;
    if (!sentinel || !root || !canLoadOlder) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting || isLoadingOlderRef.current) return;

        anchorId.current = firstIdRef.current ?? null;
        loadOlderRef.current?.();
      },
      { root, rootMargin: '120px' },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [canLoadOlder, chatId]);

  /**
   * O mesmo no outro extremo: chegar ao fim do que está carregado pede o
   * trecho seguinte.
   *
   * Só existe depois de um salto — fora dele, o fim da lista é o fim da
   * conversa e não há o que buscar. A `holdOnGrowth` é marcada antes do pedido,
   * como a âncora do topo: é ela que impede a rolagem de saltar para o fim do
   * trecho novo.
   */
  const canLoadNewer = Boolean(onLoadNewer);
  const loadNewerRef = useRef(onLoadNewer);
  loadNewerRef.current = onLoadNewer;
  const isLoadingNewerRef = useRef(isLoadingNewer);
  isLoadingNewerRef.current = isLoadingNewer;

  useEffect(() => {
    const sentinel = bottomRef.current;
    const root = scrollRef.current;
    if (!sentinel || !root || !canLoadNewer) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting || isLoadingNewerRef.current) return;

        holdOnGrowth.current = true;
        loadNewerRef.current?.();
      },
      { root, rootMargin: '120px' },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [canLoadNewer, chatId]);

  /*
   * A página pedida não trouxe nada (ou falhou): a marca precisa sair, senão
   * ela engoliria a próxima rolagem automática — a da mensagem que chegar
   * depois.
   */
  useEffect(() => {
    if (!isLoadingNewer) holdOnGrowth.current = false;
  }, [isLoadingNewer]);

  /**
   * O texto que a região viva anuncia: a última mensagem, quando ela é de
   * outra pessoa.
   *
   * Aviso de grupo entra também — "Fulano saiu" é exatamente o tipo de coisa
   * que passa despercebida sem a tela. A mensagem apagada, não: não há o que
   * ler nela.
   */
  const announced = useMemo(() => {
    const last = messages.at(-1);
    if (!last || last.userId === currentUserId || last.isDeleted) return '';

    if (last.type === 'SYSTEM') return last.text;

    const body = last.text || (last.attachment ? 'enviou um anexo' : '');
    return body ? `${last.name}: ${body}` : '';
  }, [messages, currentUserId]);

  const items = virtualizer.getVirtualItems();

  return (
    <div className='display-messages' ref={scrollRef}>
      {canLoadOlder && (
        <div className='message-list-top' ref={topRef}>
          {isLoadingOlder && <span>Carregando mensagens anteriores…</span>}
        </div>
      )}

      <div className='message-list-canvas' style={{ height: virtualizer.getTotalSize() }}>
        {items.map((item) => {
          const message = messages[item.index];
          if (!message) return null;
          const day = showDays ? days[item.index] : null;
          const receipt = receiptOf?.(message);

          return (
            <div
              key={item.key}
              data-index={item.index}
              ref={virtualizer.measureElement}
              className='message-list-row'
              style={{ transform: `translateY(${item.start}px)` }}
            >
              {day && <div className='display-day'>{day}</div>}
              {message.id === dividerId && (
                <div className='display-new-divider'>
                  <span>Novas mensagens</span>
                </div>
              )}
              <MessageItem
                message={message}
                currentUserId={currentUserId}
                isRead={isRead(message)}
                {...(receipt ? { receipt } : {})}
                {...(onOpenMedia ? { onOpenMedia } : {})}
                {...(onJumpTo ? { onJumpTo } : {})}
                {...(highlight ? { highlight } : {})}
                isHighlighted={message.id === focusedId}
                {...(onReply ? { onReply } : {})}
                {...(onEdit ? { onEdit } : {})}
                {...(onDelete ? { onDelete } : {})}
                {...(onForward ? { onForward } : {})}
                {...(onReact ? { onReact } : {})}
                {...(onToggleSave ? { onToggleSave } : {})}
                isSaved={savedIds?.has(message.id) ?? false}
                {...(onTogglePin ? { onTogglePin } : {})}
                isPinned={message.id === pinnedId}
                {...(onShowInfo ? { onShowInfo } : {})}
                {...(nameOf ? { nameOf } : {})}
                {...(names ? { names } : {})}
              />
            </div>
          );
        })}
      </div>

      {canLoadNewer && (
        <div className='message-list-bottom' ref={bottomRef}>
          {isLoadingNewer && <span>Carregando o resto da conversa…</span>}
        </div>
      )}

      {/*
        O que chega de novo, dito para quem não vê a tela.

        Nada anunciava mensagem nova: quem usa leitor de tela precisava sair da
        conversa e voltar para descobrir que alguém respondeu. A região fica
        montada desde sempre, mesmo vazia — um `aria-live` que nasce junto com o
        conteúdo não é anunciado, porque o leitor precisa já estar observando.

        `polite` porque a conversa é fluxo: interromper a leitura de uma
        mensagem para anunciar a seguinte atrapalharia mais do que ajuda. E só o
        que chega dos outros: a sua própria mensagem você acabou de escrever.
      */}
      <p className='sr-only' role='status' aria-live='polite'>
        {announced}
      </p>

      {/*
        Fica colado no fim da área visível enquanto a lista rola por baixo. O
        invólucro tem altura zero: sem isso ele empurraria o conteúdo e criaria
        um espaço morto no fim da conversa.
      */}
      <div className='message-list-anchor'>
        {/*
          Com histórico à frente, o botão fica sempre à vista: ali o fim da
          lista não é o fim da conversa, e rolar até lá pararia no meio dela.
          Nesse caso ele volta para o presente de uma vez, em vez de rolar.
        */}
        {(isAway || hasNewer) && (
          <button
            type='button'
            className='message-list-jump'
            onClick={hasNewer ? onGoToLatest : goToBottom}
            aria-label={
              hasNewer
                ? 'Voltar para as mensagens mais recentes'
                : missed > 0
                  ? `Ir para o fim · ${missed} ${missed === 1 ? 'mensagem nova' : 'mensagens novas'}`
                  : 'Ir para o fim da conversa'
            }
            title={hasNewer ? 'Voltar para o fim da conversa' : 'Ir para o fim'}
          >
            <IoArrowDown size={16} />
            {!hasNewer && missed > 0 && (
              <span className='message-list-jump-count'>{missed}</span>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
