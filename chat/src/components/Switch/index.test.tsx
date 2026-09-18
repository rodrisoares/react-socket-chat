import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import Switch from './index';

describe('Switch', () => {
  /**
   * O rotulo e a consequencia sao dois elementos, e nao uma frase so.
   *
   * E o que permite ao CSS empilha-los com tamanhos diferentes. Juntar os dois
   * num texto unico devolveria o sintoma que motivou este componente: tudo na
   * mesma linha, no mesmo tamanho.
   */
  it('separa o rotulo da explicacao', () => {
    const { container } = render(
      <Switch
        checked={false}
        onChange={vi.fn()}
        label='Só administradores enviam'
        hint='Qualquer participante pode escrever no grupo.'
      />,
    );

    expect(container.querySelector('strong')?.textContent).toBe(
      'Só administradores enviam',
    );
    expect(container.querySelector('small')?.textContent).toBe(
      'Qualquer participante pode escrever no grupo.',
    );
  });

  /** Sem explicacao, nao sobra um `<small>` vazio ocupando linha. */
  it('nao desenha a segunda linha sem `hint`', () => {
    const { container } = render(
      <Switch checked={false} onChange={vi.fn()} label='Silenciar' />,
    );

    expect(container.querySelector('small')).toBeNull();
  });

  /** O checkbox por baixo e de verdade: o teclado e o leitor de tela o alcancam. */
  it('e um checkbox alcancavel pelo rotulo', async () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} label='Silenciar' />);

    await userEvent.click(screen.getByRole('checkbox', { name: /Silenciar/ }));

    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('devolve false ao desligar', async () => {
    const onChange = vi.fn();
    render(<Switch checked onChange={onChange} label='Silenciar' />);

    await userEvent.click(screen.getByRole('checkbox'));

    expect(onChange).toHaveBeenCalledWith(false);
  });
});
