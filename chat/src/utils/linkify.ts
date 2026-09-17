/** Um pedaço do texto: ou um endereço clicável, ou texto comum. */
export interface TextSegment {
  text: string;
  /** Endereço a abrir, ou null quando o pedaço é texto puro. */
  href: string | null;
}

/**
 * Endereços dentro do texto de uma mensagem.
 *
 * Conservador de propósito: só `http://`, `https://` e `www.`. Sair adivinhando
 * domínio solto ("chama o joao.me") transformaria palavra comum em link, que é
 * pior do que não linkar.
 */
const LINK = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/gi;

/** Pontuação que costuma encostar no fim da frase, e não pertence ao endereço. */
const TRAILING = /[.,;:!?]+$/;

/**
 * Tira do fim o que é pontuação da frase, e não do endereço.
 *
 * "Veja https://exemplo.com." não tem ponto final no link. O parêntese só sai
 * quando não há um de abertura correspondente: uma URL da Wikipédia pode
 * legitimamente terminar em ")".
 */
function trimTrailing(url: string): string {
  let clean = url.replace(TRAILING, '');

  while (
    clean.endsWith(')') &&
    clean.split(')').length > clean.split('(').length
  ) {
    clean = clean.slice(0, -1).replace(TRAILING, '');
  }

  return clean;
}

/** O endereço navegável: `www.x.com` precisa de esquema para virar href. */
function hrefOf(url: string): string {
  return url.toLowerCase().startsWith('www.') ? `https://${url}` : url;
}

/**
 * Quebra o texto em pedaços, marcando os endereços.
 *
 * Os links apareciam só na aba da galeria: dentro do balão eles eram texto
 * morto, e copiar à mão era o único jeito de abrir um.
 */
export function splitLinks(text: string): TextSegment[] {
  if (!text) return [];

  const segments: TextSegment[] = [];
  let cursor = 0;

  for (const match of text.matchAll(LINK)) {
    const start = match.index;
    const raw = match[0];
    if (start === undefined) continue;

    const url = trimTrailing(raw);
    // A pontuação aparada volta para o texto comum, logo depois do link.
    const tail = raw.slice(url.length);

    if (start > cursor) {
      segments.push({ text: text.slice(cursor, start), href: null });
    }

    segments.push({ text: url, href: hrefOf(url) });
    if (tail) segments.push({ text: tail, href: null });

    cursor = start + raw.length;
  }

  if (cursor < text.length) segments.push({ text: text.slice(cursor), href: null });

  return segments;
}
