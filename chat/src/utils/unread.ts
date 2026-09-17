import type { Chat } from '@react-chat/shared';

/**
 * Quantas mensagens por ler a tela anuncia.
 *
 * Havia duas contas diferentes rodando ao mesmo tempo: o badge do rail e o
 * título da aba somavam tudo; o cabeçalho da lista tirava as arquivadas. Os dois
 * números apareciam juntos na mesma tela, discordando um do outro.
 *
 * Fora as arquivadas, saem também as silenciadas: silenciar é pedir para não ser
 * chamado, e um badge piscando é exatamente uma chamada — é o que o WhatsApp
 * faz. O contador dentro do card continua aparecendo, que é onde ele é
 * procurado de propósito.
 */
export function unreadTotal(chats: Chat[]): number {
  return chats.reduce(
    (total, chat) =>
      chat.isArchived || chat.isMuted ? total : total + chat.unreadMessages,
    0,
  );
}
