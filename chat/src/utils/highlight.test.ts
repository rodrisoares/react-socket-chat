import { describe, expect, it } from 'vitest';

import { splitByTerm } from './highlight';

describe('splitByTerm', () => {
  it('marca a ocorrencia no meio do texto', () => {
    expect(splitByTerm('subi o deploy hoje', 'deploy')).toEqual([
      { text: 'subi o ', isMatch: false },
      { text: 'deploy', isMatch: true },
      { text: ' hoje', isMatch: false },
    ]);
  });

  it('marca todas as ocorrencias', () => {
    const parts = splitByTerm('deploy e mais deploy', 'deploy');
    expect(parts.filter((part) => part.isMatch)).toHaveLength(2);
  });

  /** O LIKE do SQLite ignora maiusculas; o destaque precisa acompanhar. */
  it('ignora maiusculas e preserva o texto original', () => {
    expect(splitByTerm('Deploy pronto', 'deploy')).toEqual([
      { text: 'Deploy', isMatch: true },
      { text: ' pronto', isMatch: false },
    ]);
  });

  it('devolve o texto inteiro sem termo', () => {
    expect(splitByTerm('qualquer coisa', '')).toEqual([
      { text: 'qualquer coisa', isMatch: false },
    ]);
  });

  it('devolve o texto inteiro quando nada casa', () => {
    expect(splitByTerm('qualquer coisa', 'nada')).toEqual([
      { text: 'qualquer coisa', isMatch: false },
    ]);
  });

  it('aguenta ocorrencia no comeco e no fim', () => {
    expect(splitByTerm('aba', 'a')).toEqual([
      { text: 'a', isMatch: true },
      { text: 'b', isMatch: false },
      { text: 'a', isMatch: true },
    ]);
  });
});
