import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';

import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';
import {
  body,
  chatList,
  createDirectChat,
  createUser,
  resetDb,
  seedMessages,
  tokenFor,
} from './helpers.js';

interface ChatBody {
  id: string;
  name: string;
  isPinned: boolean;
  unreadMessages: number;
}

/** Conversas do usuario logado, como o client as recebe. */
async function listChats(userId: number): Promise<ChatBody[]> {
  const response = await request(app)
    .get('/api/me/chats')
    .set('Authorization', `Bearer ${tokenFor(userId)}`);

  return chatList<ChatBody>(response);
}

describe('marcar conversa como lida / nao lida', () => {
  beforeEach(resetDb);

  it('zera o nao lido sem precisar abrir a conversa', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);
    await seedMessages(chatId, joao.id, 3);

    expect((await listChats(luiz.id))[0]?.unreadMessages).toBe(3);

    await request(app)
      .post(`/api/chats/${chatId}/readMessages`)
      .set('Authorization', `Bearer ${tokenFor(luiz.id)}`)
      .expect(200);

    expect((await listChats(luiz.id))[0]?.unreadMessages).toBe(0);
  });

  it('mantem a conversa marcada como nao lida depois de lida', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);
    await seedMessages(chatId, joao.id, 2);

    const token = `Bearer ${tokenFor(luiz.id)}`;
    await request(app).post(`/api/chats/${chatId}/readMessages`).set('Authorization', token);
    await request(app)
      .post(`/api/chats/${chatId}/unreadMessages`)
      .set('Authorization', token)
      .expect(200);

    expect((await listChats(luiz.id))[0]?.unreadMessages).toBe(1);
  });

  /** O motivo da flag existir em vez de rebobinar o lastReadAt. */
  it('marca como nao lida ate onde o outro nunca escreveu', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);
    await seedMessages(chatId, luiz.id, 2);

    await request(app)
      .post(`/api/chats/${chatId}/unreadMessages`)
      .set('Authorization', `Bearer ${tokenFor(luiz.id)}`)
      .expect(200);

    expect((await listChats(luiz.id))[0]?.unreadMessages).toBe(1);
  });

  it('a marcacao some quando a conversa e lida de novo', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);
    await seedMessages(chatId, joao.id, 1);

    const token = `Bearer ${tokenFor(luiz.id)}`;
    await request(app).post(`/api/chats/${chatId}/unreadMessages`).set('Authorization', token);
    await request(app).post(`/api/chats/${chatId}/readMessages`).set('Authorization', token);

    expect((await listChats(luiz.id))[0]?.unreadMessages).toBe(0);
    const participation = await prisma.chatParticipant.findFirst({
      where: { chatId, userId: luiz.id },
    });
    expect(participation?.isUnread).toBe(false);
  });

  it('nao deixa marcar conversa de que nao participa', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const alheio = await createUser('Marcia', 'marcia@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);

    await request(app)
      .post(`/api/chats/${chatId}/unreadMessages`)
      .set('Authorization', `Bearer ${tokenFor(alheio.id)}`)
      .expect(403);
  });

  it('nao vaza a marcacao para o outro participante', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);
    await seedMessages(chatId, joao.id, 1);

    await request(app)
      .post(`/api/chats/${chatId}/unreadMessages`)
      .set('Authorization', `Bearer ${tokenFor(luiz.id)}`);

    // O Joao so escreveu: nada pendente para ele, e a marcacao do Luiz e privada.
    expect((await listChats(joao.id))[0]?.unreadMessages).toBe(0);
  });
});

describe('fixar conversa no topo', () => {
  beforeEach(resetDb);

  it('fixa e desafixa', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);
    const token = `Bearer ${tokenFor(luiz.id)}`;

    expect((await listChats(luiz.id))[0]?.isPinned).toBe(false);

    await request(app).post(`/api/chats/${chatId}/pin`).set('Authorization', token).expect(200);
    expect((await listChats(luiz.id))[0]?.isPinned).toBe(true);

    await request(app).delete(`/api/chats/${chatId}/pin`).set('Authorization', token).expect(200);
    expect((await listChats(luiz.id))[0]?.isPinned).toBe(false);
  });

  /** O ponto da feature: a fixada passa na frente da mais recente. */
  it('poe a fixada antes da conversa com atividade mais nova', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const marcia = await createUser('Marcia', 'marcia@email.com');

    const antiga = await createDirectChat(luiz.id, joao.id);
    const recente = await createDirectChat(luiz.id, marcia.id);
    await seedMessages(antiga, joao.id, 1);
    await seedMessages(recente, marcia.id, 1);

    // Sem fixar, a mais recente vem primeiro.
    const antes = await listChats(luiz.id);
    expect(antes[0]?.name).toBe('Marcia');

    await request(app)
      .post(`/api/chats/${antiga}/pin`)
      .set('Authorization', `Bearer ${tokenFor(luiz.id)}`);

    const depois = await listChats(luiz.id);
    expect(depois[0]?.name).toBe('Joao');
    expect(depois[1]?.name).toBe('Marcia');
  });

  it('e privado: fixar nao afeta a lista do outro', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);

    await request(app)
      .post(`/api/chats/${chatId}/pin`)
      .set('Authorization', `Bearer ${tokenFor(luiz.id)}`);

    expect((await listChats(joao.id))[0]?.isPinned).toBe(false);
  });

  it('nao deixa fixar conversa de que nao participa', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const alheio = await createUser('Marcia', 'marcia@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);

    await request(app)
      .post(`/api/chats/${chatId}/pin`)
      .set('Authorization', `Bearer ${tokenFor(alheio.id)}`)
      .expect(403);
  });
});

describe('recibo de leitura desligavel', () => {
  beforeEach(resetDb);

  interface ChatWithReads {
    id: string;
    readBy: Record<string, string>;
  }

  /** A lista de conversas, como o `userId` a ve. */
  async function chatsOf(userId: number): Promise<ChatWithReads[]> {
    const response = await request(app)
      .get('/api/me/chats')
      .set('Authorization', `Bearer ${tokenFor(userId)}`)
      .expect(200);

    return chatList<ChatWithReads>(response);
  }

  async function read(chatId: string, userId: number) {
    await request(app)
      .post(`/api/chats/${chatId}/readMessages`)
      .set('Authorization', `Bearer ${tokenFor(userId)}`)
      .expect(200);
  }

  async function setReceipts(userId: number, showReadReceipts: boolean) {
    await request(app)
      .patch('/api/me')
      .set('Authorization', `Bearer ${tokenFor(userId)}`)
      .send({ showReadReceipts })
      .expect(200);
  }

  it('ligado, a leitura do outro aparece no readBy', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);

    await read(chatId, joao.id);

    const [chat] = await chatsOf(luiz.id);
    expect(chat?.readBy[String(joao.id)]).toBeTruthy();
  });

  it('quem desliga para de mandar o proprio recibo', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);

    await setReceipts(joao.id, false);
    await read(chatId, joao.id);

    const [chat] = await chatsOf(luiz.id);
    expect(chat?.readBy).toEqual({});
  });

  /**
   * A reciprocidade e o ponto: sem ela o ajuste viraria uma forma de ver sem
   * ser visto.
   */
  it('quem desliga tambem para de receber o dos outros', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);

    await read(chatId, joao.id);
    await setReceipts(luiz.id, false);

    const [chat] = await chatsOf(luiz.id);
    expect(chat?.readBy).toEqual({});
  });

  /** Desligar o recibo nao pode mexer no proprio nao-lido. */
  it('a leitura continua sendo gravada com o recibo desligado', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);

    await seedMessages(chatId, luiz.id, 3);
    await setReceipts(joao.id, false);
    await read(chatId, joao.id);

    const response = await request(app)
      .get('/api/me/chats')
      .set('Authorization', `Bearer ${tokenFor(joao.id)}`)
      .expect(200);

    const [chat] = chatList<{ unreadMessages: number }>(response);
    expect(chat?.unreadMessages).toBe(0);
  });

  it('o ajuste dos outros nunca sai do servidor', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    await createUser('Joao', 'joao@email.com');

    const response = await request(app)
      .get('/api/me/contacts')
      .set('Authorization', `Bearer ${tokenFor(luiz.id)}`)
      .expect(200);

    for (const contact of body<Record<string, unknown>[]>(response)) {
      expect(contact).not.toHaveProperty('showReadReceipts');
    }
  });
});
