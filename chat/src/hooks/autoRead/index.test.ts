import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { Chat } from '@react-chat/shared';

import { useUiStore } from 'store/ui';
import useAutoRead from './index';

/**
 * A conversa, so com o que a decisao le.
 *
 * Parcial de proposito: montar um `Chat` inteiro esconderia atras de vinte
 * linhas de preenchimento os dois campos que o hook de fato consulta.
 */
function chatWith(unreadMessages: number, id = 'chat-1'): Chat {
  return { id, unreadMessages } as Chat;
}

beforeEach(() => {
  // O store e real: zustand deixa escrever direto, e assim o teste exercita a
  // mesma leitura de visibilidade que a tela faz, sem mock nenhum.
  useUiStore.setState({ isVisible: true });
});

describe('useAutoRead', () => {
  it('marca como lida ao abrir conversa com pendentes', () => {
    const mark = vi.fn();

    renderHook(() => useAutoRead(chatWith(3), mark));

    expect(mark).toHaveBeenCalledWith('chat-1');
  });

  it('nao marca conversa sem pendentes', () => {
    const mark = vi.fn();

    renderHook(() => useAutoRead(chatWith(0), mark));

    expect(mark).not.toHaveBeenCalled();
  });

  /**
   * A aba atras nao conta como leitura: a mensagem chega, o contador sobe, e
   * ninguem olhou nada. E a mesma regra que o socket aplica.
   */
  it('nao marca com a aba atras', () => {
    useUiStore.setState({ isVisible: false });
    const mark = vi.fn();

    renderHook(() => useAutoRead(chatWith(3), mark));

    expect(mark).not.toHaveBeenCalled();
  });

  it('marca ao voltar para a aba', () => {
    useUiStore.setState({ isVisible: false });
    const mark = vi.fn();

    renderHook(() => useAutoRead(chatWith(3), mark));
    expect(mark).not.toHaveBeenCalled();

    act(() => {
      useUiStore.setState({ isVisible: true });
    });

    expect(mark).toHaveBeenCalledWith('chat-1');
  });

  /**
   * O laco que quase entrou.
   *
   * Com o contador no array de dependencias, um POST que falha faz o `onError`
   * restaurar o numero anterior — e o efeito dispara de novo, e de novo. Um
   * blip de rede viraria uma enxurrada de requisicoes.
   *
   * Aqui o rerender simula exatamente isso: mesma conversa, mesma aba, contador
   * diferente. Nada pode sair de novo.
   */
  it('nao repete quando so o contador muda', () => {
    const mark = vi.fn();

    const { rerender } = renderHook(({ chat }) => useAutoRead(chat, mark), {
      initialProps: { chat: chatWith(3) },
    });
    expect(mark).toHaveBeenCalledTimes(1);

    rerender({ chat: chatWith(5) });

    expect(mark).toHaveBeenCalledTimes(1);
  });

  /** Trocar de conversa, sim, e gatilho novo. */
  it('marca a conversa seguinte ao trocar', () => {
    const mark = vi.fn();

    const { rerender } = renderHook(({ chat }) => useAutoRead(chat, mark), {
      initialProps: { chat: chatWith(3) },
    });

    rerender({ chat: chatWith(2, 'chat-2') });

    expect(mark).toHaveBeenNthCalledWith(1, 'chat-1');
    expect(mark).toHaveBeenNthCalledWith(2, 'chat-2');
  });
});
