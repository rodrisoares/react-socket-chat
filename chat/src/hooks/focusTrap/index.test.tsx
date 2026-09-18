import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';

import useFocusTrap from './index';

/** Um diálogo mínimo com a armadilha ligada. */
function Dialog({ autoFocusLast = false }: { autoFocusLast?: boolean }) {
  const ref = useFocusTrap<HTMLDivElement>();

  return (
    <div ref={ref} role='dialog' tabIndex={-1}>
      <button type='button'>primeiro</button>
      <button type='button'>meio</button>
      <button type='button' autoFocus={autoFocusLast}>
        ultimo
      </button>
    </div>
  );
}

/** A tela de trás, com o gatilho que abre o diálogo. */
function Screen({ autoFocusLast = false }: { autoFocusLast?: boolean }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button type='button' onClick={() => setIsOpen(true)}>
        abrir
      </button>
      <button type='button'>atras</button>
      {isOpen && (
        <>
          <button type='button' onClick={() => setIsOpen(false)}>
            fechar
          </button>
          <Dialog autoFocusLast={autoFocusLast} />
        </>
      )}
    </>
  );
}

describe('useFocusTrap', () => {
  it('foca o primeiro elemento ao abrir', () => {
    render(<Dialog />);

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'primeiro' }));
  });

  /**
   * O dialogo de confirmacao foca a acao principal de proposito. Roubar esse
   * foco para o "X" seria pior do que nao ter armadilha nenhuma.
   */
  it('respeita um autoFocus ja declarado', () => {
    render(<Dialog autoFocusLast />);

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'ultimo' }));
  });

  /** O Tab no ultimo volta ao primeiro, em vez de sair para a tela de tras. */
  it('circula do ultimo para o primeiro', async () => {
    render(<Dialog autoFocusLast />);

    await userEvent.tab();

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'primeiro' }));
  });

  it('circula do primeiro para o ultimo com Shift+Tab', async () => {
    render(<Dialog />);

    await userEvent.tab({ shift: true });

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'ultimo' }));
  });

  /**
   * O que faltava e ninguem notava: fechar devolvia o foco para o comeco da
   * pagina, e quem navega por teclado recomecava a busca do lugar onde estava.
   */
  it('devolve o foco a quem abriu', async () => {
    render(<Screen />);

    const abrir = screen.getByRole('button', { name: 'abrir' });
    await userEvent.click(abrir);

    // Dentro do dialogo agora.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'primeiro' }));

    await userEvent.click(screen.getByRole('button', { name: 'fechar' }));

    expect(document.activeElement).toBe(abrir);
  });
});
