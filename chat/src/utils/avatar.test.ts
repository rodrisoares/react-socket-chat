import { describe, expect, it } from 'vitest';
import {
  AVATAR_SEEDS,
  GROUP_ICON_SEEDS,
  avatarOptions,
  avatarUrlFor,
} from './avatar';

describe('avatarUrlFor', () => {
  it('gera a mesma URL para o mesmo seed', () => {
    expect(avatarUrlFor('ana@email.com')).toBe(avatarUrlFor('ana@email.com'));
  });

  it('gera URLs diferentes para seeds diferentes', () => {
    expect(avatarUrlFor('ana@email.com')).not.toBe(avatarUrlFor('luiz@email.com'));
  });

  it('ignora caixa e espacos em volta', () => {
    expect(avatarUrlFor('  ANA@Email.com ')).toBe(avatarUrlFor('ana@email.com'));
  });

  it('escapa caracteres especiais na query', () => {
    expect(avatarUrlFor('a b@x.com')).toContain('a%20b%40x.com');
  });

  it('usa um seed padrao quando recebe string vazia', () => {
    expect(avatarUrlFor('   ')).toContain('react-chat');
  });
});

describe('avatarOptions', () => {
  it('devolve uma opcao por seed', () => {
    expect(avatarOptions()).toHaveLength(AVATAR_SEEDS.length);
  });

  it('nao repete URLs entre as opcoes', () => {
    const urls = avatarOptions().map((option) => option.url);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('usa a mesma URL que avatarUrlFor para o seed', () => {
    const [first] = avatarOptions();
    expect(first?.url).toBe(avatarUrlFor(first?.seed ?? ''));
  });
});

/**
 * Pessoa ganha rosto; grupo ganha pictograma. Um rosto humano representando
 * "Time do Chat" sugeria que o grupo era uma pessoa.
 */
describe('avatares de grupo', () => {
  it('usa um estilo diferente do avatar de pessoa', () => {
    expect(avatarUrlFor('cafe', 'group')).not.toBe(avatarUrlFor('cafe', 'user'));
    expect(avatarUrlFor('cafe', 'group')).toContain('/icons/');
    expect(avatarUrlFor('cafe', 'user')).toContain('/avataaars/');
  });

  it('sem o parametro, continua sendo avatar de pessoa', () => {
    expect(avatarUrlFor('cafe')).toBe(avatarUrlFor('cafe', 'user'));
  });

  it('oferece as sementes de icone, e nao as de pessoa', () => {
    const options = avatarOptions('group');
    expect(options).toHaveLength(GROUP_ICON_SEEDS.length);
    expect(options.map((o) => o.seed)).not.toContain(AVATAR_SEEDS[0]);
  });

  it('nao repete URLs entre os icones', () => {
    const urls = avatarOptions('group').map((option) => option.url);
    expect(new Set(urls).size).toBe(urls.length);
  });
});
