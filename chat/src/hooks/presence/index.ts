import { useMemo } from 'react';

import useChatList from 'hooks/chatList';
import { useUiStore } from 'store/ui';

/**
 * Os sinais efêmeros da conversa: quem está digitando e quem já leu.
 *
 * O "quem já leu" tem duas fontes: o que veio com a lista (e sobrevive ao F5)
 * e o que chegou por socket nesta sessão. Por pessoa vale a leitura mais
 * recente das duas — depois de uma recarga, a lista pode trazer uma leitura
 * mais nova que a guardada, e a guardada apagaria o ✓✓.
 */
export default function usePresence() {
  const { chats } = useChatList();
  const typing = useUiStore((state) => state.typing);
  const liveReadBy = useUiStore((state) => state.liveReadBy);

  const readBy = useMemo(() => {
    const merged: Record<string, Record<number, string>> = {};

    for (const chat of chats) merged[chat.id] = { ...chat.readBy };

    for (const [chatId, reads] of Object.entries(liveReadBy)) {
      const target = (merged[chatId] ??= {});

      for (const [userId, readAt] of Object.entries(reads)) {
        const id = Number(userId);
        const known = target[id];
        // ISO do servidor dos dois lados: comparar as strings basta.
        if (!known || readAt > known) target[id] = readAt;
      }
    }

    return merged;
  }, [chats, liveReadBy]);

  return { typing, readBy };
}
