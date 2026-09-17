import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';

import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';
import * as users from '../src/repositories/userRepository.js';
import {
  body,
  chatList,
  createDirectChat,
  createUser,
  resetDb,
  tokenFor,
} from './helpers.js';

interface MeBody {
  id: number;
  status: string;
}

interface ChatBody {
  id: string;
  status?: string;
  members: { id: number; status: string }[];
}

describe('status manual do usuario', () => {
  beforeEach(resetDb);

  it('nasce como AVAILABLE', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');

    const response = await request(app)
      .get('/api/me')
      .set('Authorization', `Bearer ${tokenFor(luiz.id)}`);

    expect(body<MeBody>(response).status).toBe('AVAILABLE');
  });

  it('aceita os tres status validos', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const token = `Bearer ${tokenFor(luiz.id)}`;

    for (const status of ['BUSY', 'AWAY', 'AVAILABLE']) {
      const response = await request(app)
        .patch('/api/me')
        .set('Authorization', token)
        .send({ status })
        .expect(200);

      expect(body<MeBody>(response).status).toBe(status);
    }
  });

  it('recusa status fora da lista', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');

    await request(app)
      .patch('/api/me')
      .set('Authorization', `Bearer ${tokenFor(luiz.id)}`)
      .send({ status: 'INVISIVEL' })
      .expect(400);
  });

  /** O ponto da feature: o outro lado precisa enxergar. */
  it('aparece para o outro participante na conversa direta', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    await createDirectChat(luiz.id, joao.id);

    await request(app)
      .patch('/api/me')
      .set('Authorization', `Bearer ${tokenFor(joao.id)}`)
      .send({ status: 'BUSY' });

    const response = await request(app)
      .get('/api/me/chats')
      .set('Authorization', `Bearer ${tokenFor(luiz.id)}`);

    const [chat] = chatList<ChatBody>(response);
    expect(chat?.status).toBe('BUSY');
    expect(chat?.members.find((m) => m.id === joao.id)?.status).toBe('BUSY');
  });

  it('nao mexe no status quando o patch e de outro campo', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const token = `Bearer ${tokenFor(luiz.id)}`;

    await request(app).patch('/api/me').set('Authorization', token).send({ status: 'AWAY' });
    const response = await request(app)
      .patch('/api/me')
      .set('Authorization', token)
      .send({ name: 'Luiz Silva' })
      .expect(200);

    expect(body<MeBody>(response).status).toBe('AWAY');
  });
});

describe('presenca na subida do servidor', () => {
  beforeEach(resetDb);

  /**
   * O isOnline so e escrito no connect/disconnect do socket. Se o processo cai,
   * ninguem emite o disconnect e todo mundo fica "online" para sempre — por
   * isso o index.ts zera a presenca antes de escutar a porta.
   */
  it('zera a presenca de todo mundo', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');

    await users.setOnline(luiz.id, true);
    await users.setOnline(joao.id, true);
    expect(await prisma.user.count({ where: { isOnline: true } })).toBe(2);

    await users.setAllOffline();

    expect(await prisma.user.count({ where: { isOnline: true } })).toBe(0);
  });
});
