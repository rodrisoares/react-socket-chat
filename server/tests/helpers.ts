import bcrypt from 'bcryptjs';
import { prisma } from '../src/config/prisma.js';
import { signToken } from '../src/config/jwt.js';
import * as sessions from '../src/repositories/sessionRepository.js';

/** Zera o banco entre os testes, respeitando a ordem das FKs. */
export async function resetDb(): Promise<void> {
  await prisma.message.deleteMany();
  await prisma.chatParticipant.deleteMany();
  await prisma.chat.deleteMany();
  await prisma.user.deleteMany();
}

export async function createUser(
  name: string,
  email: string,
  password = 'segredo123',
): Promise<{ id: number; email: string; password: string }> {
  const user = await prisma.user.create({
    data: {
      name,
      email,
      passwordHash: await bcrypt.hash(password, 4),
    },
  });
  return { id: user.id, email, password };
}

export async function createDirectChat(a: number, b: number): Promise<string> {
  const chat = await prisma.chat.create({
    data: {
      type: 'DIRECT',
      // Como o repositorio de verdade: sem o instante de atividade a conversa
      // cai para o fim da ordenacao, que agora e feita pelo banco.
      lastMessageAt: new Date(),
      participants: { create: [{ userId: a }, { userId: b }] },
    },
  });
  return chat.id;
}

/** O supertest devolve `body: any`; isto dá um tipo ao que a API promete. */
export function body<T>(response: { body: unknown }): T {
  return response.body as T;
}

/**
 * A lista de conversas vem paginada: `{ chats, nextCursor }`. Este atalho
 * devolve só as conversas, que é o que quase todo teste quer olhar.
 */
export function chatList<T>(response: { body: unknown }): T[] {
  return (response.body as { chats: T[] }).chats;
}

export interface LoginBody {
  token: string;
  user: { id: number; name: string; chats: unknown[] };
}

export interface ErrorBody {
  error: string;
  issues?: { campo: string; mensagem: string }[];
}

export interface MeBody {
  id: number;
  name: string;
  isLogged: boolean;
  chats: unknown[];
}

/**
 * Semeia mensagens direto no banco, com createdAt crescente.
 * Bem mais rápido que enviar por HTTP quando o alvo do teste é a leitura.
 */
export async function seedMessages(
  chatId: string,
  senderId: number,
  count: number,
): Promise<void> {
  const base = Date.now() - count * 60_000;

  await prisma.message.createMany({
    data: Array.from({ length: count }, (_, i) => ({
      chatId,
      senderId,
      text: `msg ${i + 1}`,
      createdAt: new Date(base + i * 60_000),
    })),
  });

  // O repositorio mantem este campo ao criar mensagem; aqui as mensagens
  // entram direto, entao a atualizacao e manual — e ela que ordena a lista.
  await prisma.chat.update({
    where: { id: chatId },
    data: { lastMessageAt: new Date(base + (count - 1) * 60_000) },
  });
}

/**
 * Token assinado direto, sem passar pelo login — que tem teste próprio em
 * auth.test.ts.
 *
 * A sessão é fictícia: o HTTP não consulta a tabela de sessões (o access
 * token é sem estado), então qualquer id serve. O socket consulta — para ele,
 * use o sessionTokenFor.
 */
export function tokenFor(userId: number): string {
  return signToken(userId, 'sessao-de-teste');
}

/** Token de uma sessão que existe de verdade, como o handshake do socket exige. */
export async function sessionTokenFor(
  userId: number,
): Promise<{ token: string; sessionId: string }> {
  const session = await sessions.create(userId, sessions.newToken());
  return { token: signToken(userId, session.id), sessionId: session.id };
}

/**
 * Arquivos de verdade para os testes de anexo: o upload confere os bytes, e
 * um Buffer qualquer declarado como imagem passou a ser recusado.
 */
export const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

/** O mínimo que o file-type — e um leitor de PDF — reconhece como PDF. */
export const PDF_MIN = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');

/** Conteúdo válido para o tipo pedido; texto para qualquer outro. */
export function sampleFile(type: string): Buffer {
  if (type === 'image/png') return PNG_1PX;
  if (type === 'application/pdf') return PDF_MIN;
  return Buffer.from('conteudo');
}
