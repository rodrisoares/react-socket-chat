import { beforeEach, describe, expect, it } from 'vitest';
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

interface Hit {
  chatId: string;
  message: { id: string; text: string };
}

function search(userId: number, term: string) {
  return request(app)
    .get(`/api/me/search?q=${encodeURIComponent(term)}`)
    .set('Authorization', `Bearer ${tokenFor(userId)}`);
}

function searchInChat(userId: number, chatId: string, term: string) {
  return request(app)
    .get(`/api/chats/${chatId}/search?q=${encodeURIComponent(term)}`)
    .set('Authorization', `Bearer ${tokenFor(userId)}`);
}

/** Grava direto no banco: o alvo e a leitura, nao o envio. */
async function write(chatId: string, senderId: number, texts: string[]) {
  const base = Date.now() - texts.length * 60_000;
  await prisma.message.createMany({
    data: texts.map((text, i) => ({
      chatId,
      senderId,
      text,
      createdAt: new Date(base + i * 60_000),
    })),
  });
}

describe('busca global por conteudo', () => {
  beforeEach(resetDb);

  /** O ponto da feature: antes so achava nas ultimas 30 carregadas. */
  it('acha mensagem antiga, muito alem da primeira pagina', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);

    await write(chatId, joao.id, ['combinamos o deploy de sexta']);
    await seedMessages(chatId, joao.id, 100);

    const found = body<{ results: Hit[] }>(await search(luiz.id, 'deploy').expect(200));
    expect(found.results).toHaveLength(1);
    expect(found.results[0]?.message.text).toBe('combinamos o deploy de sexta');
  });

  it('ignora maiusculas', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);
    await write(chatId, joao.id, ['Reuniao na Segunda']);

    const found = body<{ results: Hit[] }>(await search(luiz.id, 'REUNIAO').expect(200));
    expect(found.results).toHaveLength(1);
  });

  it('devolve uma ocorrencia por conversa, a mais recente', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);
    await write(chatId, joao.id, ['deploy antigo', 'deploy novo']);

    const found = body<{ results: Hit[] }>(await search(luiz.id, 'deploy').expect(200));
    expect(found.results).toHaveLength(1);
    expect(found.results[0]?.message.text).toBe('deploy novo');
  });

  it('nao acha nada em conversa alheia', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const marcia = await createUser('Marcia', 'marcia@email.com');
    const chatId = await createDirectChat(joao.id, marcia.id);
    await write(chatId, joao.id, ['assunto privado']);

    const found = body<{ results: Hit[] }>(await search(luiz.id, 'privado').expect(200));
    expect(found.results).toHaveLength(0);
  });

  it('respeita o historico limpo', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);
    await write(chatId, joao.id, ['segredo antigo']);

    await request(app)
      .post(`/api/chats/${chatId}/clear`)
      .set('Authorization', `Bearer ${tokenFor(luiz.id)}`);

    expect(
      body<{ results: Hit[] }>(await search(luiz.id, 'segredo')).results,
    ).toHaveLength(0);
    // Para o outro, nada mudou.
    expect(
      body<{ results: Hit[] }>(await search(joao.id, 'segredo')).results,
    ).toHaveLength(1);
  });

  it('ignora mensagem apagada', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);

    const enviada = await request(app)
      .post(`/api/chats/${chatId}/messages`)
      .set('Authorization', `Bearer ${tokenFor(joao.id)}`)
      .field('text', 'texto que sera apagado');

    await request(app)
      .delete(`/api/chats/${chatId}/messages/${body<{ id: string }>(enviada).id}`)
      .set('Authorization', `Bearer ${tokenFor(joao.id)}`);

    expect(
      body<{ results: Hit[] }>(await search(luiz.id, 'apagado')).results,
    ).toHaveLength(0);
  });

  it('exige ao menos dois caracteres', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    expect(body<{ results: Hit[] }>(await search(luiz.id, 'a')).results).toHaveLength(0);
  });
});

describe('busca dentro da conversa', () => {
  beforeEach(resetDb);

  it('acha em todo o historico, em ordem cronologica', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);

    await write(chatId, joao.id, ['pauta um', 'outra coisa', 'pauta dois']);
    await seedMessages(chatId, joao.id, 60);

    const found = body<{ messages: { text: string }[] }>(
      await searchInChat(luiz.id, chatId, 'pauta').expect(200),
    );
    expect(found.messages.map((m) => m.text)).toEqual(['pauta um', 'pauta dois']);
  });

  it('nao deixa buscar em conversa de que nao participa', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const marcia = await createUser('Marcia', 'marcia@email.com');
    const chatId = await createDirectChat(joao.id, marcia.id);

    await searchInChat(luiz.id, chatId, 'oi').expect(403);
  });
});

describe('busca global sem teto de varredura', () => {
  beforeEach(resetDb);

  /**
   * A busca varria as 300 mensagens mais recentes que casavam e escolhia uma
   * por conversa dali. Uma conversa antiga com a palavra ficava de fora, e
   * nada avisava que isso tinha acontecido: o usuario concluia que a mensagem
   * nao existia.
   */
  it('acha a conversa antiga mesmo com centenas de ocorrencias recentes', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const ana = await createUser('Ana', 'ana@email.com');

    const antiga = await createDirectChat(luiz.id, joao.id);
    const recente = await createDirectChat(luiz.id, ana.id);

    // A ocorrencia antiga, bem atras no tempo.
    await prisma.message.create({
      data: {
        chatId: antiga,
        senderId: joao.id,
        text: 'combinamos o deploy naquele dia',
        createdAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000),
      },
    });

    // E 400 ocorrencias recentes na outra conversa, mais do que a varredura
    // de 300 que existia antes.
    const base = Date.now() - 400 * 60_000;
    await prisma.message.createMany({
      data: Array.from({ length: 400 }, (_, i) => ({
        chatId: recente,
        senderId: ana.id,
        text: `deploy numero ${i + 1}`,
        createdAt: new Date(base + i * 60_000),
      })),
    });

    const response = await search(luiz.id, 'deploy').expect(200);
    const { results } = body<{ results: Hit[] }>(response);

    const chatIds = results.map((hit) => hit.chatId);
    expect(chatIds).toContain(antiga);
    expect(chatIds).toContain(recente);

    // Uma por conversa, e a mais recente de cada uma.
    expect(results).toHaveLength(2);
    expect(results.find((hit) => hit.chatId === antiga)?.message.text).toBe(
      'combinamos o deploy naquele dia',
    );
    expect(results.find((hit) => hit.chatId === recente)?.message.text).toBe(
      'deploy numero 400',
    );
  });
});

describe('busca com indice de texto completo', () => {
  beforeEach(resetDb);

  /**
   * O ganho que o FTS5 traz de verdade: o LIKE anterior era sensivel a acento,
   * entao "reuniao" nao achava "reunião" — e em portugues isso e a regra, nao
   * a excecao.
   */
  it('acha com e sem acento, nos dois sentidos', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);
    await write(chatId, joao.id, ['a reunião ficou para terça']);

    const semAcento = body<{ results: Hit[] }>(await search(luiz.id, 'reuniao').expect(200));
    expect(semAcento.results).toHaveLength(1);

    const comAcento = body<{ results: Hit[] }>(await search(luiz.id, 'reunião').expect(200));
    expect(comAcento.results).toHaveLength(1);
  });

  /** Quem digita "depl" espera achar "deploy" enquanto ainda escreve. */
  it('casa por prefixo', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);
    await write(chatId, joao.id, ['subi o deploy']);

    const found = body<{ results: Hit[] }>(await search(luiz.id, 'depl').expect(200));
    expect(found.results).toHaveLength(1);
  });

  /**
   * Aspas, hifen e dois-pontos tem significado no MATCH do FTS5: um termo cru
   * derrubaria a consulta inteira com erro de sintaxe.
   */
  it('aguenta termo com pontuacao sem quebrar', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);
    await write(chatId, joao.id, ['abrir chamado']);

    for (const termo of ['"aspas', 'meio-termo', 'campo:valor', '((']) {
      await search(luiz.id, termo).expect(200);
    }
  });

  /** O indice acompanha a tabela pelas triggers da migracao. */
  it('mensagem editada passa a ser achada pelo texto novo', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);

    const enviada = await request(app)
      .post(`/api/chats/${chatId}/messages`)
      .set('Authorization', `Bearer ${tokenFor(joao.id)}`)
      .send({ text: 'texto original' })
      .expect(200);

    const { id } = body<{ id: string }>(enviada);

    await request(app)
      .patch(`/api/chats/${chatId}/messages/${id}`)
      .set('Authorization', `Bearer ${tokenFor(joao.id)}`)
      .send({ text: 'texto corrigido' })
      .expect(200);

    const antigo = body<{ results: Hit[] }>(await search(luiz.id, 'original').expect(200));
    expect(antigo.results).toHaveLength(0);

    const novo = body<{ results: Hit[] }>(await search(luiz.id, 'corrigido').expect(200));
    expect(novo.results).toHaveLength(1);
  });
});
