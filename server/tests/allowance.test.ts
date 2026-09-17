import { describe, expect, it } from 'vitest';

import { allowance } from '../src/socket/allowance.js';

/**
 * O freio do "digitando…".
 *
 * Os eventos de socket nao passavam por limite nenhum — o throttle existia so
 * no cliente, e cada aviso e um broadcast para toda a conversa. Testado com um
 * relogio de mentira: o comportamento que importa e o do tempo passando, e
 * esperar dez segundos de verdade tornaria a suite insuportavel.
 */
describe('allowance', () => {
  /** Um relogio que so anda quando o teste manda. */
  function clock(start = 0) {
    let now = start;
    return { now: () => now, advance: (ms: number) => (now += ms) };
  }

  it('deixa passar a rajada inteira do balde', () => {
    const tempo = clock();
    const freio = allowance(5, 1000, tempo.now);

    expect([1, 2, 3, 4, 5].map(() => freio.take())).toEqual([true, true, true, true, true]);
  });

  it('barra o que passa do balde', () => {
    const tempo = clock();
    const freio = allowance(3, 1000, tempo.now);

    freio.take();
    freio.take();
    freio.take();

    expect(freio.take()).toBe(false);
  });

  /** O balde repoe com o tempo: quem esperou volta a poder mandar. */
  it('repoe proporcionalmente ao tempo passado', () => {
    const tempo = clock();
    const freio = allowance(10, 1000, tempo.now);

    for (let i = 0; i < 10; i += 1) freio.take();
    expect(freio.take()).toBe(false);

    // Um decimo da janela repoe uma ficha — e so uma.
    tempo.advance(100);
    expect(freio.take()).toBe(true);
    expect(freio.take()).toBe(false);
  });

  it('nao acumula mais do que o balde cheio', () => {
    const tempo = clock();
    const freio = allowance(2, 1000, tempo.now);

    // Uma hora parado nao compra credito infinito.
    tempo.advance(3_600_000);

    expect(freio.take()).toBe(true);
    expect(freio.take()).toBe(true);
    expect(freio.take()).toBe(false);
  });

  /**
   * O uso normal da tela nao chega perto do limite: ela renova o aviso a cada
   * 2s, e o balde padrao repoe 20 fichas a cada 10s.
   */
  it('nao atrapalha o ritmo que a tela usa', () => {
    const tempo = clock();
    const freio = allowance(20, 10_000, tempo.now);

    // Cinco minutos digitando, um aviso a cada dois segundos.
    for (let i = 0; i < 150; i += 1) {
      expect(freio.take()).toBe(true);
      tempo.advance(2000);
    }
  });
});
