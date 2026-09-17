import { describe, expect, it } from 'vitest';

import { lastSeenLabel, presenceLabel } from './lastSeen';

const now = new Date('2026-03-15T18:00:00');

describe('lastSeenLabel', () => {
  it('usa "hoje" para o mesmo dia', () => {
    expect(lastSeenLabel('2026-03-15T09:30:00', now)).toBe(
      'visto por último hoje às 09:30',
    );
  });

  it('usa "ontem" para o dia anterior', () => {
    expect(lastSeenLabel('2026-03-14T23:10:00', now)).toBe(
      'visto por último ontem às 23:10',
    );
  });

  it('usa a data curta para os dias mais antigos', () => {
    expect(lastSeenLabel('2026-03-02T08:05:00', now)).toBe(
      'visto por último em 02/03 às 08:05',
    );
  });

  /** É o que o servidor manda de quem escondeu o campo na privacidade. */
  it('devolve vazio sem data', () => {
    expect(lastSeenLabel(null, now)).toBe('');
    expect(lastSeenLabel(undefined, now)).toBe('');
  });

  it('devolve vazio para data invalida', () => {
    expect(lastSeenLabel('nao e uma data', now)).toBe('');
  });
});

describe('presenceLabel', () => {
  it('online ganha da data', () => {
    expect(presenceLabel(true, '2026-03-15T09:30:00', undefined, now)).toBe('Online');
  });

  /**
   * O ponto do avatar ja pintava de laranja e de cinza; a linha de texto dizia
   * "Online" nos tres estados, contradizendo o proprio ponto ao lado.
   */
  it('online mostra o status escolhido', () => {
    expect(presenceLabel(true, null, 'BUSY', now)).toBe('Ocupado');
    expect(presenceLabel(true, null, 'AWAY', now)).toBe('Ausente');
  });

  /** "Disponivel" continua saindo como "Online": e a palavra esperada. */
  it('disponivel continua sendo "Online"', () => {
    expect(presenceLabel(true, null, 'AVAILABLE', now)).toBe('Online');
  });

  /** Offline ignora o status: quem nao esta aqui nao esta ocupado com nada. */
  it('offline com data mostra o horario, mesmo com status', () => {
    expect(presenceLabel(false, '2026-03-15T09:30:00', 'BUSY', now)).toBe(
      'visto por último hoje às 09:30',
    );
  });

  /** Privacidade desligada: sobra o estado, que não é segredo de ninguém. */
  it('offline sem data cai em "Offline"', () => {
    expect(presenceLabel(false, null, undefined, now)).toBe('Offline');
  });
});
