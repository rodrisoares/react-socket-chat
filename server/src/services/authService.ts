import bcrypt from 'bcryptjs';
import type { AuthResponse } from '@react-chat/shared';
import type { RegisterInput } from '@react-chat/shared/schemas';

import { env } from '../config/env.js';
import { signToken } from '../config/jwt.js';
import { AppError } from '../errors/AppError.js';
import * as chats from '../repositories/chatRepository.js';
import { sessionUser } from '../repositories/mappers.js';
import * as sessions from '../repositories/sessionRepository.js';
import * as users from '../repositories/userRepository.js';
import * as events from '../socket/events.js';

/** Cadastro, entrada, renovação e saída — e a sessão de longa duração. */

/**
 * O que uma sessão nova produz.
 *
 * O `refreshToken` sai separado do resto de propósito: quem decide onde ele
 * fica é o controller, e ele vai para um cookie httpOnly — nunca para o corpo
 * da resposta, que o JavaScript da página lê.
 */
export interface SignedIn {
  token: string;
  sessionId: string;
  refreshToken: string;
  user: AuthResponse;
}

/**
 * Cria a conta e já abre a sessão.
 *
 * Antes devolvia só o usuário e a tela mandava para o login: a pessoa acabava
 * de digitar a senha duas vezes e era recebida com um pedido para digitá-la de
 * novo. O caminho é o mesmo do login daqui em diante — inclusive o refresh no
 * cookie, que quem grava é o controller.
 */
export async function register(
  input: RegisterInput,
  userAgent?: string,
): Promise<SignedIn> {
  if (await users.findByEmail(input.email)) {
    throw AppError.conflict('Este e-mail já está cadastrado');
  }

  const created = await users.create({
    name: input.name,
    email: input.email,
    passwordHash: await bcrypt.hash(input.password, env.bcryptRounds),
    ...(input.image ? { image: input.image } : {}),
  });

  const user = await authResponse(created.id);

  return { ...(await openSession(created.id, userAgent)), user };
}

/**
 * Abre uma sessão de longa duração para este dispositivo.
 *
 * São dois tokens com papéis diferentes: o `token`, curto, vai no header de
 * toda requisição e só existe na memória da aba; o `refreshToken`, longo, só
 * serve para pedir um `token` novo quando o antigo expira, e viaja no cookie.
 * O `sessionId` acompanha para a tela de sessões saber qual linha é "este
 * dispositivo".
 *
 * O id da sessão também vai dentro do `token`: é por ele que as conexões de
 * socket deste dispositivo são achadas e derrubadas quando a sessão acaba.
 */
async function openSession(userId: number, userAgent?: string) {
  const refreshToken = sessions.newToken();
  const session = await sessions.create(userId, refreshToken, userAgent);

  return { token: signToken(userId, session.id), refreshToken, sessionId: session.id };
}

/** O usuário com a primeira página da lista — o que /login e /me devolvem. */
async function authResponse(userId: number): Promise<AuthResponse> {
  const user = await users.findById(userId);
  if (!user) throw new AppError(401, 'Usuário não encontrado');

  const page = await chats.listForUser(userId);

  return { ...sessionUser(user), chats: page.chats, chatsCursor: page.nextCursor };
}

export async function login(
  email: string,
  password: string,
  userAgent?: string,
): Promise<SignedIn> {
  const found = await users.findByEmailWithHash(email);

  // Mensagem unica para nao revelar se o email existe.
  if (!found || !(await bcrypt.compare(password, found.passwordHash))) {
    throw new AppError(401, 'E-mail ou senha incorretos');
  }

  // O login não cria mais uma conversa com cada usuário do banco: eram N
  // consultas por entrada e uma lista cheia de conversas vazias. Conversa
  // nasce sob demanda, no POST /api/chats.
  //
  // E não marca mais presença: quem escreve o `isOnline` é só o connect e o
  // disconnect do socket. Marcando aqui, um login por HTTP que nunca abrisse
  // socket — um script, um cliente parado na tela de carregamento, uma conexão
  // que falha — deixava a pessoa "online" para sempre, porque o disconnect que
  // desfaria isso nunca chegava.
  const user = await authResponse(found.id);

  return { ...(await openSession(found.id, userAgent)), user };
}

/**
 * Renova o access token a partir do refresh.
 *
 * O refresh é rotacionado na mesma linha — o token antigo deixa de valer no
 * mesmo instante, então um vazamento só serve até a próxima renovação.
 */
export async function refresh(refreshToken: string) {
  const session = await sessions.findValid(refreshToken);
  if (!session) throw new AppError(401, 'Sessão expirada. Entre de novo.');

  const next = sessions.newToken();
  await sessions.rotate(session.id, next);

  return {
    token: signToken(session.userId, session.id),
    refreshToken: next,
    sessionId: session.id,
  };
}

/**
 * Encerra a sessão deste dispositivo. Sem isto, sair da conta deixava o refresh
 * válido por 30 dias na máquina de onde se saiu — e a conexão de socket aberta.
 */
export async function logout(refreshToken: string): Promise<void> {
  const session = await sessions.revokeByToken(refreshToken);
  if (!session) return;

  await events.disconnectSessions(session.userId, (sessionId) => sessionId === session.id);
}

/**
 * Restaura a sessão a partir do token — é o que faz o F5 parar de deslogar.
 *
 * Como o login, não toca na presença: ela é do socket. Este endpoint responde
 * também a quem só está renovando a tela, e marcar online aqui ressuscitava
 * quem tinha acabado de fechar a aba.
 */
export async function restore(userId: number): Promise<AuthResponse> {
  return authResponse(userId);
}
