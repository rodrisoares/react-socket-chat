import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

import useTyping from './index';
import type { Chat } from '@react-chat/shared';

const emit = vi.fn<(event: string, payload?: unknown) => void>();

vi.mock('config/socket', () => ({
  socket: {
    emit: (event: string, payload?: unknown) => {
      emit(event, payload);
    },
  },
}));

/**
 * Quem está digitando vem do `usePresence`, que lê o cache das conversas — e
 * esse cache busca sozinho ao montar. Sem o mock, cada render aqui tentaria uma
 * ida à rede que nada neste arquivo espera.
 */
vi.mock('config/fetchInstance', () => ({
  default: {
    get: () => Promise.resolve({ data: { chats: [], nextCursor: null } }),
    post: () => Promise.resolve({ data: {} }),
    patch: () => Promise.resolve({ data: {} }),
    delete: () => Promise.resolve({ data: {} }),
  },
}));

/** Só o que o hook lê da conversa. */
const chat = { id: 'c1', members: [] } as unknown as Chat;

/** Um cliente por teste: o cache de um não atravessa para o seguinte. */
function renderTyping() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

  function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  }

  return renderHook(() => useTyping(chat), { wrapper: Wrapper });
}

function typingEmits(): number {
  return emit.mock.calls.filter(([event]) => event === 'typing').length;
}

describe('useTyping', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    emit.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Era um evento por tecla: dez letras, dez avisos iguais para a sala. */
  it('avisa no maximo a cada 2 s enquanto a pessoa digita', () => {
    const { result } = renderTyping();

    for (let tecla = 0; tecla < 10; tecla += 1) {
      result.current.signal();
      vi.advanceTimersByTime(100);
    }
    expect(typingEmits()).toBe(1);

    // Passados os 2 s, a digitação que continua renova o aviso.
    vi.advanceTimersByTime(1100);
    result.current.signal();
    expect(typingEmits()).toBe(2);
  });

  it('avisa que parou depois de um tempo sem teclas', () => {
    const { result } = renderTyping();

    result.current.signal();
    vi.advanceTimersByTime(1500);

    expect(emit).toHaveBeenLastCalledWith('stop-typing', { chatId: 'c1' });
  });

  it('depois de parar, a proxima tecla avisa de novo na hora', () => {
    const { result } = renderTyping();

    result.current.signal();
    vi.advanceTimersByTime(1500);
    result.current.signal();

    expect(typingEmits()).toBe(2);
  });
});
