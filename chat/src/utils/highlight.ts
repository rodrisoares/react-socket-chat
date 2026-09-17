/** Um pedaço do texto, marcado ou não como ocorrência da busca. */
export interface TextPart {
  text: string;
  isMatch: boolean;
}

/**
 * Quebra o texto nas ocorrências do termo, preservando o original.
 *
 * Ignora maiúsculas, como o `LIKE` do SQLite que faz a busca no servidor —
 * destacar só o que casa exatamente mostraria resultado sem nada marcado.
 * Acentos continuam sensíveis, também como no servidor.
 */
export function splitByTerm(text: string, term: string): TextPart[] {
  const needle = term.trim().toLowerCase();
  if (!needle || !text) return [{ text, isMatch: false }];

  const parts: TextPart[] = [];
  const haystack = text.toLowerCase();
  let cursor = 0;

  for (;;) {
    const found = haystack.indexOf(needle, cursor);
    if (found === -1) break;

    if (found > cursor) parts.push({ text: text.slice(cursor, found), isMatch: false });
    parts.push({ text: text.slice(found, found + needle.length), isMatch: true });
    cursor = found + needle.length;
  }

  if (cursor < text.length) parts.push({ text: text.slice(cursor), isMatch: false });
  return parts;
}
