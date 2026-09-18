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

/**
 * Uma conversa no resultado filtrado.
 *
 * A busca da lista deixou de ser rota propria: ela e a propria listagem, com
 * termo. A conversa que casou pelo conteudo traz a mensagem em
 * `matchedMessage`; a que casou pelo nome, nao — ali nao ha trecho para
 * mostrar.
 */
interface Hit {
  id: string;
  name: string;
  matchedMessage?: { id: string; text: string };
}

function search(userId: number, term: string) {
  return request(app)
    .get(`/api/me/chats?q=${encodeURIComponent(term)}`)
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

    const found = body<{ chats: Hit[] }>(await search(luiz.id, 'deploy').expect(200));
    expect(found.chats).toHaveLength(1);
    expect(found.chats[0]?.matchedMessage?.text).toBe('combinamos o deploy de sexta');
  });

  it('ignora maiusculas', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);
    await write(chatId, joao.id, ['Reuniao na Segunda']);

    const found = body<{ chats: Hit[] }>(await search(luiz.id, 'REUNIAO').expect(200));
    expect(found.chats).toHaveLength(1);
  });

  it('devolve uma ocorrencia por conversa, a mais recente', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);
    await write(chatId, joao.id, ['deploy antigo', 'deploy novo']);

    const found = body<{ chats: Hit[] }>(await search(luiz.id, 'deploy').expect(200));
    expect(found.chats).toHaveLength(1);
    expect(found.chats[0]?.matchedMessage?.text).toBe('deploy novo');
  });

  it('nao acha nada em conversa alheia', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const marcia = await createUser('Marcia', 'marcia@email.com');
    const chatId = await createDirectChat(joao.id, marcia.id);
    await write(chatId, joao.id, ['assunto privado']);

    const found = body<{ chats: Hit[] }>(await search(luiz.id, 'privado').expect(200));
    expect(found.chats).toHaveLength(0);
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
      body<{ chats: Hit[] }>(await search(luiz.id, 'segredo')).chats,
    ).toHaveLength(0);
    // Para o outro, nada mudou.
    expect(
      body<{ chats: Hit[] }>(await search(joao.id, 'segredo')).chats,
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
      body<{ chats: Hit[] }>(await search(luiz.id, 'apagado')).chats,
    ).toHaveLength(0);
  });

  /**
   * O conteudo so entra a partir de dois caracteres: com uma letra o indice
   * devolveria quase tudo, e custaria caro para isso. O nome vale desde a
   * primeira — filtrar uma lista curta digitando "a" e comum e barato.
   */
  it('o conteudo exige dois caracteres; o nome, nao', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const ana = await createUser('Ana', 'ana@email.com');
    const chatId = await createDirectChat(luiz.id, ana.id);
    await write(chatId, ana.id, ['assunto qualquer']);

    // Uma letra: casa a Ana pelo nome, e nao devolve a mensagem.
    const curto = body<{ chats: Hit[] }>(await search(luiz.id, 'a').expect(200));
    expect(curto.chats.map((hit) => hit.id)).toEqual([chatId]);
    expect(curto.chats[0]?.matchedMessage).toBeUndefined();

    // Duas: o conteudo entra, e a mensagem vem junto.
    const longo = body<{ chats: Hit[] }>(await search(luiz.id, 'assunto').expect(200));
    expect(longo.chats[0]?.matchedMessage?.text).toBe('assunto qualquer');
  });
});

/**
 * Filtrar pelo nome da conversa.
 *
 * Isto era feito no navegador, sobre as conversas ja carregadas — e para o
 * filtro nao esconder conversa que existe, a tela puxava a lista inteira ao
 * primeiro caractere digitado. O nome nao mora num lugar so: o do grupo esta
 * na conversa, e o da direta e o nome da outra pessoa.
 */
describe('filtro por nome da conversa', () => {
  beforeEach(resetDb);

  it('acha a conversa direta pelo nome do contato', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const marcia = await createUser('Marcia', 'marcia@email.com');
    const joao = await createUser('Joao', 'joao@email.com');

    const comMarcia = await createDirectChat(luiz.id, marcia.id);
    await createDirectChat(luiz.id, joao.id);

    const found = body<{ chats: Hit[] }>(await search(luiz.id, 'marc').expect(200));
    expect(found.chats.map((hit) => hit.id)).toEqual([comMarcia]);
  });

  it('acha o grupo pelo nome dele', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');

    await prisma.chat.create({
      data: {
        type: 'GROUP',
        name: 'Time do Deploy',
        lastMessageAt: new Date(),
        participants: { create: [{ userId: luiz.id }, { userId: joao.id }] },
      },
    });

    const found = body<{ chats: Hit[] }>(await search(luiz.id, 'time').expect(200));
    expect(found.chats.map((hit) => hit.name)).toEqual(['Time do Deploy']);
  });

  /** O nome do membro nao pode arrastar o grupo para o resultado. */
  it('nao acha o grupo pelo nome de quem esta nele', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const marcia = await createUser('Marcia', 'marcia@email.com');

    await prisma.chat.create({
      data: {
        type: 'GROUP',
        name: 'Assuntos gerais',
        lastMessageAt: new Date(),
        participants: { create: [{ userId: luiz.id }, { userId: marcia.id }] },
      },
    });

    const found = body<{ chats: Hit[] }>(await search(luiz.id, 'marcia').expect(200));
    expect(found.chats).toHaveLength(0);
  });

  /** Nome e conteudo sao a mesma pergunta para quem procura: uma lista so. */
  it('junta o que casou pelo nome e o que casou pelo conteudo', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const deploy = await createUser('Deploy', 'deploy@email.com');
    const joao = await createUser('Joao', 'joao@email.com');

    const peloNome = await createDirectChat(luiz.id, deploy.id);
    const peloTexto = await createDirectChat(luiz.id, joao.id);
    await write(peloTexto, joao.id, ['subimos o deploy ontem']);

    const found = body<{ chats: Hit[] }>(await search(luiz.id, 'deploy').expect(200));
    const ids = found.chats.map((hit) => hit.id);

    expect(ids).toContain(peloNome);
    expect(ids).toContain(peloTexto);
    expect(found.chats.find((hit) => hit.id === peloNome)?.matchedMessage).toBeUndefined();
    expect(found.chats.find((hit) => hit.id === peloTexto)?.matchedMessage?.text).toBe(
      'subimos o deploy ontem',
    );
  });

  /** O resultado continua paginado: era a paginacao que a cascata contornava. */
  it('pagina o resultado filtrado', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');

    for (let i = 0; i < 4; i += 1) {
      const outro = await createUser(`Marcia ${String(i)}`, `marcia${String(i)}@email.com`);
      await createDirectChat(luiz.id, outro.id);
    }

    const primeira = body<{ chats: Hit[]; nextCursor: string | null }>(
      await request(app)
        .get('/api/me/chats?q=marcia&limit=2')
        .set('Authorization', `Bearer ${tokenFor(luiz.id)}`)
        .expect(200),
    );

    expect(primeira.chats).toHaveLength(2);
    expect(primeira.nextCursor).not.toBeNull();

    const segunda = body<{ chats: Hit[] }>(
      await request(app)
        .get(
          `/api/me/chats?q=marcia&limit=2&cursor=${encodeURIComponent(primeira.nextCursor ?? '')}`,
        )
        .set('Authorization', `Bearer ${tokenFor(luiz.id)}`)
        .expect(200),
    );

    const todos = [...primeira.chats, ...segunda.chats].map((hit) => hit.id);
    expect(new Set(todos).size).toBe(4);
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
    const { chats } = body<{ chats: Hit[] }>(response);

    const chatIds = chats.map((hit) => hit.id);
    expect(chatIds).toContain(antiga);
    expect(chatIds).toContain(recente);

    // Uma por conversa, e a mais recente de cada uma.
    expect(chats).toHaveLength(2);
    expect(chats.find((hit) => hit.id === antiga)?.matchedMessage?.text).toBe(
      'combinamos o deploy naquele dia',
    );
    expect(chats.find((hit) => hit.id === recente)?.matchedMessage?.text).toBe(
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

    const semAcento = body<{ chats: Hit[] }>(await search(luiz.id, 'reuniao').expect(200));
    expect(semAcento.chats).toHaveLength(1);

    const comAcento = body<{ chats: Hit[] }>(await search(luiz.id, 'reunião').expect(200));
    expect(comAcento.chats).toHaveLength(1);
  });

  /** Quem digita "depl" espera achar "deploy" enquanto ainda escreve. */
  it('casa por prefixo', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);
    await write(chatId, joao.id, ['subi o deploy']);

    const found = body<{ chats: Hit[] }>(await search(luiz.id, 'depl').expect(200));
    expect(found.chats).toHaveLength(1);
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

    const antigo = body<{ chats: Hit[] }>(await search(luiz.id, 'original').expect(200));
    expect(antigo.chats).toHaveLength(0);

    const novo = body<{ chats: Hit[] }>(await search(luiz.id, 'corrigido').expect(200));
    expect(novo.chats).toHaveLength(1);
  });
});
