import { prisma } from '../config/prisma.js';

/**
 * Favoritos — as mensagens que alguem salvou.
 *
 * Privado de quem salvou, como o bloqueio e o silenciar: o autor da mensagem
 * nunca fica sabendo. Por isso nada aqui emite evento de socket.
 */

const withSender = {
  sender: { select: { id: true, name: true, image: true } },
  reactions: { select: { userId: true, emoji: true } },
  replyTo: {
    select: {
      id: true,
      text: true,
      deletedAt: true,
      attachmentUrl: true,
      attachmentName: true,
      attachmentType: true,
      sender: { select: { id: true, name: true } },
    },
  },
} as const;

/**
 * Salva. O upsert apoia-se no unique (userId, messageId): salvar duas vezes e
 * inofensivo, em vez de estourar por conflito.
 */
export function save(userId: number, messageId: string) {
  return prisma.savedMessage.upsert({
    where: { userId_messageId: { userId, messageId } },
    create: { userId, messageId },
    update: {},
  });
}

export function unsave(userId: number, messageId: string) {
  return prisma.savedMessage.deleteMany({ where: { userId, messageId } });
}

/**
 * Ids do que o usuario salvou. A tela precisa deles para acender a estrela em
 * cada mensagem; o conteudo so e buscado quando a lista de salvas abre.
 */
export async function listIds(userId: number): Promise<string[]> {
  const rows = await prisma.savedMessage.findMany({
    where: { userId },
    select: { messageId: true },
  });

  return rows.map((row) => row.messageId);
}

/**
 * As mensagens salvas, com a conversa de cada uma.
 *
 * Filtra pelo que o usuario ainda pode ver: saiu do grupo e excluiu, ou limpou
 * o historico, e o favorito nao pode ser a porta dos fundos para o que foi
 * escondido. A conversa apagada leva o favorito junto (cascade no banco).
 */
export function listSaved(userId: number, limit: number) {
  return prisma.savedMessage.findMany({
    where: {
      userId,
      message: {
        deletedAt: null,
        // "Apagar para mim" tambem vale aqui: salvar antes nao pode ser a porta
        // dos fundos para o que a pessoa depois escolheu nao ver mais.
        deletions: { none: { userId } },
        chat: {
          participants: {
            some: {
              userId,
              // O corte privado entra na comparacao abaixo, ja em JS: o Prisma
              // nao compara duas colunas da mesma linha.
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      message: {
        include: {
          ...withSender,
          chat: {
            select: {
              id: true,
              type: true,
              name: true,
              participants: {
                where: { userId },
                // O leftAt entra no corte: saiu do grupo, o favorito de algo
                // escrito depois da saida nao pode aparecer.
                select: { clearedAt: true, hiddenAt: true, leftAt: true },
              },
            },
          },
        },
      },
    },
  });
}
