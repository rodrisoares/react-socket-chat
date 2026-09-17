import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';

import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';
import { body, createUser, resetDb, tokenFor } from './helpers.js';

/**
 * Uma conversa direta por par de pessoas.
 *
 * Nao havia restricao nenhuma no banco: a rota lia, nao achava nada, e criava.
 * Dois pedidos ao mesmo tempo passavam os dois pela leitura vazia, e o par
 * terminava com duas conversas — cada aba numa delas, cada uma com metade do
 * historico. Agora o `directKey` e unico, e quem perde a corrida recebe a
 * conversa que o outro acabou de criar.
 */
describe('POST /api/chats — uma conversa por par', () => {
  beforeEach(resetDb);

  it('dois pedidos simultaneos criam uma conversa so', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const token = tokenFor(luiz.id);

    const [primeira, segunda] = await Promise.all([
      request(app)
        .post('/api/chats')
        .set('Authorization', `Bearer ${token}`)
        .send({ otherUserId: joao.id }),
      request(app)
        .post('/api/chats')
        .set('Authorization', `Bearer ${token}`)
        .send({ otherUserId: joao.id }),
    ]);

    expect(primeira.status).toBeLessThan(300);
    expect(segunda.status).toBeLessThan(300);

    // O mesmo id nas duas respostas: a segunda recebeu a que a primeira criou.
    expect(body<{ id: string }>(primeira).id).toBe(body<{ id: string }>(segunda).id);
    expect(await prisma.chat.count({ where: { type: 'DIRECT' } })).toBe(1);
  });

  it('grava a chave do par, do menor id para o maior', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');

    const criada = await request(app)
      .post('/api/chats')
      .set('Authorization', `Bearer ${tokenFor(luiz.id)}`)
      .send({ otherUserId: joao.id });

    const chat = await prisma.chat.findUnique({
      where: { id: body<{ id: string }>(criada).id },
      select: { directKey: true },
    });

    const menor = Math.min(luiz.id, joao.id);
    const maior = Math.max(luiz.id, joao.id);
    expect(chat?.directKey).toBe(`${menor}:${maior}`);
  });

  /** A ordem da chave nao depende de quem pediu: os dois lados dao no mesmo. */
  it('o outro lado abrindo primeiro nao cria uma segunda conversa', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');

    const doLuiz = await request(app)
      .post('/api/chats')
      .set('Authorization', `Bearer ${tokenFor(luiz.id)}`)
      .send({ otherUserId: joao.id });

    const doJoao = await request(app)
      .post('/api/chats')
      .set('Authorization', `Bearer ${tokenFor(joao.id)}`)
      .send({ otherUserId: luiz.id });

    expect(body<{ id: string }>(doJoao).id).toBe(body<{ id: string }>(doLuiz).id);
    expect(await prisma.chat.count({ where: { type: 'DIRECT' } })).toBe(1);
  });
});
