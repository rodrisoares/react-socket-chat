import { useEffect, useRef } from 'react';

/**
 * Pilha do Esc: cada camada aberta — modal, menu, painel, busca, rascunho —
 * empilha o próprio "fechar", e um Esc fecha só a de cima.
 *
 * Antes cada componente ouvia o Esc sozinho no document, sem ordem entre eles.
 * Fechar o perfil, cancelar a renomeação do grupo ou sair da busca fechava a
 * conversa aberta junto — só escapava quem lembrava de parar o evento.
 */
interface Layer {
  close: () => void;
}

const layers: Layer[] = [];
let isListening = false;

function onKeyDown(event: KeyboardEvent): void {
  // Durante a composição (acentos, teclado asiático) o Esc é do editor.
  if (event.key !== 'Escape' || event.isComposing) return;

  const top = layers.at(-1);
  if (!top) return;

  // Na captura, e parando aqui: nenhum outro ouvinte age sobre o mesmo toque.
  event.preventDefault();
  event.stopPropagation();
  top.close();
}

/**
 * Empilha `close` enquanto `isActive` for verdadeiro. A ordem da pilha é a
 * ordem em que as camadas abriram: a última a abrir é a primeira a fechar.
 */
export default function useEscape(close: () => void, isActive = true): void {
  // Ref para a camada chamar sempre o `close` atual sem reempilhar a cada render.
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    if (!isActive) return;

    if (!isListening) {
      document.addEventListener('keydown', onKeyDown, true);
      isListening = true;
    }

    const layer: Layer = { close: () => closeRef.current() };
    layers.push(layer);

    return () => {
      const index = layers.indexOf(layer);
      if (index >= 0) layers.splice(index, 1);
    };
  }, [isActive]);
}
