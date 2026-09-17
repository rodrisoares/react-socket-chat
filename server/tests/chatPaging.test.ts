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

interface Page {
  chats: { id: string; name: string; isPinned: boolean }[];
  nextCursor: string | null;
}

function list(userId: number, query = '') {
  return request(app)
    .get(`/api/me/chats${query}`)
    .set('Authorization', `Bearer ${tokenFor(userId)}`);
}

/**
 * Cria `count` contatos, cada um com uma conversa direta com `userId`, com
 * atividade crescente: o ultimo e o mais recente.
 */
async function manyChats(userId: number, count: number): Promise<string[]> {
  const ids: string[] = [];

  for (let index = 0; index < count; index += 1) {
    const other = await createUser(`Contato ${index}`, `contato${index}@email.com`);
    const chatId = await createDirectChat(userId, other.id);

    await prisma.chat.update({
      where: { id: chatId },
      data: { lastMessageAt: new Date(Date.now() - (count - index) * 60_000) },
    });

    ids.push(chatId);
  }

  return ids;
}

describe('lista de conversas paginada', () => {
  beforeEach(resetDb);

  it('devolve a pagina pedida e o cursor da proxima', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    await manyChats(luiz.id, 7);

    const primeira = body<Page>(await list(luiz.id, '?limit=3').expect(200));
    expect(primeira.chats).toHaveLength(3);
    expect(primeira.nextCursor).toBeTruthy();

    const segunda = body<Page>(
      await list(luiz.id, `?limit=3&cursor=${primeira.nextCursor}`).expect(200),
    );
    expect(segunda.chats).toHaveLength(3);

    // Paginas sem interseccao: o cursor nao repete nem pula.
    const ids = new Set([
      ...primeira.chats.map((chat) => chat.id),
      ...segunda.chats.map((chat) => chat.id),
    ]);
    expect(ids.size).toBe(6);
  });

  it('a ultima pagina fecha o cursor', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    await manyChats(luiz.id, 4);

    const ultima = body<Page>(await list(luiz.id, '?limit=10').expect(200));
    expect(ultima.chats).toHaveLength(4);
    expect(ultima.nextCursor).toBeNull();
  });

  /** Percorrer tudo pelo cursor tem de dar o mesmo conjunto de uma vez so. */
  it('as paginas somadas dao a lista inteira', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const criadas = await manyChats(luiz.id, 11);

    const vistas: string[] = [];
    let cursor: string | null = null;

    do {
      const query: string = cursor ? `?limit=4&cursor=${cursor}` : '?limit=4';
      const page: Page = body<Page>(await list(luiz.id, query).expect(200));
      vistas.push(...page.chats.map((chat) => chat.id));
      cursor = page.nextCursor;
    } while (cursor);

    expect(new Set(vistas).size).toBe(criadas.length);
  });

  /** A ordem e do banco agora: fixadas primeiro, depois atividade. */
  it('fixada vem na primeira pagina, mesmo sendo a mais antiga', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const ids = await manyChats(luiz.id, 6);
    const maisAntiga = ids[0] as string;

    await request(app)
      .post(`/api/chats/${maisAntiga}/pin`)
      .set('Authorization', `Bearer ${tokenFor(luiz.id)}`)
      .expect(200);

    const primeira = body<Page>(await list(luiz.id, '?limit=2').expect(200));
    expect(primeira.chats[0]?.id).toBe(maisAntiga);
    expect(primeira.chats[0]?.isPinned).toBe(true);
  });

  it('recusa limite invalido', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    await list(luiz.id, '?limit=abc').expect(400);
  });

  /**
   * As conversas sao criadas aqui: o login nao materializa mais uma com cada
   * contato. O teto de tempo maior e pelos 34 usuarios, cada um com bcrypt.
   */
  it(
    'o login ja traz a primeira pagina e o cursor',
    async () => {
      const luiz = await createUser('Luiz', 'luiz@email.com');
      for (let index = 0; index < 34; index += 1) {
        const contato = await createUser(`Contato ${index}`, `contato${index}@email.com`);
        await createDirectChat(luiz.id, contato.id);
      }

      const response = await request(app)
        .post('/api/auth/login')
        .send({ email: luiz.email, password: luiz.password })
        .expect(200);

      const { user } = body<{
        user: { chats: unknown[]; chatsCursor: string | null };
      }>(response);

      // A pagina padrao tem 30: antes vinham todas de uma vez.
      expect(user.chats).toHaveLength(30);
      expect(user.chatsCursor).toBeTruthy();
    },
    60_000,
  );
});

describe('resumo de uma conversa', () => {
  beforeEach(resetDb);

  /**
   * Existe para o chat-updated do socket nao custar a lista inteira.
   */
  it('devolve a conversa no mesmo formato da lista', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);
    await seedMessages(chatId, joao.id, 2);

    const response = await request(app)
      .get(`/api/chats/${chatId}/summary`)
      .set('Authorization', `Bearer ${tokenFor(luiz.id)}`)
      .expect(200);

    const { chat } = body<{
      chat: { id: string; name: string; unreadMessages: number } | null;
    }>(response);

    expect(chat?.id).toBe(chatId);
    expect(chat?.name).toBe('Joao');
    expect(chat?.unreadMessages).toBe(2);

    // Mesmo conteudo que a lista traria para esta conversa.
    const daLista = chatList<{ id: string; unreadMessages: number }>(
      await request(app)
        .get('/api/me/chats')
        .set('Authorization', `Bearer ${tokenFor(luiz.id)}`)
        .expect(200),
    ).find((item) => item.id === chatId);

    expect(chat?.unreadMessages).toBe(daLista?.unreadMessages);
  });

  it('devolve null para conversa que o usuario excluiu', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);

    await request(app)
      .delete(`/api/chats/${chatId}`)
      .set('Authorization', `Bearer ${tokenFor(luiz.id)}`)
      .expect(200);

    const response = await request(app)
      .get(`/api/chats/${chatId}/summary`)
      .set('Authorization', `Bearer ${tokenFor(luiz.id)}`)
      .expect(200);

    expect(body<{ chat: unknown }>(response).chat).toBeNull();
  });

  it('recusa quem nao participa', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const ana = await createUser('Ana', 'ana@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);

    await request(app)
      .get(`/api/chats/${chatId}/summary`)
      .set('Authorization', `Bearer ${tokenFor(ana.id)}`)
      .expect(403);
  });
});
