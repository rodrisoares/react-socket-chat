import type { Chat, Message } from '@react-chat/shared';

export interface ChatMatch {
  chat: Chat;
  /**
   * Preenchido só quando o filtro casou com uma mensagem, e não com o nome:
   * o card mostra esse trecho no lugar da última.
   */
  matchText?: string;
  /**
   * Id da mensagem que casou. É por ele que clicar no resultado leva até a
   * mensagem, e não apenas até a conversa — antes o clique abria a conversa no
   * fim do histórico e cabia a quem procurou achar de novo, agora rolando.
   */
  matchId?: string;
}

/**
 * Filtra as conversas por nome **ou** por conteúdo.
 *
 * O nome é comparado aqui, porque já está em memória e responde a cada tecla.
 * O conteúdo vem pronto do servidor em `hits` (ver `useChatSearch`): antes esta
 * função varria `chat.messages`, que só continha as últimas 30 carregadas —
 * então "aquela conversa sobre deploy" só era achada se fosse recente.
 */
export default function filterChats(
  chats: Chat[],
  filter: string,
  hits: Record<string, Message> = {},
): ChatMatch[] {
  const needle = filter.trim().toLowerCase();
  if (!needle) return chats.map((chat) => ({ chat }));

  const matches: ChatMatch[] = [];

  for (const chat of chats) {
    if (chat.name.toLowerCase().includes(needle)) {
      matches.push({ chat });
      continue;
    }

    const hit = hits[chat.id];
    if (hit) matches.push({ chat, matchText: hit.text, matchId: hit.id });
  }

  return matches;
}
