import type { MessageType } from '@react-chat/shared';

import { prisma } from '../config/prisma.js';
import * as fts from './fts.js';
import { createdAtRange, type Visibility } from './visibility.js';

/**
 * O filtro de "apagar para mim", no formato do `where` do Prisma.
 *
 * Precisa entrar em tudo que devolve mensagem — historico, janela do `around`,
 * busca, galeria, salvas, previa do card e banner da fixada. Faltando em um so,
 * a mensagem que a pessoa apagou reaparece por ali.
 */
export function notDeletedFor(userId: number) {
  return { deletions: { none: { userId } } };
}

const withSender = {
  sender: { select: { id: true, name: true, image: true } },
  reactions: { select: { userId: true, emoji: true } },
  replyTo: {
    select: {
      id: true,
      text: true,
      deletedAt: true,
      // Sem isto, responder a uma mensagem que so tem anexo mostrava uma
      // citacao vazia: o texto e '' e nao havia mais nada para exibir.
      attachmentUrl: true,
      attachmentName: true,
      attachmentType: true,
      sender: { select: { id: true, name: true } },
    },
  },
} as const;

export interface CreateMessageData {
  chatId: string;
  senderId: number;
  text: string;
  /**
   * "SYSTEM" e o aviso que o grupo produz. Ausente significa "TEXT", que e o
   * default da coluna — mensagem de gente e o caso comum.
   */
  type?: MessageType;
  replyToId?: string;
  attachmentUrl?: string;
  attachmentName?: string;
  attachmentType?: string;
  /**
   * Dimensoes da imagem e a miniatura, medidas no upload. So imagem tem: quem
   * as produz e o sharp, que nao le video (ver config/upload.ts).
   */
  attachmentWidth?: number;
  attachmentHeight?: number;
  attachmentThumbUrl?: string;
  isForwarded?: boolean;
}

/**
 * Grava a mensagem e atualiza o lastReadAt do remetente numa unica transacao.
 * Substitui o read-modify-write em arquivo, que perdia mensagens simultaneas.
 */
export function create(data: CreateMessageData) {
  return prisma.$transaction(async (tx) => {
    const message = await tx.message.create({
      data: {
        chatId: data.chatId,
        senderId: data.senderId,
        text: data.text,
        ...(data.type ? { type: data.type } : {}),
        ...(data.replyToId ? { replyToId: data.replyToId } : {}),
        ...(data.attachmentUrl ? { attachmentUrl: data.attachmentUrl } : {}),
        ...(data.attachmentName ? { attachmentName: data.attachmentName } : {}),
        ...(data.attachmentType ? { attachmentType: data.attachmentType } : {}),
        ...(data.attachmentWidth ? { attachmentWidth: data.attachmentWidth } : {}),
        ...(data.attachmentHeight ? { attachmentHeight: data.attachmentHeight } : {}),
        ...(data.attachmentThumbUrl
          ? { attachmentThumbUrl: data.attachmentThumbUrl }
          : {}),
        ...(data.isForwarded ? { isForwarded: true } : {}),
      },
      include: withSender,
    });

    /*
     * Aviso do grupo nao marca nada como lido.
     *
     * A regra vale para mensagem de gente: quem acabou de escrever obviamente
     * viu a conversa. Um aviso de sistema e efeito colateral de outra acao, e o
     * `senderId` dele e so quem causou o evento.
     *
     * No "saiu do grupo" isso era destrutivo: o autor do aviso e justamente
     * quem esta saindo, entao gravar o lastReadAt dele zerava o nao-lido que
     * ele levaria consigo. E qualquer acao de admin marcaria a conversa inteira
     * como lida para o admin, sem que ele tivesse lido nada.
     */
    if (data.type !== 'SYSTEM') {
      await tx.chatParticipant.updateMany({
        where: { chatId: data.chatId, userId: data.senderId },
        data: { lastReadAt: message.createdAt },
      });
    }

    // Na mesma transacao: e esta coluna que ordena e pagina a lista de
    // conversas, e uma lista ordenada por dado desatualizado seria pior do que
    // nao ter ordenacao nenhuma.
    await tx.chat.update({
      where: { id: data.chatId },
      data: { lastMessageAt: message.createdAt },
    });

    return message;
  });
}

export function findById(id: string) {
  return prisma.message.findUnique({ where: { id }, include: withSender });
}

/** Esta pessoa apagou esta mensagem so para si? */
export async function isDeletedFor(messageId: string, userId: number): Promise<boolean> {
  const found = await prisma.messageDeletion.findUnique({
    where: { messageId_userId: { messageId, userId } },
    select: { id: true },
  });

  return found !== null;
}

/**
 * Tudo o que este usuario escreveu, para a exportacao de dados.
 *
 * So as dele: a conversa dos outros nao e dado dele, e exporta-la seria
 * entregar, num arquivo, o que eles escreveram para ele em particular.
 */
export function listByAuthor(userId: number) {
  return prisma.message.findMany({
    where: { senderId: userId, type: 'TEXT' },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      chatId: true,
      text: true,
      createdAt: true,
      editedAt: true,
      deletedAt: true,
      isForwarded: true,
      attachmentName: true,
      attachmentType: true,
    },
  });
}

/** As reacoes que este usuario deu — tambem dele, e tambem vao no arquivo. */
export function listReactionsBy(userId: number) {
  return prisma.messageReaction.findMany({
    where: { userId },
    orderBy: { createdAt: 'asc' },
    select: { messageId: true, emoji: true, createdAt: true },
  });
}

/**
 * Todo caminho de anexo que alguma mensagem ainda referencia — o original e a
 * miniatura. E a lista do que a varredura de orfaos nao pode apagar.
 */
export async function listAttachmentPaths(): Promise<string[]> {
  const rows = await prisma.message.findMany({
    where: {
      OR: [{ attachmentUrl: { not: null } }, { attachmentThumbUrl: { not: null } }],
    },
    select: { attachmentUrl: true, attachmentThumbUrl: true },
  });

  return rows.flatMap((row) =>
    [row.attachmentUrl, row.attachmentThumbUrl].filter(
      (path): path is string => path !== null,
    ),
  );
}

/**
 * Nome original de um anexo, pelo caminho gravado. So o download de arquivo
 * precisa dele: o disco guarda o nome gerado, e nunca o que o usuario mandou.
 */
export async function findAttachmentName(storedUrl: string): Promise<string | null> {
  const found = await prisma.message.findFirst({
    where: { attachmentUrl: storedUrl },
    select: { attachmentName: true },
  });

  return found?.attachmentName ?? null;
}

export interface PageOptions {
  /** createdAt da mensagem mais antiga ja carregada. */
  before?: Date;
  /**
   * O id dela, que vai junto do `before`.
   *
   * Paginando so pelo instante, duas mensagens criadas no mesmo milissegundo
   * caem do mesmo lado do corte: a pagina seguinte pede "anterior a T" e pula a
   * irma que tambem nasceu em T. A mensagem some da conversa sem ninguem
   * notar. Com o par (createdAt, id) o corte e total, e nao ha empate possivel.
   *
   * Opcional para o cliente antigo, que so manda o instante, continuar lendo.
   */
  beforeId?: string;
  /**
   * O que o participante enxerga. O corte de "excluir" impede que paginar
   * para tras traga de volta o historico escondido; a saida do grupo impede
   * que quem saiu leia o que veio depois.
   */
  visibility: Visibility;
  /** De quem e a visao — para tirar o que ele apagou so para si. */
  userId: number;
}

/**
 * O corte da paginacao pelo par (createdAt, id).
 *
 * `'older'` pega o que vem antes do cursor; `'newer'`, o que vem depois. Vai
 * dentro de um `AND` de proposito: a visibilidade ja ocupa o `createdAt` do
 * `where`, e espalhar os dois no mesmo objeto faria um sobrescrever o outro.
 */
function cursorClause(at: Date, id: string | undefined, side: 'older' | 'newer') {
  if (!id) return side === 'older' ? { createdAt: { lt: at } } : { createdAt: { gt: at } };

  return side === 'older'
    ? { OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: id } }] }
    : { OR: [{ createdAt: { gt: at } }, { createdAt: at, id: { gt: id } }] };
}

/** O mesmo cursor, no sentido oposto — ver listAfter. */
export interface AfterOptions {
  /** createdAt da mensagem mais nova ja carregada. */
  after: Date;
  /** O id dela, pelo mesmo motivo que o beforeId existe. */
  afterId?: string;
  visibility: Visibility;
  userId: number;
}

/** Historico paginado, do mais novo para o mais antigo. */
export async function listPage(
  chatId: string,
  limit: number,
  { before, beforeId, visibility, userId }: PageOptions,
) {
  const rows = await prisma.message.findMany({
    where: {
      chatId,
      ...notDeletedFor(userId),
      ...createdAtRange(visibility),
      ...(before ? { AND: [cursorClause(before, beforeId, 'older')] } : {}),
    },
    // O id desempata o milissegundo repetido — ver PageOptions.beforeId.
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    include: withSender,
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  // Devolve em ordem cronologica, que e como a tela renderiza.
  return { messages: page.reverse(), hasMore };
}

/**
 * A pagina seguinte no sentido do presente — o contrario do listPage.
 *
 * Existe para a volta do salto. Quem pulou ate uma mensagem de semanas atras
 * ficava preso naquele trecho: dava para carregar mais historico para tras, e
 * nao havia caminho nenhum de volta ate o fim da conversa a nao ser fechar e
 * reabrir. O `listAround` ja dizia que sobrava mensagem mais nova
 * (`hasMoreAfter`) e ninguem tinha como pedi-la.
 *
 * O cursor e o mesmo par (createdAt, id) da paginacao para tras, pelo mesmo
 * motivo: duas mensagens do mesmo milissegundo cairiam do mesmo lado do corte.
 */
export async function listAfter(
  chatId: string,
  limit: number,
  { after, afterId, visibility, userId }: AfterOptions,
) {
  const rows = await prisma.message.findMany({
    where: {
      chatId,
      ...notDeletedFor(userId),
      ...createdAtRange(visibility),
      AND: [cursorClause(after, afterId, 'newer')],
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: limit + 1,
    include: withSender,
  });

  const hasMore = rows.length > limit;

  // Ja vem em ordem cronologica: aqui a consulta anda no mesmo sentido em que
  // a tela renderiza, e nao ha o que inverter.
  return { messages: hasMore ? rows.slice(0, limit) : rows, hasMore };
}

/**
 * A janela de historico em volta de uma mensagem.
 *
 * Existe para saltar ate a citada, a fixada, um resultado da busca ou uma
 * salva. Sem ela o cliente so sabia pedir "mais uma pagina para tras" e ia
 * puxando o historico inteiro ate topar com a mensagem — com um teto de cinco
 * paginas, e passado ele a citacao simplesmente nao levava a lugar nenhum.
 *
 * Devolve `radius` de cada lado, e diz se sobrou historico nas duas direcoes.
 */
export async function listAround(
  chatId: string,
  target: { createdAt: Date; id: string },
  radius: number,
  visibility: Visibility,
  userId: number,
) {
  const range = createdAtRange(visibility);
  const mine = notDeletedFor(userId);

  const [older, newer] = await Promise.all([
    prisma.message.findMany({
      where: {
        chatId,
        ...mine,
        ...range,
        AND: [cursorClause(target.createdAt, target.id, 'older')],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: radius + 1,
      include: withSender,
    }),
    prisma.message.findMany({
      where: {
        chatId,
        ...mine,
        ...range,
        AND: [cursorClause(target.createdAt, target.id, 'newer')],
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: radius + 1,
      include: withSender,
    }),
  ]);

  const hasMore = older.length > radius;
  const hasMoreAfter = newer.length > radius;

  return {
    before: older.slice(0, radius).reverse(),
    after: newer.slice(0, radius),
    hasMore,
    hasMoreAfter,
  };
}

/** Teto de resultados da busca dentro de uma conversa. */
export const SEARCH_LIMIT = 50;

/**
 * Busca nas conversas do usuario: a ocorrencia mais relevante de cada uma.
 *
 * Quem escolhe as mensagens e o indice FTS5 (ver fts.ts) — dele vem o
 * casamento sem acento, a velocidade e a relevancia. Aqui so se hidrata o
 * resultado com remetente, reacoes e citacao, que e o formato da tela.
 *
 * A ordem final e por data, e nao por relevancia: a lista mostra uma conversa
 * por linha, e quem procura espera as conversas ativas no topo.
 */
export async function searchForUser(term: string, userId: number) {
  const ids = await fts.bestPerChat(term, userId);
  if (ids.length === 0) return [];

  return prisma.message.findMany({
    where: { id: { in: ids } },
    orderBy: { createdAt: 'desc' },
    include: withSender,
  });
}

/** Busca dentro de uma conversa, em ordem cronologica. */
export async function searchInChat(
  chatId: string,
  term: string,
  visibility: Visibility,
  userId: number,
) {
  const ids = await fts.searchInChat(chatId, term, visibility, SEARCH_LIMIT, userId);
  if (ids.length === 0) return [];

  return prisma.message.findMany({
    where: { id: { in: ids } },
    orderBy: { createdAt: 'asc' },
    include: withSender,
  });
}

/** Teto por aba da galeria: midia, arquivos e links. */
export const GALLERY_LIMIT = 60;

/**
 * Anexos da conversa, do mais novo para o mais antigo.
 *
 * A visibilidade e a mesma do historico: o que "Limpar conversa" escondeu, e
 * o que o grupo mandou depois de o usuario sair, nao reaparecem pela galeria.
 */
export function listAttachments(chatId: string, visibility: Visibility, userId: number) {
  return prisma.message.findMany({
    where: {
      chatId,
      deletedAt: null,
      ...notDeletedFor(userId),
      attachmentUrl: { not: null },
      ...createdAtRange(visibility),
    },
    orderBy: { createdAt: 'desc' },
    // O dobro do teto: a rota ainda separa midia de arquivo, e um so tipo
    // poderia levar a pagina inteira.
    take: GALLERY_LIMIT * 2,
    include: withSender,
  });
}

/**
 * Mensagens que carregam link. O SQLite nao tem regex no Prisma, entao o
 * `contains` filtra o grosso no banco e a extracao fina fica na rota.
 */
export function listWithLinks(chatId: string, visibility: Visibility, userId: number) {
  return prisma.message.findMany({
    where: {
      chatId,
      deletedAt: null,
      ...notDeletedFor(userId),
      // Aviso de grupo nunca carrega link, e a galeria e de conteudo enviado.
      type: 'TEXT',
      text: { contains: 'http' },
      ...createdAtRange(visibility),
    },
    orderBy: { createdAt: 'desc' },
    take: GALLERY_LIMIT,
    include: withSender,
  });
}

/**
 * Grava a reacao da pessoa, trocando a anterior se houver.
 * O upsert apoia-se no unique (messageId, userId): e ele que garante "uma por
 * pessoa", em vez de a rota ler antes e torcer para nao haver corrida.
 */
export function setReaction(messageId: string, userId: number, emoji: string) {
  return prisma.messageReaction.upsert({
    where: { messageId_userId: { messageId, userId } },
    create: { messageId, userId, emoji },
    update: { emoji },
  });
}

export function removeReaction(messageId: string, userId: number) {
  return prisma.messageReaction.deleteMany({ where: { messageId, userId } });
}

export function findReaction(messageId: string, userId: number) {
  return prisma.messageReaction.findUnique({
    where: { messageId_userId: { messageId, userId } },
  });
}

export function edit(id: string, text: string) {
  return prisma.message.update({
    where: { id },
    data: { text, editedAt: new Date() },
    include: withSender,
  });
}

/**
 * "Apagar para mim": a mensagem some da visao de uma pessoa so.
 *
 * Nada e apagado de verdade — o texto e o anexo continuam la para os outros, e
 * o autor nunca fica sabendo. O upsert apoia-se no unique (messageId, userId):
 * apagar duas vezes e inofensivo.
 */
export function deleteForMe(messageId: string, userId: number) {
  return prisma.messageDeletion.upsert({
    where: { messageId_userId: { messageId, userId } },
    create: { messageId, userId },
    update: {},
  });
}

/** Exclusao logica: a mensagem some do conteudo mas nao quebra as respostas. */
export function softDelete(id: string) {
  return prisma.message.update({
    where: { id },
    data: { text: '', deletedAt: new Date(), attachmentUrl: null },
    include: withSender,
  });
}
