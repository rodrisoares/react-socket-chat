/**
 * A regra do que conta como menção, num lugar só.
 *
 * Ela nasceu dentro do envio de mensagem, para decidir quem notificar mesmo com
 * a conversa silenciada. Ao ganhar um segundo consumidor — a prévia do card,
 * que precisa dizer "Fulano mencionou você" — virou função própria: duas cópias
 * da mesma regra divergem na primeira mudança, e aí a notificação e o rótulo
 * passariam a discordar sobre a mesma mensagem.
 *
 * Mora no pacote compartilhado, e não no servidor, porque é contrato: o cliente
 * precisa poder aplicar exatamente o mesmo critério no dia em que quiser marcar
 * algo sem ida ao servidor.
 */

/**
 * O texto menciona esta pessoa?
 *
 * Substring simples, e generoso de propósito. Errar para mais avisa alguém que
 * não foi chamado — chato; errar para menos engole um chamado — que é o dano
 * que a funcionalidade existe para evitar.
 *
 * Sem acento nem fronteira de palavra: `@Ana` casa dentro de `@Ana Paula`, e é
 * assim que se quer para notificar. Quem precisa da fronteira exata é o
 * destaque visual, que resolve isso à parte escolhendo o nome mais longo
 * primeiro (ver `richText` no cliente).
 */
export function mentionsName(text: string, name: string): boolean {
  if (!text || !name) return false;
  return text.toLowerCase().includes(`@${name.toLowerCase()}`);
}
