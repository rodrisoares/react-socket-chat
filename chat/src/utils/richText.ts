import { splitByTerm } from './highlight';
import { splitLinks } from './linkify';

/**
 * O texto de uma mensagem, quebrado em pedaços prontos para desenhar.
 *
 * Três coisas já disputavam o mesmo texto: os endereços (linkify), as
 * ocorrências da busca (highlight) e agora a formatação e as menções. No balão
 * elas viviam como `map` dentro de `map`, e cada camada nova dobrava o
 * aninhamento — a terceira já sairia ilegível, e a quarta impossível.
 *
 * Aqui elas viram uma passagem só, que devolve uma lista plana. A ordem importa
 * e não é arbitrária:
 *
 * 1. **Endereço** primeiro, porque uma URL pode conter `_` e `*` (é comum em
 *    link da Wikipédia) e interpretá-los como formatação quebraria o link.
 * 2. **Código** logo depois, porque dentro de crase nada mais vale: é o único
 *    jeito de escrever um asterisco literal.
 * 3. **Negrito e itálico** no que sobra.
 * 4. **Menção** e **busca** por último, que são marcações de palavra inteira e
 *    não carregam conteúdo próprio.
 */

export interface RichToken {
  text: string;
  /** Endereço a abrir; ausente em texto comum. */
  href?: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  /** Nome mencionado, sem o `@`. */
  mention?: string;
  /** Ocorrência do termo buscado. */
  isMatch?: boolean;
}

/**
 * Os marcadores, na convenção que os aplicativos de mensagem ensinaram — a
 * mesma do WhatsApp. Markdown de verdade seria pesado demais para um balão, e
 * `**assim**` obrigaria a digitar dois asteriscos por lado no celular.
 */
const MARKS = [
  { char: '`', flag: 'code' },
  { char: '*', flag: 'bold' },
  { char: '_', flag: 'italic' },
] as const;

type Flag = (typeof MARKS)[number]['flag'];

/** O que já está valendo quando se entra num trecho. */
type Flags = Partial<Record<Flag, boolean>>;

/**
 * Um marcador só vale colado no conteúdo e solto do resto.
 *
 * Sem isto, `a_b_c` (nome de variável) viraria itálico, e `2 * 3 * 4` viraria
 * negrito. A regra é a mesma dos aplicativos: o de abertura não pode ter espaço
 * depois, o de fechamento não pode ter espaço antes, e nenhum dos dois pode
 * estar grudado numa letra do lado de fora.
 */
function isWordChar(char: string | undefined): boolean {
  return char !== undefined && /[\p{L}\p{N}]/u.test(char);
}

/** Onde fecha o marcador aberto em `open`, ou -1 se ele nunca fecha. */
function closingIndex(text: string, open: number, char: string): number {
  for (let i = open + 1; i < text.length; i += 1) {
    if (text[i] !== char) continue;
    // Espaço antes do fechamento não fecha nada: "* a *" é texto.
    if (text[i - 1] === ' ') continue;
    if (isWordChar(text[i + 1])) continue;
    // Conteúdo vazio (`**`) não é formatação.
    if (i === open + 1) continue;

    return i;
  }

  return -1;
}

/**
 * Aplica a formatação, recursivamente — negrito dentro de itálico funciona.
 *
 * Dentro de código não: ali o texto é literal, e é justamente isso que permite
 * escrever um asterisco sem ele sumir.
 */
function formatted(text: string, active: Flags): RichToken[] {
  if (!text) return [];

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const mark = MARKS.find((item) => item.char === char);
    if (!mark) continue;

    // Grudado numa letra à esquerda, ou com espaço à direita: não abre nada.
    if (isWordChar(text[i - 1]) || text[i + 1] === ' ' || text[i + 1] === undefined) {
      continue;
    }

    // `mark.char`, e não `char`: são o mesmo caractere, mas o da tupla é um
    // literal de string, enquanto `text[i]` é `string | undefined` sob
    // `noUncheckedIndexedAccess`. E nomeia melhor a intenção — é este marcador
    // que se quer fechar, não um caractere qualquer daquela posição.
    const close = closingIndex(text, i, mark.char);
    if (close === -1) continue;

    const inner = text.slice(i + 1, close);
    const next = { ...active, [mark.flag]: true };

    return [
      ...formatted(text.slice(0, i), active),
      // Código não recebe formatação por dentro: o conteúdo é literal.
      ...(mark.flag === 'code' ? [{ text: inner, ...next }] : formatted(inner, next)),
      ...formatted(text.slice(close + 1), active),
    ];
  }

  return [{ text, ...active }];
}

/**
 * Marca as menções a nomes conhecidos.
 *
 * Recebe os nomes do grupo, e não adivinha: `@` seguido de qualquer palavra
 * marcaria um e-mail no meio do texto. Os nomes vão do mais longo para o mais
 * curto — com "Ana" e "Ana Paula" na mesma conversa, casar o curto primeiro
 * deixaria " Paula" solto fora da menção.
 */
function mentioned(token: RichToken, names: string[]): RichToken[] {
  /*
   * Token vazio não é token.
   *
   * A recursão abaixo continua sobre o que vem depois da menção — e quando ela
   * termina na última letra, esse resto é ''. Sem esta guarda, toda mensagem
   * acabada em menção ganhava um pedaço vazio no fim, que viraria um `<span>`
   * sem conteúdo no balão.
   */
  if (!token.text) return [];
  if (names.length === 0 || token.code || token.href) return [token];

  const ordered = [...names].sort((a, b) => b.length - a.length);
  const parts: RichToken[] = [];
  const { text, ...flags } = token;
  let cursor = 0;

  while (cursor < text.length) {
    const at = text.indexOf('@', cursor);
    if (at === -1) break;

    const rest = text.slice(at + 1);
    const name = ordered.find((item) => rest.toLowerCase().startsWith(item.toLowerCase()));

    if (!name) {
      // Não é menção de ninguém: segue procurando o próximo `@`.
      cursor = at + 1;
      continue;
    }

    if (at > 0) parts.push({ text: text.slice(0, at), ...flags });
    parts.push({ text: `@${text.slice(at + 1, at + 1 + name.length)}`, ...flags, mention: name });

    return [...parts, ...mentioned({ text: text.slice(at + 1 + name.length), ...flags }, names)];
  }

  return [token];
}

/** Quebra o token nas ocorrências da busca, preservando o que ele já era. */
function highlighted(token: RichToken, term: string): RichToken[] {
  if (!term || token.mention) return [token];

  const { text, ...flags } = token;

  return splitByTerm(text, term)
    .filter((part) => part.text)
    .map((part) => (part.isMatch ? { text: part.text, ...flags, isMatch: true } : { text: part.text, ...flags }));
}

export interface RichTextOptions {
  /** Termo da busca, para marcar as ocorrências. */
  term?: string;
  /** Nomes que podem ser mencionados — os membros da conversa. */
  names?: string[];
}

/**
 * O texto pronto para desenhar, numa lista plana.
 *
 * Endereço não recebe formatação nem menção: ele é o pedaço mais frágil do
 * texto, e mexer nele quebraria justamente o que faz um link funcionar.
 */
export function richText(text: string, options: RichTextOptions = {}): RichToken[] {
  if (!text) return [];

  const { term = '', names = [] } = options;

  return splitLinks(text).flatMap((segment) => {
    if (segment.href) return [{ text: segment.text, href: segment.href }];

    return formatted(segment.text, {})
      .flatMap((token) => mentioned(token, names))
      .flatMap((token) => highlighted(token, term));
  });
}
