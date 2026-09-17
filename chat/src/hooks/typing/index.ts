import { useCallback, useEffect, useMemo, useRef } from 'react';

import { socket } from 'config/socket';
import usePresence from 'hooks/presence';
import { typingLabel } from 'utils/typingLabel';
import type { Chat } from '@react-chat/shared';

/** Silêncio após o qual o "digitando…" é retirado. */
const IDLE_MS = 1500;

/**
 * Intervalo mínimo entre dois avisos de "digitando". Era um evento por tecla;
 * quem recebe mantém o aviso por alguns segundos (ver o provider), então
 * renová-lo de tempos em tempos basta.
 */
const REFRESH_MS = 2000;

/**
 * Sinaliza a digitação e lê quem está digitando na conversa.
 * O evento é efêmero: nunca é persistido nem volta para quem digitou.
 */
export default function useTyping(chat: Chat | null) {
  const { typing } = usePresence();
  const timeout = useRef<number | undefined>(undefined);
  /** Quando o último "digitando" saiu; 0 = nenhum aviso em curso. */
  const lastSent = useRef(0);
  const chatId = chat?.id;

  const signal = useCallback(() => {
    if (!chatId) return;

    const now = Date.now();
    if (now - lastSent.current >= REFRESH_MS) {
      socket.emit('typing', { chatId });
      lastSent.current = now;
    }

    window.clearTimeout(timeout.current);
    timeout.current = window.setTimeout(() => {
      socket.emit('stop-typing', { chatId });
      lastSent.current = 0;
    }, IDLE_MS);
  }, [chatId]);

  /** Avisa que parou — usado ao enviar a mensagem. */
  const stop = useCallback(() => {
    if (!chatId) return;
    window.clearTimeout(timeout.current);
    socket.emit('stop-typing', { chatId });
    lastSent.current = 0;
  }, [chatId]);

  // Sair da conversa (ou desmontar) não pode deixar o aviso preso nos outros.
  useEffect(() => {
    return () => {
      window.clearTimeout(timeout.current);
      lastSent.current = 0;
      if (chatId) socket.emit('stop-typing', { chatId });
    };
  }, [chatId]);

  const names = useMemo(() => {
    const ids = chatId ? (typing[chatId] ?? []) : [];
    return ids
      .map((userId) => chat?.members.find((member) => member.id === userId)?.name)
      .filter((name): name is string => Boolean(name));
  }, [chat, chatId, typing]);

  // O corte em "e mais N" mora no utilitário: o card da lista precisa do
  // mesmo texto, e duas versões da regra divergiriam na primeira mudança.
  const label = useMemo(() => typingLabel(names), [names]);

  return { signal, stop, names, label };
}
