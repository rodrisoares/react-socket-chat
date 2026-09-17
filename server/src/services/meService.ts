import bcrypt from 'bcryptjs';
import { CONTACTS_PAGE_SIZE } from '@react-chat/shared';
import type {
  ChatPage,
  SavedMessage,
  SearchHit,
  SessionUser,
  User,
} from '@react-chat/shared';
import type { UpdateProfileInput } from '@react-chat/shared/schemas';

import { env } from '../config/env.js';
import { removeUpload } from '../config/upload.js';
import { AppError } from '../errors/AppError.js';
import * as blocks from '../repositories/blockRepository.js';
import * as chats from '../repositories/chatRepository.js';
import { publicUser, sessionUser } from '../repositories/mappers.js';
import * as messages from '../repositories/messageRepository.js';
import * as saved from '../repositories/savedRepository.js';
import * as sessions from '../repositories/sessionRepository.js';
import * as users from '../repositories/userRepository.js';
import { isVisible, visibilityOf } from '../repositories/visibility.js';
import * as events from '../socket/events.js';

/** O que é do próprio usuário: perfil, conversas, favoritos, bloqueios, sessões. */

/** Teto da lista de salvas: ela é um atalho, não um segundo histórico. */
const SAVED_LIMIT = 100;

/** Abaixo disto a busca não vale a viagem. */
const MIN_SEARCH_LENGTH = 2;

export async function profile(userId: number): Promise<SessionUser> {
  const user = await users.findById(userId);
  if (!user) throw AppError.notFound('Usuário não encontrado');

  return sessionUser(user);
}

/** Perfil editável: nome, foto, bio, status, privacidade e senha. */
export async function updateProfile(
  userId: number,
  currentSession: string,
  input: UpdateProfileInput,
): Promise<SessionUser> {
  const data: {
    name?: string;
    image?: string | null;
    bio?: string | null;
    status?: string;
    statusText?: string | null;
    isAway?: boolean;
    showLastSeen?: boolean;
    showReadReceipts?: boolean;
    passwordHash?: string;
  } = {};

  if (input.name) data.name = input.name;
  // Diferente do nome: string vazia em image e bio significa "limpar",
  // entao o teste e contra undefined, nao contra falsy.
  if (input.image !== undefined) data.image = input.image === '' ? null : input.image;
  if (input.bio !== undefined) data.bio = input.bio === '' ? null : input.bio;
  if (input.status) data.status = input.status;
  // Como a bio: string vazia limpa o recado, entao testa-se contra undefined.
  if (input.statusText !== undefined) {
    data.statusText = input.statusText === '' ? null : input.statusText;
  }
  // Ausencia automatica: coluna propria, nunca sobrescreve o `status` escolhido
  // a mao — quem marcou "Ocupado" e foi almocar volta "Ocupado".
  if (input.isAway !== undefined) data.isAway = input.isAway;
  if (input.showLastSeen !== undefined) data.showLastSeen = input.showLastSeen;
  if (input.showReadReceipts !== undefined) data.showReadReceipts = input.showReadReceipts;

  if (input.newPassword) {
    const found = await users.findByIdWithHash(userId);
    if (!found) throw AppError.notFound('Usuário não encontrado');

    const matches = await bcrypt.compare(input.currentPassword ?? '', found.passwordHash);
    if (!matches) throw AppError.badRequest('Senha atual incorreta');

    data.passwordHash = await bcrypt.hash(input.newPassword, env.bcryptRounds);
  }

  if (Object.keys(data).length === 0) {
    throw AppError.badRequest('Nada para atualizar');
  }

  /*
   * A foto anterior, para sair do disco se ela era um upload próprio.
   *
   * Sem isto cada troca de avatar deixaria um arquivo em /uploads para sempre —
   * o mesmo vazamento que o `removeUpload` já evita ao apagar uma mensagem com
   * anexo. Só é lida quando a foto muda: nas outras edições seria uma consulta
   * a mais por nada.
   */
  const previous = data.image !== undefined ? await users.findById(userId) : null;

  const updated = await users.updateProfile(userId, data);

  // Só o que este servidor guarda: avatar do DiceBear é URL de terceiro, e não
  // há arquivo nenhum para remover.
  const old = previous?.image;
  if (old?.startsWith('/uploads/') && old !== data.image) {
    await removeUpload(old);
  }

  // Trocar a senha derruba os outros dispositivos: é o motivo mais comum para
  // trocar de senha. A sessão que pediu fica — ela vem no próprio token;
  // encerrar todas devolveria o usuário para a tela de login. As conexões de
  // socket abertas caem junto, e não só o refresh.
  if (data.passwordHash) {
    await sessions.revokeOthers(userId, currentSession);
    await events.disconnectSessions(userId, (sessionId) => sessionId !== currentSession);
  }

  const owner = sessionUser(updated);
  // O nome e a foto aparecem nas conversas dos outros — mas só de quem conversa
  // com ele, e sem o que a privacidade esconde. As outras abas do dono recebem
  // o objeto inteiro: é o interruptor dele que precisa acompanhar.
  await events.profileUpdated(userId, publicUser(updated), owner);

  return owner;
}

/**
 * Conversas do usuário. Antes só chegavam embutidas na resposta do login —
 * não havia nenhum GET na API.
 */
export function listChats(
  userId: number,
  options: { limit?: number; cursor?: string },
): Promise<ChatPage> {
  return chats.listForUser(userId, options);
}

/**
 * Busca por conteúdo em todas as conversas do usuário: uma ocorrência por
 * conversa, a mais recente. Antes a busca da lista só olhava as mensagens que
 * o cliente tinha em memória — as últimas 30 de cada conversa.
 */
export async function search(userId: number, term: string): Promise<SearchHit[]> {
  if (term.length < MIN_SEARCH_LENGTH) return [];

  const cutoffs = await chats.searchCutoffs(userId);
  const found = await messages.searchForUser(cutoffs, term, userId);

  return found.map((message) => ({
    chatId: message.chatId,
    message: chats.serializeMessage(message),
  }));
}

/**
 * Bloquear / desbloquear. Estado privado de quem bloqueou, como fixar e
 * silenciar: não ecoa nada para o outro lado — ele nunca é avisado.
 */
/**
 * Quem o usuário bloqueou, com nome e foto.
 *
 * Devolvia só ids, e a tela de bloqueados descobria os nomes cruzando-os com a
 * lista de contatos — o que só funcionava enquanto `/contacts` devolvia o banco
 * inteiro. Com a busca de contatos paginada, quem foi bloqueado deixaria de
 * aparecer na resposta e sumiria da tela sem nunca ter sido desbloqueado.
 */
export async function listBlocks(userId: number): Promise<User[]> {
  const found = await blocks.listBlockedUsers(userId);
  return found.map(publicUser);
}

export async function block(userId: number, targetId: number): Promise<void> {
  if (!Number.isInteger(targetId)) throw AppError.badRequest('Usuário inválido');
  if (targetId === userId) throw AppError.badRequest('Não dá para bloquear a si mesmo');
  if (!(await users.findById(targetId))) throw AppError.notFound('Usuário não encontrado');

  await blocks.block(userId, targetId);
}

export async function unblock(userId: number, targetId: number): Promise<void> {
  if (!Number.isInteger(targetId)) throw AppError.badRequest('Usuário inválido');
  await blocks.unblock(userId, targetId);
}

/**
 * Dispositivos conectados. A tela marca qual é o atual pelo sessionId que veio
 * no login.
 */
export function listSessions(userId: number) {
  return sessions.listActive(userId);
}

/**
 * Encerra uma sessão. Só as próprias: o filtro por userId garante isso. O
 * socket aberto por ela cai na hora — sem isto o aparelho continuava recebendo
 * mensagens pela conexão que já estava aberta.
 */
export async function revokeSession(userId: number, sessionId: string): Promise<void> {
  const { count } = await sessions.revoke(sessionId, userId);
  if (count === 0) throw AppError.notFound('Sessão não encontrada');

  await events.disconnectSessions(userId, (id) => id === sessionId);
}

/**
 * "Sair dos outros dispositivos". A sessão atual fica: encerrar tudo derrubaria
 * quem pediu, que é o oposto do que a ação promete.
 */
export async function revokeOtherSessions(userId: number, keep: string): Promise<number> {
  const { count } = await sessions.revokeOthers(userId, keep);
  await events.disconnectSessions(userId, (sessionId) => sessionId !== keep);

  return count;
}

/**
 * Favoritos. Privado de quem salvou — nada disto ecoa para a conversa, nem
 * para o autor da mensagem.
 */
export function savedIds(userId: number): Promise<string[]> {
  return saved.listIds(userId);
}

export async function listSaved(userId: number): Promise<SavedMessage[]> {
  const rows = await saved.listSaved(userId, SAVED_LIMIT);

  // O corte privado compara colunas da mesma linha, o que o Prisma não faz no
  // where: o que o usuário limpou, excluiu ou o que veio depois de ele sair do
  // grupo é filtrado aqui.
  const visible = rows.filter((row) => {
    const participation = row.message.chat.participants[0];
    return (
      participation !== undefined &&
      isVisible(row.message.createdAt, visibilityOf(participation))
    );
  });

  return visible.map((row) => ({
    chatId: row.message.chat.id,
    chatName: row.message.chat.name,
    chatType: row.message.chat.type,
    savedAt: row.createdAt.toISOString(),
    message: chats.serializeMessage(row.message),
  }));
}

export async function save(userId: number, messageId: string): Promise<void> {
  const message = await messages.findById(messageId);
  if (!message) throw AppError.notFound('Mensagem não encontrada');

  const participation = await chats.findParticipant(message.chatId, userId);
  if (!participation) throw AppError.forbidden('Usuário não participa desta conversa');

  // Só dá para salvar o que se pode ver: a checagem é a mesma do histórico.
  // Fora do corte — limpo, excluído, ou escrito depois de sair do grupo — a
  // mensagem não existe para este usuário.
  if (!isVisible(message.createdAt, visibilityOf(participation))) {
    throw AppError.notFound('Mensagem não encontrada');
  }

  await saved.save(userId, messageId);
}

export async function unsave(userId: number, messageId: string): Promise<void> {
  await saved.unsave(userId, messageId);
}

/**
 * Contatos para iniciar conversa ou montar grupo, filtrados no servidor.
 *
 * Devolvia todo usuário cadastrado, de uma vez, e a tela de "nova conversa" nem
 * campo de busca tinha: com cem contas eram cem perfis em cada abertura, e a
 * pessoa rolava a lista inteira procurando um nome. Agora o termo vai ao banco
 * e a resposta tem teto.
 *
 * Sem termo a lista continua vindo — só que a primeira página dela, em ordem
 * alfabética: abrir o seletor e não ver ninguém até digitar seria pior para
 * quem tem três contatos.
 */
export async function contacts(userId: number, term: string): Promise<User[]> {
  const found = await users.searchOthers(userId, term, CONTACTS_PAGE_SIZE);
  // Sem e-mail e sem os interruptores de privacidade: ver publicUser.
  return found.map(publicUser);
}
