import { useEffect, useRef } from 'react';

/**
 * Prende o foco dentro de um diálogo, e o devolve ao fechar.
 *
 * O `role="dialog"` e o `aria-modal` já estavam lá, mas eram só a etiqueta: o
 * Tab passava direto para a tela de trás, e quem navega por teclado acabava
 * digitando num campo coberto por um modal que continuava aberto. Fechar
 * tampouco devolvia o foco ao botão que abriu — ele voltava para o começo da
 * página, e a pessoa recomeçava a busca do lugar onde estava.
 *
 * Duas escolhas que não são óbvias:
 *
 * O foco inicial só é tomado quando ninguém dentro do diálogo já o tem. Assim
 * um `autoFocus` continua valendo — o diálogo de confirmação foca a ação
 * principal de propósito, e roubar isso para o "X" seria pior.
 *
 * A lista de focáveis é recalculada a cada Tab, e não guardada na montagem: o
 * conteúdo muda enquanto o diálogo está aberto (a busca filtra a lista, a
 * seleção acrescenta botões), e uma lista velha prenderia o foco em elementos
 * que já saíram.
 */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Os focáveis, sem os que estão escondidos por atributo.
 *
 * O teste de visibilidade é por atributo, e não por layout. O caminho óbvio
 * seria `offsetParent !== null`, e ele mente em dois lugares que importam aqui:
 * num elemento `position: fixed` — que é como um modal se posiciona — ele é
 * nulo de qualquer jeito, e num ambiente sem layout (o jsdom dos testes) ele é
 * nulo para tudo, o que desarmaria a armadilha inteira sem ninguém notar.
 *
 * O que os diálogos deste app de fato escondem, eles escondem com `hidden` ou
 * `aria-hidden` — e o que some por renderização condicional nem chega ao DOM.
 */
function focusables(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => !element.hasAttribute('hidden') && element.ariaHidden !== 'true',
  );
}

export default function useFocusTrap<T extends HTMLElement>() {
  const ref = useRef<T>(null);

  useEffect(() => {
    const container = ref.current;
    if (!container) return;

    const previous = document.activeElement as HTMLElement | null;

    // Sem roubar o `autoFocus` de quem já o declarou.
    if (!container.contains(document.activeElement)) {
      (focusables(container)[0] ?? container).focus();
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Tab' || !container) return;

      const items = focusables(container);
      const first = items[0];
      const last = items.at(-1);

      // Diálogo sem nada focável: o Tab não tem para onde ir, e deixá-lo sair
      // devolveria o problema que este hook existe para resolver.
      if (!first || !last) {
        event.preventDefault();
        return;
      }

      const active = document.activeElement;
      const isInside = container.contains(active);

      if (event.shiftKey && (active === first || !isInside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !isInside)) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown, true);

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      // De volta a quem abriu. O `isConnected` importa: o gatilho pode ter
      // saído da tela junto com a ação — um card removido, por exemplo.
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  return ref;
}
