import { describe, expect, it } from 'vitest';

import { richText } from './richText';

/** Só o texto e o que ele carrega — o formato cheio polui a comparação. */
function shape(text: string, options?: Parameters<typeof richText>[1]) {
  return richText(text, options).map((token) => ({
    text: token.text,
    ...(token.href ? { href: token.href } : {}),
    ...(token.bold ? { bold: true } : {}),
    ...(token.italic ? { italic: true } : {}),
    ...(token.code ? { code: true } : {}),
    ...(token.mention ? { mention: token.mention } : {}),
    ...(token.isMatch ? { isMatch: true } : {}),
  }));
}

describe('richText · formatação', () => {
  it('marca negrito, italico e codigo', () => {
    expect(shape('um *forte* e um _fraco_ e um `x = 1`')).toEqual([
      { text: 'um ' },
      { text: 'forte', bold: true },
      { text: ' e um ' },
      { text: 'fraco', italic: true },
      { text: ' e um ' },
      { text: 'x = 1', code: true },
    ]);
  });

  /**
   * O caso que obriga a regra de fronteira a existir: nome de variavel e
   * multiplicacao sao texto comum, e virariam formatacao sem ela.
   */
  it('nao formata marcador grudado em letra nem solto no meio da frase', () => {
    expect(shape('a_b_c')).toEqual([{ text: 'a_b_c' }]);
    expect(shape('2 * 3 * 4')).toEqual([{ text: '2 * 3 * 4' }]);
  });

  it('nao formata marcador que nunca fecha', () => {
    expect(shape('um *aberto e nada mais')).toEqual([{ text: 'um *aberto e nada mais' }]);
  });

  it('aninha negrito dentro de italico', () => {
    expect(shape('_todo *ele* assim_')).toEqual([
      { text: 'todo ', italic: true },
      { text: 'ele', bold: true, italic: true },
      { text: ' assim', italic: true },
    ]);
  });

  /** Dentro de crase o texto e literal: e o unico jeito de escrever um `*`. */
  it('nao formata por dentro do codigo', () => {
    expect(shape('use `a *b* c` aqui')).toEqual([
      { text: 'use ' },
      { text: 'a *b* c', code: true },
      { text: ' aqui' },
    ]);
  });
});

describe('richText · endereços', () => {
  it('mantem o link inteiro e nao o formata', () => {
    // O `_` do endereco tem de sobreviver: interpretá-lo quebraria o link.
    expect(shape('veja https://x.test/a_b_c agora')).toEqual([
      { text: 'veja ' },
      { text: 'https://x.test/a_b_c', href: 'https://x.test/a_b_c' },
      { text: ' agora' },
    ]);
  });
});

describe('richText · menções', () => {
  const names = ['Ana', 'Ana Paula'];

  it('marca a mencao a quem esta na conversa', () => {
    expect(shape('oi @Ana tudo bem', { names })).toEqual([
      { text: 'oi ' },
      { text: '@Ana', mention: 'Ana' },
      { text: ' tudo bem' },
    ]);
  });

  /**
   * Com "Ana" e "Ana Paula" na mesma conversa, casar o nome curto primeiro
   * deixaria " Paula" solto fora da mencao.
   */
  it('prefere o nome mais longo', () => {
    expect(shape('oi @Ana Paula', { names })).toEqual([
      { text: 'oi ' },
      { text: '@Ana Paula', mention: 'Ana Paula' },
    ]);
  });

  /** Sem a lista, `@` seguido de palavra marcaria e-mail no meio do texto. */
  it('ignora arroba de quem nao esta na conversa', () => {
    expect(shape('manda pra joao@email.com', { names })).toEqual([
      { text: 'manda pra joao@email.com' },
    ]);
  });
});

describe('richText · busca', () => {
  it('marca a ocorrencia dentro do texto formatado', () => {
    expect(shape('um *forte* aqui', { term: 'forte' })).toEqual([
      { text: 'um ' },
      { text: 'forte', bold: true, isMatch: true },
      { text: ' aqui' },
    ]);
  });

  it('sem termo nao marca nada', () => {
    expect(shape('um forte aqui')).toEqual([{ text: 'um forte aqui' }]);
  });
});
