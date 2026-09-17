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
  tokenFor,
} from './helpers.js';

interface ChatBody {
  id: string;
  pinnedMessage: { id: string; text: string } | null;
}

interface SavedBody {
  saved: { chatId: string; message: { id: string; text: string } }[];
}

async function send(chatId: string, userId: number, text: string): Promise<string> {
  const response = await request(app)
    .post(`/api/chats/${chatId}/messages`)
    .set('Authorization', `Bearer ${tokenFor(userId)}`)
    .send({ text })
    .expect(200);

  return body<{ id: string }>(response).id;
}

/** A conversa como o `userId` a ve na lista. */
async function chatOf(userId: number, chatId: string): Promise<ChatBody | undefined> {
  const response = await request(app)
    .get('/api/me/chats')
    .set('Authorization', `Bearer ${tokenFor(userId)}`)
    .expect(200);

  return chatList<ChatBody>(response).find((chat) => chat.id === chatId);
}

function pin(chatId: string, userId: number, messageId: string) {
  return request(app)
    .post(`/api/chats/${chatId}/pinned`)
    .set('Authorization', `Bearer ${tokenFor(userId)}`)
    .send({ messageId });
}

describe('mensagem fixada na conversa', () => {
  beforeEach(resetDb);

  /** Compartilhada: e o ponto que a separa do isPinned, que e privado. */
  it('a fixada aparece para os dois lados', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);

    const id = await send(chatId, luiz.id, 'combinado: sexta as 10h');
    await pin(chatId, luiz.id, id).expect(200);

    expect((await chatOf(luiz.id, chatId))?.pinnedMessage?.id).toBe(id);
    expect((await chatOf(joao.id, chatId))?.pinnedMessage?.text).toBe(
      'combinado: sexta as 10h',
    );
  });

  it('fixar outra substitui a anterior', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);

    const primeira = await send(chatId, luiz.id, 'primeira');
    const segunda = await send(chatId, luiz.id, 'segunda');

    await pin(chatId, luiz.id, primeira).expect(200);
    await pin(chatId, joao.id, segunda).expect(200);

    expect((await chatOf(luiz.id, chatId))?.pinnedMessage?.id).toBe(segunda);
  });

  it('desafixar limpa o banner', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);

    const id = await send(chatId, luiz.id, 'aviso');
    await pin(chatId, luiz.id, id).expect(200);

    await request(app)
      .delete(`/api/chats/${chatId}/pinned`)
      .set('Authorization', `Bearer ${tokenFor(joao.id)}`)
      .expect(200);

    expect((await chatOf(luiz.id, chatId))?.pinnedMessage).toBeNull();
  });

  /** Apagar a mensagem solta o pino: o SetNull do banco cuida disso. */
  it('apagar a mensagem fixada tira o banner', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);

    const id = await send(chatId, luiz.id, 'aviso');
    await pin(chatId, luiz.id, id).expect(200);

    await request(app)
      .delete(`/api/chats/${chatId}/messages/${id}`)
      .set('Authorization', `Bearer ${tokenFor(luiz.id)}`)
      .expect(200);

    // A exclusao e logica, entao a linha continua; o banner e que nao pode
    // mostrar "mensagem apagada" fixada no topo.
    expect((await chatOf(luiz.id, chatId))?.pinnedMessage).toBeNull();
  });

  it('recusa mensagem de outra conversa', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const ana = await createUser('Ana', 'ana@email.com');
    const aqui = await createDirectChat(luiz.id, joao.id);
    const outra = await createDirectChat(luiz.id, ana.id);

    const id = await send(outra, luiz.id, 'de outra conversa');
    await pin(aqui, luiz.id, id).expect(400);
  });

  it('recusa quem nao participa', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const ana = await createUser('Ana', 'ana@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);

    const id = await send(chatId, luiz.id, 'aviso');
    await pin(chatId, ana.id, id).expect(403);
  });

  /** O corte de "limpar conversa" vale para o banner tambem. */
  it('quem limpou a conversa deixa de ver a fixada antiga', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);

    const id = await send(chatId, luiz.id, 'aviso antigo');
    await pin(chatId, luiz.id, id).expect(200);

    await request(app)
      .post(`/api/chats/${chatId}/clear`)
      .set('Authorization', `Bearer ${tokenFor(luiz.id)}`)
      .expect(200);

    expect((await chatOf(luiz.id, chatId))?.pinnedMessage).toBeNull();
    // Do outro lado nada mudou.
    expect((await chatOf(joao.id, chatId))?.pinnedMessage?.id).toBe(id);
  });
});

describe('mensagens salvas', () => {
  beforeEach(resetDb);

  function save(userId: number, messageId: string) {
    return request(app)
      .post(`/api/me/saved/${messageId}`)
      .set('Authorization', `Bearer ${tokenFor(userId)}`);
  }

  function listSaved(userId: number) {
    return request(app)
      .get('/api/me/saved')
      .set('Authorization', `Bearer ${tokenFor(userId)}`);
  }

  it('salva e lista, com a conversa de origem', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);

    const id = await send(chatId, joao.id, 'o link do relatorio');
    await save(luiz.id, id).expect(200);

    const found = body<SavedBody>(await listSaved(luiz.id).expect(200));
    expect(found.saved).toHaveLength(1);
    expect(found.saved[0]?.chatId).toBe(chatId);
    expect(found.saved[0]?.message.text).toBe('o link do relatorio');
  });

  it('salvar duas vezes nao duplica', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);

    const id = await send(chatId, joao.id, 'importante');
    await save(luiz.id, id).expect(200);
    await save(luiz.id, id).expect(200);

    const found = body<SavedBody>(await listSaved(luiz.id).expect(200));
    expect(found.saved).toHaveLength(1);
  });

  it('remove da lista', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);

    const id = await send(chatId, joao.id, 'importante');
    await save(luiz.id, id).expect(200);

    await request(app)
      .delete(`/api/me/saved/${id}`)
      .set('Authorization', `Bearer ${tokenFor(luiz.id)}`)
      .expect(200);

    const found = body<SavedBody>(await listSaved(luiz.id).expect(200));
    expect(found.saved).toHaveLength(0);
  });

  /** Privado: o favorito de um nao aparece na lista do outro. */
  it('cada um ve so o que salvou', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);

    const id = await send(chatId, joao.id, 'importante');
    await save(luiz.id, id).expect(200);

    const dele = body<SavedBody>(await listSaved(joao.id).expect(200));
    expect(dele.saved).toHaveLength(0);
  });

  it('os ids vem numa rota enxuta, para as estrelas da tela', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);

    const id = await send(chatId, joao.id, 'importante');
    await save(luiz.id, id).expect(200);

    const response = await request(app)
      .get('/api/me/saved/ids')
      .set('Authorization', `Bearer ${tokenFor(luiz.id)}`)
      .expect(200);

    expect(body<{ ids: string[] }>(response).ids).toEqual([id]);
  });

  it('recusa salvar mensagem de conversa alheia', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const ana = await createUser('Ana', 'ana@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);

    const id = await send(chatId, luiz.id, 'privado');
    await save(ana.id, id).expect(403);
  });

  /** O favorito nao pode ser a porta dos fundos do que foi limpo. */
  it('o que a limpeza escondeu sai da lista', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);

    const id = await send(chatId, joao.id, 'antes da limpeza');
    await save(luiz.id, id).expect(200);

    await request(app)
      .post(`/api/chats/${chatId}/clear`)
      .set('Authorization', `Bearer ${tokenFor(luiz.id)}`)
      .expect(200);

    const found = body<SavedBody>(await listSaved(luiz.id).expect(200));
    expect(found.saved).toHaveLength(0);
  });

  it('mensagem apagada sai da lista', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);

    const id = await send(chatId, joao.id, 'some depois');
    await save(luiz.id, id).expect(200);

    await request(app)
      .delete(`/api/chats/${chatId}/messages/${id}`)
      .set('Authorization', `Bearer ${tokenFor(joao.id)}`)
      .expect(200);

    const found = body<SavedBody>(await listSaved(luiz.id).expect(200));
    expect(found.saved).toHaveLength(0);
  });

  /** Apagar a conversa leva os favoritos dela junto (cascade no banco). */
  it('excluir a conversa no banco leva o favorito', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);

    const id = await send(chatId, joao.id, 'tchau');
    await save(luiz.id, id).expect(200);

    await prisma.chat.delete({ where: { id: chatId } });

    expect(await prisma.savedMessage.count({ where: { userId: luiz.id } })).toBe(0);
  });
});
