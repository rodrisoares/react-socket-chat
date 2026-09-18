import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * O estado que não vem do servidor: o que está aberto na tela e os sinais
 * efêmeros do socket.
 *
 * Tudo o que o servidor conhece — conversas, histórico, perfil, favoritos —
 * mora no cache do TanStack Query, com uma chave e uma função de busca. Aqui
 * fica só o que morre junto com a aba, e que antes dividia espaço com os dados
 * do servidor dentro de um provider de 730 linhas.
 */
interface UiState {
  /*
   * A conversa aberta não mora mais aqui: ela é a URL (`/c/:chatId`), lida pelo
   * `useOpenChat` e, fora do React, pelo `currentChatId` — ver utils/chatRoute.
   *
   * Guardá-la aqui *e* no endereço seria duas fontes para o mesmo estado, com
   * sincronização nos dois sentidos: a forma exata do bug que fazia o botão de
   * bloquear decidir o rótulo por uma fonte e o verbo HTTP por outra.
   */
  /**
   * Mensagem a destacar assim que a conversa abrir; null = nenhuma.
   *
   * É o que faz "Abrir na conversa" (nas salvas) e o resultado da busca global
   * levarem até a mensagem, e não só até a conversa. Vale uma vez: quem a lê,
   * zera.
   */
  focusMessageId: string | null;
  /**
   * chatId -> rascunho ainda não enviado.
   *
   * Trocar de conversa descartava o que estava escrito: quem respondia numa
   * conversa, ia conferir algo noutra e voltava, encontrava o campo vazio.
   */
  drafts: Record<string, string>;
  /** chatId -> ids de quem está digitando agora. */
  typing: Record<string, number[]>;
  /** chatId -> { userId: ISO da última leitura } que chegou por socket. */
  liveReadBy: Record<string, Record<number, string>>;
  /**
   * A aba está à frente de quem usa. Mensagem que chega na conversa aberta só
   * conta como lida assim; com a aba escondida ela fica por ler.
   */
  isVisible: boolean;

  /**
   * Pede o salto até uma mensagem. Quem navega até a conversa é o `useOpenChat`
   * — aqui fica só o alvo, que vale uma vez.
   */
  requestFocus: (messageId: string) => void;
  /** Lê e zera o pedido de salto — ele não pode disparar de novo no render seguinte. */
  takeFocusMessage: () => string | null;
  setDraft: (chatId: string, text: string) => void;
  clearDraft: (chatId: string) => void;
  startTyping: (chatId: string, userId: number) => void;
  stopTyping: (chatId: string, userId: number) => void;
  /** Uma queda do socket derruba todo "digitando…" em curso. */
  clearTyping: () => void;
  /**
   * Alguém leu a conversa. O instante vem do servidor: o relógio desta máquina
   * pode estar atrasado, e o ✓✓ ficaria apagado.
   */
  markRead: (chatId: string, userId: number, readAt: string) => void;
  setVisible: (isVisible: boolean) => void;
  /** Sair da conta: nada do que está aqui sobrevive à troca de usuário. */
  reset: () => void;
}

const EMPTY = {
  focusMessageId: null,
  drafts: {},
  typing: {},
  liveReadBy: {},
} satisfies Pick<UiState, 'focusMessageId' | 'drafts' | 'typing' | 'liveReadBy'>;

/**
 * O rascunho sobrevive ao F5; o resto, não.
 *
 * O card da lista promete "Rascunho:" — e a promessa não se sustentava: tudo
 * aqui era memória da aba, então recarregar a página apagava o que estava
 * escrito e o card continuava anunciando um texto que já não existia.
 *
 * Só os rascunhos são gravados. "Digitando…", leitura ao vivo, visibilidade da
 * aba e o alvo do salto são sinais do instante: restaurá-los mostraria alguém
 * digitando uma frase que terminou ontem.
 *
 * O armazenamento pode falhar — janela anônima, dados do site bloqueados —, e
 * aí o `persist` simplesmente não persiste: o app continua funcionando com o
 * comportamento de antes.
 */
export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
  ...EMPTY,
  isVisible: typeof document === 'undefined' || document.visibilityState === 'visible',

  requestFocus: (messageId) => set({ focusMessageId: messageId }),

  takeFocusMessage: () => {
    const { focusMessageId } = get();
    if (focusMessageId !== null) set({ focusMessageId: null });
    return focusMessageId;
  },

  setDraft: (chatId, text) =>
    set((state) => {
      if ((state.drafts[chatId] ?? '') === text) return state;

      // Rascunho vazio não é rascunho: guardá-lo faria o card anunciar
      // "Rascunho:" por uma tecla digitada e apagada.
      if (!text) {
        const { [chatId]: _gone, ...rest } = state.drafts;
        return { drafts: rest };
      }

      return { drafts: { ...state.drafts, [chatId]: text } };
    }),

  clearDraft: (chatId) =>
    set((state) => {
      if (state.drafts[chatId] === undefined) return state;

      const { [chatId]: _gone, ...rest } = state.drafts;
      return { drafts: rest };
    }),

  startTyping: (chatId, userId) =>
    set((state) => {
      const current = state.typing[chatId] ?? [];
      if (current.includes(userId)) return state;

      return { typing: { ...state.typing, [chatId]: [...current, userId] } };
    }),

  stopTyping: (chatId, userId) =>
    set((state) => {
      const current = state.typing[chatId] ?? [];
      if (!current.includes(userId)) return state;

      return {
        typing: { ...state.typing, [chatId]: current.filter((id) => id !== userId) },
      };
    }),

  clearTyping: () => set({ typing: {} }),

  markRead: (chatId, userId, readAt) =>
    set((state) => ({
      liveReadBy: {
        ...state.liveReadBy,
        [chatId]: { ...(state.liveReadBy[chatId] ?? {}), [userId]: readAt },
      },
    })),

      setVisible: (isVisible) => set({ isVisible }),

      reset: () => set({ ...EMPTY }),
    }),
    {
      name: 'react-chat:ui',
      // Só o rascunho atravessa o F5 — ver o comentário acima.
      partialize: (state) => ({ drafts: state.drafts }),
    },
  ),
);

/**
 * Seletores prontos: assinar o store inteiro faria a lista re-renderizar a
 * cada tecla digitada por outra pessoa.
 */
export const useIsVisible = () => useUiStore((state) => state.isVisible);
export const useTypingIn = (chatId: string | undefined) =>
  useUiStore((state) => (chatId ? (state.typing[chatId] ?? EMPTY_IDS) : EMPTY_IDS));
export const useDrafts = () => useUiStore((state) => state.drafts);

/** Uma referência só para "ninguém digitando": um `[]` novo re-renderizaria sempre. */
const EMPTY_IDS: number[] = [];
