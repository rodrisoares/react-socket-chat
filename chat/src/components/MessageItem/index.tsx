import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import {
  FiPaperclip,
  FiEdit2,
  FiTrash2,
  FiCornerUpLeft,
  FiCornerUpRight,
  FiSmile,
  FiMaximize2,
  FiStar,
  FiCopy,
  FiInfo,
} from 'react-icons/fi';
import { TbPin, TbPinnedOff } from 'react-icons/tb';
import { BsCheck, BsCheckAll } from 'react-icons/bs';

/**
 * Chunk próprio, como no compositor.
 *
 * O seletor carrega o conjunto Unicode inteiro — meio megabyte. Importado
 * estaticamente aqui, ele entrava na carga da conversa inteira por causa de um
 * botão que quase nunca é aberto: o Vite avisava que o import dinâmico do
 * compositor não separava nada, porque este aqui o prendia.
 */
const EmojiPicker = lazy(() => import('components/EmojiPicker'));
import { attachmentUrl } from 'config/env';
import { fullDateLabel, timeLabel } from 'utils/dayLabel';
import { richText } from 'utils/richText';
import { attachmentTypeLabel } from 'utils/messagePreview';
import { isPreviewable } from 'utils/media';
import type { Message } from '@react-chat/shared';

/** Deslocamento a partir do qual soltar o dedo responde à mensagem. */
const SWIPE_THRESHOLD = 56;

/** Quanto o balão anda no máximo: além disso o gesto não fica mais claro. */
const SWIPE_MAX = 80;

/** Dedo parado neste tempo abre a barra de ações. */
const LONG_PRESS_MS = 450;

/** Movimento a partir do qual já não é toque parado, e sim arrasto. */
const MOVE_TOLERANCE = 8;

/** Quem já leu e quem falta — o recibo detalhado dos grupos. */
export interface Receipt {
  readers: string[];
  pending: string[];
}

interface MessageItemProps {
  message: Message;
  /** Id do usuário logado — decide o lado do balão e as ações disponíveis. */
  currentUserId: number | undefined;
  isRead: boolean;
  /**
   * Nomes por trás do ✓✓. Com mais de um destinatário o recibo vira botão —
   * "2/4" e, ao clicar, quem leu e quem falta. Ausente na conversa direta,
   * onde o ícone sozinho já diz tudo.
   */
  receipt?: Receipt;
  /** Abre a mídia no visor em tela cheia; sem ele, o anexo é só um link. */
  onOpenMedia?: (message: Message) => void;
  /**
   * Leva à mensagem citada. Sem ele a citação continua decorativa — era o
   * caso até agora: ela mostrava o trecho e não levava a lugar nenhum.
   */
  onJumpTo?: (messageId: string) => void;
  /** Termo da busca, para marcar as ocorrências dentro do texto. */
  highlight?: string;
  /** Alvo de um salto ou da busca: o balão fica destacado até sair do foco. */
  isHighlighted?: boolean;
  /**
   * Sem os três a mensagem fica sem ações — é como o grupo que o usuário
   * deixou se apresenta: histórico visível, nada mais.
   */
  onReply?: (message: Message) => void;
  onEdit?: (message: Message) => void;
  /**
   * Apagar — e não só a própria. Na mensagem de outra pessoa a ação é o
   * "apagar para mim", que some da sua tela sem ninguém ficar sabendo; quem
   * escolhe entre os dois alcances é o diálogo de confirmação.
   */
  onDelete?: (message: Message) => void;
  onForward?: (message: Message) => void;
  /** Emoji vazio remove a reação de quem clicou. */
  onReact?: (message: Message, emoji: string) => void;
  /** Salvar nos favoritos. Privado: ninguém na conversa fica sabendo. */
  onToggleSave?: (message: Message) => void;
  isSaved?: boolean;
  /** Fixar no topo da conversa — este, ao contrário, todos veem. */
  onTogglePin?: (message: Message) => void;
  isPinned?: boolean;
  /**
   * "Dados da mensagem": quem já leu, e quando.
   *
   * Só nas suas. Saber quem leu a mensagem de outra pessoa não é assunto de
   * quem está olhando — o servidor recusa de todo modo, e o botão não deve
   * prometer o que ele nega.
   */
  onShowInfo?: (message: Message) => void;
  /**
   * Nome de quem reagiu, por id. Sem ele a reação mostra só a contagem — que
   * era todo o retorno até agora: dava para ver que três pessoas reagiram, e
   * não quem.
   */
  nameOf?: (userId: number) => string | undefined;
  /**
   * Nomes que podem ser mencionados — os membros da conversa.
   *
   * Vem de fora, e o balão não adivinha: sem a lista, `@` seguido de palavra
   * marcaria um e-mail no meio do texto como se fosse menção a alguém.
   */
  names?: string[];
}

export default function MessageItem({
  message,
  currentUserId,
  isRead,
  receipt,
  onOpenMedia,
  onJumpTo,
  highlight,
  isHighlighted = false,
  onReply,
  onEdit,
  onDelete,
  onForward,
  onReact,
  onToggleSave,
  isSaved = false,
  onTogglePin,
  isPinned = false,
  onShowInfo,
  nameOf,
  names,
}: MessageItemProps) {
  const [isReacting, setIsReacting] = useState(false);
  /** Lista de quem leu, aberta a pedido: ela cresce dentro do balão. */
  const [showReaders, setShowReaders] = useState(false);
  /** "Copiado!" por um instante: sem retorno, o clique não parece ter feito nada. */
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<number | undefined>(undefined);
  /** Gatilho do seletor: o painel flutuante se posiciona por ele. */
  const reactButtonRef = useRef<HTMLButtonElement>(null);
  const isMine = message.userId === currentUserId;
  const owner = isMine ? 'owner' : 'foreign';

  /** O emoji que eu escolhi, se escolhi algum: clicar nele de novo remove. */
  const mine = message.reactions.find((r) => r.userIds.includes(currentUserId ?? -1));

  /**
   * As dimensões viram atributos do `<img>`.
   *
   * É com elas que o browser reserva a caixa certa antes de a imagem chegar.
   * Sem isso o balão nasce com altura zero e empurra tudo quando a foto
   * carrega — o salto que fazia perder a linha que se estava lendo. Vêm vazias
   * de vídeo e do que foi enviado antes de o servidor passar a medir.
   */
  const size =
    message.attachment?.width && message.attachment.height
      ? { width: message.attachment.width, height: message.attachment.height }
      : {};

  /** Quem reagiu, por extenso. "Você" primeiro, como em toda lista de gente. */
  function reactionLabel(emoji: string, userIds: number[]): string {
    const names = userIds
      .map((id) => (id === currentUserId ? 'Você' : nameOf?.(id)))
      .filter((name): name is string => Boolean(name));

    if (names.length === 0) return `${emoji}, ${userIds.length}`;

    return `${names.join(', ')} ${names.length === 1 ? 'reagiu' : 'reagiram'} com ${emoji}`;
  }

  const readers = receipt?.readers ?? [];
  const total = readers.length + (receipt?.pending.length ?? 0);
  /** Mais de um destinatário: só aí detalhar o recibo diz algo novo. */
  const isGroupReceipt = Boolean(receipt) && total > 1;

  /**
   * Miolo da citação — o mesmo nos dois invólucros, o botão e o span.
   *
   * Nome e trecho em elementos próprios porque cada um tem o seu corte: o
   * bloco virou um cartão de largura fixa dentro do balão, e sem `ellipsis`
   * uma citação longa esticava o balão inteiro.
   */
  const quoted = message.replyTo;
  const quotedThumb = isPreviewable(quoted?.attachment?.type)
    ? attachmentUrl(quoted?.attachment?.url ?? '')
    : '';

  const quote = quoted && (
    <>
      <span className='display-messages-item-reply-body'>
        <strong className='display-messages-item-reply-who'>{quoted.name}</strong>
        {quoted.isDeleted ? (
          <em className='display-messages-item-reply-text'>mensagem apagada</em>
        ) : (
          <span className='display-messages-item-reply-text'>
            {/* Mensagem só com anexo tem texto vazio: sem o rótulo a citação
                ficava muda justamente quando havia algo para ver. */}
            {quoted.text || attachmentTypeLabel(quoted.attachment)}
          </span>
        )}
      </span>

      {/* A miniatura diz de que foto se fala sem precisar abrir nada. Vídeo
          entra pelo primeiro quadro, como na galeria. */}
      {quotedThumb &&
        (quoted.attachment?.type.startsWith('video/') ? (
          <video
            className='display-messages-item-reply-thumb'
            src={quotedThumb}
            preload='metadata'
            muted
          />
        ) : (
          <img
            className='display-messages-item-reply-thumb'
            src={quotedThumb}
            alt=''
          />
        ))}
    </>
  );

  function react(emoji: string) {
    setIsReacting(false);
    onReact?.(message, mine?.emoji === emoji ? '' : emoji);
  }

  /**
   * Copiar vale até em conversa só de leitura — num grupo que você deixou, por
   * exemplo. Não é ação sobre a conversa, é sobre o texto.
   */
  const canCopy = !message.isDeleted && Boolean(message.text);

  /**
   * Copia o texto do balão, e só ele: anexo, citação e reações ficam de fora,
   * que é o que "Copiar texto" promete.
   *
   * `navigator.clipboard` não existe fora de contexto seguro, e o acesso falha
   * aqui dentro — a promessa rejeita e o catch segura. Sem ele o botão diria
   * "Copiado!" sem ter copiado nada.
   */
  async function copyText() {
    try {
      await navigator.clipboard.writeText(message.text);
      setCopied(true);
      window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Silêncio de propósito: não há o que o usuário possa fazer a respeito.
    }
  }

  const hasActions =
    !message.isDeleted &&
    (canCopy ||
      Boolean(onReply ?? onEdit ?? onDelete ?? onForward ?? onReact ?? onToggleSave));

  /**
   * As ações da mensagem no toque.
   *
   * Elas só apareciam no `:hover`, e no celular não existe hover: a barra
   * inteira — responder, editar, apagar, reagir, encaminhar — ficava fora de
   * alcance. O toque longo abre a barra; arrastar o balão para a direita
   * responde, que é o gesto que os apps de mensagem ensinaram.
   */
  const [swipe, setSwipe] = useState(0);
  const [isTouchOpen, setIsTouchOpen] = useState(false);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const longPress = useRef<number | undefined>(undefined);
  /** O toque longo também dispara um clique ao soltar: este o engole. */
  const swallowClick = useRef(false);

  function cancelLongPress() {
    window.clearTimeout(longPress.current);
    longPress.current = undefined;
  }

  // Nem o toque longo agendado nem o "Copiado!" podem disparar depois que o
  // balão saiu da tela — a lista é virtualizada, e os itens somem o tempo todo.
  useEffect(
    () => () => {
      cancelLongPress();
      window.clearTimeout(copiedTimer.current);
    },
    [],
  );

  function onTouchStart(event: React.TouchEvent) {
    const touch = event.touches[0];
    if (!touch || !hasActions) return;

    touchStart.current = { x: touch.clientX, y: touch.clientY };
    longPress.current = window.setTimeout(() => {
      setIsTouchOpen(true);
      swallowClick.current = true;
    }, LONG_PRESS_MS);
  }

  function onTouchMove(event: React.TouchEvent) {
    const start = touchStart.current;
    const touch = event.touches[0];
    if (!start || !touch) return;

    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;

    // Movimento mais vertical que horizontal é rolagem da conversa, e não
    // gesto no balão: desiste em vez de brigar com o scroll.
    if (Math.abs(dy) > Math.abs(dx)) {
      touchStart.current = null;
      cancelLongPress();
      setSwipe(0);
      return;
    }

    if (Math.abs(dx) > MOVE_TOLERANCE) cancelLongPress();

    // Só para a direita, e só quando há para quem responder.
    if (onReply) setSwipe(Math.max(0, Math.min(SWIPE_MAX, dx)));
  }

  function onTouchEnd() {
    const travelled = swipe;
    touchStart.current = null;
    cancelLongPress();
    setSwipe(0);

    if (travelled >= SWIPE_THRESHOLD) onReply?.(message);
  }

  /**
   * Aviso do grupo: uma linha centralizada, e não um balão.
   *
   * Sai antes de tudo o que só faz sentido para mensagem de gente — o lado, o
   * nome, as ações, a reação, o recibo de leitura. Ele não é de ninguém: o
   * `userId` guarda apenas quem causou o evento, e desenhá-lo como balão dessa
   * pessoa diria que foi ela que escreveu "Fulano saiu do grupo".
   *
   * Depois dos hooks de propósito. Sair antes deles mudaria a quantidade de
   * hooks chamados entre uma renderização e outra, que é o que o React proíbe.
   */
  if (message.type === 'SYSTEM') {
    return (
      <div className='display-messages-system'>
        {/* A hora fica no passe de mouse, como no balão: a linha é curta e um
            horário ao lado competiria com o próprio aviso. */}
        <span title={fullDateLabel(message.createdAt)}>{message.text}</span>
      </div>
    );
  }

  return (
    <div
      className={[
        'display-messages-item',
        `display-messages-item--${owner}`,
        isHighlighted ? 'is-highlighted' : '',
        isTouchOpen ? 'is-touch-open' : '',
        swipe > 0 ? 'is-swiping' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={swipe > 0 ? { transform: `translateX(${swipe}px)` } : undefined}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
      onClick={() => {
        // Soltar o toque longo dispara um clique: ele não pode fechar na hora
        // a barra que o próprio toque acabou de abrir.
        if (swallowClick.current) {
          swallowClick.current = false;
          return;
        }
        if (isTouchOpen) setIsTouchOpen(false);
      }}
    >
      {/* Pista do gesto, atrás do balão: sem ela, arrastar só se descobre por
          acidente. */}
      {swipe > 0 && (
        <span className='display-messages-item-swipe' aria-hidden='true'>
          <FiCornerUpLeft size={16} />
        </span>
      )}

      <span className='display-messages-item-name'>{message.name}</span>

      {message.isForwarded && (
        <span className='display-messages-item-forwarded'>
          <FiCornerUpRight size={11} /> Encaminhada
        </span>
      )}

      {message.replyTo &&
        // Só vira botão quando há para onde ir: a mensagem original apagada
        // continua na thread, mas saltar até ela não mostraria nada.
        (onJumpTo && !message.replyTo.isDeleted ? (
          <button
            type='button'
            className='display-messages-item-reply display-messages-item-reply--link'
            onClick={() => onJumpTo(message.replyTo?.id ?? '')}
            aria-label={`Ir para a mensagem de ${message.replyTo.name}`}
            title='Ir para a mensagem citada'
          >
            {quote}
          </button>
        ) : (
          <span className='display-messages-item-reply'>{quote}</span>
        ))}

      {message.isDeleted ? (
        <em className='display-messages-item-deleted'>Esta mensagem foi apagada</em>
      ) : (
        <>
          {message.attachment &&
            (isPreviewable(message.attachment.type) ? (
              <div className='display-messages-item-media'>
                {message.attachment.type.startsWith('video/') ? (
                  <>
                    {/* Toca no próprio balão; o visor é para ver grande. */}
                    <video
                      src={attachmentUrl(message.attachment.url)}
                      controls
                      preload='metadata'
                    />
                    {onOpenMedia && (
                      <button
                        type='button'
                        className='display-messages-item-media-expand'
                        onClick={() => onOpenMedia(message)}
                        aria-label='Abrir vídeo em tela cheia'
                        title='Abrir em tela cheia'
                      >
                        <FiMaximize2 size={14} />
                      </button>
                    )}
                  </>
                ) : onOpenMedia ? (
                  <button
                    type='button'
                    className='display-messages-item-media-open'
                    onClick={() => onOpenMedia(message)}
                    aria-label={`Abrir ${message.attachment.name}`}
                  >
                    <img
                      {...size}
                      src={attachmentUrl(message.attachment.url)}
                      alt={message.attachment.name}
                    />
                  </button>
                ) : (
                  // Sem visor — a conversa em somente leitura — a imagem volta
                  // a ser link: melhor abrir em outra aba do que não abrir.
                  <a
                    className='display-messages-item-attachment'
                    href={attachmentUrl(message.attachment.url)}
                    target='_blank'
                    rel='noreferrer'
                  >
                    <img
                      {...size}
                      src={attachmentUrl(message.attachment.url)}
                      alt={message.attachment.name}
                    />
                  </a>
                )}
              </div>
            ) : (
              <a
                className='display-messages-item-attachment'
                href={attachmentUrl(message.attachment.url)}
                target='_blank'
                rel='noreferrer'
              >
                <FiPaperclip size={14} /> {message.attachment.name}
              </a>
            ))}
          {/*
            Uma passagem só: endereços, formatação, menções e ocorrências da
            busca saem do `richText` já resolvidos e em ordem.

            Eram dois `map` encaixados — links por fora, busca por dentro —, e
            cada camada nova dobrava o aninhamento: a formatação seria a
            terceira, e já sairia ilegível aqui dentro.
          */}
          {message.text && (
            <span>
              {richText(message.text, {
                ...(highlight ? { term: highlight } : {}),
                ...(names ? { names } : {}),
              }).map((token, index) => {
                if (token.href) {
                  return (
                    <a
                      key={index}
                      className='display-messages-item-link'
                      href={token.href}
                      target='_blank'
                      // `noopener` junto: sem ele a página aberta ganha acesso
                      // a esta pelo `window.opener`.
                      rel='noreferrer noopener'
                    >
                      {token.text}
                    </a>
                  );
                }

                // Compostas: um pedaço pode ser negrito e itálico ao mesmo tempo.
                const classes = [
                  token.bold ? 'display-messages-item-bold' : '',
                  token.italic ? 'display-messages-item-italic' : '',
                  token.code ? 'display-messages-item-code' : '',
                  token.mention ? 'display-messages-item-mention' : '',
                ]
                  .filter(Boolean)
                  .join(' ');

                // A ocorrência da busca continua em `<mark>`: é o elemento que
                // diz "isto casou com o que você procurou" — o leitor de tela
                // anuncia, e uma cor sozinha não anunciaria nada.
                return token.isMatch ? (
                  <mark
                    key={index}
                    className={`display-messages-item-match ${classes}`.trim()}
                  >
                    {token.text}
                  </mark>
                ) : (
                  <span key={index} className={classes || undefined}>
                    {token.text}
                  </span>
                );
              })}
            </span>
          )}
        </>
      )}

      {isReacting && onReact && (
        <Suspense fallback={null}>
          <EmojiPicker
            anchorTo={reactButtonRef.current}
            onSelect={react}
            onClose={() => setIsReacting(false)}
          />
        </Suspense>
      )}

      {message.reactions.length > 0 && (
        <div className='display-messages-item-reactions'>
          {message.reactions.map((reaction) => {
            const who = reactionLabel(reaction.emoji, reaction.userIds);

            return (
              <button
                key={reaction.emoji}
                type='button'
                className={`display-messages-item-reaction${
                  reaction.emoji === mine?.emoji ? ' is-mine' : ''
                }`}
                // Sem onReact a lista é só leitura: mostra, não deixa mexer.
                disabled={!onReact}
                onClick={() => react(reaction.emoji)}
                // Os nomes vão no `title` e no rótulo acessível: dentro do
                // balão não há largura para uma lista de gente, e a contagem
                // sozinha não dizia quem.
                title={who}
                aria-label={who}
              >
                {reaction.emoji} {reaction.userIds.length}
              </button>
            );
          })}
        </div>
      )}

      <span className='display-messages-item-meta'>
        {message.isEdited && !message.isDeleted && <em>editada</em>}
        {/* O balão mostra só a hora para caber; a data completa fica a um
            passe de mouse, em vez de obrigar a rolar até o separador de dia. */}
        <span
          className='display-messages-item-date'
          title={fullDateLabel(message.createdAt)}
        >
          {timeLabel(message.createdAt)}
        </span>
        {isMine &&
          !message.isDeleted &&
          (isGroupReceipt ? (
            <button
              type='button'
              className={`display-messages-item-receipt display-messages-item-receipt--button${
                isRead ? ' is-read' : ''
              }`}
              onClick={() => setShowReaders((open) => !open)}
              aria-expanded={showReaders}
              aria-label={`Lida por ${readers.length} de ${total}`}
              title={`Lida por ${readers.length} de ${total} · ver quem`}
            >
              {isRead ? (
                <BsCheckAll size={14} title='Lida' />
              ) : (
                <BsCheck size={14} title='Enviada' />
              )}
              {readers.length}/{total}
            </button>
          ) : (
            <span className={`display-messages-item-receipt${isRead ? ' is-read' : ''}`}>
              {isRead ? (
                <BsCheckAll size={14} title='Lida' />
              ) : (
                <BsCheck size={14} title='Enviada' />
              )}
            </span>
          ))}
      </span>

      {/* Dentro do balão, e não num painel flutuante: a lista é curta, e
          flutuar dentro de uma lista virtualizada nasce recortado. */}
      {showReaders && receipt && (
        <div className='display-messages-item-readers'>
          <p>
            <strong>Lida por</strong>{' '}
            {readers.length > 0 ? readers.join(', ') : 'ninguém ainda'}
          </p>
          {receipt.pending.length > 0 && (
            <p className='display-messages-item-readers-pending'>
              <strong>Falta</strong> {receipt.pending.join(', ')}
            </p>
          )}
        </div>
      )}

      {/*
        Cada botão leva `title` além do `aria-label`: são cinco ícones de 13px
        lado a lado, e o rótulo acessível só o leitor de tela lê — quem usa o
        mouse não tinha como saber qual era qual sem clicar.
      */}
      {hasActions && (
        <div className='display-messages-item-actions'>
          {onReact && (
            <button
              type='button'
              ref={reactButtonRef}
              onClick={() => setIsReacting((open) => !open)}
              aria-label='Reagir'
              title='Reagir'
              aria-expanded={isReacting}
            >
              <FiSmile size={13} />
            </button>
          )}
          {onToggleSave && (
            <button
              type='button'
              className={isSaved ? 'is-on' : ''}
              onClick={() => onToggleSave(message)}
              aria-label={isSaved ? 'Remover dos salvos' : 'Salvar mensagem'}
              title={isSaved ? 'Remover dos salvos' : 'Salvar mensagem'}
            >
              <FiStar size={13} />
            </button>
          )}
          {onTogglePin && (
            <button
              type='button'
              className={isPinned ? 'is-on' : ''}
              onClick={() => onTogglePin(message)}
              aria-label={isPinned ? 'Desafixar da conversa' : 'Fixar na conversa'}
              title={isPinned ? 'Desafixar da conversa' : 'Fixar na conversa'}
            >
              {isPinned ? <TbPinnedOff size={13} /> : <TbPin size={13} />}
            </button>
          )}
          {onForward && (
            <button
              type='button'
              onClick={() => onForward(message)}
              aria-label='Encaminhar'
              title='Encaminhar'
            >
              <FiCornerUpRight size={13} />
            </button>
          )}
          {onReply && (
            <button
              type='button'
              onClick={() => onReply(message)}
              aria-label='Responder'
              title='Responder'
            >
              <FiCornerUpLeft size={13} />
            </button>
          )}
          {canCopy && (
            <button
              type='button'
              onClick={() => void copyText()}
              aria-label={copied ? 'Texto copiado' : 'Copiar texto'}
              title={copied ? 'Copiado!' : 'Copiar texto'}
            >
              <FiCopy size={13} />
            </button>
          )}
          {isMine && (
            <>
              {onShowInfo && (
                <button
                  type='button'
                  onClick={() => onShowInfo(message)}
                  aria-label='Dados da mensagem'
                  title='Dados da mensagem'
                >
                  <FiInfo size={13} />
                </button>
              )}
              {onEdit && (
                <button
                  type='button'
                  onClick={() => onEdit(message)}
                  aria-label='Editar'
                  title='Editar'
                >
                  <FiEdit2 size={13} />
                </button>
              )}
            </>
          )}
          {/*
            Apagar fica fora do `isMine`.

            Na mensagem de outra pessoa ele é o "apagar para mim": privado, sem
            tocar na conversa de ninguém, e por isso vale para qualquer
            mensagem. Quem decide o alcance é o diálogo de confirmação, que já
            tem texto para os dois casos — e o servidor recusa "para todos" de
            quem não é o autor. Enquanto o botão vivia aqui dentro, esse
            caminho inteiro existia sem porta de entrada.
          */}
          {onDelete && (
            <button
              type='button'
              onClick={() => onDelete(message)}
              aria-label={isMine ? 'Apagar' : 'Apagar para mim'}
              title={isMine ? 'Apagar' : 'Apagar para mim'}
            >
              <FiTrash2 size={13} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
