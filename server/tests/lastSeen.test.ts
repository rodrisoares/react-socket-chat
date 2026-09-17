import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';

import { app } from '../src/app.js';
import * as users from '../src/repositories/userRepository.js';
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
  lastSeenAt: string | null;
  members: { id: number; lastSeenAt: string | null }[];
}

interface MeBody {
  id: number;
  showLastSeen?: boolean;
  lastSeenAt?: string | null;
}

/** A conversa direta entre os dois, como o `userId` a ve. */
async function chatOf(userId: number): Promise<ChatBody> {
  const response = await request(app)
    .get('/api/me/chats')
    .set('Authorization', `Bearer ${tokenFor(userId)}`)
    .expect(200);

  const chats = chatList<ChatBody>(response);
  return chats[0] as ChatBody;
}

describe('visto por ultimo', () => {
  beforeEach(resetDb);

  it('nasce ligado e sem horario nenhum', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');

    const response = await request(app)
      .get('/api/me')
      .set('Authorization', `Bearer ${tokenFor(luiz.id)}`)
      .expect(200);

    const me = body<MeBody>(response);
    expect(me.showLastSeen).toBe(true);
    expect(me.lastSeenAt).toBeNull();
  });

  /** O instante e gravado no disconnect do socket, junto com o isOnline. */
  it('sair grava o horario e ele chega a quem conversa com a pessoa', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    await createDirectChat(luiz.id, joao.id);

    await users.setOnline(joao.id, true);
    // Online: quem esta aqui agora nao tem "visto por ultimo" — vale o ponto
    // verde, e nao um horario parado no passado.
    expect((await chatOf(luiz.id)).lastSeenAt).toBeNull();

    await users.setOnline(joao.id, false);

    const chat = await chatOf(luiz.id);
    expect(chat.lastSeenAt).not.toBeNull();
    expect(chat.members.find((m) => m.id === joao.id)?.lastSeenAt).not.toBeNull();
  });

  /**
   * O campo e removido na serializacao, e nao escondido na tela: com ele
   * viajando, bastaria abrir o devtools para ler o que a pessoa desligou.
   */
  it('desligado, o horario nao sai do servidor', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    await createDirectChat(luiz.id, joao.id);

    await users.setOnline(joao.id, false);
    await request(app)
      .patch('/api/me')
      .set('Authorization', `Bearer ${tokenFor(joao.id)}`)
      .send({ showLastSeen: false })
      .expect(200);

    const chat = await chatOf(luiz.id);
    expect(chat.lastSeenAt).toBeNull();
    expect(chat.members.find((m) => m.id === joao.id)?.lastSeenAt).toBeNull();
  });

  it('o dono continua vendo o proprio interruptor', async () => {
    const joao = await createUser('Joao', 'joao@email.com');

    const response = await request(app)
      .patch('/api/me')
      .set('Authorization', `Bearer ${tokenFor(joao.id)}`)
      .send({ showLastSeen: false })
      .expect(200);

    expect(body<MeBody>(response).showLastSeen).toBe(false);
  });

  it('o interruptor dos outros nunca aparece na lista de contatos', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    await createUser('Joao', 'joao@email.com');

    const response = await request(app)
      .get('/api/me/contacts')
      .set('Authorization', `Bearer ${tokenFor(luiz.id)}`)
      .expect(200);

    for (const contact of body<MeBody[]>(response)) {
      expect(contact).not.toHaveProperty('showLastSeen');
    }
  });

  it('recusa valor que nao e booleano', async () => {
    const joao = await createUser('Joao', 'joao@email.com');

    await request(app)
      .patch('/api/me')
      .set('Authorization', `Bearer ${tokenFor(joao.id)}`)
      .send({ showLastSeen: 'talvez' })
      .expect(400);
  });
});

describe('visto por ultimo nos detalhes da conversa', () => {
  beforeEach(resetDb);

  it('GET /api/chats/:id leva o horario de cada membro', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);

    await users.setOnline(joao.id, false);

    const response = await request(app)
      .get(`/api/chats/${chatId}`)
      .set('Authorization', `Bearer ${tokenFor(luiz.id)}`)
      .expect(200);

    const details = body<ChatBody>(response);
    expect(details.members.find((m) => m.id === joao.id)?.lastSeenAt).not.toBeNull();
  });

  /**
   * O setAllOffline roda na subida do servidor para limpar quem ficou "online"
   * num processo derrubado. Sem gravar o instante, uma reinicializacao deixava
   * todo mundo offline e sem nenhum "visto por ultimo" — a tela mostrava so
   * "Offline", como se o recurso nao existisse.
   */
  it('a limpeza de presenca na subida do servidor tambem grava o horario', async () => {
    const joao = await createUser('Joao', 'joao@email.com');
    await users.setOnline(joao.id, true);

    await users.setAllOffline();

    const found = await users.findById(joao.id);
    expect(found?.isOnline).toBe(false);
    expect(found?.lastSeenAt).not.toBeNull();
  });
});
