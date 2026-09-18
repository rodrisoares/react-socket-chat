import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';

import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';
import { body, createUser, resetDb, tokenFor } from './helpers.js';

/**
 * O grupo nunca fica sem quem o administre.
 *
 * So o criador era admin, e sair do grupo zerava a flag: o grupo ficava travado
 * para sempre — ninguem podia renomear, trocar a foto nem administrar membros.
 * Quando o ultimo admin sai, herda quem esta ha mais tempo no grupo.
 */
async function criarGrupo(criadorId: number, membros: number[]): Promise<string> {
  const criado = await request(app)
    .post('/api/chats/groups')
    .set('Authorization', `Bearer ${tokenFor(criadorId)}`)
    .send({ name: 'Time', memberIds: membros });

  return body<{ id: string }>(criado).id;
}

describe('DELETE /api/chats/:id/members/:userId — heranca do admin', () => {
  beforeEach(resetDb);

  it('promove o membro mais antigo quando o criador sai', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const ana = await createUser('Ana', 'ana@email.com');
    const chatId = await criarGrupo(luiz.id, [joao.id, ana.id]);

    const saida = await request(app)
      .delete(`/api/chats/${chatId}/members/${luiz.id}`)
      .set('Authorization', `Bearer ${tokenFor(luiz.id)}`);

    expect(saida.status).toBeLessThan(300);

    const admins = await prisma.chatParticipant.findMany({
      where: { chatId, leftAt: null, isAdmin: true },
      select: { userId: true },
    });

    // O Joao entrou antes da Ana: e dele a herança.
    expect(admins).toHaveLength(1);
    expect(admins[0]?.userId).toBe(joao.id);
  });

  /** O que a promoção existe para garantir: o grupo continua administrável. */
  it('o novo admin consegue renomear o grupo', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await criarGrupo(luiz.id, [joao.id]);

    await request(app)
      .delete(`/api/chats/${chatId}/members/${luiz.id}`)
      .set('Authorization', `Bearer ${tokenFor(luiz.id)}`);

    await request(app)
      .patch(`/api/chats/${chatId}`)
      .set('Authorization', `Bearer ${tokenFor(joao.id)}`)
      .send({ name: 'Time novo' })
      .expect(200);

    const chat = await prisma.chat.findUnique({
      where: { id: chatId },
      select: { name: true },
    });
    expect(chat?.name).toBe('Time novo');
  });

  it('quem sai deixa de ser admin', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await criarGrupo(luiz.id, [joao.id]);

    await request(app)
      .delete(`/api/chats/${chatId}/members/${luiz.id}`)
      .set('Authorization', `Bearer ${tokenFor(luiz.id)}`);

    const criador = await prisma.chatParticipant.findFirst({
      where: { chatId, userId: luiz.id },
      select: { isAdmin: true, leftAt: true },
    });

    expect(criador?.isAdmin).toBe(false);
    expect(criador?.leftAt).not.toBeNull();
  });
});

/**
 * O grupo nasce vestido.
 *
 * Ele nascia so com nome e participantes: a foto e o assunto vinham depois,
 * pelo painel de detalhes — que muita gente nunca abre. Na lista, grupos sem
 * foto ficam indistinguiveis uns dos outros, e nada diz do que se tratam.
 */
describe('POST /api/chats/groups — foto e descricao na criacao', () => {
  beforeEach(resetDb);

  it('grava a foto e a descricao junto com o grupo', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');

    const criado = await request(app)
      .post('/api/chats/groups')
      .set('Authorization', `Bearer ${tokenFor(luiz.id)}`)
      .send({
        name: 'Time do Deploy',
        memberIds: [joao.id],
        image: 'https://api.dicebear.com/9.x/icons/svg?seed=foguete',
        description: 'Combinados de subida para producao',
      })
      .expect(201);

    const grupo = await prisma.chat.findUnique({
      where: { id: body<{ id: string }>(criado).id },
    });

    expect(grupo?.image).toBe('https://api.dicebear.com/9.x/icons/svg?seed=foguete');
    expect(grupo?.description).toBe('Combinados de subida para producao');
  });

  /** Os dois sao opcionais: juntar tres pessoas nao pode virar formulario. */
  it('continua criando o grupo so com nome e participantes', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');

    const criado = await request(app)
      .post('/api/chats/groups')
      .set('Authorization', `Bearer ${tokenFor(luiz.id)}`)
      .send({ name: 'Time', memberIds: [joao.id] })
      .expect(201);

    const grupo = await prisma.chat.findUnique({
      where: { id: body<{ id: string }>(criado).id },
    });

    expect(grupo?.image).toBeNull();
    expect(grupo?.description).toBeNull();
  });

  /** Campo vazio e ausencia, e nao uma foto de caminho vazio. */
  it('trata string vazia como nao preenchido', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');

    const criado = await request(app)
      .post('/api/chats/groups')
      .set('Authorization', `Bearer ${tokenFor(luiz.id)}`)
      .send({ name: 'Time', memberIds: [joao.id], image: '', description: '' })
      .expect(201);

    const grupo = await prisma.chat.findUnique({
      where: { id: body<{ id: string }>(criado).id },
    });

    expect(grupo?.image).toBeNull();
    expect(grupo?.description).toBeNull();
  });

  /**
   * A foto passa pelo mesmo filtro do avatar: so DiceBear ou upload proprio.
   * Sem isto, a criacao seria a porta de entrada que o PATCH ja fechou — e a
   * imagem de um grupo aponta para um servidor de terceiros que passa a ver o
   * IP de todo mundo que abre a conversa.
   */
  it('recusa foto de origem que nao e do app', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');

    await request(app)
      .post('/api/chats/groups')
      .set('Authorization', `Bearer ${tokenFor(luiz.id)}`)
      .send({
        name: 'Time',
        memberIds: [joao.id],
        image: 'https://exemplo.invalid/rastreador.png',
      })
      .expect(400);
  });

  it('recusa descricao longa demais', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');

    await request(app)
      .post('/api/chats/groups')
      .set('Authorization', `Bearer ${tokenFor(luiz.id)}`)
      .send({ name: 'Time', memberIds: [joao.id], description: 'a'.repeat(400) })
      .expect(400);
  });
});
