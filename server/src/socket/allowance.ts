/**
 * Um balde de fichas, para limitar evento de socket.
 *
 * As rotas HTTP têm o `express-rate-limit`; o socket não tinha nada. O
 * "digitando…" chegava sem freio nenhum, e cada aviso é um broadcast para toda
 * a conversa — um cliente escrito à mão podia multiplicar uma mensagem sua em
 * milhares de entregas alheias.
 *
 * Balde, e não contador por janela, porque a digitação é irregular por
 * natureza: quem escreve uma frase longa dispara uma rajada curta e depois
 * silencia. Um contador com corte seco puniria a rajada legítima; o balde
 * deixa a rajada passar enquanto a média se mantiver.
 *
 * Vive por conexão e morre com ela. Sem estado compartilhado de propósito:
 * abrir cem conexões para contornar o limite já é outro problema, e é o
 * handshake que o resolve.
 */

/** Fichas do balde cheio — o tamanho da rajada que passa de uma vez. */
export const TYPING_BURST = 20;

/** Em quanto tempo o balde se enche do zero. */
export const TYPING_WINDOW_MS = 10_000;

export interface Allowance {
  /** Gasta uma ficha. `false` quando não havia nenhuma. */
  take: () => boolean;
}

/**
 * O relógio entra por parâmetro para o teste não precisar esperar dez
 * segundos de verdade.
 */
export function allowance(
  burst: number = TYPING_BURST,
  windowMs: number = TYPING_WINDOW_MS,
  now: () => number = Date.now,
): Allowance {
  let tokens = burst;
  let last = now();

  return {
    take(): boolean {
      const current = now();

      // Repõe proporcionalmente ao tempo passado, sem passar do balde cheio.
      tokens = Math.min(burst, tokens + ((current - last) * burst) / windowMs);
      last = current;

      if (tokens < 1) return false;

      tokens -= 1;
      return true;
    },
  };
}
