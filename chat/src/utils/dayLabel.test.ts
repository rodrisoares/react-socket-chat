import { describe, expect, it } from 'vitest';
import {
  cardTimeLabel,
  dayLabel,
  dayMarkers,
  fullDateLabel,
  timeLabel,
} from './dayLabel';

/** "Hoje" fixo para o teste não depender do dia em que roda. */
const hoje = new Date('2026-03-15T12:00:00.000Z');

describe('dayLabel', () => {
  it('chama de "Hoje" o mesmo dia', () => {
    expect(dayLabel('2026-03-15T08:30:00.000Z', hoje)).toBe('Hoje');
  });

  it('chama de "Ontem" o dia anterior', () => {
    expect(dayLabel('2026-03-14T23:00:00.000Z', hoje)).toBe('Ontem');
  });

  it('usa data por extenso para dias mais antigos', () => {
    const label = dayLabel('2026-03-10T10:00:00.000Z', hoje);
    expect(label).not.toBe('Hoje');
    expect(label).not.toBe('Ontem');
    expect(label).toMatch(/mar/i);
  });

  it('atravessa a virada do mes sem quebrar', () => {
    const primeiroDeAbril = new Date('2026-04-01T12:00:00.000Z');
    expect(dayLabel('2026-03-31T20:00:00.000Z', primeiroDeAbril)).toBe('Ontem');
  });

  it('devolve string vazia para data invalida, em vez de "Invalid Date"', () => {
    expect(dayLabel('nao-e-data', hoje)).toBe('');
  });
});

/**
 * A lista de mensagens é virtualizada: os itens são montados fora de ordem e
 * só os visíveis, então o separador de dia não pode depender de quem veio antes
 * na renderização — só da posição na lista.
 */
describe('dayMarkers', () => {
  const hoje = new Date('2026-03-15T12:00:00.000Z');

  it('marca a primeira mensagem de cada dia, e só ela', () => {
    const marcas = dayMarkers(
      [
        '2026-03-13T09:00:00.000Z',
        '2026-03-13T18:00:00.000Z',
        '2026-03-14T08:00:00.000Z',
        '2026-03-15T08:00:00.000Z',
        '2026-03-15T09:00:00.000Z',
      ],
      hoje,
    );

    expect(marcas.map(Boolean)).toEqual([true, false, true, true, false]);
    expect(marcas[2]).toBe('Ontem');
    expect(marcas[3]).toBe('Hoje');
  });

  it('nao marca nada numa lista vazia', () => {
    expect(dayMarkers([], hoje)).toEqual([]);
  });

  it('marca a unica mensagem', () => {
    expect(dayMarkers(['2026-03-15T08:00:00.000Z'], hoje)).toEqual(['Hoje']);
  });
});

/**
 * O horário era formatado no servidor, no fuso dele. Agora sai daqui, no fuso
 * de quem lê — por isso as datas do teste são montadas no fuso local: assim
 * ele passa em qualquer máquina.
 */
describe('timeLabel', () => {
  it('formata a hora no fuso de quem le', () => {
    expect(timeLabel(new Date(2026, 2, 15, 9, 5).toISOString())).toBe('09:05');
  });

  it('usa 24 horas', () => {
    expect(timeLabel(new Date(2026, 2, 15, 21, 30).toISOString())).toBe('21:30');
  });

  it('devolve string vazia para data invalida', () => {
    expect(timeLabel('nao-e-data')).toBe('');
  });
});

/**
 * O card mostrava "HH:mm" para qualquer idade de mensagem. As datas sao
 * montadas no fuso local, como no timeLabel: a formatacao e local, e com ISO em
 * UTC o teste passaria so em algumas maquinas.
 */
describe('cardTimeLabel', () => {
  const hoje = new Date(2026, 2, 15, 12, 0);

  it('mostra a hora quando e do mesmo dia', () => {
    expect(cardTimeLabel(new Date(2026, 2, 15, 9, 5).toISOString(), hoje)).toBe('09:05');
  });

  it('diz "Ontem" no dia anterior, sem hora', () => {
    expect(cardTimeLabel(new Date(2026, 2, 14, 23, 0).toISOString(), hoje)).toBe('Ontem');
  });

  it('usa o dia da semana dentro dos ultimos sete dias', () => {
    const label = cardTimeLabel(new Date(2026, 2, 11, 10, 0).toISOString(), hoje);

    expect(label).toMatch(/feira|sábado|domingo/i);
  });

  it('usa dd/mm para o que passou da semana', () => {
    expect(cardTimeLabel(new Date(2026, 1, 20, 10, 0).toISOString(), hoje)).toBe('20/02');
  });

  it('devolve string vazia para data invalida', () => {
    expect(cardTimeLabel('nao-e-data', hoje)).toBe('');
  });
});

describe('fullDateLabel', () => {
  it('traz a data por extenso com a hora', () => {
    const label = fullDateLabel(new Date(2026, 2, 15, 9, 5).toISOString());

    expect(label).toMatch(/15/);
    expect(label).toMatch(/mar/i);
    expect(label).toContain('09:05');
  });

  it('devolve string vazia para data invalida', () => {
    expect(fullDateLabel('nao-e-data')).toBe('');
  });
});
