import { CHATS_PAGE_SIZE, mentionsName } from '@react-chat/shared';
import type { Chat, ChatPage, Message } from '@react-chat/shared';

import { prisma } from '../config/prisma.js';
import { signedAttachmentUrl } from '../config/attachments.js';
import * as blocks from './blockRepository.js';
import * as messages from './messageRepository.js';
import { lastSeenOf, publicStatusOf } from './mappers.js';
import * as users from './userRepository.js';
import { createdAtRange, isVisible, latest, visibilityOf } from './visibility.js';

const participantUser = {
  select: {
    id: true,
    name: true,
    image: true,
    bio: true,
    status: true,
    statusText: true,
    isAway: true,
    isOnline: true,
    lastSeenAt: true,
    showLastSeen: true,
    showReadReceipts: true,
  },
} as const;

/**
 * O que a previa do card e o banner da fixada carregam de cada mensagem. Fica
 * num lugar so porque a ultima mensagem de quem saiu do grupo vem de outra
 * consulta, e precisa sair no mesmo formato.
 */
const messageInclude = {
  sender: participantUser,
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

interface Cutoff {
  chatId: string;
  lastReadAt: Date | null;
  clearedAt: Date | null;
  leftAt: Date | null;
}

/**
 * Quantas mensagens pendentes cada conversa tem, numa consulta so.
 *
 * Antes o numero saia de contar a pagina de 30 mensagens que vinha junto. Sem
 * a pagina, contar conversa a conversa seria N+1 — entao vai tudo num groupBy
 * com um OR por conversa, cada um com o proprio corte.
 */
async function countPending(
  userId: number,
  participations: Cutoff[],
): Promise<Map<string, number>> {
  const pending = new Map<string, number>();
  if (participations.length === 0) return pending;

  const rows = await prisma.message.groupBy({
    by: ['chatId'],
    where: {
      senderId: { not: userId },
      // Aviso de grupo aparece no historico, mas nao cobra atencao: sem isto,
      // um admin trocando a foto marcaria a conversa como nao lida para todo
      // mundo, com badge vermelho e tudo.
      type: 'TEXT',
      // O que a pessoa apagou so para si tambem nao conta: ela ja decidiu que
      // aquilo nao existe para ela.
      ...messages.notDeletedFor(userId),
      OR: participations.map((participation) => ({
        chatId: participation.chatId,
        // Lida ate aqui, ou limpa ate aqui: vale o corte mais recente. E o que
        // o grupo escreveu depois de o usuario sair nao fica pendente para ele.
        ...createdAtRange({
          after: latest(participation.lastReadAt, participation.clearedAt),
          until: participation.leftAt,
        }),
      })),
    },
    _count: { _all: true },
  });

  for (const row of rows) pending.set(row.chatId, row._count._all);
  return pending;
}

/** Formato que o client consome, tanto para conversa direta quanto para grupo. */
interface SerializableMessage {
  id: string;
  senderId: number;
  text: string;
  /** "TEXT" ou "SYSTEM" — o aviso que o proprio grupo produziu. */
  type: string;
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
  isForwarded: boolean;
  reactions?: { userId: number; emoji: string }[];
  attachmentUrl: string | null;
  attachmentName: string | null;
  attachmentType: string | null;
  /** Opcionais: a previa da citacao nao seleciona estas colunas. */
  attachmentWidth?: number | null;
  attachmentHeight?: number | null;
  attachmentThumbUrl?: string | null;
  replyTo?: {
    id: string;
    text: string;
    deletedAt: Date | null;
    attachmentUrl?: string | null;
    attachmentName?: string | null;
    attachmentType?: string | null;
    sender: { id: number; name: string };
  } | null;
  sender: { id: number; name: string; image: string | null };
}

/**
 * Agrupa as reacoes por emoji, na ordem em que apareceram.
 * A UI mostra o emoji, a contagem e destaca o que a pessoa escolheu — para
 * isso precisa dos ids, nao so do total.
 */
function groupReactions(reactions: { userId: number; emoji: string }[] = []) {
  const byEmoji = new Map<string, number[]>();

  for (const reaction of reactions) {
    const users = byEmoji.get(reaction.emoji);
    if (users) users.push(reaction.userId);
    else byEmoji.set(reaction.emoji, [reaction.userId]);
  }

  return [...byEmoji.entries()].map(([emoji, userIds]) => ({ emoji, userIds }));
}

/**
 * A mensagem no formato da tela — o `Message` do pacote compartilhado, o mesmo
 * tipo que o cliente consome.
 *
 * Sem horario formatado: o instante vai em ISO e quem formata e o client, no
 * fuso de quem esta lendo. Formatado aqui, ele saia no fuso do servidor — num
 * deploy em UTC, tres horas adiantado para quem esta no Brasil.
 */
export function serializeMessage(message: SerializableMessage): Message {
  return {
    id: message.id,
    userId: message.senderId,
    name: message.sender.name,
    // Normalizado em vez de repassado cru: a coluna e texto livre no SQLite, e
    // um valor inesperado viraria um balao sem formato nenhum na tela.
    type: message.type === 'SYSTEM' ? 'SYSTEM' : 'TEXT',
    text: message.deletedAt ? '' : message.text,
    createdAt: message.createdAt.toISOString(),
    isEdited: message.editedAt !== null,
    isDeleted: message.deletedAt !== null,
    isForwarded: message.isForwarded,
    // Mensagem apagada nao carrega reacao: elas somem junto com o conteudo.
    reactions: message.deletedAt ? [] : groupReactions(message.reactions),
    attachment: message.attachmentUrl
      ? {
          // Assinada na serializacao: o banco guarda so o caminho.
          url: signedAttachmentUrl(message.attachmentUrl),
          name: message.attachmentName ?? 'arquivo',
          type: message.attachmentType ?? 'application/octet-stream',
          // As dimensoes vao junto para a tela reservar o espaco antes de a
          // imagem chegar — sem elas o balao empurra a conversa ao carregar.
          // Ausentes em video e no que foi enviado antes desta mudanca.
          ...(message.attachmentWidth ? { width: message.attachmentWidth } : {}),
          ...(message.attachmentHeight ? { height: message.attachmentHeight } : {}),
          ...(message.attachmentThumbUrl
            ? { thumbnailUrl: signedAttachmentUrl(message.attachmentThumbUrl) }
            : {}),
        }
      : null,
    replyTo: message.replyTo
      ? {
          id: message.replyTo.id,
          name: message.replyTo.sender.name,
          text: message.replyTo.deletedAt ? '' : message.replyTo.text,
          isDeleted: message.replyTo.deletedAt !== null,
          // Apagada nao carrega anexo: ele sai junto com o conteudo.
          attachment:
            message.replyTo.attachmentUrl && message.replyTo.deletedAt === null
              ? {
                  url: signedAttachmentUrl(message.replyTo.attachmentUrl),
                  name: message.replyTo.attachmentName ?? 'arquivo',
                  type: message.replyTo.attachmentType ?? 'application/octet-stream',
                }
              : null,
          }
      : null,
  };
}

/**
 * A ultima mensagem que cada conversa deixada mostra para quem saiu dela.
 *
 * O include da lista traz a mais nova de todas, e ali o Prisma nao aplica um
 * corte que muda de linha para linha. Quem saiu costuma ter poucas conversas
 * nesse estado, entao uma consulta por conversa sai barato.
 */
async function lastBeforeLeaving(
  participations: {
    chatId: string;
    clearedAt: Date | null;
    hiddenAt: Date | null;
    leftAt: Date | null;
  }[],
  userId: number,
) {
  const left = participations.filter((participation) => participation.leftAt !== null);

  const found = await Promise.all(
    left.map((participation) =>
      prisma.message.findFirst({
        where: {
          chatId: participation.chatId,
          ...messages.notDeletedFor(userId),
          ...createdAtRange(visibilityOf(participation)),
        },
        orderBy: { createdAt: 'desc' },
        include: messageInclude,
      }),
    ),
  );

  return new Map(
    left.map((participation, index) => [participation.chatId, found[index] ?? null]),
  );
}

/** O instante, sem passar do limite — a leitura dos outros vista por quem saiu. */
function capAt(date: Date, limit: Date | null): Date {
  return limit !== null && date > limit ? limit : date;
}

/**
 * Conversas do usuario, sem o historico: so a ultima mensagem, que e o que o
 * card da lista mostra. Antes vinham as ultimas 30 de cada conversa — com 50
 * conversas, 1500 mensagens a cada recarga da lista, e a lista recarrega a
 * cada chat-created/chat-updated. O historico agora vem de
 * GET /api/chats/:id/messages, quando a conversa e aberta.
 *
 * O nao-lido continua derivado do lastReadAt, nunca de contador denormalizado.
 */
export interface ListOptions {
  limit?: number;
  /** Id da conversa que fechou a pagina anterior. */
  cursor?: string;
  /** So estas conversas, sem paginar — usado para atualizar uma sozinha. */
  only?: string[];
  /**
   * Restringe a estas conversas, **paginando normalmente**.
   *
   * E o que a listagem filtrada usa: quem decide quais conversas casam com o
   * termo e o meService, e aqui elas seguem passando pela mesma ordenacao e
   * pelo mesmo cursor do resto. Diferente do `only`, que devolve tudo de uma
   * vez porque so serve para atualizar uma conversa sozinha.
   */
  ids?: string[];
}

/**
 * As conversas cujo **nome** casa com o termo.
 *
 * Nome de conversa nao mora num lugar so: o do grupo esta na propria conversa,
 * e o da direta e o nome da outra pessoa. Por isso as duas metades do OR.
 *
 * O `contains` do SQLite vira LIKE, que ignora maiuscula no ASCII mas nao
 * ignora acento — procurar "jose" nao acha "José". E a mesma limitacao que a
 * busca de contatos tem; quem resolve acento e o indice FTS, que aqui nao
 * existe porque nome de conversa nao e texto longo.
 */
export async function findIdsByName(userId: number, term: string): Promise<string[]> {
  const rows = await prisma.chatParticipant.findMany({
    where: {
      userId,
      chat: {
        OR: [
          { type: 'GROUP', name: { contains: term } },
          {
            type: 'DIRECT',
            participants: {
              some: { userId: { not: userId }, user: { name: { contains: term } } },
            },
          },
        ],
      },
    },
    select: { chatId: true },
  });

  return rows.map((row) => row.chatId);
}

export async function listForUser(
  userId: number,
  options: ListOptions = {},
): Promise<ChatPage> {
  const limit = Math.min(Math.max(options.limit ?? CHATS_PAGE_SIZE, 1), 100);
  const single = options.only !== undefined;

  const participations = await prisma.chatParticipant.findMany({
    where: {
      userId,
      ...(options.only ? { chatId: { in: options.only } } : {}),
      // O recorte da listagem filtrada. Entra no `where`, e nao depois: assim a
      // pagina sai com o tamanho pedido em vez de ser podada no fim.
      ...(options.ids ? { chatId: { in: options.ids } } : {}),
    },
    /*
     * A ordem mora no banco: fixadas primeiro, depois atividade, e o id como
     * desempate. Sem o desempate o cursor pularia ou repetiria linhas quando
     * duas conversas tivessem o mesmo instante.
     *
     * Era tudo em JS, depois de carregar todas as participacoes do usuario.
     */
    orderBy: [
      { isPinned: 'desc' },
      { chat: { lastMessageAt: 'desc' } },
      { chatId: 'asc' },
    ],
    // Uma a mais do que o pedido: a sobra e o que responde "tem proxima?".
    ...(single ? {} : { take: limit + 1 }),
    ...(options.cursor
      ? { cursor: { chatId_userId: { chatId: options.cursor, userId } }, skip: 1 }
      : {}),
    include: {
      chat: {
        include: {
          participants: { include: { user: participantUser } },
          // A fixada vem junto: ela e um banner no topo da conversa, e
          // buscar a parte seria uma ida ao servidor por conversa aberta.
          //
          // As deleções vem embutidas porque `pinnedMessage` e relação para-um,
          // onde o Prisma nao aceita `where` — quem filtra e a serializacao
          // abaixo. Sem isto, apagar a fixada so para si deixava o banner no
          // topo mostrando exatamente o que a pessoa mandou sumir.
          pinnedMessage: {
            include: {
              ...messageInclude,
              deletions: { where: { userId }, select: { id: true } },
            },
          },
          messages: {
            // O que este usuario apagou so para si nao pode voltar como previa
            // do card: a conversa mostraria no resumo o que sumiu la dentro.
            where: messages.notDeletedFor(userId),
            orderBy: { createdAt: 'desc' },
            // O `take` do include vale por conversa: uma mensagem cada.
            take: 1,
            include: messageInclude,
          },
        },
      },
    },
  });

  const pendingByChat = await countPending(userId, participations);
  // Uma leitura so: o ajuste e do usuario, e nao da conversa.
  const sendsReceipts = await users.sendsReadReceipts(userId);
  // Uma consulta so: marcar conversa a conversa seria N+1 por um booleano.
  const blockedIds = new Set(await blocks.listBlockedBy(userId));
  // Quem saiu do grupo so ve a conversa ate a saida: a previa e a ultima de
  // antes dela, e nao a mais nova que o grupo mandou.
  const leftLast = await lastBeforeLeaving(participations, userId);

  // Um relogio so para a pagina inteira: comparar cada conversa com um `new
  // Date()` proprio faria duas linhas da mesma resposta usarem instantes
  // diferentes para decidir se o silencio ja venceu.
  const now = new Date();

  const chats = participations.flatMap((participation) => {
    const { chat, isAdmin, isUnread, isPinned } = participation;
    const { archivedAt, isMuted, mutedUntil, hiddenAt, leftAt } = participation;
    const isGroup = chat.type === 'GROUP';
    const other = chat.participants.find((p) => p.userId !== userId)?.user;
    const visibility = visibilityOf(participation);

    // O corte de limpar/excluir e a saida do grupo sao privados, entao o
    // Prisma nao consegue aplica-los no include (o valor varia por linha) —
    // filtra-se aqui. Como so veio a mensagem mais nova, ela ficar fora do
    // corte significa que nao sobrou nenhuma visivel.
    const newest = leftAt !== null ? leftLast.get(chat.id) : chat.messages[0];
    const lastMessage = newest && isVisible(newest.createdAt, visibility) ? newest : null;

    const pending = pendingByChat.get(chat.id) ?? 0;

    // Marcada a mao: mostra ao menos 1 mesmo sem mensagem pendente de fato.
    const unreadMessages = isUnread ? Math.max(pending, 1) : pending;

    const lastMessageAt = lastMessage?.createdAt ?? chat.createdAt;

    // Excluida e ainda sem nada novo: some da lista. Volta sozinha assim que
    // chegar mensagem posterior ao corte. Limpar nao mexe no hiddenAt, entao
    // a conversa limpa continua aqui, vazia. Para quem saiu do grupo, a
    // mensagem nova nunca chega — e a conversa excluida continua excluida.
    if (hiddenAt !== null && lastMessageAt <= hiddenAt) return [];

    // Mensagem nova desarquiva: o arquivo so vale enquanto nada aconteceu
    // depois dele.
    const isArchived = archivedAt !== null && lastMessageAt <= archivedAt;

    // Quem saiu do grupo nao conta mais como participante para ninguem:
    // fica de fora do avatar, dos recibos de leitura e da lista de membros.
    const active = chat.participants.filter((p) => p.leftAt === null);

    // O nome de quem pediu a lista, para saber se a ultima mensagem o chama.
    // Sai dos participantes que a consulta ja trouxe: nenhuma ida extra.
    const myName = chat.participants.find((p) => p.userId === userId)?.user.name;

    const item: Chat & { lastMessageAt: Date } = {
      id: chat.id,
      type: isGroup ? 'GROUP' : 'DIRECT',
      name: isGroup ? (chat.name ?? 'Grupo') : (other?.name ?? ''),
      image: (isGroup ? chat.image : other?.image) ?? undefined,
      isLogged: isGroup ? false : (other?.isOnline ?? false),
      // Conversa direta carrega o status do outro para o ponto do avatar.
      status: isGroup || !other ? undefined : publicStatusOf(other),
      statusText: isGroup || !other ? null : other.statusText,
      // E o "visto por ultimo" dele, que o cabecalho mostra sob o nome.
      lastSeenAt: isGroup || !other ? null : lastSeenOf(other),
      isAdmin,
      isPinned,
      isArchived,
      // Resolvido aqui, e nao na tela: vale o "sempre" ou um prazo que ainda
      // nao venceu. Passado o horario a conversa volta a avisar sozinha, sem
      // nada precisar rodar para desligar o silencio.
      isMuted: isMuted || (mutedUntil !== null && mutedUntil > now),
      // So para o menu poder dizer "silenciada ate as 15h". No "sempre" e null.
      mutedUntil: mutedUntil !== null && mutedUntil > now ? mutedUntil.toISOString() : null,
      // O "assunto" do grupo; conversa direta nao tem.
      description: isGroup ? chat.description : null,
      onlyAdminsSend: isGroup && chat.onlyAdminsSend,
      /// Eu bloqueei o outro. Só em conversa direta; grupo nunca bloqueia.
      isBlocked: !isGroup && other !== undefined && blockedIds.has(other.id),
      /// Saiu do grupo: a conversa fica so para leitura ate ser excluida.
      hasLeft: leftAt !== null,
      /*
       * A ultima mensagem chama este usuario pelo nome.
       *
       * Calculado aqui, e nao guardado: os participantes ja vieram com nome na
       * mesma consulta, e quem pede a lista e conhecido — sobra uma comparacao
       * de texto por conversa. Persistir isso custaria uma migracao para
       * alimentar um rotulo de card.
       *
       * So em grupo, e nunca a propria mensagem: "voce mencionou voce" nao
       * existe. A regra do casamento e a mesma que decide quem notificar.
       */
      mentionsMe:
        isGroup &&
        lastMessage !== null &&
        lastMessage.senderId !== userId &&
        myName !== undefined &&
        mentionsName(lastMessage.text, myName) &&
        // E so enquanto ela ainda estiver por ler: depois de aberta a conversa,
        // o chamado deixou de ser pendente e o card volta a mostrar o texto.
        (participation.lastReadAt === null ||
          lastMessage.createdAt > participation.lastReadAt),
      participants: active.map((p) => p.userId),
      members: active.map((p) => ({
        id: p.user.id,
        name: p.user.name,
        image: p.user.image ?? undefined,
        status: publicStatusOf(p.user),
        statusText: p.user.statusText,
        isOnline: p.user.isOnline,
        lastSeenAt: lastSeenOf(p.user),
        isAdmin: p.isAdmin,
      })),
      unreadMessages,
      // Ultima leitura de cada participante, para o recibo de leitura
      // sobreviver ao F5: antes ele so existia enquanto o evento de socket
      // estivesse na memoria da aba.
      // Quem desligou o recibo nao aparece aqui, e quem desligou o proprio
      // nao recebe o de ninguem: sem a reciprocidade o ajuste viraria uma
      // forma de ver sem ser visto.
      // Para quem saiu, a leitura dos outros para na saida: todas as
      // mensagens dele sao anteriores a ela, e o horario real diria quando o
      // grupo continuou ativo.
      readBy: Object.fromEntries(
        active
          .filter(
            (p) =>
              p.userId !== userId &&
              p.lastReadAt !== null &&
              p.user.showReadReceipts &&
              sendsReceipts,
          )
          .map((p) => [p.userId, capAt(p.lastReadAt as Date, leftAt).toISOString()]),
      ),
      // Fixada: respeita o mesmo corte do historico — o que o usuario limpou
      // nao volta como banner — e, para quem saiu, so conta o que ja estava
      // fixado quando ele saiu.
      pinnedMessage:
        chat.pinnedMessage &&
        chat.pinnedMessage.deletedAt === null &&
        // Apagada so para este usuario: o banner some para ele, e continua no
        // topo para os outros. Ver o include acima.
        chat.pinnedMessage.deletions.length === 0 &&
        isVisible(chat.pinnedMessage.createdAt, visibility) &&
        (leftAt === null || (chat.pinnedAt !== null && chat.pinnedAt <= leftAt))
          ? serializeMessage(chat.pinnedMessage)
          : null,
      /// So a previa do card; o historico vem da rota de mensagens.
      lastMessage: lastMessage ? serializeMessage(lastMessage) : null,
      lastMessageAt,
    };

    return [item];
  });

  /*
   * A ordem ja vem do banco. O que sobra aqui e a pagina: a linha extra sai da
   * resposta e vira o cursor.
   *
   * As paginas podem sair menores que o limite — conversa excluida e sem nada
   * novo e descartada no `flatMap` acima, e o banco nao tem como saber disso,
   * porque a regra compara duas colunas da mesma linha. Quem consome pede a
   * proxima pagina enquanto houver cursor.
   */
  const page = single ? participations : participations.slice(0, limit);
  const hasMore = !single && participations.length > limit;
  const nextCursor = hasMore ? (page.at(-1)?.chatId ?? null) : null;

  const visible = chats
    .filter((chat) => page.some((participation) => participation.chatId === chat.id))
    .map(({ lastMessageAt: _lastMessageAt, ...chat }) => chat);

  return { chats: visible, nextCursor };
}

/**
 * Ids das conversas em que o usuario ainda esta. Existe para quem so precisa
 * das salas do socket: o listForUser carrega a previa de cada conversa, custo
 * absurdo para montar uma lista de nomes de sala.
 */
export async function listChatIds(userId: number): Promise<string[]> {
  const rows = await prisma.chatParticipant.findMany({
    where: { userId, leftAt: null },
    select: { chatId: true },
  });

  return rows.map((row) => row.chatId);
}

/*
 * Aqui morava o `searchCutoffs`, que carregava todas as participacoes do
 * usuario para a busca global montar um `OR` por conversa. O recorte passou
 * para dentro do proprio SQL da busca, num join com ChatParticipant — ver
 * `bestPerChat` em fts.ts.
 */

/**
 * As conversas do usuario como a exportacao de dados as descreve: o que ele
 * participa, desde quando, e o que ele escolheu sobre cada uma.
 */
export function listForExport(userId: number) {
  return prisma.chatParticipant.findMany({
    where: { userId },
    orderBy: { joinedAt: 'asc' },
    select: {
      joinedAt: true,
      leftAt: true,
      isPinned: true,
      isMuted: true,
      archivedAt: true,
      clearedAt: true,
      hiddenAt: true,
      chat: {
        select: {
          id: true,
          type: true,
          name: true,
          description: true,
          createdAt: true,
        },
      },
    },
  });
}

/**
 * Marca a saida de todas as conversas de uma vez — a exclusao de conta.
 *
 * Sem isto a conta anonimizada continuaria participante ativa de tudo: contada
 * em "N participantes", e eternamente pendente no recibo de leitura, porque
 * ninguem mais le por ela. O ✓✓ de um grupo nunca mais fecharia.
 *
 * Nao anuncia nada. O aviso "Fulano saiu do grupo" congela o nome no historico,
 * e o nome e justamente o que a exclusao veio apagar.
 *
 * Devolve as conversas afetadas: quem chama avisa cada uma pelo socket.
 */
export async function leaveAllChats(userId: number): Promise<string[]> {
  const active = await prisma.chatParticipant.findMany({
    where: { userId, leftAt: null },
    select: { chatId: true },
  });

  const chatIds = active.map((participant) => participant.chatId);
  if (chatIds.length === 0) return [];

  await prisma.chatParticipant.updateMany({
    where: { userId, leftAt: null },
    data: { leftAt: new Date(), isAdmin: false, isPinned: false },
  });

  return chatIds;
}

/** As fotos de grupo que sao arquivo deste servidor — ver a varredura de orfaos. */
export async function listUploadedImages(): Promise<string[]> {
  const rows = await prisma.chat.findMany({
    where: { image: { startsWith: '/uploads/' } },
    select: { image: true },
  });

  return rows.map((row) => row.image).filter((image): image is string => image !== null);
}

export function findById(chatId: string) {
  return prisma.chat.findUnique({
    where: { id: chatId },
    include: { participants: true },
  });
}

/** Quem saiu fica de fora: o painel de detalhes lista so quem esta no grupo. */
export function findByIdWithMembers(chatId: string) {
  return prisma.chat.findUnique({
    where: { id: chatId },
    include: {
      participants: { where: { leftAt: null }, include: { user: participantUser } },
    },
  });
}

/**
 * Conversa direta entre dois usuarios, se ja existir.
 *
 * Vai direto pelo `directKey`, que e unico e indexado. Antes era um findMany
 * com dois `some` aninhados — duas subconsultas sobre ChatParticipant para
 * cada conversa direta do banco, so para descobrir se um par ja tinha a sua.
 * A coluna existia desde a migracao `direct_chat_key` e resolvia a corrida de
 * escrita; o caminho de leitura e que continuava sem usa-la.
 *
 * O que fica de fora: as duplicatas antigas que ficaram sem chave naquela
 * migracao. E o certo — a que ficou com a chave e a que tem a atividade
 * recente, e e para ela que "abrir a conversa" deve levar. A duplicata continua
 * na lista de quem participa dela, so nao e mais o destino de um pedido novo.
 */
export function findDirectBetween(userId: number, otherUserId: number) {
  return prisma.chat.findUnique({
    where: { directKey: directKeyOf(userId, otherUserId) },
    include: { participants: true },
  });
}

/** A chave do par, sempre na mesma ordem: e o formato que o unique espera. */
export function directKeyOf(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

/**
 * Abre a conversa direta entre os dois.
 *
 * O `directKey` e unico no banco, e e ele que decide a corrida: se dois pedidos
 * chegam juntos, os dois passam pela busca sem achar nada, mas so um insert
 * sobrevive. O outro cai no catch e recebe a conversa que acabou de nascer —
 * antes os dois criavam, e o par terminava com duas conversas.
 */
export async function createDirect(userId: number, otherUserId: number) {
  try {
    return await prisma.chat.create({
      data: {
        type: 'DIRECT',
        directKey: directKeyOf(userId, otherUserId),
        // Sem isto a conversa nasceria sem instante de atividade e a ordenacao
        // do banco a jogaria para o fim da lista, onde ninguem a veria.
        lastMessageAt: new Date(),
        participants: { create: [{ userId }, { userId: otherUserId }] },
      },
      include: { participants: true },
    });
  } catch (error) {
    // Perdeu a corrida: a conversa existe, e e ela que o outro lado espera.
    // Se o erro foi outro, o findDirectBetween nao acha nada e ele sobe.
    const existing = await findDirectBetween(userId, otherUserId);
    if (existing) return existing;
    throw error;
  }
}

/** Cria o grupo com o criador como admin. */
export function createGroup(name: string, creatorId: number, memberIds: number[]) {
  const unique = [...new Set([creatorId, ...memberIds])];

  return prisma.chat.create({
    data: {
      type: 'GROUP',
      name,
      lastMessageAt: new Date(),
      participants: {
        create: unique.map((userId) => ({
          userId,
          isAdmin: userId === creatorId,
        })),
      },
    },
    include: { participants: true },
  });
}

/** Nome e/ou foto do grupo. A foto usa os mesmos avatares do perfil. */
export function updateGroup(
  chatId: string,
  data: {
    name?: string;
    image?: string | null;
    description?: string | null;
    onlyAdminsSend?: boolean;
  },
) {
  return prisma.chat.update({ where: { id: chatId }, data });
}

/**
 * Promove a administrador, ou tira.
 *
 * So participante ativo: promover quem ja saiu daria um grupo administrado por
 * alguem que nao esta nele — e que voltaria com poderes se fosse readicionado.
 */
export function setAdmin(chatId: string, userId: number, isAdmin: boolean) {
  return prisma.chatParticipant.updateMany({
    where: { chatId, userId, leftAt: null },
    data: { isAdmin },
  });
}

/** Grava (ou apaga) o codigo do convite. Gerar outro invalida o anterior. */
export function setInviteCode(chatId: string, inviteCode: string | null) {
  return prisma.chat.update({ where: { id: chatId }, data: { inviteCode } });
}

export function findByInviteCode(inviteCode: string) {
  return prisma.chat.findUnique({
    where: { inviteCode },
    include: { participants: true },
  });
}

/**
 * Quem esta no grupo agora, com a ultima leitura de cada um. Alimenta o "Dados
 * da mensagem": quem ja leu sai de comparar o lastReadAt com a data da mensagem.
 */
export function activeParticipants(chatId: string) {
  return prisma.chatParticipant.findMany({
    where: { chatId, leftAt: null },
    include: { user: participantUser },
  });
}

/**
 * Adiciona ao grupo. Quem ja saiu tem linha guardada (chatId+userId e unico),
 * entao a entrada dessas pessoas e uma reativacao, nao um insert: o `leftAt`
 * cai e o corte de exclusao vai junto, senao o grupo voltaria vazio.
 */
export async function addMembers(chatId: string, userIds: number[]) {
  const known = await prisma.chatParticipant.findMany({
    where: { chatId, userId: { in: userIds } },
    select: { userId: true },
  });

  const returning = new Set(known.map((participant) => participant.userId));
  const fresh = userIds.filter((userId) => !returning.has(userId));

  if (returning.size > 0) {
    await prisma.chatParticipant.updateMany({
      where: { chatId, userId: { in: [...returning] } },
      data: {
        leftAt: null,
        clearedAt: null,
        hiddenAt: null,
        archivedAt: null,
        joinedAt: new Date(),
      },
    });
  }

  if (fresh.length > 0) {
    await prisma.chatParticipant.createMany({
      data: fresh.map((userId) => ({ chatId, userId })),
    });
  }
}

/**
 * Saida logica do grupo. A linha fica para a conversa continuar na lista em
 * somente leitura ate o usuario excluir — apagar aqui faria a conversa sumir
 * na hora e nao sobraria nada para o "Excluir conversa" agir.
 */
export function removeMember(chatId: string, userId: number): Promise<number | null> {
  return prisma.$transaction(async (tx) => {
    await tx.chatParticipant.updateMany({
      where: { chatId, userId },
      data: { leftAt: new Date(), isAdmin: false, isPinned: false },
    });

    const chat = await tx.chat.findUnique({
      where: { id: chatId },
      select: { type: true },
    });
    if (chat?.type !== 'GROUP') return null;

    // Ainda ha quem administre: nada a fazer.
    const admins = await tx.chatParticipant.count({
      where: { chatId, leftAt: null, isAdmin: true },
    });
    if (admins > 0) return null;

    /*
     * O criador saiu e o grupo ficou sem ninguem que possa renomear, trocar a
     * foto ou administrar os membros — um grupo travado para sempre. Herda quem
     * esta ha mais tempo, que e a escolha menos arbitraria: o `joinedAt` e
     * publico no painel de detalhes, entao a promocao e explicavel para o grupo.
     */
    const oldest = await tx.chatParticipant.findFirst({
      where: { chatId, leftAt: null },
      orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
      select: { id: true, userId: true },
    });
    if (!oldest) return null;

    await tx.chatParticipant.update({
      where: { id: oldest.id },
      data: { isAdmin: true },
    });

    return oldest.userId;
  });
}

/**
 * Devolve a conversa para a lista de quem pediu para abri-la.
 *
 * Excluir foi limpar + sumir da lista. Pedir a conversa de novo desfaz so o
 * segundo: o historico continua escondido, como o usuario deixou.
 */
export function unhide(chatId: string, userId: number) {
  return prisma.chatParticipant.updateMany({
    where: { chatId, userId },
    data: { hiddenAt: null },
  });
}

/**
 * Fixa (ou solta) a mensagem do topo da conversa.
 *
 * Guarda quem fixou e quando: o banner diz "fixada por", e sem o instante nao
 * haveria como ordenar se um dia couber mais de uma.
 */
export function setPinnedMessage(
  chatId: string,
  messageId: string | null,
  userId: number | null,
) {
  return prisma.chat.update({
    where: { id: chatId },
    data: {
      pinnedMessageId: messageId,
      pinnedAt: messageId ? new Date() : null,
      pinnedById: messageId ? userId : null,
    },
  });
}

export function findParticipant(chatId: string, userId: number) {
  return prisma.chatParticipant.findUnique({
    where: { chatId_userId: { chatId, userId } },
  });
}

/** Arquivar / desarquivar. Sem instante, a conversa sai do arquivo. */
export function setArchived(chatId: string, userId: number, isArchived: boolean) {
  return prisma.chatParticipant.updateMany({
    where: { chatId, userId },
    data: { archivedAt: isArchived ? new Date() : null },
  });
}

/**
 * Silenciar. Sem `until` e o "sempre"; com, e o prazo.
 *
 * As duas colunas sao escritas juntas de proposito: silenciar por 8h depois de
 * ter silenciado para sempre precisa desligar o "sempre", senao o prazo venceria
 * e a conversa continuaria muda — e ninguem entenderia por que.
 */
export function setMuted(
  chatId: string,
  userId: number,
  isMuted: boolean,
  until: Date | null = null,
) {
  return prisma.chatParticipant.updateMany({
    where: { chatId, userId },
    data: { isMuted, mutedUntil: until },
  });
}

/**
 * "Limpar conversa" — o historico some so para quem pediu; nenhuma mensagem e
 * apagada. A conversa fica na lista, vazia.
 *
 * Zera o hiddenAt de proposito: quem limpa uma conversa que ja tinha sido
 * excluida antes esta pedindo para ela ficar visivel, e um hiddenAt antigo a
 * esconderia de novo assim que o novo corte passasse na frente dele.
 */
export function clearHistory(chatId: string, userId: number) {
  return prisma.chatParticipant.updateMany({
    where: { chatId, userId },
    data: { clearedAt: new Date(), hiddenAt: null, isUnread: false },
  });
}

/**
 * "Excluir conversa" — limpar e ainda sumir da lista. Sai do arquivo e da
 * fixacao junto: os dois so fariam sentido para uma conversa que se ve.
 */
export function hideChat(chatId: string, userId: number) {
  const now = new Date();

  return prisma.chatParticipant.updateMany({
    where: { chatId, userId },
    data: {
      clearedAt: now,
      hiddenAt: now,
      archivedAt: null,
      isPinned: false,
      isUnread: false,
    },
  });
}

export function isAdmin(chatId: string, userId: number) {
  return prisma.chatParticipant.findFirst({
    where: { chatId, userId, isAdmin: true },
  });
}

/**
 * Grava a leitura e devolve o instante gravado. Ele vai junto no evento do
 * recibo: comparar a data da mensagem com o relogio de quem recebe o evento
 * erraria sempre que esse relogio estivesse atrasado.
 */
export async function markAsRead(chatId: string, userId: number): Promise<Date> {
  const readAt = new Date();

  await prisma.chatParticipant.updateMany({
    where: { chatId, userId },
    data: { lastReadAt: readAt, isUnread: false },
  });

  return readAt;
}

export function setPinned(chatId: string, userId: number, isPinned: boolean) {
  return prisma.chatParticipant.updateMany({
    where: { chatId, userId },
    data: { isPinned },
  });
}

/**
 * "Marcar como nao lida". Nao mexe no lastReadAt: quem le a conversa depois
 * continua tendo o mesmo ponto de leitura, e a flag some no proximo markAsRead.
 */
export function markAsUnread(chatId: string, userId: number) {
  return prisma.chatParticipant.updateMany({
    where: { chatId, userId },
    data: { isUnread: true },
  });
}
