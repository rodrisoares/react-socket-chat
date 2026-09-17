import { existsSync } from 'node:fs';
import path from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';

import { app } from '../src/app.js';
import { UPLOAD_DIR } from '../src/config/upload.js';
import {
  body,
  chatList,
  createDirectChat,
  createUser,
  resetDb,
  tokenFor,
} from './helpers.js';

interface MessageBody {
  id: string;
  text: string;
  isForwarded: boolean;
  attachment: { url: string; name: string } | null;
  reactions: { emoji: string; userIds: number[] }[];
}

interface ChatBody {
  id: string;
  type: string;
  name: string;
  image?: string;
  isBlocked: boolean;
  lastMessage: MessageBody | null;
}

function auth(userId: number) {
  return `Bearer ${tokenFor(userId)}`;
}

function listChats(userId: number) {
  return request(app).get('/api/me/chats').set('Authorization', auth(userId));
}

function send(chatId: string, userId: number, text: string) {
  return request(app)
    .post(`/api/chats/${chatId}/messages`)
    .set('Authorization', auth(userId))
    .field('text', text);
}

async function createGroup(creatorId: number, memberIds: number[]) {
  const response = await request(app)
    .post('/api/chats/groups')
    .set('Authorization', auth(creatorId))
    .send({ name: 'Time', memberIds });

  return body<{ id: string }>(response).id;
}

describe('foto do grupo', () => {
  beforeEach(resetDb);

  it('o admin define e remove a foto', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createGroup(luiz.id, [joao.id]);
    const foto = 'https://api.dicebear.com/9.x/avataaars/svg?seed=aurora';

    await request(app)
      .patch(`/api/chats/${chatId}`)
      .set('Authorization', auth(luiz.id))
      .send({ image: foto })
      .expect(200);

    expect(chatList<ChatBody>(await listChats(joao.id))[0]?.image).toBe(foto);

    // String vazia remove, como no perfil do usuario.
    await request(app)
      .patch(`/api/chats/${chatId}`)
      .set('Authorization', auth(luiz.id))
      .send({ image: '' })
      .expect(200);

    expect(chatList<ChatBody>(await listChats(joao.id))[0]?.image).toBeUndefined();
  });

  it('trocar so a foto nao mexe no nome', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createGroup(luiz.id, [joao.id]);

    await request(app)
      .patch(`/api/chats/${chatId}`)
      .set('Authorization', auth(luiz.id))
      .send({ image: 'https://api.dicebear.com/9.x/icons/svg?seed=cafe' })
      .expect(200);

    expect(chatList<ChatBody>(await listChats(joao.id))[0]?.name).toBe('Time');
  });

  it('quem nao e admin nao troca a foto', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createGroup(luiz.id, [joao.id]);

    await request(app)
      .patch(`/api/chats/${chatId}`)
      .set('Authorization', auth(joao.id))
      .send({ image: 'https://api.dicebear.com/9.x/icons/svg?seed=cafe' })
      .expect(403);
  });

  it('recusa um PATCH que nao muda nada', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createGroup(luiz.id, [joao.id]);

    await request(app)
      .patch(`/api/chats/${chatId}`)
      .set('Authorization', auth(luiz.id))
      .send({})
      .expect(400);
  });
});

describe('reacoes', () => {
  beforeEach(resetDb);

  async function setup() {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);
    const enviada = body<MessageBody>(await send(chatId, luiz.id, 'topa?'));
    return { luiz, joao, chatId, messageId: enviada.id };
  }

  function react(chatId: string, messageId: string, userId: number, emoji: string) {
    return request(app)
      .put(`/api/chats/${chatId}/messages/${messageId}/reaction`)
      .set('Authorization', auth(userId))
      .send({ emoji });
  }

  it('agrupa por emoji e guarda quem reagiu', async () => {
    const { luiz, joao, chatId, messageId } = await setup();

    await react(chatId, messageId, luiz.id, '👍').expect(200);
    const depois = body<MessageBody>(await react(chatId, messageId, joao.id, '👍'));

    expect(depois.reactions).toHaveLength(1);
    expect(depois.reactions[0]?.emoji).toBe('👍');
    expect(depois.reactions[0]?.userIds.sort()).toEqual([luiz.id, joao.id].sort());
  });

  /** A regra escolhida: uma por pessoa, e o emoji novo substitui o anterior. */
  it('reagir de novo troca, nao soma', async () => {
    const { luiz, chatId, messageId } = await setup();

    await react(chatId, messageId, luiz.id, '👍');
    const depois = body<MessageBody>(await react(chatId, messageId, luiz.id, '🎉'));

    expect(depois.reactions).toHaveLength(1);
    expect(depois.reactions[0]?.emoji).toBe('🎉');
  });

  it('remove a propria reacao', async () => {
    const { luiz, chatId, messageId } = await setup();
    await react(chatId, messageId, luiz.id, '👍');

    const depois = body<MessageBody>(
      await request(app)
        .delete(`/api/chats/${chatId}/messages/${messageId}/reaction`)
        .set('Authorization', auth(luiz.id))
        .expect(200),
    );

    expect(depois.reactions).toHaveLength(0);
  });

  it('a reacao aparece na previa da lista', async () => {
    const { luiz, joao, chatId, messageId } = await setup();
    await react(chatId, messageId, joao.id, '❤️');

    const lista = chatList<ChatBody>(await listChats(luiz.id));
    expect(lista[0]?.lastMessage?.reactions[0]?.emoji).toBe('❤️');
  });

  it('mensagem apagada nao aceita reacao', async () => {
    const { luiz, chatId, messageId } = await setup();

    await request(app)
      .delete(`/api/chats/${chatId}/messages/${messageId}`)
      .set('Authorization', auth(luiz.id));

    await react(chatId, messageId, luiz.id, '👍').expect(400);
  });

  it('nao deixa reagir em conversa alheia', async () => {
    const { chatId, messageId } = await setup();
    const alheio = await createUser('Marcia', 'marcia@email.com');

    await react(chatId, messageId, alheio.id, '👍').expect(403);
  });
});

describe('bloquear usuario', () => {
  beforeEach(resetDb);

  function block(userId: number, targetId: number) {
    return request(app)
      .post(`/api/me/blocks/${targetId}`)
      .set('Authorization', auth(userId));
  }

  it('quem bloqueou nao consegue mais enviar, e sabe por que', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);

    await block(luiz.id, joao.id).expect(200);

    const recusa = await send(chatId, luiz.id, 'oi').expect(403);
    expect(body<{ error: string }>(recusa).error).toMatch(/bloqueou/i);
  });

  /** Silencioso: a recusa nao pode revelar o bloqueio para o bloqueado. */
  it('o bloqueado recebe um erro neutro', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);

    await block(luiz.id, joao.id);

    const recusa = await send(chatId, joao.id, 'oi').expect(403);
    expect(body<{ error: string }>(recusa).error).not.toMatch(/bloque/i);
  });

  it('nao afeta grupo compartilhado', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const grupo = await createGroup(luiz.id, [joao.id]);

    await block(luiz.id, joao.id);

    await send(grupo, joao.id, 'no grupo eu falo').expect(200);
    await send(grupo, luiz.id, 'e eu tambem').expect(200);
  });

  it('desbloquear devolve o envio', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);

    await block(luiz.id, joao.id);
    await request(app)
      .delete(`/api/me/blocks/${joao.id}`)
      .set('Authorization', auth(luiz.id))
      .expect(200);

    await send(chatId, luiz.id, 'de volta').expect(200);
    await send(chatId, joao.id, 'oi').expect(200);
  });

  it('recusa abrir conversa direta com quem bloqueou', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');

    await block(luiz.id, joao.id);

    await request(app)
      .post('/api/chats')
      .set('Authorization', auth(joao.id))
      .send({ otherUserId: luiz.id })
      .expect(403);
  });

  it('a conversa mostra isBlocked so para quem bloqueou', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    await createDirectChat(luiz.id, joao.id);

    await block(luiz.id, joao.id);

    expect(chatList<ChatBody>(await listChats(luiz.id))[0]?.isBlocked).toBe(true);
    expect(chatList<ChatBody>(await listChats(joao.id))[0]?.isBlocked).toBe(false);
  });

  it('nao deixa bloquear a si mesmo', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    await block(luiz.id, luiz.id).expect(400);
  });
});

describe('encaminhar mensagem', () => {
  beforeEach(resetDb);

  it('copia para varias conversas de uma vez, marcada como encaminhada', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const marcia = await createUser('Marcia', 'marcia@email.com');

    const origem = await createDirectChat(luiz.id, joao.id);
    const destino1 = await createDirectChat(luiz.id, marcia.id);
    const destino2 = await createGroup(luiz.id, [marcia.id]);

    const enviada = body<MessageBody>(await send(origem, joao.id, 'olha esse link'));

    const resultado = await request(app)
      .post(`/api/chats/${origem}/messages/${enviada.id}/forward`)
      .set('Authorization', auth(luiz.id))
      .send({ chatIds: [destino1, destino2] })
      .expect(200);

    expect(body<{ forwarded: number }>(resultado).forwarded).toBe(2);

    const lista = chatList<ChatBody>(await listChats(luiz.id));
    for (const id of [destino1, destino2]) {
      const chat = lista.find((c) => c.id === id);
      expect(chat?.lastMessage?.text).toBe('olha esse link');
      expect(chat?.lastMessage?.isForwarded).toBe(true);
    }
  });

  /** O anexo é copiado: apagar a original nao pode levar a copia junto. */
  it('copia o arquivo do anexo em vez de apontar para o mesmo', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const marcia = await createUser('Marcia', 'marcia@email.com');

    const origem = await createDirectChat(luiz.id, joao.id);
    const destino = await createDirectChat(luiz.id, marcia.id);

    const enviada = body<MessageBody>(
      await request(app)
        .post(`/api/chats/${origem}/messages`)
        .set('Authorization', auth(luiz.id))
        .field('text', 'segue')
        .attach('attachment', Buffer.from('conteudo'), {
          filename: 'nota.txt',
          contentType: 'text/plain',
        })
        .expect(200),
    );

    await request(app)
      .post(`/api/chats/${origem}/messages/${enviada.id}/forward`)
      .set('Authorization', auth(luiz.id))
      .send({ chatIds: [destino] })
      .expect(200);

    const copia = chatList<ChatBody>(await listChats(luiz.id)).find(
      (c) => c.id === destino,
    )?.lastMessage;
    const arquivoCopia = path.join(
      UPLOAD_DIR,
      path.basename((copia?.attachment?.url ?? '').split('?')[0] ?? ''),
    );

    expect(copia?.attachment?.name).toBe('nota.txt');
    expect(existsSync(arquivoCopia)).toBe(true);

    // Apagar a original remove o arquivo dela, nao o da copia.
    await request(app)
      .delete(`/api/chats/${origem}/messages/${enviada.id}`)
      .set('Authorization', auth(luiz.id))
      .expect(200);

    expect(existsSync(arquivoCopia)).toBe(true);
  });

  it('nao encaminha para conversa de que o usuario nao participa', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const marcia = await createUser('Marcia', 'marcia@email.com');

    const origem = await createDirectChat(luiz.id, joao.id);
    const alheia = await createDirectChat(joao.id, marcia.id);
    const enviada = body<MessageBody>(await send(origem, luiz.id, 'oi'));

    await request(app)
      .post(`/api/chats/${origem}/messages/${enviada.id}/forward`)
      .set('Authorization', auth(luiz.id))
      .send({ chatIds: [alheia] })
      .expect(403);
  });

  /** Valida tudo antes de escrever: encaminhar pela metade e pior. */
  it('um destino invalido cancela o lote inteiro', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const marcia = await createUser('Marcia', 'marcia@email.com');

    const origem = await createDirectChat(luiz.id, joao.id);
    const valido = await createDirectChat(luiz.id, marcia.id);
    const alheia = await createDirectChat(joao.id, marcia.id);
    const enviada = body<MessageBody>(await send(origem, luiz.id, 'oi'));

    await request(app)
      .post(`/api/chats/${origem}/messages/${enviada.id}/forward`)
      .set('Authorization', auth(luiz.id))
      .send({ chatIds: [valido, alheia] })
      .expect(403);

    const destino = chatList<ChatBody>(await listChats(luiz.id)).find(
      (c) => c.id === valido,
    );
    expect(destino?.lastMessage).toBeNull();
  });

  it('nao encaminha mensagem apagada', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const marcia = await createUser('Marcia', 'marcia@email.com');

    const origem = await createDirectChat(luiz.id, joao.id);
    const destino = await createDirectChat(luiz.id, marcia.id);
    const enviada = body<MessageBody>(await send(origem, luiz.id, 'ops'));

    await request(app)
      .delete(`/api/chats/${origem}/messages/${enviada.id}`)
      .set('Authorization', auth(luiz.id));

    await request(app)
      .post(`/api/chats/${origem}/messages/${enviada.id}/forward`)
      .set('Authorization', auth(luiz.id))
      .send({ chatIds: [destino] })
      .expect(400);
  });
});
