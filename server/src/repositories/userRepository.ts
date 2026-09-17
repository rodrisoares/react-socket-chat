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
