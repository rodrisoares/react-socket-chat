import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import useEscape from './index';

describe('useEscape', () => {
  /** O motivo da pilha: fechar o modal fechava junto a conversa aberta atrás dele. */
  it('fecha so a camada de cima', async () => {
    const conversa = vi.fn();
    const modal = vi.fn();

    renderHook(() => useEscape(conversa));
    const aberto = renderHook(() => useEscape(modal));

    await userEvent.keyboard('{Escape}');
    expect(modal).toHaveBeenCalledTimes(1);
    expect(conversa).not.toHaveBeenCalled();

    // Fechado o modal, o próximo Esc é da conversa.
    aberto.unmount();
    await userEvent.keyboard('{Escape}');
    expect(conversa).toHaveBeenCalledTimes(1);
  });

  it('camada inativa fica fora da pilha', async () => {
    const conversa = vi.fn();
    const menu = vi.fn();

    renderHook(() => useEscape(conversa));
    renderHook(() => useEscape(menu, false));

    await userEvent.keyboard('{Escape}');
    expect(menu).not.toHaveBeenCalled();
    expect(conversa).toHaveBeenCalledTimes(1);
  });

  it('chama sempre o fechar mais recente', async () => {
    const primeiro = vi.fn();
    const segundo = vi.fn();

    const { rerender } = renderHook(({ close }) => useEscape(close), {
      initialProps: { close: primeiro },
    });
    rerender({ close: segundo });

    await userEvent.keyboard('{Escape}');
    expect(segundo).toHaveBeenCalledTimes(1);
    expect(primeiro).not.toHaveBeenCalled();
  });

  it('ignora as outras teclas', async () => {
    const close = vi.fn();
    renderHook(() => useEscape(close));

    await userEvent.keyboard('{Enter}a');
    expect(close).not.toHaveBeenCalled();
  });
});
