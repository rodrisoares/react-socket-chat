import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
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
// Apelidado porque este módulo já exporta um `revokeSession` — o da rota, que
// encerra a sessão no banco. O de lá só alcança o token que já foi assinado.
import {
  revokeSession as revokeStatelessAccess,
  revokeSessions,
} from '../config/revokedSessions.js';
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
    const { ids } = await sessions.revokeOthers(userId, currentSession);

    // O refresh das outras morre no banco; o access token delas continuaria
    // valendo por até 15 min, e é esta lista que o alcança.
    revokeSessions(ids);
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

  // Sem carregar as participações antes: quem recorta por conversa agora é o
  // próprio SQL da busca, com um join — ver bestPerChat.
  const found = await messages.searchForUser(term, userId);

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

  // Sem isto, "encerrar" derrubava o socket na hora e deixava o HTTP daquele
  // aparelho funcionando até o access token dele vencer.
  revokeStatelessAccess(sessionId);
  await events.disconnectSessions(userId, (id) => id === sessionId);
}

/**
 * "Sair dos outros dispositivos". A sessão atual fica: encerrar tudo derrubaria
 * quem pediu, que é o oposto do que a ação promete.
 */
export async function revokeOtherSessions(userId: number, keep: string): Promise<number> {
  const { count, ids } = await sessions.revokeOthers(userId, keep);

  revokeSessions(ids);
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
 * Exclui a conta — anonimizando, e não apagando a linha.
 *
 * A diferença não é detalhe de implementação: o `senderId` de toda mensagem
 * aponta para o usuário com `onDelete: Cascade`, então apagar a linha levaria
 * junto tudo o que a pessoa escreveu. Cada grupo de que ela participou ficaria
 * com metade do diálogo — perguntas sem resposta e respostas sem pergunta, na
 * conversa de outras pessoas, que não pediram nada disso.
 *
 * O que sai de fato: nome, e-mail, senha, foto, bio, recado, presença e o
 * arquivo do avatar. O que fica é o texto das mensagens, atribuído a "Usuário
 * excluído".
 *
 * A senha é pedida porque esta é a única ação do app sem volta, e ela é o que
 * distingue o dono de quem encontrou a aba aberta.
 */
export async function deleteAccount(userId: number, password: string): Promise<void> {
  const found = await users.findByIdWithHash(userId);
  if (!found) throw AppError.notFound('Usuário não encontrado');

  if (!(await bcrypt.compare(password, found.passwordHash))) {
    throw AppError.badRequest('Senha incorreta');
  }

  /*
   * O aviso aos contatos sai antes da saída das conversas.
   *
   * O `profileUpdated` emite para quem divide conversa com a pessoa, e essa
   * lista é montada a partir das participações ativas — depois do `leaveAll`
   * ela estaria vazia, e ninguém receberia nada.
   */
  const anonymous = await users.anonymize(userId, await bcrypt.hash(randomUUID(), 4));
  await events.profileUpdated(userId, publicUser(anonymous), publicUser(anonymous));

  // Sai de todas as conversas: continuando participante ativa, a conta
  // anonimizada seria contada em "N participantes" e ficaria eternamente
  // pendente no recibo de leitura — o ✓✓ daquele grupo nunca mais fecharia.
  const chatIds = await chats.leaveAllChats(userId);
  for (const chatId of chatIds) events.chatUpdated(chatId);

  // A foto era arquivo deste servidor: sem isto ela continuaria servida por
  // URL assinada a quem já a tivesse.
  if (found.image?.startsWith('/uploads/')) await removeUpload(found.image);

  // Todas as sessões, inclusive a que pediu: não há mais conta para voltar.
  const { ids } = await sessions.revokeAll(userId);
  revokeSessions(ids);
  await events.disconnectSessions(userId, () => true);
}

/**
 * Tudo o que este servidor guarda sobre o usuário, num JSON só.
 *
 * As mensagens são as dele, e não as das conversas: o que os outros
 * escreveram para ele não é dado dele, e pô-lo num arquivo exportável seria
 * entregar de bandeja a conversa privada de terceiros. As conversas entram como
 * contexto — id, tipo, nome e quando ele entrou.
 *
 * O anexo entra pelo nome e pelo tipo, sem o arquivo: um JSON com fotos dentro
 * seria pesado demais para uma rota síncrona, e o link assinado vence.
 */
export async function exportData(userId: number) {
  const user = await users.findById(userId);
  if (!user) throw AppError.notFound('Usuário não encontrado');

  const [participations, written, reactions, savedRows, blocked, devices] =
    await Promise.all([
      chats.listForExport(userId),
      messages.listByAuthor(userId),
      messages.listReactionsBy(userId),
      saved.listSaved(userId, SAVED_LIMIT),
      blocks.listBlockedUsers(userId),
      sessions.listActive(userId),
    ]);

  return {
    exportedAt: new Date().toISOString(),
    /** O que a exportação cobre, dito no próprio arquivo. */
    sobre:
      'Dados da sua conta neste servidor. As mensagens listadas são as que você enviou; o que outras pessoas escreveram pertence a elas e não entra aqui.',
    perfil: sessionUser(user),
    conversas: participations.map((participation) => ({
      id: participation.chat.id,
      tipo: participation.chat.type,
      nome: participation.chat.name,
      descricao: participation.chat.description,
      criadaEm: participation.chat.createdAt.toISOString(),
      entrouEm: participation.joinedAt.toISOString(),
      saiuEm: participation.leftAt?.toISOString() ?? null,
      fixada: participation.isPinned,
      silenciada: participation.isMuted,
      arquivadaEm: participation.archivedAt?.toISOString() ?? null,
      limpaEm: participation.clearedAt?.toISOString() ?? null,
      excluidaEm: participation.hiddenAt?.toISOString() ?? null,
    })),
    mensagens: written.map((message) => ({
      id: message.id,
      conversaId: message.chatId,
      texto: message.deletedAt ? '' : message.text,
      enviadaEm: message.createdAt.toISOString(),
      editadaEm: message.editedAt?.toISOString() ?? null,
      apagadaEm: message.deletedAt?.toISOString() ?? null,
      encaminhada: message.isForwarded,
      anexo: message.attachmentName
        ? { nome: message.attachmentName, tipo: message.attachmentType }
        : null,
    })),
    reacoes: reactions.map((reaction) => ({
      mensagemId: reaction.messageId,
      emoji: reaction.emoji,
      em: reaction.createdAt.toISOString(),
    })),
    salvas: savedRows.map((row) => ({
      mensagemId: row.message.id,
      conversaId: row.message.chat.id,
      salvaEm: row.createdAt.toISOString(),
    })),
    bloqueados: blocked.map((person) => ({ id: person.id, nome: person.name })),
    dispositivos: devices.map((device) => ({
      userAgent: device.userAgent,
      entrouEm: device.createdAt.toISOString(),
      ultimoUso: device.lastUsedAt.toISOString(),
    })),
  };
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
