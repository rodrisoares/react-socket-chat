import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { MESSAGES_PAGE_SIZE } from '@react-chat/shared';
import type { MessagePage } from '@react-chat/shared';

import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';
import {
  body,
  createDirectChat,
  createUser,
  resetDb,
  seedMessages,
  tokenFor,
} from './helpers.js';

/** Metade da pagina de cada lado, como o messageService calcula. */
const RAIO = Math.floor(MESSAGES_PAGE_SIZE / 2);

describe('GET /api/chats/:id/messages?around=', () => {
  beforeEach(resetDb);

  /**
   * O salto ate a citacao, a fixada ou um resultado da busca. Antes o cliente
   * so sabia pedir "mais uma pagina para tras", com teto de cinco: uma mensagem
   * mais funda do que isso nao era alcancavel.
   */
  it('abre a janela em volta da mensagem pedida', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);
    await seedMessages(chatId, luiz.id, 100);

    const todas = await prisma.message.findMany({
      where: { chatId },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    const alvo = todas[50];
    if (!alvo) throw new Error('o seed nao gravou as mensagens');

    const resposta = await request(app)
      .get(`/api/chats/${chatId}/messages?around=${alvo.id}`)
      .set('Authorization', `Bearer ${tokenFor(luiz.id)}`)
      .expect(200);

    const pagina = body<MessagePage>(resposta);

    // O raio de cada lado mais a propria mensagem, com ela no centro.
    expect(pagina.messages).toHaveLength(RAIO * 2 + 1);
    expect(pagina.messages[RAIO]?.id).toBe(alvo.id);

    // Sobrou historico dos dois lados: a janela e um trecho do meio.
    expect(pagina.hasMore).toBe(true);
    expect(pagina.hasMoreAfter).toBe(true);
  });

  it('avisa quando nao ha mais nada depois — a janela bate no fim da conversa', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);
    await seedMessages(chatId, luiz.id, 40);

    const ultima = await prisma.message.findFirst({
      where: { chatId },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });

    const pagina = body<MessagePage>(
      await request(app)
        .get(`/api/chats/${chatId}/messages?around=${ultima?.id ?? ''}`)
        .set('Authorization', `Bearer ${tokenFor(luiz.id)}`)
        .expect(200),
    );

    expect(pagina.hasMoreAfter).toBe(false);
    expect(pagina.hasMore).toBe(true);
  });

  it('recusa uma mensagem de outra conversa', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const ana = await createUser('Ana', 'ana@email.com');

    const daDupla = await createDirectChat(luiz.id, joao.id);
    const deFora = await createDirectChat(joao.id, ana.id);
    await seedMessages(daDupla, luiz.id, 5);
    await seedMessages(deFora, joao.id, 5);

    const alheia = await prisma.message.findFirst({
      where: { chatId: deFora },
      select: { id: true },
    });

    await request(app)
      .get(`/api/chats/${daDupla}/messages?around=${alheia?.id ?? ''}`)
      .set('Authorization', `Bearer ${tokenFor(luiz.id)}`)
      .expect(404);
  });
});

/**
 * A volta do salto.
 *
 * O `around` ja dizia que sobrava mensagem mais nova, e nao havia como pedi-la:
 * quem pulasse ate uma mensagem antiga ficava preso naquele trecho, com
 * caminho so para tras. Este e o sentido que faltava.
 */
describe('GET /api/chats/:id/messages?after=', () => {
  beforeEach(resetDb);

  it('anda para a frente a partir do cursor', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);
    await seedMessages(chatId, luiz.id, 100);

    const todas = await prisma.message.findMany({
      where: { chatId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, createdAt: true },
    });
    const cursor = todas[20];
    if (!cursor) throw new Error('o seed nao gravou as mensagens');

    const pagina = body<MessagePage>(
      await request(app)
        .get(
          `/api/chats/${chatId}/messages` +
            `?after=${encodeURIComponent(cursor.createdAt.toISOString())}` +
            `&afterId=${encodeURIComponent(cursor.id)}`,
        )
        .set('Authorization', `Bearer ${tokenFor(luiz.id)}`)
        .expect(200),
    );

    expect(pagina.messages).toHaveLength(MESSAGES_PAGE_SIZE);
    // Em ordem cronologica, e comecando logo depois do cursor.
    expect(pagina.messages[0]?.id).toBe(todas[21]?.id);
    // Sobrou conversa a frente: ainda nao e o fim.
    expect(pagina.hasMoreAfter).toBe(true);
  });

  it('avisa quando alcanca o fim da conversa', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);
    await seedMessages(chatId, luiz.id, 10);

    const primeira = await prisma.message.findFirst({
      where: { chatId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, createdAt: true },
    });
    if (!primeira) throw new Error('o seed nao gravou as mensagens');

    const pagina = body<MessagePage>(
      await request(app)
        .get(
          `/api/chats/${chatId}/messages` +
            `?after=${encodeURIComponent(primeira.createdAt.toISOString())}` +
            `&afterId=${encodeURIComponent(primeira.id)}`,
        )
        .set('Authorization', `Bearer ${tokenFor(luiz.id)}`)
        .expect(200),
    );

    expect(pagina.messages).toHaveLength(9);
    expect(pagina.hasMoreAfter).toBe(false);
  });

  /** O mesmo empate que o `beforeId` resolve, do outro lado do corte. */
  it('nao repete as irmas do mesmo milissegundo', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);

    const instante = new Date();
    await prisma.message.createMany({
      data: Array.from({ length: 5 }, (_, i) => ({
        chatId,
        senderId: luiz.id,
        text: `simultanea ${i + 1}`,
        createdAt: instante,
      })),
    });

    const todas = await prisma.message.findMany({
      where: { chatId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
    const cursor = todas[1];
    if (!cursor) throw new Error('as mensagens nao foram gravadas');

    const pagina = body<MessagePage>(
      await request(app)
        .get(
          `/api/chats/${chatId}/messages` +
            `?after=${encodeURIComponent(instante.toISOString())}` +
            `&afterId=${encodeURIComponent(cursor.id)}`,
        )
        .set('Authorization', `Bearer ${tokenFor(luiz.id)}`)
        .expect(200),
    );

    // Só as três de depois do cursor, e nenhuma delas é o próprio cursor.
    expect(pagina.messages).toHaveLength(3);
    expect(pagina.messages.some((message) => message.id === cursor.id)).toBe(false);
  });

  it('recusa um instante que não é data', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);

    await request(app)
      .get(`/api/chats/${chatId}/messages?after=ontem`)
      .set('Authorization', `Bearer ${tokenFor(luiz.id)}`)
      .expect(400);
  });

  /**
   * Quem saiu do grupo nao anda para a frente ate o presente: o corte da saida
   * vale aqui como vale no historico e na busca.
   */
  it('respeita o corte de quem saiu do grupo', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);
    await seedMessages(chatId, joao.id, 20);

    const todas = await prisma.message.findMany({
      where: { chatId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, createdAt: true },
    });
    const cursor = todas[2];
    const saida = todas[9];
    if (!cursor || !saida) throw new Error('o seed nao gravou as mensagens');

    await prisma.chatParticipant.updateMany({
      where: { chatId, userId: luiz.id },
      data: { leftAt: saida.createdAt },
    });

    const pagina = body<MessagePage>(
      await request(app)
        .get(
          `/api/chats/${chatId}/messages` +
            `?after=${encodeURIComponent(cursor.createdAt.toISOString())}` +
            `&afterId=${encodeURIComponent(cursor.id)}`,
        )
        .set('Authorization', `Bearer ${tokenFor(luiz.id)}`)
        .expect(200),
    );

    // Da quarta ate a decima, e nada do que o grupo escreveu depois da saida.
    expect(pagina.messages).toHaveLength(7);
    expect(pagina.messages.at(-1)?.id).toBe(saida.id);
    expect(pagina.hasMoreAfter).toBe(false);
  });
});

describe('GET /api/chats/:id/messages — empate de milissegundo', () => {
  beforeEach(resetDb);

  /**
   * O bug que o cursor com id corrige: paginando so pelo `createdAt`, a pagina
   * seguinte pede "anterior a T" e deixa de fora as irmas que tambem nasceram
   * em T. Elas somem da conversa sem ninguem notar.
   */
  it('nao pula mensagens criadas no mesmo instante', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);

    const instante = new Date();
    const total = MESSAGES_PAGE_SIZE + 5;

    await prisma.message.createMany({
      data: Array.from({ length: total }, (_, i) => ({
        chatId,
        senderId: luiz.id,
        text: `simultanea ${i + 1}`,
        createdAt: instante,
      })),
    });

    const token = `Bearer ${tokenFor(luiz.id)}`;

    const primeira = body<MessagePage>(
      await request(app)
        .get(`/api/chats/${chatId}/messages`)
        .set('Authorization', token)
        .expect(200),
    );

    expect(primeira.messages).toHaveLength(MESSAGES_PAGE_SIZE);
    expect(primeira.hasMore).toBe(true);

    const maisAntiga = primeira.messages[0];
    if (!maisAntiga) throw new Error('a primeira pagina veio vazia');

    const cursor =
      `?before=${encodeURIComponent(maisAntiga.createdAt)}` +
      `&beforeId=${encodeURIComponent(maisAntiga.id)}`;

    const segunda = body<MessagePage>(
      await request(app)
        .get(`/api/chats/${chatId}/messages${cursor}`)
        .set('Authorization', token)
        .expect(200),
    );

    const ids = new Set([...primeira.messages, ...segunda.messages].map((m) => m.id));

    // Nada repetido e nada perdido: as duas paginas somam a conversa inteira.
    expect(ids.size).toBe(total);
  });

  /** O motivo de o `beforeId` existir, dito em teste. */
  it('so com o instante, as irmas do mesmo milissegundo ficam invisiveis', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);

    const instante = new Date();

    await prisma.message.createMany({
      data: Array.from({ length: MESSAGES_PAGE_SIZE + 5 }, (_, i) => ({
        chatId,
        senderId: luiz.id,
        text: `simultanea ${i + 1}`,
        createdAt: instante,
      })),
    });

    const token = `Bearer ${tokenFor(luiz.id)}`;

    const primeira = body<MessagePage>(
      await request(app)
        .get(`/api/chats/${chatId}/messages`)
        .set('Authorization', token)
        .expect(200),
    );

    const maisAntiga = primeira.messages[0];
    if (!maisAntiga) throw new Error('a primeira pagina veio vazia');

    const semId = body<MessagePage>(
      await request(app)
        .get(
          `/api/chats/${chatId}/messages?before=${encodeURIComponent(maisAntiga.createdAt)}`,
        )
        .set('Authorization', token)
        .expect(200),
    );

    // O corte e so "anterior a T", e nenhuma das que sobraram e anterior a T.
    expect(semId.messages).toHaveLength(0);
  });
});
