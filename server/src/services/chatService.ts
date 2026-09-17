import { randomBytes } from 'node:crypto';
import type { Chat, ChatDetails } from '@react-chat/shared';

import { env } from '../config/env.js';
import { AppError } from '../errors/AppError.js';
import * as blocks from '../repositories/blockRepository.js';
import * as chats from '../repositories/chatRepository.js';
import { lastSeenOf, publicStatusOf } from '../repositories/mappers.js';
import * as messages from '../repositories/messageRepository.js';
import * as users from '../repositories/userRepository.js';
import { visibilityOf, type Visibility } from '../repositories/visibility.js';
import * as events from '../socket/events.js';

/**
 * As regras de conversa: quem pode ler, quem pode escrever, e o que cada ação
 * muda.
 *
 * Elas viviam dentro dos handlers de `routes/chats.ts`, junto com o `req`, o
 * `res` e as emissões de socket. Aqui não há HTTP: o controller traduz a
 * requisição numa chamada destas funções, e quem avisa o socket é o módulo de
 * eventos.
 */

type ChatWithParticipants = NonNullable<Awaited<ReturnType<typeof chats.findById>>>;
type Participant = ChatWithParticipants['participants'][number];

/**
 * O nome de quem causou um evento, para o aviso do grupo.
 *
 * O texto é gravado pronto, então este nome congela no instante do evento — e é
 * o histórico correto: se a pessoa trocar de nome amanhã, a linha continua
 * dizendo o que aconteceu naquele dia.
 */
async function nameOf(userId: number): Promise<string> {
  const user = await users.findById(userId);
  return user?.name ?? 'Alguém';
}

/**
 * Escreve um aviso do grupo — "Fulano saiu", "renomeou o grupo".
 *
 * Vira mensagem de verdade, na mesma tabela, para entrar no histórico na ordem
 * certa e chegar pelo socket como qualquer outra. O que a distingue é o `type`:
 * ela não aceita reação, resposta nem edição, não conta como não lida e não
 * entra na busca.
 */
async function announce(chatId: string, actorId: number, text: string): Promise<void> {
  const created = await messages.create({
    chatId,
    senderId: actorId,
    text,
    type: 'SYSTEM',
  });

  events.messageCreated(chatId, actorId, chats.serializeMessage(created));
}

/** O convite como ele é entregue: endereço pronto para colar em qualquer lugar. */
function inviteUrlOf(code: string): string {
  return `${env.appUrl}/convite/${code}`;
}

/** A conversa, a participação de quem pediu, e o que ele enxerga dela. */
export interface Participation {
  chat: ChatWithParticipants;
  participant: Participant;
  visibility: Visibility;
}

/**
 * Garante que a conversa está na lista do usuário. Quem saiu do grupo continua
 * passando aqui de propósito: a conversa fica visível em somente leitura até
 * ser excluída, então ler e excluir seguem permitidos — ler só até a saída, que
 * é o que a `visibility` corta.
 */
export async function assertParticipant(
  chatId: string,
  userId: number,
): Promise<Participation> {
  const chat = await chats.findById(chatId);
  if (!chat) throw AppError.notFound('Conversa não encontrada');

  const participant = chat.participants.find((p) => p.userId === userId);
  if (!participant) throw AppError.forbidden('Usuário não participa desta conversa');

  return { chat, participant, visibility: visibilityOf(participant) };
}

/** Além de ter a conversa, ainda estar dentro — exigido por tudo que escreve. */
export async function assertActiveParticipant(
  chatId: string,
  userId: number,
): Promise<Participation> {
  const found = await assertParticipant(chatId, userId);
  if (found.participant.leftAt) {
    throw AppError.forbidden('Você não faz mais parte desta conversa');
  }
  return found;
}

async function assertGroupAdmin(
  chatId: string,
  userId: number,
): Promise<ChatWithParticipants> {
  const { chat } = await assertActiveParticipant(chatId, userId);
  if (chat.type !== 'GROUP') throw AppError.badRequest('Esta conversa não é um grupo');
  if (!(await chats.isAdmin(chatId, userId))) {
    throw AppError.forbidden('Apenas administradores do grupo podem fazer isso');
  }
  return chat;
}

/**
 * Recusa a conversa direta quando há bloqueio entre os dois.
 *
 * As mensagens são diferentes de propósito: quem bloqueou merece saber por que
 * não consegue enviar; quem foi bloqueado recebe um erro neutro, porque avisar
 * seria justamente o contrário de "bloqueio silencioso".
 */
export async function assertNotBlocked(userId: number, otherId: number): Promise<void> {
  const state = await blocks.stateBetween(userId, otherId);

  if (state.iBlocked) {
    throw AppError.forbidden('Você bloqueou este contato. Desbloqueie para conversar.');
  }
  if (state.blockedMe) {
    throw AppError.forbidden('Não foi possível enviar a mensagem para este contato.');
  }
}

/**
 * O outro participante de uma conversa direta, ou null em grupo.
 * Grupo nunca é afetado por bloqueio — foi a regra escolhida.
 */
export function otherInDirect(
  chat: { type: string; participants: { userId: number }[] },
  userId: number,
): number | null {
  if (chat.type !== 'DIRECT') return null;
  return chat.participants.find((p) => p.userId !== userId)?.userId ?? null;
}

/** Estar dentro, e sem bloqueio no caminho: o que escrever exige. */
export async function assertCanWrite(
  chatId: string,
  userId: number,
): Promise<Participation> {
  const found = await assertActiveParticipant(chatId, userId);

  // "Só admins enviam" não fecha o grupo para leitura: quem não é admin
  // continua vendo tudo, só não escreve. A checagem mora aqui, e não na rota de
  // mensagem, porque encaminhar também escreve — e passaria por fora.
  if (
    found.chat.type === 'GROUP' &&
    found.chat.onlyAdminsSend &&
    !found.participant.isAdmin
  ) {
    throw AppError.forbidden('Somente administradores podem enviar neste grupo');
  }

  const other = otherInDirect(found.chat, userId);
  if (other !== null) await assertNotBlocked(userId, other);

  return found;
}

/** Conversa direta, criada sob demanda. */
export async function openDirect(userId: number, otherUserId: number) {
  if (otherUserId === userId) {
    throw AppError.badRequest('Não é possível conversar consigo mesmo');
  }
  if (!(await users.findById(otherUserId))) {
    throw AppError.notFound('Usuário não encontrado');
  }
  await assertNotBlocked(userId, otherUserId);

  const existing = await chats.findDirectBetween(userId, otherUserId);
  const chat = existing ?? (await chats.createDirect(userId, otherUserId));

  // Quem excluiu a conversa continua com a linha no banco: para ele a conversa
  // "nao existe", mas o findDirectBetween a acha. Pedir para abri-la é pedir
  // para tê-la de volta na lista — do contrário devolveríamos o id de algo que
  // o /api/me/chats não mostra.
  if (existing) await chats.unhide(chat.id, userId);

  events.joinChat(chat.id, [userId, otherUserId]);
  return { id: chat.id, type: chat.type, isNew: existing === null };
}

/** Grupo: o criador vira admin. */
export async function createGroup(userId: number, name: string, memberIds: number[]) {
  const found = await Promise.all(memberIds.map((id) => users.findById(id)));
  if (found.some((user) => !user)) {
    throw AppError.badRequest('Um dos participantes não existe');
  }

  const chat = await chats.createGroup(name, userId, memberIds);
  events.joinChat(chat.id, [userId, ...memberIds]);
  events.chatCreated(chat.id);

  return { id: chat.id, type: chat.type, name };
}

/**
 * Nome, foto, descrição e o modo "só admins enviam".
 *
 * Cada mudança deixa um aviso no grupo — mudar o nome de um grupo em silêncio é
 * como as pessoas perdem a conversa de vista. O que não mudou de fato não
 * anuncia nada: salvar o formulário sem mexer em nada não pode encher a conversa
 * de avisos.
 */
export async function updateGroup(
  chatId: string,
  userId: number,
  data: {
    name?: string;
    image?: string;
    description?: string;
    onlyAdminsSend?: boolean;
  },
): Promise<void> {
  const chat = await assertGroupAdmin(chatId, userId);

  await chats.updateGroup(chatId, {
    ...(data.name !== undefined ? { name: data.name } : {}),
    // Como no perfil, string vazia significa "remover a foto".
    ...(data.image !== undefined ? { image: data.image === '' ? null : data.image } : {}),
    // E, como na bio, string vazia limpa a descrição.
    ...(data.description !== undefined
      ? { description: data.description === '' ? null : data.description }
      : {}),
    ...(data.onlyAdminsSend !== undefined ? { onlyAdminsSend: data.onlyAdminsSend } : {}),
  });

  const actor = await nameOf(userId);

  if (data.name !== undefined && data.name !== chat.name) {
    await announce(chatId, userId, `${actor} mudou o nome do grupo para "${data.name}"`);
  }
  if (data.image !== undefined && (data.image || null) !== chat.image) {
    await announce(
      chatId,
      userId,
      data.image ? `${actor} mudou a foto do grupo` : `${actor} removeu a foto do grupo`,
    );
  }
  if (data.description !== undefined && (data.description || null) !== chat.description) {
    await announce(
      chatId,
      userId,
      data.description
        ? `${actor} mudou a descrição do grupo`
        : `${actor} removeu a descrição do grupo`,
    );
  }
  if (data.onlyAdminsSend !== undefined && data.onlyAdminsSend !== chat.onlyAdminsSend) {
    await announce(
      chatId,
      userId,
      data.onlyAdminsSend
        ? `${actor} deixou o envio só para administradores`
        : `${actor} liberou o envio para todos`,
    );
  }

  events.chatUpdated(chatId);
}

/**
 * Promove a administrador, ou tira.
 *
 * Um admin não consegue se rebaixar sendo o último: o grupo ficaria sem ninguém
 * que pudesse renomear, administrar membros ou promover alguém — travado para
 * sempre. É a mesma preocupação que faz a saída do criador promover quem está
 * há mais tempo (ver removeMember no repositório).
 */
export async function setAdmin(
  chatId: string,
  requesterId: number,
  targetId: number,
  isAdmin: boolean,
): Promise<void> {
  const chat = await assertGroupAdmin(chatId, requesterId);

  const target = chat.participants.find((p) => p.userId === targetId && p.leftAt === null);
  if (!target) throw AppError.badRequest('Esta pessoa não está no grupo');

  // Já está como se pede: nada a gravar, e nada a anunciar.
  if (target.isAdmin === isAdmin) return;

  if (!isAdmin) {
    const admins = chat.participants.filter((p) => p.leftAt === null && p.isAdmin);
    if (admins.length <= 1) {
      throw AppError.badRequest('O grupo ficaria sem nenhum administrador');
    }
  }

  await chats.setAdmin(chatId, targetId, isAdmin);

  const actor = await nameOf(requesterId);
  const name = await nameOf(targetId);
  await announce(
    chatId,
    requesterId,
    isAdmin
      ? `${actor} tornou ${name} administrador`
      : `${actor} removeu ${name} da administração`,
  );

  events.chatUpdated(chatId);
}

/**
 * Cria (ou troca) o link de convite do grupo.
 *
 * Gerar de novo invalida o anterior — é assim que se revoga um link que vazou.
 * O código é aleatório e longo: ele é a única credencial para entrar no grupo,
 * então adivinhá-lo tem de ser inviável.
 */
export async function createInvite(chatId: string, userId: number): Promise<string> {
  await assertGroupAdmin(chatId, userId);

  const code = randomBytes(12).toString('base64url');
  await chats.setInviteCode(chatId, code);

  return inviteUrlOf(code);
}

/** Apaga o convite: os links que já circulam param de funcionar. */
export async function revokeInvite(chatId: string, userId: number): Promise<void> {
  await assertGroupAdmin(chatId, userId);
  await chats.setInviteCode(chatId, null);
}

/**
 * Entra no grupo por um link de convite.
 *
 * Único caminho de entrada que não exige ser admin — é justamente o que o link
 * existe para permitir. Um código que não resolve responde "convite inválido"
 * sem dizer se ele nunca existiu ou se foi revogado: as duas respostas seriam a
 * mesma informação para quem está tentando adivinhar.
 */
export async function joinByInvite(
  code: string,
  userId: number,
): Promise<{ id: string; isNew: boolean }> {
  const chat = await chats.findByInviteCode(code);
  if (!chat || chat.type !== 'GROUP') {
    throw AppError.notFound('Convite inválido ou expirado');
  }

  const existing = chat.participants.find((p) => p.userId === userId);
  // Já está dentro: abrir o link de novo só leva à conversa, sem anunciar nada.
  if (existing && existing.leftAt === null) return { id: chat.id, isNew: false };

  await chats.addMembers(chat.id, [userId]);
  events.joinChat(chat.id, [userId]);

  await announce(chat.id, userId, `${await nameOf(userId)} entrou pelo link de convite`);
  events.chatUpdated(chat.id);

  return { id: chat.id, isNew: true };
}

/** Devolve quantos entraram de fato: quem já estava no grupo não conta. */
export async function addMembers(
  chatId: string,
  userId: number,
  memberIds: number[],
): Promise<number> {
  const chat = await assertGroupAdmin(chatId, userId);

  // Quem saiu tem linha, mas não está no grupo: precisa poder voltar.
  const already = new Set(
    chat.participants.filter((p) => p.leftAt === null).map((p) => p.userId),
  );
  const toAdd = memberIds.filter((id) => !already.has(id));

  if (toAdd.length > 0) {
    await chats.addMembers(chatId, toAdd);
    events.joinChat(chatId, toAdd);

    const actor = await nameOf(userId);
    const names = await Promise.all(toAdd.map(nameOf));
    // Um aviso só para a leva inteira: adicionar cinco pessoas de uma vez não
    // pode render cinco linhas seguidas na conversa.
    await announce(chatId, userId, `${actor} adicionou ${names.join(', ')}`);
  }

  events.chatUpdated(chatId);
  return toAdd.length;
}

export async function removeMember(
  chatId: string,
  requesterId: number,
  targetId: number,
): Promise<void> {
  // Sair do grupo não exige ser admin; remover outra pessoa exige.
  const isLeaving = targetId === requesterId;

  if (isLeaving) {
    const { chat } = await assertActiveParticipant(chatId, requesterId);
    if (chat.type !== 'GROUP') {
      throw AppError.badRequest('Conversa direta não tem como sair; exclua-a');
    }
  } else {
    await assertGroupAdmin(chatId, requesterId);
  }

  const promoted = await chats.removeMember(chatId, targetId);
  events.leaveChat(chatId, targetId);

  /*
   * O aviso é escrito depois da saída, e em nome de quem agiu.
   *
   * Quem sai deixa de ser participante ativo, então o `announce` não pode
   * passar pelo `assertCanWrite` — ele escreve direto no repositório, que é
   * o que permite a linha "Fulano saiu" existir na conversa que ele acabou
   * de deixar.
   */
  const actor = await nameOf(requesterId);
  await announce(
    chatId,
    requesterId,
    isLeaving ? `${actor} saiu do grupo` : `${actor} removeu ${await nameOf(targetId)}`,
  );

  // O criador saiu e a administração foi herdada: o grupo precisa saber de quem
  // é agora, senão a mudança de permissão aparece sem explicação nenhuma.
  if (promoted !== null) {
    await announce(chatId, promoted, `${await nameOf(promoted)} agora é administrador`);
  }

  events.chatUpdated(chatId);
  events.chatUpdatedFor(targetId, chatId);
}

/**
 * Uma conversa no formato da lista.
 *
 * Existe para o `chat-updated` do socket não custar a lista inteira: antes
 * qualquer mudança em qualquer conversa recarregava todas as conversas do
 * usuário, cada uma com participantes, última mensagem e fixada.
 *
 * Devolve null quando a conversa deixou de existir para ele — é o caso de quem
 * acabou de excluí-la.
 */
export async function summary(chatId: string, userId: number): Promise<Chat | null> {
  await assertParticipant(chatId, userId);

  const { chats: found } = await chats.listForUser(userId, { only: [chatId] });
  return found[0] ?? null;
}

/** Membros do grupo ou dados do contato — alimenta o painel de detalhes. */
export async function details(chatId: string, userId: number): Promise<ChatDetails> {
  await assertParticipant(chatId, userId);

  const chat = await chats.findByIdWithMembers(chatId);
  if (!chat) throw AppError.notFound('Conversa não encontrada');

  // Quem saiu não está entre os participantes ativos, e portanto não é admin.
  const isAdmin = chat.participants.some((p) => p.user.id === userId && p.isAdmin);

  return {
    id: chat.id,
    type: chat.type,
    name: chat.name,
    description: chat.description,
    onlyAdminsSend: chat.onlyAdminsSend,
    // Só para administrador: com o link, qualquer um entra no grupo — mandá-lo
    // para todo mundo seria distribuir a chave junto com a porta.
    ...(isAdmin
      ? { inviteUrl: chat.inviteCode ? inviteUrlOf(chat.inviteCode) : null }
      : {}),
    createdAt: chat.createdAt.toISOString(),
    members: chat.participants.map((p) => ({
      id: p.user.id,
      name: p.user.name,
      image: p.user.image ?? undefined,
      bio: p.user.bio,
      status: publicStatusOf(p.user),
      statusText: p.user.statusText,
      isOnline: p.user.isOnline,
      lastSeenAt: lastSeenOf(p.user),
      isAdmin: p.isAdmin,
      joinedAt: p.joinedAt.toISOString(),
    })),
  };
}

/** Fixa uma mensagem no topo da conversa; todos na conversa veem a mesma. */
export async function pinMessage(
  chatId: string,
  userId: number,
  messageId: string,
): Promise<void> {
  await assertActiveParticipant(chatId, userId);

  const message = await messages.findById(messageId);
  if (!message || message.chatId !== chatId) {
    throw AppError.badRequest('Mensagem não pertence a esta conversa');
  }
  if (message.deletedAt) {
    throw AppError.badRequest('Não dá para fixar uma mensagem apagada');
  }

  await chats.setPinnedMessage(chatId, messageId, userId);
  events.chatUpdated(chatId);
}

/** Solta o pino. Também aberto a qualquer participante ativo. */
export async function unpinMessage(chatId: string, userId: number): Promise<void> {
  await assertActiveParticipant(chatId, userId);
  await chats.setPinnedMessage(chatId, null, null);
  events.chatUpdated(chatId);
}

/**
 * Marca a conversa como lida.
 *
 * Avisa a sala para os recibos de leitura dos outros participantes — a menos
 * que este usuário tenha desligado o recibo, e aí ninguém fica sabendo que ele
 * leu. A leitura em si continua sendo gravada: ela é o que zera o não-lido dele.
 */
export async function markRead(chatId: string, userId: number): Promise<void> {
  await assertParticipant(chatId, userId);
  const readAt = await chats.markAsRead(chatId, userId);

  if (await users.sendsReadReceipts(userId)) {
    events.messagesRead(chatId, userId, readAt);
  }
}

/**
 * "Marcar como não lida" — estado privado de quem pediu, então não emite nada
 * para a sala: o recibo de leitura dos outros participantes não volta atrás.
 */
export async function markUnread(chatId: string, userId: number): Promise<void> {
  await assertParticipant(chatId, userId);
  await chats.markAsUnread(chatId, userId);
}

/** Fixar / desafixar na lista: preferência privada, sem eco para os outros. */
export async function setPinned(
  chatId: string,
  userId: number,
  isPinned: boolean,
): Promise<void> {
  await assertParticipant(chatId, userId);
  await chats.setPinned(chatId, userId, isPinned);
}

/**
 * Arquivar / desarquivar. Como fixar, é preferência privada e não ecoa para a
 * sala. Mensagem nova desarquiva sozinha — quem decide isso é o listForUser,
 * comparando o instante guardado com a última mensagem.
 */
export async function setArchived(
  chatId: string,
  userId: number,
  isArchived: boolean,
): Promise<void> {
  await assertParticipant(chatId, userId);
  await chats.setArchived(chatId, userId, isArchived);
}

/**
 * Silenciar: some o som e a notificação, o não-lido continua contando.
 *
 * Sem `minutes` é o "até eu desfazer"; com, é o prazo. As duas formas escrevem
 * as duas colunas, porque silenciar por 8h depois de ter silenciado para sempre
 * precisa desligar o "sempre" — senão o prazo venceria e a conversa continuaria
 * muda, sem nada na tela explicando por quê.
 */
export async function setMuted(
  chatId: string,
  userId: number,
  isMuted: boolean,
  minutes?: number,
): Promise<void> {
  await assertParticipant(chatId, userId);

  const until = isMuted && minutes ? new Date(Date.now() + minutes * 60_000) : null;
  await chats.setMuted(chatId, userId, isMuted && until === null, until);
}

/**
 * "Limpar conversa": o histórico some só para quem pediu, e a conversa fica na
 * lista. Nenhuma mensagem é apagada — o outro participante continua vendo
 * tudo, então não há o que ecoar para a sala.
 */
export async function clearHistory(chatId: string, userId: number): Promise<void> {
  await assertParticipant(chatId, userId);
  await chats.clearHistory(chatId, userId);
}

/**
 * "Excluir conversa": limpar e ainda sumir da lista, só para quem pediu.
 *
 * Em grupo exige ter saído antes: esconder a conversa continuando membro daria
 * uma conversa que reaparece sozinha e da qual não dá para sair.
 */
export async function remove(chatId: string, userId: number): Promise<void> {
  const { chat, participant } = await assertParticipant(chatId, userId);

  if (chat.type === 'GROUP' && !participant.leftAt) {
    throw AppError.badRequest('Saia do grupo antes de excluir a conversa');
  }

  await chats.hideChat(chatId, userId);
}
