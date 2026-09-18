import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';

import { app } from '../src/app.js';
import { body, chatList, createUser, resetDb, tokenFor } from './helpers.js';

/**
 * Quem sai do grupo — ou e removido — fica com a conversa em somente leitura,
 * mas so ate a saida. Antes, tudo o que o grupo escrevia depois continuava
 * chegando: pelo historico, pela lista, pela busca, pela galeria e pelos
 * favoritos.
 */

interface MessageBody {
  id: string;
  text: string;
  /** "TEXT" ou "SYSTEM" — o aviso que o proprio grupo produz. */
  type: string;
}

interface ChatBody {
  id: string;
  hasLeft: boolean;
  unreadMessages: number;
  lastMessage: { text: string } | null;
  pinnedMessage: { id: string } | null;
}

const auth = (userId: number) => `Bearer ${tokenFor(userId)}`;

/** Folga para a saida e a mensagem seguinte nao caírem no mesmo milissegundo. */
const pause = () => new Promise((resolve) => setTimeout(resolve, 10));

async function createGroup(creatorId: number, memberIds: number[]): Promise<string> {
  const response = await request(app)
    .post('/api/chats/groups')
    .set('Authorization', auth(creatorId))
    .send({ name: 'Time', memberIds })
    .expect(201);

  return body<{ id: string }>(response).id;
}

async function send(chatId: string, userId: number, text: string): Promise<MessageBody> {
  const response = await request(app)
    .post(`/api/chats/${chatId}/messages`)
    .set('Authorization', auth(userId))
    .field('text', text)
    .expect(200);

  return body<MessageBody>(response);
}

async function chatsOf(userId: number): Promise<ChatBody[]> {
  const response = await request(app)
    .get('/api/me/chats')
    .set('Authorization', auth(userId))
    .expect(200);

  return chatList<ChatBody>(response);
}

const ANTES = 'antes da saida https://antes.test/doc';
const DEPOIS = 'depois da saida https://depois.test/doc';

/** A Marcia sai (ou e removida pelo admin), e o grupo segue conversando. */
async function scenario({ removed = false } = {}) {
  const luiz = await createUser('Luiz', 'luiz@email.com');
  const joao = await createUser('Joao', 'joao@email.com');
  const marcia = await createUser('Marcia', 'marcia@email.com');
  const chatId = await createGroup(luiz.id, [joao.id, marcia.id]);

  const antes = await send(chatId, joao.id, ANTES);
  await pause();

  await request(app)
    .delete(`/api/chats/${chatId}/members/${marcia.id}`)
    .set('Authorization', auth(removed ? luiz.id : marcia.id))
    .expect(200);
  await pause();

  const depois = await send(chatId, joao.id, DEPOIS);

  return { luiz, joao, marcia, chatId, antes, depois };
}

describe('quem saiu do grupo', () => {
  beforeEach(resetDb);

  it('le o historico so ate a saida', async () => {
    const { marcia, chatId } = await scenario();

    const response = await request(app)
      .get(`/api/chats/${chatId}/messages`)
      .set('Authorization', auth(marcia.id))
      .expect(200);

    const { messages } = body<{ messages: MessageBody[] }>(response);
    expect(messages.map((message) => message.text)).toEqual([ANTES]);
  });

  it('vale igual para quem foi removido pelo admin', async () => {
    const { marcia, chatId } = await scenario({ removed: true });

    const response = await request(app)
      .get(`/api/chats/${chatId}/messages`)
      .set('Authorization', auth(marcia.id))
      .expect(200);

    const { messages } = body<{ messages: MessageBody[] }>(response);
    expect(messages.map((message) => message.text)).toEqual([ANTES]);
  });

  it('a lista e o resumo mostram a ultima de antes da saida, sem contar as de depois', async () => {
    const { marcia, chatId } = await scenario();

    const chat = (await chatsOf(marcia.id)).find((item) => item.id === chatId);
    expect(chat?.hasLeft).toBe(true);
    expect(chat?.lastMessage?.text).toBe(ANTES);
    // So a mensagem de antes da saida esta pendente para ela.
    expect(chat?.unreadMessages).toBe(1);

    const resumo = await request(app)
      .get(`/api/chats/${chatId}/summary`)
      .set('Authorization', auth(marcia.id))
      .expect(200);

    expect(body<{ chat: ChatBody | null }>(resumo).chat?.lastMessage?.text).toBe(ANTES);
  });

  it('a busca nao acha o que veio depois', async () => {
    const { marcia, chatId } = await scenario();

    const global = await request(app)
      .get('/api/me/chats?q=depois')
      .set('Authorization', auth(marcia.id))
      .expect(200);
    expect(body<{ chats: unknown[] }>(global).chats).toHaveLength(0);

    const naConversa = await request(app)
      .get(`/api/chats/${chatId}/search?q=depois`)
      .set('Authorization', auth(marcia.id))
      .expect(200);
    expect(body<{ messages: unknown[] }>(naConversa).messages).toHaveLength(0);

    // O que veio antes continua achavel.
    const antes = await request(app)
      .get(`/api/chats/${chatId}/search?q=antes`)
      .set('Authorization', auth(marcia.id))
      .expect(200);
    expect(body<{ messages: unknown[] }>(antes).messages).toHaveLength(1);
  });

  it('a galeria nao mostra o link de depois', async () => {
    const { marcia, chatId } = await scenario();

    const response = await request(app)
      .get(`/api/chats/${chatId}/media`)
      .set('Authorization', auth(marcia.id))
      .expect(200);

    const { links } = body<{ links: { url: string }[] }>(response);
    expect(links.map((link) => link.url)).toEqual(['https://antes.test/doc']);
  });

  it('nao deixa salvar mensagem de depois da saida', async () => {
    const { marcia, antes, depois } = await scenario();

    await request(app)
      .post(`/api/me/saved/${depois.id}`)
      .set('Authorization', auth(marcia.id))
      .expect(404);

    await request(app)
      .post(`/api/me/saved/${antes.id}`)
      .set('Authorization', auth(marcia.id))
      .expect(200);
  });

  it('a fixada depois da saida nao aparece para quem saiu', async () => {
    const { joao, marcia, chatId, antes } = await scenario();

    await request(app)
      .post(`/api/chats/${chatId}/pinned`)
      .set('Authorization', auth(joao.id))
      .send({ messageId: antes.id })
      .expect(200);

    const chat = (await chatsOf(marcia.id)).find((item) => item.id === chatId);
    expect(chat?.pinnedMessage).toBeNull();
  });

  /** Antes, qualquer mensagem nova do grupo trazia de volta a conversa excluida. */
  it('conversa excluida depois de sair continua excluida', async () => {
    const { joao, marcia, chatId } = await scenario();

    await request(app)
      .delete(`/api/chats/${chatId}`)
      .set('Authorization', auth(marcia.id))
      .expect(200);
    await pause();

    await send(chatId, joao.id, 'mais uma');

    expect((await chatsOf(marcia.id)).find((item) => item.id === chatId)).toBeUndefined();
  });

  it('quem ficou continua vendo tudo', async () => {
    const { luiz, chatId } = await scenario();

    const response = await request(app)
      .get(`/api/chats/${chatId}/messages`)
      .set('Authorization', auth(luiz.id))
      .expect(200);

    const { messages } = body<{ messages: MessageBody[] }>(response);

    /*
     * O aviso da saida entra no historico de quem ficou, entre as duas
     * mensagens — e ele que explica por que a Marcia parou de responder.
     *
     * Quem saiu nao o ve: ele nasce depois do `leftAt`, e o corte de
     * visibilidade o deixa de fora (ver os dois primeiros testes deste arquivo).
     */
    expect(messages.map((message) => message.text)).toEqual([
      ANTES,
      'Marcia saiu do grupo',
      DEPOIS,
    ]);

    // E ele e aviso, nao mensagem: e o `type` que faz a tela desenhar uma linha
    // centralizada em vez de um balao da Marcia.
    expect(messages.map((message) => message.type)).toEqual(['TEXT', 'SYSTEM', 'TEXT']);
  });
});
