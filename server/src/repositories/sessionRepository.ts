import { createHash, randomBytes } from 'node:crypto';

import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';

/**
 * Sessoes de longa duracao — o refresh token e a lista de dispositivos.
 *
 * A tabela guarda o hash, nunca o token: quem ler o banco nao consegue se
 * passar por ninguem, do mesmo jeito que o passwordHash protege a senha.
 */

/** Token cru, entregue uma unica vez a quem entrou. */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * SHA-256, e nao bcrypt: o token ja nasce com 256 bits de entropia, entao nao
 * ha o que adivinhar por forca bruta — e o hash e consultado a cada renovacao,
 * onde o custo do bcrypt apareceria.
 */
function hashOf(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function expiresAt(from = new Date()): Date {
  return new Date(from.getTime() + env.refreshExpiresDays * 24 * 60 * 60 * 1000);
}

/** Projecao que a lista de sessoes mostra: nunca inclui o hash. */
const publicSessionSelect = {
  id: true,
  userAgent: true,
  createdAt: true,
  lastUsedAt: true,
  expiresAt: true,
} as const;

export function create(userId: number, token: string, userAgent?: string) {
  return prisma.session.create({
    data: {
      userId,
      tokenHash: hashOf(token),
      ...(userAgent ? { userAgent: userAgent.slice(0, 200) } : {}),
      expiresAt: expiresAt(),
    },
  });
}

/** A sessao viva daquele token, ou null: expirada e encerrada nao contam. */
export function findValid(token: string) {
  return prisma.session.findFirst({
    where: {
      tokenHash: hashOf(token),
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
  });
}

/**
 * Rotaciona o token da sessao, na propria linha.
 *
 * Trocar o hash em vez de criar outra linha mantem a identidade do
 * dispositivo: a lista de sessoes continua mostrando "entrou em tal dia" em
 * vez de nascer de novo a cada renovacao. O token antigo deixa de casar com
 * qualquer linha, entao reapresenta-lo simplesmente falha.
 */
export function rotate(id: string, token: string) {
  return prisma.session.update({
    where: { id },
    data: {
      tokenHash: hashOf(token),
      lastUsedAt: new Date(),
      expiresAt: expiresAt(),
    },
  });
}

export function revoke(id: string, userId: number) {
  return prisma.session.updateMany({
    where: { id, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/**
 * A sessao existe, e deste usuario, e ainda vale? Consultado no handshake do
 * socket: o token dela pode continuar valido depois de ela ser encerrada.
 */
export async function isActive(id: string, userId: number): Promise<boolean> {
  const found = await prisma.session.findFirst({
    where: { id, userId, revokedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true },
  });

  return found !== null;
}

/**
 * Encerra a sessao daquele token. Devolve qual foi — quem chama derruba as
 * conexoes de socket dela —, ou null quando nao havia sessao viva.
 */
export async function revokeByToken(token: string) {
  const found = await prisma.session.findFirst({
    where: { tokenHash: hashOf(token), revokedAt: null },
    select: { id: true, userId: true },
  });
  if (!found) return null;

  await prisma.session.update({
    where: { id: found.id },
    data: { revokedAt: new Date() },
  });

  return found;
}

/** Encerra todas as outras — a opcao "sair dos demais dispositivos". */
export function revokeOthers(userId: number, keepId: string) {
  return prisma.session.updateMany({
    where: { userId, revokedAt: null, id: { not: keepId } },
    data: { revokedAt: new Date() },
  });
}

export function listActive(userId: number) {
  return prisma.session.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastUsedAt: 'desc' },
    select: publicSessionSelect,
  });
}

/**
 * Limpa o que ja nao vale nada. Roda na subida do servidor: sessao expirada ou
 * encerrada so ocupa espaco, e guardar hash de token morto nao protege ninguem.
 */
export function purgeDead() {
  return prisma.session.deleteMany({
    where: {
      OR: [{ expiresAt: { lt: new Date() } }, { revokedAt: { not: null } }],
    },
  });
}
