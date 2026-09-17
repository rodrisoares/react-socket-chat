import {
  DELETE_FOR_EVERYONE_MINUTES,
  MESSAGES_PAGE_SIZE,
  mentionsName,
} from '@react-chat/shared';
import type {
  ChatGallery,
  GalleryLink,
  Message,
  MessageInfo,
  MessagePage,
} from '@react-chat/shared';

import { copyUpload, removeUpload } from '../config/upload.js';
import { AppError } from '../errors/AppError.js';
import * as chats from '../repositories/chatRepository.js';
import { lastSeenOf, publicStatusOf } from '../repositories/mappers.js';
import * as messages from '../repositories/messageRepository.js';
import * as users from '../repositories/userRepository.js';
import { isVisible } from '../repositories/visibility.js';
import * as events from '../socket/events.js';
import * as chatService from './chatService.js';

/**
 * O que se faz com uma mensagem: ler, enviar, editar, apagar, encaminhar e
 * reagir. Toda a autorização vem do `chatService`; o socket é avisado pelo
 * módulo de eventos, e não daqui.
 */

/** Abaixo disto a busca não vale a viagem — o cliente já nem envia. */
const MIN_SEARCH_LENGTH = 2;

/** A mensagem, se ela é mesmo desta conversa. */
async function messageOf(chatId: string, messageId: string) {
  const message = await messages.findById(messageId);
  if (!message || message.chatId !== chatId) {
    throw AppError.notFound('Mensagem não encontrada');
  }
  return message;
}

/**
 * Histórico paginado: `before` é o createdAt da mensagem mais antiga na tela, e
 * `beforeId` o id dela — os dois juntos, senão duas mensagens do mesmo
 * milissegundo escorregam entre as páginas (ver PageOptions no repositório).
 */
export async function listPage(
  chatId: string,
  userId: number,
  before?: Date,
  beforeId?: string,
): Promise<MessagePage> {
  const { visibility } = await chatService.assertParticipant(chatId, userId);

  const { messages: rows, hasMore } = await messages.listPage(chatId, MESSAGES_PAGE_SIZE, {
    before,
    beforeId,
    visibility,
    userId,
  });

  return { messages: rows.map(chats.serializeMessage), hasMore };
}

/**
 * A página seguinte no sentido do presente — a volta do salto.
 *
 * Depois de pular até uma mensagem antiga, o cliente tem uma janela de
 * histórico no meio da conversa e precisa poder andar para a frente até
 * reencontrar o fim. Sem isto o `hasMoreAfter` da janela era uma informação
 * sem uso: dizia que havia mensagem mais nova e não havia como pedi-la.
 *
 * O `hasMore` sai `true` sempre: o cursor é uma mensagem que existe, então há
 * pelo menos ela antes deste trecho. Quem responde "acabou o histórico para
 * trás" é a paginação normal, e não esta.
 */
export async function listNewer(
  chatId: string,
  userId: number,
  after: Date,
  afterId?: string,
): Promise<MessagePage> {
  const { visibility } = await chatService.assertParticipant(chatId, userId);

  const { messages: rows, hasMore } = await messages.listAfter(
    chatId,
    MESSAGES_PAGE_SIZE,
    { after, ...(afterId ? { afterId } : {}), visibility, userId },
  );

  return {
    messages: rows.map(chats.serializeMessage),
    hasMore: true,
    hasMoreAfter: hasMore,
  };
}

/** Metade da página de cada lado da mensagem pedida. */
const AROUND_RADIUS = Math.floor(MESSAGES_PAGE_SIZE / 2);

/**
 * O histórico em volta de uma mensagem — o salto até a citação, a fixada, um
 * resultado da busca ou uma salva.
 *
 * A mensagem precisa ser visível para quem pediu: o que o usuário limpou, e o
 * que o grupo escreveu depois de ele sair, não voltam por aqui. Um id de outra
 * conversa, ou de algo fora do corte, responde o mesmo "não encontrada" — não
 * há por que dizer qual dos dois é.
 */
export async function listAround(
  chatId: string,
  userId: number,
  messageId: string,
): Promise<MessagePage> {
  const { visibility } = await chatService.assertParticipant(chatId, userId);

  const target = await messages.findById(messageId);
  if (!target || target.chatId !== chatId || !isVisible(target.createdAt, visibility)) {
    throw AppError.notFound('Mensagem não encontrada');
  }

  // Apagada só para quem pediu: saltar até ela a traria de volta à tela pela
  // porta dos fundos — pela citação, pela busca ou pela lista de salvas.
  if (await messages.isDeletedFor(messageId, userId)) {
    throw AppError.notFound('Mensagem não encontrada');
  }

  const window = await messages.listAround(
    chatId,
    target,
    AROUND_RADIUS,
    visibility,
    userId,
  );

  return {
    messages: [...window.before, target, ...window.after].map(chats.serializeMessage),
    hasMore: window.hasMore,
    hasMoreAfter: window.hasMoreAfter,
  };
}

/** Busca dentro de uma conversa, em todo o histórico visível para o usuário. */
export async function search(
  chatId: string,
  userId: number,
  term: string,
): Promise<Message[]> {
  const { visibility } = await chatService.assertParticipant(chatId, userId);
  if (term.length < MIN_SEARCH_LENGTH) return [];

  const found = await messages.searchInChat(chatId, term, visibility, userId);
  return found.map(chats.serializeMessage);
}

/** Tipos que a galeria mostra como mídia; o resto vira "arquivo". */
function isGalleryMedia(type: string | null): boolean {
  return Boolean(type && (type.startsWith('image/') || type.startsWith('video/')));
}

/** Links de um texto, sem repetir o mesmo endereço duas vezes. */
const LINK_PATTERN = /https?:\/\/[^\s<>"')]+/g;

/**
 * Galeria da conversa: mídia, arquivos e links, como no painel do WhatsApp.
 *
 * Vem tudo numa resposta só porque as três abas do painel são a mesma visita:
 * separar em três rotas custaria três idas ao servidor para trocar de aba.
 */
export async function gallery(chatId: string, userId: number): Promise<ChatGallery> {
  const { visibility } = await chatService.assertParticipant(chatId, userId);

  const [attachments, withLinks] = await Promise.all([
    messages.listAttachments(chatId, visibility, userId),
    messages.listWithLinks(chatId, visibility, userId),
  ]);

  const media = attachments
    .filter((message) => isGalleryMedia(message.attachmentType))
    .slice(0, messages.GALLERY_LIMIT)
    .map(chats.serializeMessage);

  const files = attachments
    .filter((message) => !isGalleryMedia(message.attachmentType))
    .slice(0, messages.GALLERY_LIMIT)
    .map(chats.serializeMessage);

  const seen = new Set<string>();
  const links: GalleryLink[] = withLinks.flatMap((message) => {
    const found = message.text.match(LINK_PATTERN) ?? [];

    return found.flatMap((url) => {
      if (seen.has(url)) return [];
      seen.add(url);

      return [
        {
          url,
          messageId: message.id,
          name: message.sender.name,
          // Só o instante: quem formata é o cliente, no fuso de quem lê.
          createdAt: message.createdAt.toISOString(),
        },
      ];
    });
  });

  return { media, files, links };
}

/** O anexo já gravado em disco, como a rota o recebeu do multer. */
export interface UploadedAttachment {
  url: string;
  name: string;
  type: string;
  /** Só imagem tem: medidas e miniatura saem do sharp, no verifyUpload. */
  width?: number;
  height?: number;
  thumbnailUrl?: string;
}

export interface NewMessage {
  text: string;
  replyToId?: string;
  attachment?: UploadedAttachment;
}

/**
 * Quem o texto menciona, entre os membros ativos da conversa.
 *
 * Resolvido aqui, e não no cliente. Procurar `@SeuNome` na tela de quem recebe
 * seria frágil de três jeitos: nome com espaço não tem fim claro, duas pessoas
 * com o mesmo nome no grupo dão falso positivo, e quem trocar de nome perde as
 * menções antigas.
 *
 * O critério em si mora no `mentionsName`, no pacote compartilhado: a prévia do
 * card também precisa dele para dizer "Fulano mencionou você", e duas cópias da
 * mesma regra divergiriam — a notificação e o rótulo passariam a discordar
 * sobre a mesma mensagem. Quem enviou nunca se menciona.
 */
async function mentionsIn(
  chatId: string,
  text: string,
  authorId: number,
): Promise<number[]> {
  // O caso comum é não ter arroba nenhuma: nem vale a consulta.
  if (!text.includes('@')) return [];

  const participants = await chats.activeParticipants(chatId);

  return participants
    .filter(
      (participant) =>
        participant.userId !== authorId && mentionsName(text, participant.user.name),
    )
    .map((participant) => participant.userId);
}

export async function send(
  chatId: string,
  userId: number,
  input: NewMessage,
): Promise<Message> {
  await chatService.assertCanWrite(chatId, userId);

  if (!input.text && !input.attachment) {
    throw AppError.badRequest('Envie um texto ou um anexo');
  }

  if (input.replyToId) {
    const original = await messages.findById(input.replyToId);
    if (!original || original.chatId !== chatId) {
      throw AppError.badRequest('Mensagem respondida não pertence a esta conversa');
    }
  }

  const created = await messages.create({
    chatId,
    senderId: userId,
    text: input.text,
    ...(input.replyToId ? { replyToId: input.replyToId } : {}),
    ...(input.attachment
      ? {
          attachmentUrl: input.attachment.url,
          attachmentName: input.attachment.name,
          attachmentType: input.attachment.type,
          ...(input.attachment.width ? { attachmentWidth: input.attachment.width } : {}),
          ...(input.attachment.height ? { attachmentHeight: input.attachment.height } : {}),
          ...(input.attachment.thumbnailUrl
            ? { attachmentThumbUrl: input.attachment.thumbnailUrl }
            : {}),
        }
      : {}),
  });

  const message = chats.serializeMessage(created);
  events.messageCreated(chatId, userId, message, await mentionsIn(chatId, input.text, userId));

  return message;
}

export async function edit(
  chatId: string,
  userId: number,
  messageId: string,
  text: string,
): Promise<Message> {
  await chatService.assertActiveParticipant(chatId, userId);
  const original = await messageOf(chatId, messageId);

  if (original.senderId !== userId) {
    throw AppError.forbidden('Só o autor pode editar a mensagem');
  }
  if (original.deletedAt) {
    throw AppError.badRequest('Mensagem apagada não pode ser editada');
  }

  const message = chats.serializeMessage(await messages.edit(messageId, text));
  events.messageUpdated(chatId, message);

  return message;
}

/**
 * "Apagar para mim": a mensagem some da tela de quem pediu, e só dela.
 *
 * Nada é apagado de verdade, nada é emitido para a sala e o autor não fica
 * sabendo — é estado privado, como bloquear e silenciar. Por isso vale para
 * qualquer mensagem, inclusive as dos outros e as fora do prazo.
 */
export async function removeForMe(
  chatId: string,
  userId: number,
  messageId: string,
): Promise<void> {
  // Basta ter a conversa: quem saiu do grupo continua podendo limpar a própria
  // visão do que ficou para trás.
  await chatService.assertParticipant(chatId, userId);
  await messageOf(chatId, messageId);

  await messages.deleteForMe(messageId, userId);
}

/**
 * "Apagar para todos": a mensagem vira "mensagem apagada" para o grupo inteiro.
 *
 * Só o autor, e só dentro do prazo. O prazo existe porque apagar sem limite
 * reescreve o passado — daria para sumir com o que se combinou meses atrás, na
 * conversa de todo mundo. Passado ele, resta o "apagar para mim", que não mexe
 * na tela de ninguém.
 */
export async function removeForEveryone(
  chatId: string,
  userId: number,
  messageId: string,
): Promise<Message> {
  await chatService.assertActiveParticipant(chatId, userId);
  const original = await messageOf(chatId, messageId);

  if (original.type === 'SYSTEM') {
    throw AppError.badRequest('Aviso do grupo não pode ser apagado');
  }
  if (original.senderId !== userId) {
    throw AppError.forbidden('Só o autor pode apagar a mensagem');
  }

  const minutesOld = (Date.now() - original.createdAt.getTime()) / 60_000;
  if (minutesOld > DELETE_FOR_EVERYONE_MINUTES) {
    throw AppError.badRequest(
      `O prazo para apagar para todos é de ${DELETE_FOR_EVERYONE_MINUTES} minutos. Você ainda pode apagar só para você.`,
    );
  }

  const deleted = await messages.softDelete(messageId);
  // O softDelete zera a referência no banco; o arquivo só sai daqui.
  await removeUpload(original.attachmentUrl);

  const message = chats.serializeMessage(deleted);
  events.messageUpdated(chatId, message);

  return message;
}

/**
 * "Dados da mensagem": quem já leu, e quando.
 *
 * Só o autor pergunta — quem leu a mensagem de outra pessoa não é assunto de
 * quem está olhando. E o recibo de leitura continua valendo nos dois sentidos:
 * quem desligou o seu não aparece em nenhuma das listas, e quem desligou o
 * próprio não vê a de ninguém. Fosse só na lista de lidos, "ainda não leu"
 * entregaria exatamente o que o recibo desligado esconde.
 */
export async function info(
  chatId: string,
  userId: number,
  messageId: string,
): Promise<MessageInfo> {
  await chatService.assertParticipant(chatId, userId);
  const message = await messageOf(chatId, messageId);

  if (message.senderId !== userId) {
    throw AppError.forbidden('Só o autor vê os dados da mensagem');
  }

  const readBy: MessageInfo['readBy'] = [];
  const pending: MessageInfo['pending'] = [];

  // Desligou o próprio recibo: não recebe o dos outros. As duas listas saem
  // vazias, e a tela diz que a informação não está disponível.
  if (!(await users.sendsReadReceipts(userId))) {
    return { messageId: message.id, readBy, pending };
  }

  for (const participant of await chats.activeParticipants(chatId)) {
    const person = participant.user;
    if (person.id === userId || !person.showReadReceipts) continue;

    const member = {
      id: person.id,
      name: person.name,
      image: person.image ?? undefined,
      status: publicStatusOf(person),
      statusText: person.statusText,
      isOnline: person.isOnline,
      lastSeenAt: lastSeenOf(person),
      isAdmin: participant.isAdmin,
    };

    const readAt = participant.lastReadAt;
    if (readAt !== null && readAt >= message.createdAt) {
      readBy.push({ ...member, readAt: readAt.toISOString() });
    } else {
      pending.push(member);
    }
  }

  // Quem leu primeiro no topo: é a ordem em que a informação é lida.
  readBy.sort((a, b) => a.readAt.localeCompare(b.readAt));

  return { messageId: message.id, readBy, pending };
}

/**
 * Encaminhar para várias conversas de uma vez.
 *
 * Cria uma mensagem nova em cada destino, com o anexo copiado. A resposta
 * citada não vai junto: a mensagem citada não existe no destino.
 */
export async function forward(
  chatId: string,
  userId: number,
  messageId: string,
  chatIds: string[],
): Promise<number> {
  await chatService.assertActiveParticipant(chatId, userId);
  const original = await messageOf(chatId, messageId);

  if (original.deletedAt) {
    throw AppError.badRequest('Mensagem apagada não pode ser encaminhada');
  }

  // Valida todos os destinos antes de escrever qualquer um: encaminhar meio
  // caminho é pior do que não encaminhar.
  const targets = [...new Set(chatIds)];
  for (const target of targets) {
    await chatService.assertCanWrite(target, userId);
  }

  for (const target of targets) {
    const copied = await copyUpload(original.attachmentUrl);

    const copy = await messages
      .create({
        chatId: target,
        senderId: userId,
        text: original.text,
        isForwarded: true,
        ...(copied
          ? {
              attachmentUrl: copied.url,
              attachmentName: original.attachmentName ?? 'arquivo',
              attachmentType: original.attachmentType ?? 'application/octet-stream',
              // O conteúdo é o mesmo arquivo: as medidas valem para a cópia.
              // A miniatura, não — ela é cópia própria, senão apagar a
              // original levaria junto a miniatura de todas as cópias.
              ...(original.attachmentWidth
                ? { attachmentWidth: original.attachmentWidth }
                : {}),
              ...(original.attachmentHeight
                ? { attachmentHeight: original.attachmentHeight }
                : {}),
              ...(copied.thumbnailUrl ? { attachmentThumbUrl: copied.thumbnailUrl } : {}),
            }
          : {}),
      })
      .catch(async (error: unknown) => {
        // A cópia do arquivo não pode sobrar no disco sem mensagem que a use.
        await removeUpload(copied?.url ?? null);
        throw error;
      });

    events.messageCreated(target, userId, chats.serializeMessage(copy));
  }

  return targets.length;
}

/** Relê a mensagem para o payload sair com as reações agrupadas e atualizadas. */
async function updatedMessage(chatId: string, messageId: string): Promise<Message> {
  const updated = await messageOf(chatId, messageId);
  const message = chats.serializeMessage(updated);
  events.messageUpdated(chatId, message);

  return message;
}

/**
 * Reagir. Uma reação por pessoa: mandar outro emoji troca o anterior. É
 * idempotente de propósito — reagir duas vezes com o mesmo emoji não duplica
 * nada, e quem decide remover é o `removeReaction`.
 */
export async function react(
  chatId: string,
  userId: number,
  messageId: string,
  emoji: string,
): Promise<Message> {
  await chatService.assertActiveParticipant(chatId, userId);
  const original = await messageOf(chatId, messageId);

  if (original.deletedAt) {
    throw AppError.badRequest('Mensagem apagada não aceita reação');
  }

  await messages.setReaction(messageId, userId, emoji);
  return updatedMessage(chatId, messageId);
}

export async function removeReaction(
  chatId: string,
  userId: number,
  messageId: string,
): Promise<Message> {
  await chatService.assertActiveParticipant(chatId, userId);
  await messageOf(chatId, messageId);

  await messages.removeReaction(messageId, userId);
  return updatedMessage(chatId, messageId);
}
