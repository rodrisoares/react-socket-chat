import { useEffect, useRef } from 'react';

import fetch from 'config/fetchInstance';

/**
 * Ausência automática por inatividade.
 *
 * Sem isto, quem fecha o notebook e vai almoçar continua "Disponível" para todo
 * mundo — e o ponto verde passa a mentir, que é pior do que não haver ponto.
 *
 * Duas escolhas importam aqui:
 *
 * O que vai ao servidor é `isAway`, e **nunca** o `status`. São colunas
 * separadas de propósito: sobrescrever o status apagaria a escolha da pessoa, e
 * quem marcou "Ocupado" antes de sair voltaria "Disponível" sem nunca ter
 * pedido isso. Quem junta os dois é o servidor, ao serializar para os outros
 * (ver `effectiveStatus`).
 *
 * E só as *transições* são enviadas. Um PATCH por movimento de mouse seria uma
 * enxurrada de requisições para dizer a mesma coisa; o que muda de fato é
 * ficar ausente e deixar de estar.
 */

/** Quanto tempo parado até contar como ausente. */
const IDLE_AFTER_MS = 5 * 60 * 1000;

/** O que conta como sinal de vida. */
const ACTIVITY = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

export default function useAutoAway(enabled: boolean): void {
  /** O último estado que o servidor conhece — a guarda contra repetir PATCH. */
  const isAway = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    let timer: number | undefined;

    function announce(next: boolean) {
      if (isAway.current === next) return;

      isAway.current = next;
      // Sem `catch` a falha vira rejeição não tratada no console. E não há o
      // que fazer a respeito: na próxima transição tenta de novo.
      void fetch.patch('/api/me', { isAway: next }).catch(() => {
        // Não deu: desfaz a marca local para a próxima tentativa valer.
        isAway.current = !next;
      });
    }

    function restart() {
      window.clearTimeout(timer);
      announce(false);
      timer = window.setTimeout(() => announce(true), IDLE_AFTER_MS);
    }

    /**
     * Aba escondida não conta como atividade nem como ausência imediata: ela
     * pode estar atrás de outra janela com a pessoa lendo ao lado. O que vale é
     * o relógio, que segue correndo. Voltar para a aba, sim, é sinal de vida.
     */
    function onVisibility() {
      if (document.visibilityState === 'visible') restart();
    }

    for (const event of ACTIVITY) {
      window.addEventListener(event, restart, { passive: true });
    }
    document.addEventListener('visibilitychange', onVisibility);
    restart();

    return () => {
      window.clearTimeout(timer);
      for (const event of ACTIVITY) window.removeEventListener(event, restart);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled]);
}
