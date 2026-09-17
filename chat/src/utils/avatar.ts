/**
 * Estilos do DiceBear usados no app.
 *
 * Pessoa ganha rosto; grupo ganha pictograma de objeto. Um rosto humano
 * representando "Time do Chat" sugere que o grupo é uma pessoa — e na lista,
 * ao lado das conversas diretas, os dois ficavam indistinguíveis.
 */
const STYLE = {
  user: 'avataaars',
  group: 'icons',
} as const;

export type AvatarKind = keyof typeof STYLE;

/**
 * Gera a URL de um avatar determinístico a partir de um texto.
 *
 * Substitui o @faker-js/faker, que era importado só por causa de
 * faker.image.avatar() e custava 459 KB no bundle — 64% do JS.
 */
export function avatarUrlFor(seed: string, kind: AvatarKind = 'user'): string {
  const safeSeed = encodeURIComponent(seed.trim().toLowerCase() || 'react-chat');
  return `https://api.dicebear.com/9.x/${STYLE[kind]}/svg?seed=${safeSeed}`;
}

/**
 * Avatares oferecidos no perfil. Sementes fixas em vez de sorteio: o usuário
 * escolhe uma cara e ela continua a mesma na próxima vez que abrir o diálogo.
 */
export const AVATAR_SEEDS = [
  'aurora',
  'bento',
  'cacau',
  'dante',
  'elis',
  'fabio',
  'gaia',
  'heitor',
  'iris',
  'joana',
  'kaue',
  'lia',
  'miro',
  'nina',
  'olavo',
  'pilar',
] as const;

/**
 * Sementes dos ícones de grupo. Nomes de objeto em vez de nomes de gente: o
 * `seed` vira o rótulo acessível de cada opção no diálogo, então ele precisa
 * descrever o que a pessoa está vendo.
 */
export const GROUP_ICON_SEEDS = [
  'balao',
  'bussola',
  'cafe',
  'camera',
  'coracao',
  'estrela',
  'foguete',
  'folha',
  'globo',
  'lampada',
  'musica',
  'pipa',
  'raio',
  'sino',
  'trofeu',
  'viagem',
] as const;

export interface AvatarOption {
  seed: string;
  url: string;
}

/** Lista pronta para o grid do diálogo de escolha. */
export function avatarOptions(kind: AvatarKind = 'user'): AvatarOption[] {
  const seeds = kind === 'group' ? GROUP_ICON_SEEDS : AVATAR_SEEDS;
  return seeds.map((seed) => ({ seed, url: avatarUrlFor(seed, kind) }));
}
