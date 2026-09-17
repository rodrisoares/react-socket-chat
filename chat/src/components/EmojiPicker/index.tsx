import './styles.scss';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import data from '@emoji-mart/data';
import ptBR from '@emoji-mart/data/i18n/pt.json';
import Picker from '@emoji-mart/react';

import useEscape from 'hooks/escape';
import useTheme from 'hooks/theme';

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  onClose: () => void;
  /**
   * Quando informado, o painel vira flutuante: sai num portal e se posiciona
   * em `fixed` colado a este elemento.
   *
   * É o que as reações precisam — dentro da mensagem, a lista virtualizada
   * recorta tudo que passa da linha, então um painel posicionado no próprio
   * balão nasce cortado. Sem a prop, o comportamento é o do compositor, que
   * vive num pai relativo e não é recortado por ninguém.
   */
  anchorTo?: HTMLElement | null;
}

/** Respiro entre o painel e o gatilho, e entre o painel e a borda da tela. */
const GAP = 8;

/**
 * Seletor de emojis.
 *
 * Eram 32 emojis fixos num grid próprio: quem procurasse qualquer outro não
 * tinha onde procurar. O emoji-mart traz o conjunto Unicode inteiro com busca,
 * categorias, tons de pele e a faixa de usados recentemente — esta última ele
 * guarda sozinho, no armazenamento do navegador.
 *
 * O painel continua saindo num portal quando ancorado: essa parte é nossa, e a
 * razão dela não mudou.
 */
export default function EmojiPicker({ onSelect, onClose, anchorTo }: EmojiPickerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const { theme } = useTheme();

  // Aberto, o seletor é o topo da pilha do Esc: fecha ele, e não a conversa.
  useEscape(onClose);

  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      if (!ref.current?.contains(event.target as Node)) onClose();
    }

    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [onClose]);

  /**
   * Posição do painel flutuante: acima do gatilho, ou abaixo quando não cabe,
   * e sempre preso dentro da janela.
   */
  useLayoutEffect(() => {
    if (!anchorTo) return;

    const anchor = anchorTo.getBoundingClientRect();
    const panel = ref.current?.getBoundingClientRect();
    const width = panel?.width ?? 0;
    const height = panel?.height ?? 0;

    const acima = anchor.top - height - GAP;
    const top = acima >= GAP ? acima : anchor.bottom + GAP;

    // Centrado no gatilho, mas nunca para fora da janela.
    const centrado = anchor.left + anchor.width / 2 - width / 2;
    const left = Math.min(Math.max(GAP, centrado), window.innerWidth - width - GAP);

    setCoords({ top, left });
  }, [anchorTo]);

  /**
   * Rolar move o gatilho e o painel ficaria solto no ar; em `fixed` ele não
   * acompanha. Fechar é mais honesto do que reposicionar a cada quadro.
   */
  useEffect(() => {
    if (!anchorTo) return;

    window.addEventListener('scroll', onClose, true);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('scroll', onClose, true);
      window.removeEventListener('resize', onClose);
    };
  }, [anchorTo, onClose]);

  const panel = (
    <div
      className={`emoji-picker${anchorTo ? ' emoji-picker--floating' : ''}`}
      ref={ref}
      role='dialog'
      aria-label='Escolher emoji'
      style={
        anchorTo
          ? // Enquanto não mediu, fica invisível: sem isto o painel pisca no
            // canto antes de assumir a posição certa.
            { top: coords?.top ?? 0, left: coords?.left ?? 0, visibility: coords ? 'visible' : 'hidden' }
          : undefined
      }
    >
      <Picker
        data={data}
        // Rótulos e categorias em português; a busca casa pelos dois idiomas.
        i18n={ptBR}
        // Acompanha o tema do app: o painel claro sobre a tela escura seria um
        // retângulo branco no meio da conversa.
        theme={theme}
        // A prévia ocupa uma faixa inteira só para repetir o emoji sob o
        // cursor — dentro do balão, esse espaço vale mais como emoji.
        previewPosition='none'
        onEmojiSelect={(emoji: { native: string }) => onSelect(emoji.native)}
      />
    </div>
  );

  return anchorTo ? createPortal(panel, document.body) : panel;
}
