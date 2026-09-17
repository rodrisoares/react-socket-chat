import { prisma } from '../config/prisma.js';
import { publicUserSelect } from './userRepository.js';

/**
 * Bloqueio entre dois usuarios.
 *
 * Silencioso por decisao de produto: o bloqueado nao e avisado, e as rotas so
 * recusam o envio. Vale para conversa direta; em grupo compartilhado as
 * mensagens dele continuam aparecendo normalmente.
 */
export function block(blockerId: number, blockedId: number) {
  return prisma.block.upsert({
    where: { blockerId_blockedId: { blockerId, blockedId } },
    create: { blockerId, blockedId },
    update: {},
  });
}

export function unblock(blockerId: number, blockedId: number) {
  return prisma.block.deleteMany({ where: { blockerId, blockedId } });
}

/** Quem este usuario bloqueou. Alimenta o `isBlocked` de cada conversa. */
export async function listBlockedBy(blockerId: number): Promise<number[]> {
  const rows = await prisma.block.findMany({
    where: { blockerId },
    select: { blockedId: true },
  });

  return rows.map((row) => row.blockedId);
}

/**
 * Quem este usuario bloqueou, com nome e foto.
 *
 * Existe porque a tela de bloqueados precisa de nomes, e ate agora ela os
 * conseguia cruzando estes ids com a lista de contatos — que so funcionava
 * enquanto `/contacts` devolvia o banco inteiro. Com a busca de contatos
 * paginada, quem foi bloqueado deixaria de aparecer na resposta e sumiria da
 * tela sem nunca ter sido desbloqueado.
 */
export async function listBlockedUsers(blockerId: number) {
  const rows = await prisma.block.findMany({
    where: { blockerId },
    // O mais recente primeiro: e a ordem em que a pessoa se lembra deles.
    orderBy: { createdAt: 'desc' },
    select: { blocked: { select: publicUserSelect } },
  });

  return rows.map((row) => row.blocked);
}

export interface BlockState {
  /** Eu bloqueei a outra pessoa. */
  iBlocked: boolean;
  /** A outra pessoa me bloqueou. */
  blockedMe: boolean;
}

/**
 * Como esta o bloqueio entre os dois, nas duas direcoes.
 *
 * As duas pontas importam e por motivos diferentes: para quem bloqueou, a UI
 * explica o porque; para quem foi bloqueado, a mensagem tem de ser neutra —
 * revelar o bloqueio e justamente o que "silencioso" evita.
 */
export async function stateBetween(
  userId: number,
  otherId: number,
): Promise<BlockState> {
  const rows = await prisma.block.findMany({
    where: {
      OR: [
        { blockerId: userId, blockedId: otherId },
        { blockerId: otherId, blockedId: userId },
      ],
    },
    select: { blockerId: true },
  });

  return {
    iBlocked: rows.some((row) => row.blockerId === userId),
    blockedMe: rows.some((row) => row.blockerId === otherId),
  };
}
