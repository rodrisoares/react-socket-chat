import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';

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

describe('POST /api/chats/:id/messages — concorrencia', () => {
  beforeEach(resetDb);

  /**
   * O motivo desta fase existir: a versao antiga fazia read → modify → write
   * num arquivo JSON, sem lock, e perdia mensagens simultaneas. Com a transacao
   * do Prisma (task 1.7) nenhuma pode se perder.
   */
  it('grava as 30 mensagens enviadas em paralelo, sem perder nenhuma', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);
    const token = tokenFor(luiz.id);

    const total = 30;
    const envios = Array.from({ length: total }, (_, i) =>
      request(app)
        .post(`/api/chats/${chatId}/messages`)
        .set('Authorization', `Bearer ${token}`)
        .send({ text: `concorrente ${i + 1}` }),
    );

    const respostas = await Promise.all(envios);

    expect(respostas.every((r) => r.status === 200)).toBe(true);
    expect(await prisma.message.count({ where: { chatId } })).toBe(total);
  });

  it('nao duplica nem embaralha o conteudo sob concorrencia', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);
    const token = tokenFor(luiz.id);

    const textos = Array.from({ length: 20 }, (_, i) => `msg-${i + 1}`);
    await Promise.all(
      textos.map((text) =>
        request(app)
          .post(`/api/chats/${chatId}/messages`)
          .set('Authorization', `Bearer ${token}`)
          .send({ text }),
      ),
    );

    const gravadas = await prisma.message.findMany({ where: { chatId } });
    const gravados = gravadas.map((m) => m.text).sort();

    expect(gravados).toEqual([...textos].sort());
    expect(new Set(gravados).size).toBe(textos.length);
  });
});

describe('POST /api/chats/:id/messages — autorizacao', () => {
  beforeEach(resetDb);

  it('recusa 403 quem nao participa da conversa', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const ana = await createUser('Ana', 'ana@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);
    const tokenDaAna = tokenFor(ana.id);

    const response = await request(app)
      .post(`/api/chats/${chatId}/messages`)
      .set('Authorization', `Bearer ${tokenDaAna}`)
      .send({ text: 'invasao' });

    expect(response.status).toBe(403);
    expect(await prisma.message.count({ where: { chatId } })).toBe(0);
  });

  it('recusa 404 em conversa inexistente', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const token = tokenFor(luiz.id);

    const response = await request(app)
      .post('/api/chats/nao-existe/messages')
      .set('Authorization', `Bearer ${token}`)
      .send({ text: 'oi' });

    expect(response.status).toBe(404);
  });

  it('usa o remetente do token, nunca o userId do corpo', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);
    const token = tokenFor(luiz.id);

    await request(app)
      .post(`/api/chats/${chatId}/messages`)
      .set('Authorization', `Bearer ${token}`)
      // Tenta se passar pelo joao: o servidor tem de ignorar.
      .send({ text: 'quem enviou?', userId: joao.id });

    const message = await prisma.message.findFirst({ where: { chatId } });
    expect(message?.senderId).toBe(luiz.id);
  });

  it('recusa 400 mensagem sem texto e sem anexo', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);
    const token = tokenFor(luiz.id);

    const response = await request(app)
      .post(`/api/chats/${chatId}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ text: '   ' });

    expect(response.status).toBe(400);
  });
});

describe('edicao e exclusao', () => {
  beforeEach(resetDb);

  async function setup() {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);
    const token = tokenFor(luiz.id);

    const response = await request(app)
      .post(`/api/chats/${chatId}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ text: 'original' });

    return { luiz, joao, chatId, token, messageId: body<{ id: string }>(response).id };
  }

  it('marca a mensagem como editada', async () => {
    const { chatId, token, messageId } = await setup();

    const response = await request(app)
      .patch(`/api/chats/${chatId}/messages/${messageId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ text: 'editada' });

    expect(response.status).toBe(200);

    const message = await prisma.message.findUnique({ where: { id: messageId } });
    expect(message?.text).toBe('editada');
    expect(message?.editedAt).not.toBeNull();
  });

  it('recusa 403 quando outro usuario tenta editar', async () => {
    const { chatId, joao, messageId } = await setup();
    const tokenDoJoao = tokenFor(joao.id);

    const response = await request(app)
      .patch(`/api/chats/${chatId}/messages/${messageId}`)
      .set('Authorization', `Bearer ${tokenDoJoao}`)
      .send({ text: 'nao deveria' });

    expect(response.status).toBe(403);
  });

  /** Exclusao logica: a resposta que cita a mensagem nao pode quebrar. */
  it('apaga logicamente e preserva a resposta que a citava', async () => {
    const { chatId, token, messageId } = await setup();

    await request(app)
      .post(`/api/chats/${chatId}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ text: 'respondendo', replyToId: messageId });

    await request(app)
      .delete(`/api/chats/${chatId}/messages/${messageId}`)
      .set('Authorization', `Bearer ${token}`);

    const apagada = await prisma.message.findUnique({ where: { id: messageId } });
    expect(apagada).not.toBeNull();
    expect(apagada?.deletedAt).not.toBeNull();
    expect(apagada?.text).toBe('');

    const resposta = await prisma.message.findFirst({ where: { replyToId: messageId } });
    expect(resposta?.text).toBe('respondendo');
  });
});

describe('GET /api/chats/:id/messages — paginacao', () => {
  beforeEach(resetDb);

  it('pagina de 30 em 30, sem sobreposicao entre as paginas', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);
    const token = tokenFor(luiz.id);

    // Direto no banco: o alvo aqui e a leitura paginada, nao o envio.
    await seedMessages(chatId, luiz.id, 42);

    type Page = { messages: { id: string; text: string; createdAt: string }[]; hasMore: boolean };

    const primeira = body<Page>(
      await request(app)
        .get(`/api/chats/${chatId}/messages`)
        .set('Authorization', `Bearer ${token}`),
    );

    expect(primeira.messages).toHaveLength(30);
    expect(primeira.hasMore).toBe(true);
    expect(primeira.messages.at(-1)?.text).toBe('msg 42');

    const cursor = primeira.messages[0]?.createdAt ?? '';
    const segunda = body<Page>(
      await request(app)
        .get(`/api/chats/${chatId}/messages?before=${encodeURIComponent(cursor)}`)
        .set('Authorization', `Bearer ${token}`),
    );

    expect(segunda.messages).toHaveLength(12);
    expect(segunda.hasMore).toBe(false);

    const ids = new Set([
      ...primeira.messages.map((m) => m.id),
      ...segunda.messages.map((m) => m.id),
    ]);
    expect(ids.size).toBe(42);
  });

  it('recusa 400 com cursor invalido', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);
    const token = tokenFor(luiz.id);

    const response = await request(app)
      .get(`/api/chats/${chatId}/messages?before=nao-e-data`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(400);
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});
