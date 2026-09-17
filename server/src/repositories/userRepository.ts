import { randomUUID } from 'node:crypto';

import { prisma } from '../config/prisma.js';

/**
 * Projecao segura: nunca inclui o passwordHash.
 *
 * Quem converte estas linhas para o formato da API — e tira o que os outros
 * nao podem ver — e o `mappers.ts`.
 */
export const publicUserSelect = {
  id: true,
  name: true,
  email: true,
  image: true,
  bio: true,
  status: true,
  statusText: true,
  isAway: true,
  isOnline: true,
  lastSeenAt: true,
  showLastSeen: true,
  showReadReceipts: true,
} as const;

/**
 * O usuario manda recibo de leitura? Consulta enxuta de proposito: roda em
 * toda marcacao de leitura, que acontece a cada conversa aberta.
 */
export async function sendsReadReceipts(id: number): Promise<boolean> {
  const found = await prisma.user.findUnique({
    where: { id },
    select: { showReadReceipts: true },
  });

  return found?.showReadReceipts ?? false;
}

export function findById(id: number) {
  return prisma.user.findUnique({ where: { id }, select: publicUserSelect });
}

/** Inclui o passwordHash: use apenas para conferir a senha no login. */
export function findByEmailWithHash(email: string) {
  return prisma.user.findUnique({ where: { email } });
}

export function findByEmail(email: string) {
  return prisma.user.findUnique({ where: { email }, select: publicUserSelect });
}

/**
 * Contatos, filtrados no banco e com teto.
 *
 * Antes era `listOthers`: devolvia todo usuario cadastrado, de uma vez. Com
 * cem contas ja eram cem perfis em cada abertura do "nova conversa", e a tela
 * nao tinha nem campo de busca — a pessoa rolava a lista inteira procurando um
 * nome.
 *
 * O `contains` do SQLite vira LIKE, que ignora maiuscula e minuscula no ASCII
 * mas nao ignora acento: procurar "jose" nao acha "José". A busca de mensagens
 * resolve isso com o indice FTS; aqui, com nomes curtos e teto de pagina, nao
 * vale uma tabela virtual so para contatos.
 */
export function searchOthers(userId: number, term: string, limit: number) {
  const trimmed = term.trim();

  return prisma.user.findMany({
    where: {
      id: { not: userId },
      // Conta excluida nao e oferecida para comecar conversa nova: ela existe
      // so para as conversas antigas continuarem legiveis.
      deletedAt: null,
      ...(trimmed
        ? {
            OR: [{ name: { contains: trimmed } }, { email: { contains: trimmed } }],
          }
        : {}),
    },
    // Alfabetica: sem ordem explicita o banco devolve o que for mais barato, e
    // a lista mudava de ordem entre duas aberturas iguais.
    orderBy: { name: 'asc' },
    take: limit,
    select: publicUserSelect,
  });
}

/**
 * As fotos de perfil que sao arquivo deste servidor.
 *
 * O avatar do DiceBear e URL de terceiro e nao ocupa disco nenhum; o que a
 * varredura de orfaos precisa saber e quais arquivos de uploads/ ainda sao a
 * foto de alguem.
 */
export async function listUploadedImages(): Promise<string[]> {
  const rows = await prisma.user.findMany({
    where: { image: { startsWith: '/uploads/' } },
    select: { image: true },
  });

  return rows.map((row) => row.image).filter((image): image is string => image !== null);
}

export function create(data: {
  name: string;
  email: string;
  passwordHash: string;
  image?: string;
}) {
  return prisma.user.create({ data, select: publicUserSelect });
}

export function updateProfile(
  id: number,
  data: {
    name?: string;
    image?: string | null;
    bio?: string | null;
    status?: string;
    statusText?: string | null;
    /** Ausencia automatica: coluna propria, nunca sobrescreve o `status`. */
    isAway?: boolean;
    showLastSeen?: boolean;
    showReadReceipts?: boolean;
    passwordHash?: string;
  },
) {
  return prisma.user.update({ where: { id }, data, select: publicUserSelect });
}

export function findByIdWithHash(id: number) {
  return prisma.user.findUnique({ where: { id } });
}

/** Como uma conta excluida se apresenta para quem ficou nas conversas. */
export const DELETED_USER_NAME = 'Usuário excluído';

/**
 * Raspa a conta: o dado pessoal sai, a linha fica.
 *
 * Fica porque o `senderId` de toda mensagem aponta para ca com `onDelete:
 * Cascade` — apagar levaria junto tudo o que a pessoa escreveu, e o grupo de
 * que ela participou ficaria com metade do dialogo: perguntas sem resposta na
 * conversa de outras pessoas, que nao pediram nada disso.
 *
 * O e-mail vira um endereco morto em vez de nulo porque a coluna e unica e
 * obrigatoria; `.invalid` e o dominio que a RFC 2606 reserva justamente para
 * nunca existir. A senha vira um hash de valor aleatorio: nao ha o que
 * adivinhar, e nenhum login chega ate a comparacao de todo modo — o `deletedAt`
 * o barra antes.
 */
export function anonymize(id: number, passwordHash: string) {
  return prisma.user.update({
    where: { id },
    data: {
      name: DELETED_USER_NAME,
      email: `excluido-${String(id)}-${randomUUID()}@removed.invalid`,
      passwordHash,
      image: null,
      bio: null,
      statusText: null,
      status: 'AVAILABLE',
      isAway: false,
      isOnline: false,
      lastSeenAt: null,
      // Ninguem mais precisa saber quando esta conta esteve online, e ela nao
      // le mais nada: os dois interruptores de privacidade fecham.
      showLastSeen: false,
      showReadReceipts: false,
      deletedAt: new Date(),
    },
    select: publicUserSelect,
  });
}

/**
 * Zera a presenca de todo mundo. O isOnline e escrito no connect e no
 * disconnect do socket; se o processo cai, ninguem emite o disconnect e os
 * usuarios ficam "online" para sempre. Roda uma vez, na subida do servidor.
 *
 * Grava o lastSeenAt junto, e so de quem estava marcado como online: sem isto,
 * qualquer reinicializacao deixava todo mundo offline e sem horario nenhum, e o
 * "visto por ultimo" mostrava "Offline" para sempre — era o que parecia um bug
 * na tela de detalhes do contato.
 *
 * O instante e aproximado de proposito: de uma queda suja nao ha como saber
 * quando a pessoa de fato saiu, e "agora" erra menos do que nao dizer nada.
 * Quem ja estava offline nao e tocado, para nao perder o horario verdadeiro.
 */
export function setAllOffline() {
  return prisma.user.updateMany({
    where: { isOnline: true },
    data: { isOnline: false, lastSeenAt: new Date() },
  });
}

/**
 * Presenca do socket. Sair grava o instante: e dele que sai o "visto por
 * ultimo". Entrar nao limpa o campo — quem esta online nao mostra o horario,
 * mas ao desconectar de novo ele e sobrescrito.
 */
export function setOnline(id: number, isOnline: boolean) {
  return prisma.user.update({
    where: { id },
    data: { isOnline, ...(isOnline ? {} : { lastSeenAt: new Date() }) },
    select: publicUserSelect,
  });
}
