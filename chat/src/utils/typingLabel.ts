/**
 * "Fulano está digitando…" sem deixar a linha crescer sem limite.
 *
 * Dois nomes ainda cabem; do terceiro em diante vira "e mais N", como no
 * Telegram — a alternativa seria uma lista que empurra o campo de escrita para
 * fora da tela num grupo grande.
 */
export function typingLabel(names: string[]): string {
  if (names.length === 0) return '';

  const verb = names.length === 1 ? 'está' : 'estão';

  if (names.length === 1) return `${names[0]} ${verb} digitando…`;
  if (names.length === 2) return `${names[0]} e ${names[1]} ${verb} digitando…`;

  return `${names[0]} e mais ${names.length - 1} ${verb} digitando…`;
}

/**
 * Versão curta, para o card da lista.
 *
 * Na conversa direta o nome sai: ele já é o título do card, e repeti-lo na
 * linha de baixo não acrescenta nada. Em grupo ele é a informação toda.
 */
export function typingPreview(names: string[], isGroup: boolean): string {
  if (names.length === 0) return '';
  if (!isGroup) return 'digitando…';
  if (names.length === 1) return `${names[0]} digitando…`;
  return typingLabel(names);
}
