import './styles.scss';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MUTE_DURATIONS } from '@react-chat/shared';
import {
  FiArchive,
  FiBell,
  FiBellOff,
  FiCheckCircle,
  FiInbox,
  FiMoreVertical,
  FiTrash2,
} from 'react-icons/fi';
import { TbEraser, TbPin, TbPinnedOff } from 'react-icons/tb';
import { IoMailUnreadOutline } from 'react-icons/io5';

import useEscape from 'hooks/escape';

interface ChatMenuProps {
  /** Decide qual das duas ações o menu oferece. */
  isUnread: boolean;
  onMarkRead: () => void;
  onMarkUnread: () => void;
  /**
   * Aberto/fechado fica com quem usa: no card da lista o clique direito
   * também precisa abrir, e só o card sabe desse evento.
   */
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /** Rótulo acessível do botão "⋮". */
  label: string;
  className?: string;
  /** Sem os dois, o menu não oferece fixar — é o caso do cabeçalho. */
  isPinned?: boolean;
  onTogglePin?: () => void;
  isArchived?: boolean;
  onToggleArchive?: () => void;
  isMuted?: boolean;
  onToggleMute?: () => void;
  /**
   * Silenciar por um prazo. `null` é o "até eu desfazer".
   *
   * Opcional: sem ele o item continua sendo um interruptor, que é como os
   * testes e qualquer chamador antigo o usam.
   */
  onMuteFor?: (minutes: number | null) => void;
  /** Limpar o histórico só para quem clicou; a conversa fica na lista. */
  onClearHistory?: () => void;
  /**
   * Excluir só para quem clicou; o outro continua vendo a conversa. Quem usa
   * decide se cabe: em grupo, só depois de sair.
   */
  onDelete?: () => void;
  /**
   * Tira o menu da árvore e o posiciona em `fixed`, colado ao gatilho.
   *
   * É o que o card da lista precisa. Ele vive dentro de um contêiner com
   * `overflow-y: auto` (ver `.home-chat-list`), e um descendente `absolute` é
   * recortado por qualquer ancestral com overflow: nas conversas do fim da
   * lista o menu abria para baixo, passava da borda e os últimos itens —
   * limpar e excluir — simplesmente não apareciam.
   *
   * Nem trocar para `fixed` sem o portal resolveria: as linhas da lista
   * virtualizada usam `transform`, e um `transform` cria bloco de contenção
   * até para `position: fixed`.
   *
   * Opt-in porque o menu do cabeçalho não é recortado por ninguém — é o mesmo
   * desenho do `anchorTo` do EmojiPicker, que resolveu isto antes.
   */
  floating?: boolean;
}

/** Respiro entre o menu e o gatilho, e entre o menu e a borda da tela. */
const GAP = 4;

export default function ChatMenu({
  isUnread,
  onMarkRead,
  onMarkUnread,
  isOpen,
  onOpenChange,
  label,
  className = '',
  isPinned = false,
  onTogglePin,
  isArchived = false,
  onToggleArchive,
  isMuted = false,
  onToggleMute,
  onMuteFor,
  onClearHistory,
  onDelete,
  floating = false,
}: ChatMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  /** Prazos abertos sob o item de silenciar. */
  const [showDurations, setShowDurations] = useState(false);
  /** Posição do menu flutuante; null enquanto não foi medida. */
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

  // Aberto, o menu é o topo da pilha do Esc: fecha ele, e não a conversa.
  useEscape(() => onOpenChange(false), isOpen);

  // Fechar o menu fecha os prazos junto: reabri-lo não pode encontrar um
  // submenu aberto de onde ele parou. A medida também sai, para a próxima
  // abertura não piscar na posição da anterior.
  useEffect(() => {
    if (!isOpen) {
      setShowDurations(false);
      setCoords(null);
    }
  }, [isOpen]);

  /**
   * Onde o menu flutuante cabe: abaixo do gatilho, ou acima quando não cabe, e
   * sempre preso dentro da janela.
   *
   * Abre para baixo por convenção — é o que um "⋮" faz. O EmojiPicker prefere
   * acima porque é um painel alto ao lado de um balão; aqui a preferência é a
   * oposta.
   *
   * `showDurations` é dependência de propósito: abrir os prazos cresce o menu, e
   * sem remedir ele voltaria a estourar a borda de baixo — reintroduzindo o
   * mesmo bug por outra porta.
   */
  useLayoutEffect(() => {
    if (!floating || !isOpen) return;

    const anchor = rootRef.current?.getBoundingClientRect();
    const panel = listRef.current?.getBoundingClientRect();
    if (!anchor || !panel) return;

    const abaixo = anchor.bottom + GAP;
    const top =
      abaixo + panel.height <= window.innerHeight - GAP
        ? abaixo
        : Math.max(GAP, anchor.top - panel.height - GAP);

    // Alinhado à direita do gatilho, como o `right: 0` do menu ancorado.
    const left = Math.min(
      Math.max(GAP, anchor.right - panel.width),
      window.innerWidth - panel.width - GAP,
    );

    setCoords({ top, left });
  }, [floating, isOpen, showDurations]);

  /**
   * Rolar move o gatilho e o menu ficaria solto no ar: em `fixed` ele não
   * acompanha. Fechar é mais honesto do que reposicionar a cada quadro — é a
   * mesma escolha do EmojiPicker.
   */
  useEffect(() => {
    if (!floating || !isOpen) return;

    function close() {
      onOpenChange(false);
    }

    // Captura: a rolagem acontece na lista de conversas, não na janela.
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);

    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [floating, isOpen, onOpenChange]);

  useEffect(() => {
    if (!isOpen) return;

    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (rootRef.current?.contains(target)) return;
      /*
       * Portado para o `body`, o menu deixa de ser descendente do root — e sem
       * esta linha todo clique num item dele contaria como "clique fora",
       * fechando o menu antes de a ação rodar.
       */
      if (listRef.current?.contains(target)) return;

      onOpenChange(false);
    }

    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [isOpen, onOpenChange]);

  function run(action: () => void) {
    action();
    onOpenChange(false);
  }

  // Limpar e excluir formam o bloco do fim; o traço vai em quem abre o bloco,
  // que nem sempre é o mesmo — em grupo, excluir só aparece depois de sair.
  const opensLastBlock = onClearHistory ? 'clear' : onDelete ? 'delete' : null;

  function blockClass(item: 'clear' | 'delete'): string {
    return opensLastBlock === item ? 'chat-menu-list-divider' : '';
  }

  /**
   * Os itens, separados do invólucro.
   *
   * Extraídos porque o `<ul>` agora tem duas formas — ancorado no card, ou
   * portado para o `body` — e duplicar a lista inteira nas duas seria garantir
   * que elas divergissem na primeira mudança.
   */
  const menuItems = (
    <>
      <li role='none'>
        <button
          type='button'
          role='menuitem'
          onClick={(event) => {
            event.stopPropagation();
            run(isUnread ? onMarkRead : onMarkUnread);
          }}
        >
          {isUnread ? (
            <>
              <FiCheckCircle size={15} /> Marcar como lida
            </>
          ) : (
            <>
              <IoMailUnreadOutline size={15} /> Marcar como não lida
            </>
          )}
        </button>
      </li>

      {onTogglePin && (
        <li role='none'>
          <button
            type='button'
            role='menuitem'
            onClick={(event) => {
              event.stopPropagation();
              run(onTogglePin);
            }}
          >
            {isPinned ? (
              <>
                <TbPinnedOff size={15} /> Desafixar
              </>
            ) : (
              <>
                <TbPin size={15} /> Fixar no topo
              </>
            )}
          </button>
        </li>
      )}

      {onToggleMute && (
        <li role='none'>
          {/*
            Silenciada: reativar é a única saída, e um prazo ali não faria
            sentido. É só ao silenciar que a pergunta "por quanto tempo?"
            existe — e só quando quem usa o menu sabe respondê-la.
          */}
          {isMuted || !onMuteFor ? (
            <button
              type='button'
              role='menuitem'
              onClick={(event) => {
                event.stopPropagation();
                run(onToggleMute);
              }}
            >
              {isMuted ? (
                <>
                  <FiBell size={15} /> Reativar notificações
                </>
              ) : (
                <>
                  <FiBellOff size={15} /> Silenciar notificações
                </>
              )}
            </button>
          ) : (
            <>
              <button
                type='button'
                role='menuitem'
                aria-expanded={showDurations}
                onClick={(event) => {
                  event.stopPropagation();
                  setShowDurations((open) => !open);
                }}
              >
                <FiBellOff size={15} /> Silenciar notificações
              </button>

              {showDurations && (
                <ul className='chat-menu-durations' role='menu'>
                  {MUTE_DURATIONS.map((duration) => (
                    <li key={duration.label} role='none'>
                      <button
                        type='button'
                        role='menuitem'
                        onClick={(event) => {
                          event.stopPropagation();
                          run(() => onMuteFor(duration.minutes));
                        }}
                      >
                        {duration.label}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </li>
      )}

      {onToggleArchive && (
        <li role='none'>
          <button
            type='button'
            role='menuitem'
            onClick={(event) => {
              event.stopPropagation();
              run(onToggleArchive);
            }}
          >
            {isArchived ? (
              <>
                <FiInbox size={15} /> Desarquivar
              </>
            ) : (
              <>
                <FiArchive size={15} /> Arquivar
              </>
            )}
          </button>
        </li>
      )}

      {onClearHistory && (
        <li role='none' className={blockClass('clear')}>
          <button
            type='button'
            role='menuitem'
            onClick={(event) => {
              event.stopPropagation();
              run(onClearHistory);
            }}
          >
            <TbEraser size={15} /> Limpar conversa
          </button>
        </li>
      )}

      {onDelete && (
        <li role='none' className={`chat-menu-list-danger ${blockClass('delete')}`.trim()}>
          <button
            type='button'
            role='menuitem'
            onClick={(event) => {
              event.stopPropagation();
              run(onDelete);
            }}
          >
            <FiTrash2 size={15} /> Excluir conversa
          </button>
        </li>
      )}
    </>
  );

  const list = isOpen ? (
    <ul
      ref={listRef}
      className={`chat-menu-list${floating ? ' chat-menu-list--floating' : ''}`}
      role='menu'
      style={
        floating
          ? {
              top: coords?.top ?? 0,
              left: coords?.left ?? 0,
              // Enquanto não mediu, fica invisível: sem isto o menu pisca no
              // canto superior esquerdo antes de assumir a posição certa.
              visibility: coords ? 'visible' : 'hidden',
            }
          : undefined
      }
    >
      {menuItems}
    </ul>
  ) : null;

  return (
    <div className={`chat-menu ${className}`.trim()} ref={rootRef}>
      <button
        type='button'
        className='chat-menu-trigger'
        // O rótulo acessível diz de qual conversa é o menu; a dica do mouse
        // fica curta de propósito — ela aparece ao lado do próprio card, que
        // já responde "de qual conversa".
        aria-label={label}
        title='Mais opções'
        aria-haspopup='menu'
        aria-expanded={isOpen}
        onClick={(event) => {
          // O card inteiro é clicável: sem isto, abrir o menu abriria a conversa.
          event.stopPropagation();
          onOpenChange(!isOpen);
        }}
      >
        <FiMoreVertical size={16} />
      </button>

      {/* Portado para o `body` quando flutuante — ver a prop `floating`. */}
      {floating && list ? createPortal(list, document.body) : list}
    </div>
  );
}
