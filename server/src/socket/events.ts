import { io } from '../config/instances.js';
import * as chats from '../repositories/chatRepository.js';
import type { Message, ServerToClientEvents, User } from '@react-chat/shared';

/**
 * O único lugar que fala com o socket.
 *
 * Antes cada rota emitia por conta própria: o nome do evento era uma string
 * solta no meio do handler, e para saber o que uma conversa dispara era
 * preciso ler as 860 linhas de `routes/chats.ts`. Aqui os eventos têm nome de
 * domínio — "mensagem criada", "conversa mudou" —, e o mapa de eventos do
 * pacote compartilhado confere o nome e o payload de cada um.
 */

/** Sala de uma conversa: todo participante ativo entra nela ao conectar. */
const chatRoom = (chatId: string) => `chat${chatId}`;

/** Sala pessoal: todas as abas e todos os dispositivos de uma pessoa. */
const userRoom = (userId: number) => `user${userId}`;

/**
 * Emite só para quem divide alguma conversa com o usuário.
 *
 * Antes era `io.emit`: presença e mudança de perfil iam para todos os
 * conectados, inclusive quem nunca falou com a pessoa. Sem sala nenhuma não há
 * a quem avisar — e um `to([])` do socket.io voltaria a ser broadcast.
 */
async function emitToPeers<E extends keyof ServerToClientEvents>(
  userId: number,
  event: E,
  ...args: Parameters<ServerToClientEvents[E]>
): Promise<void> {
  const chatIds = await chats.listChatIds(userId);
  const rooms = chatIds.map(chatRoom);
  if (rooms.length === 0) return;

  io.to(rooms).emit(event, ...args);
}

/** Põe todos os participantes na sala da conversa. */
export function joinChat(chatId: string, userIds: number[]): void {
  for (const userId of userIds) {
    io.in(userRoom(userId)).socketsJoin(chatRoom(chatId));
  }
}

export function leaveChat(chatId: string, userId: number): void {
  io.in(userRoom(userId)).socketsLeave(chatRoom(chatId));
}

/**
 * Mensagem nova na conversa.
 *
 * `mentions` vai junto para a menção furar o silêncio do outro lado: conversa
 * silenciada não notifica nada, mas ser chamado pelo nome é justamente o caso
 * em que a pessoa quer saber.
 *
 * Vazio por padrão — aviso de grupo e encaminhamento não mencionam ninguém, e
 * assim os dois chamadores que não resolvem menção seguem como estavam.
 */
export function messageCreated(
  chatId: string,
  senderId: number,
  message: Message,
  mentions: number[] = [],
): void {
  io.to(chatRoom(chatId)).emit('new-message', {
    chatId,
    id: senderId,
    newMessage: message,
    ...(mentions.length > 0 ? { mentions } : {}),
  });
}

/** Editada, apagada, ou com reação nova: a mensagem inteira vai de novo. */
export function messageUpdated(chatId: string, message: Message): void {
  io.to(chatRoom(chatId)).emit('message-updated', { chatId, message });
}

export function chatCreated(chatId: string): void {
  io.to(chatRoom(chatId)).emit('chat-created', { chatId });
}

export function chatUpdated(chatId: string): void {
  io.to(chatRoom(chatId)).emit('chat-updated', { chatId });
}

/**
 * O mesmo aviso, para uma pessoa só. Quem saiu do grupo já não está na sala —
 * e é justamente quem precisa recarregar, para a conversa virar somente
 * leitura na tela dele.
 */
export function chatUpdatedFor(userId: number, chatId: string): void {
  io.to(userRoom(userId)).emit('chat-updated', { chatId });
}

/**
 * Alguém leu a conversa. O instante gravado vai junto: é com ele que o cliente
 * compara a data de cada mensagem — o relógio de quem recebe pode estar
 * atrasado, e o ✓✓ ficaria apagado.
 */
export function messagesRead(chatId: string, userId: number, readAt: Date): void {
  io.to(chatRoom(chatId)).emit('read-message', {
    chatId,
    id: userId,
    readAt: readAt.toISOString(),
  });
}

/**
 * Perfil atualizado. Os contatos recebem a versão pública; as outras abas do
 * dono recebem o objeto inteiro — é ele que precisa ver o próprio interruptor
 * de privacidade acompanhar.
 */
export async function profileUpdated(
  userId: number,
  forPeers: User,
  forOwner: User,
): Promise<void> {
  await emitToPeers(userId, 'user-updated', forPeers);
  io.to(userRoom(userId)).emit('user-updated', forOwner);
}

/** Entrou: só quem conversa com ele precisa saber. */
export async function userOnline(userId: number): Promise<void> {
  await emitToPeers(userId, 'new-login', userId);
}

/**
 * Saiu. O "visto por último" vai junto: é com ele que o cabeçalho troca
 * "online" pelo horário sem esperar um reload. Vem null de quem desligou o
 * campo na privacidade.
 */
export async function userOffline(userId: number, lastSeenAt: string | null): Promise<void> {
  await emitToPeers(userId, 'user-logoff', { id: userId, lastSeenAt });
}

/**
 * Derruba as conexões de socket das sessões encerradas.
 *
 * O socket só confere o token no handshake: sem isto, o aparelho cuja sessão
 * foi encerrada — pela lista de dispositivos, pela troca de senha ou pelo
 * logout — continuava recebendo mensagens pela conexão que já estava aberta.
 */
export async function disconnectSessions(
  userId: number,
  shouldDrop: (sessionId: string | undefined) => boolean,
): Promise<void> {
  const sockets = await io.in(userRoom(userId)).fetchSockets();

  for (const socket of sockets) {
    if (shouldDrop(socket.data.sessionId)) socket.disconnect(true);
  }
}
