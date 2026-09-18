import { create } from 'zustand';

/**
 * Os avisos passageiros da tela.
 *
 * Os erros eram `<p>` soltos no meio do layout — a conversa tinha três, um
 * embaixo do outro, entre a lista de mensagens e o campo de escrita. Três
 * problemas com isso: eles empurravam o conteúdo ao aparecer, ficavam onde o
 * olho não estava (quem acabou de clicar num botão lá em cima não olha para
 * baixo), e nenhum deles era anunciado por leitor de tela.
 *
 * Como aviso flutuante, eles aparecem sempre no mesmo canto, sozinhos, somem
 * sem ninguém precisar fechar, e a região que os hospeda é `aria-live`.
 *
 * Fora do React de propósito: quem falha costuma ser um hook ou um handler
 * assíncrono, não um componente com acesso a contexto.
 */
export type ToastKind = 'error' | 'info';

export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

interface ToastState {
  toasts: Toast[];
  show: (text: string, kind?: ToastKind) => void;
  dismiss: (id: number) => void;
}

/** Contador simples: dois avisos no mesmo milissegundo precisam de ids diferentes. */
let nextId = 0;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],

  show: (text, kind = 'error') =>
    set((state) => {
      // O mesmo texto duas vezes seguidas é uma repetição, e não dois avisos:
      // clicar de novo no botão que falhou não deve empilhar.
      if (state.toasts.at(-1)?.text === text) return state;

      nextId += 1;
      return { toasts: [...state.toasts, { id: nextId, kind, text }] };
    }),

  dismiss: (id) =>
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}));

/**
 * Mostra um aviso de fora do React.
 *
 * É o que permite um hook de mutação avisar sem devolver estado de erro para o
 * componente só para ele desenhar um parágrafo.
 */
export function showToast(text: string, kind: ToastKind = 'error'): void {
  useToastStore.getState().show(text, kind);
}
