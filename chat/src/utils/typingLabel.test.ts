import { describe, expect, it } from 'vitest';

import { typingLabel, typingPreview } from './typingLabel';

describe('typingLabel', () => {
  it('nao diz nada sem ninguem digitando', () => {
    expect(typingLabel([])).toBe('');
  });

  it('conjuga no singular com uma pessoa', () => {
    expect(typingLabel(['Marcia'])).toBe('Marcia está digitando…');
  });

  it('lista os dois nomes quando sao dois', () => {
    expect(typingLabel(['Marcia', 'Luiz'])).toBe('Marcia e Luiz estão digitando…');
  });

  /** O corte existe para a linha não empurrar o compositor num grupo grande. */
  it('corta em "e mais N" a partir do terceiro', () => {
    expect(typingLabel(['Marcia', 'Luiz', 'Ana'])).toBe(
      'Marcia e mais 2 estão digitando…',
    );
    expect(typingLabel(['Marcia', 'Luiz', 'Ana', 'Beto'])).toBe(
      'Marcia e mais 3 estão digitando…',
    );
  });
});

describe('typingPreview', () => {
  /** No card da conversa direta o nome já é o título: repeti-lo é ruído. */
  it('omite o nome na conversa direta', () => {
    expect(typingPreview(['Marcia'], false)).toBe('digitando…');
    expect(typingPreview(['Marcia', 'Luiz'], false)).toBe('digitando…');
  });

  it('mostra o nome no grupo', () => {
    expect(typingPreview(['Marcia'], true)).toBe('Marcia digitando…');
  });

  it('usa o texto completo com mais de uma pessoa', () => {
    expect(typingPreview(['Marcia', 'Luiz'], true)).toBe(
      'Marcia e Luiz estão digitando…',
    );
  });

  it('nao diz nada sem ninguem digitando', () => {
    expect(typingPreview([], true)).toBe('');
  });
});
