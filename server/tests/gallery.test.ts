import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { GALLERY_PAGE_SIZE } from '@react-chat/shared';

import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';
import {
  body,
  createDirectChat,
  createUser,
  resetDb,
  sampleFile,
  tokenFor,
} from './helpers.js';

interface GalleryBody {
  media: { id: string; attachment: { name: string; type: string } | null }[];
  files: { id: string; attachment: { name: string; type: string } | null }[];
  links: { url: string; name: string }[];
  hasMore: { media: boolean; files: boolean; links: boolean };
}

/**
 * Anexos gravados direto no banco, sem passar pelo upload.
 *
 * A paginacao so aparece acima de 60 por aba, e 61 uploads de verdade — cada um
 * abrindo o arquivo no sharp para conferir os bytes — levariam a suite inteira
 * junto. O que esta sob teste aqui e a consulta, e para ela a linha no banco e
 * indistinguivel de uma que veio pela rota.
 */
async function seedAttachments(
  chatId: string,
  senderId: number,
  count: number,
  type: string,
  prefix = 'a',
): Promise<void> {
  const base = Date.now() - count * 60_000;

  await prisma.message.createMany({
    data: Array.from({ length: count }, (_, i) => ({
      chatId,
      senderId,
      text: '',
      attachmentUrl: `/uploads/${prefix}-${i}.bin`,
      attachmentName: `${prefix}-${i}`,
      attachmentType: type,
      createdAt: new Date(base + i * 60_000),
    })),
  });
}

async function send(
  chatId: string,
  userId: number,
  text: string,
  file?: { name: string; type: string },
) {
  const call = request(app)
    .post(`/api/chats/${chatId}/messages`)
    .set('Authorization', `Bearer ${tokenFor(userId)}`)
    .field('text', text);

  if (file) {
    // Conteudo de verdade do tipo declarado: o upload confere os bytes.
    call.attach('attachment', sampleFile(file.type), {
      filename: file.name,
      contentType: file.type,
    });
  }

  await call.expect(200);
}

function gallery(chatId: string, userId: number) {
  return request(app)
    .get(`/api/chats/${chatId}/media`)
    .set('Authorization', `Bearer ${tokenFor(userId)}`);
}

describe('galeria da conversa', () => {
  beforeEach(resetDb);

  it('separa midia, arquivos e links', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);

    await send(chatId, luiz.id, 'foto', { name: 'a.png', type: 'image/png' });
    await send(chatId, luiz.id, 'contrato', { name: 'a.pdf', type: 'application/pdf' });
    await send(chatId, joao.id, 'olha isto https://exemplo.test/post');
    await send(chatId, joao.id, 'sem nada de especial');

    const found = body<GalleryBody>(await gallery(chatId, luiz.id).expect(200));

    expect(found.media).toHaveLength(1);
    expect(found.media[0]?.attachment?.type).toBe('image/png');
    expect(found.files).toHaveLength(1);
    expect(found.files[0]?.attachment?.name).toBe('a.pdf');
    expect(found.links).toEqual([
      expect.objectContaining({ url: 'https://exemplo.test/post', name: 'Joao' }),
    ]);
  });

  /** A URL vem assinada, como em qualquer outro lugar que serve anexo. */
  it('a midia ja vem com a URL assinada', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);

    await send(chatId, luiz.id, 'foto', { name: 'a.png', type: 'image/png' });

    const found = body<{ media: { attachment: { url: string } }[] }>(
      await gallery(chatId, luiz.id).expect(200),
    );

    expect(found.media[0]?.attachment.url).toMatch(
      /^\/uploads\/[^?]+\?exp=\d+&sig=[0-9a-f]{64}$/,
    );
  });

  it('o mesmo link repetido aparece uma vez so', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);

    await send(chatId, luiz.id, 'veja https://exemplo.test/post');
    await send(chatId, joao.id, 'esse mesmo: https://exemplo.test/post');

    const found = body<GalleryBody>(await gallery(chatId, luiz.id).expect(200));
    expect(found.links).toHaveLength(1);
  });

  /**
   * "Limpar conversa" e um corte privado: o que ele escondeu do historico nao
   * pode reaparecer pela galeria, que seria a porta dos fundos.
   */
  it('respeita o corte de quem limpou a conversa', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);

    await send(chatId, luiz.id, 'foto', { name: 'a.png', type: 'image/png' });
    await send(chatId, luiz.id, 'link https://exemplo.test/post');

    await request(app)
      .post(`/api/chats/${chatId}/clear`)
      .set('Authorization', `Bearer ${tokenFor(luiz.id)}`)
      .expect(200);

    const mine = body<GalleryBody>(await gallery(chatId, luiz.id).expect(200));
    expect(mine.media).toHaveLength(0);
    expect(mine.links).toHaveLength(0);

    // Do outro lado nada mudou: o corte e de quem limpou.
    const theirs = body<GalleryBody>(await gallery(chatId, joao.id).expect(200));
    expect(theirs.media).toHaveLength(1);
    expect(theirs.links).toHaveLength(1);
  });

  it('recusa quem nao participa da conversa', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const ana = await createUser('Ana', 'ana@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);

    await gallery(chatId, ana.id).expect(403);
  });
});

describe('galeria: paginacao por aba', () => {
  beforeEach(resetDb);

  async function twoPeopleAndChat() {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    return { luiz, joao, chatId: await createDirectChat(luiz.id, joao.id) };
  }

  it('a primeira pagina para no teto e avisa que ha mais', async () => {
    const { luiz, chatId } = await twoPeopleAndChat();
    await seedAttachments(chatId, luiz.id, GALLERY_PAGE_SIZE + 5, 'image/png');

    const first = body<GalleryBody>(await gallery(chatId, luiz.id).expect(200));

    expect(first.media).toHaveLength(GALLERY_PAGE_SIZE);
    expect(first.hasMore.media).toBe(true);
  });

  it('exatamente o teto nao promete mais nada', async () => {
    const { luiz, chatId } = await twoPeopleAndChat();
    await seedAttachments(chatId, luiz.id, GALLERY_PAGE_SIZE, 'image/png');

    const found = body<GalleryBody>(await gallery(chatId, luiz.id).expect(200));

    expect(found.media).toHaveLength(GALLERY_PAGE_SIZE);
    expect(found.hasMore.media).toBe(false);
  });

  it('a proxima pagina continua de onde a anterior parou', async () => {
    const { luiz, chatId } = await twoPeopleAndChat();
    await seedAttachments(chatId, luiz.id, GALLERY_PAGE_SIZE + 5, 'image/png');

    const first = body<GalleryBody>(await gallery(chatId, luiz.id).expect(200));
    const cursor = first.media.at(-1)?.id;

    const second = body<GalleryBody>(
      await gallery(chatId, luiz.id).query({ tab: 'media', cursor }).expect(200),
    );

    expect(second.media).toHaveLength(5);
    expect(second.hasMore.media).toBe(false);

    // Nenhum id volta duas vezes: e o `skip: 1` do cursor.
    const ids = new Set([...first.media, ...second.media].map((item) => item.id));
    expect(ids.size).toBe(GALLERY_PAGE_SIZE + 5);
  });

  /** Paginar uma aba nao arrasta as outras duas junto pela rede. */
  it('a pagina de uma aba vem so com ela', async () => {
    const { luiz, chatId } = await twoPeopleAndChat();
    await seedAttachments(chatId, luiz.id, GALLERY_PAGE_SIZE + 2, 'image/png');
    await seedAttachments(chatId, luiz.id, 3, 'application/pdf', 'doc');

    const first = body<GalleryBody>(await gallery(chatId, luiz.id).expect(200));
    const cursor = first.media.at(-1)?.id;

    const second = body<GalleryBody>(
      await gallery(chatId, luiz.id).query({ tab: 'media', cursor }).expect(200),
    );

    expect(second.media).toHaveLength(2);
    expect(second.files).toHaveLength(0);
    expect(second.links).toHaveLength(0);
  });

  /**
   * A divisao entre midia e arquivo virou filtro da consulta.
   *
   * Antes ela era feita em memoria sobre uma pagina unica de anexos — a
   * consulta trazia o dobro do teto e torcia para sobrar dos dois lados. Com
   * 130 imagens na frente, o PDF caia fora da janela lida e a aba "Arquivos"
   * aparecia vazia numa conversa que tem arquivo.
   */
  it('muita midia nao esconde os arquivos', async () => {
    const { luiz, chatId } = await twoPeopleAndChat();
    await seedAttachments(chatId, luiz.id, 130, 'image/png');
    await seedAttachments(chatId, luiz.id, 1, 'application/pdf', 'contrato');

    const found = body<GalleryBody>(await gallery(chatId, luiz.id).expect(200));

    expect(found.media).toHaveLength(GALLERY_PAGE_SIZE);
    expect(found.files).toHaveLength(1);
    expect(found.files[0]?.attachment?.name).toBe('contrato-0');
  });

  it('recusa uma aba que nao existe', async () => {
    const { luiz, chatId } = await twoPeopleAndChat();

    await gallery(chatId, luiz.id).query({ tab: 'fotos' }).expect(400);
  });

  /** Cursor sem aba nao diz de qual das tres ele e. */
  it('recusa cursor sem aba', async () => {
    const { luiz, chatId } = await twoPeopleAndChat();

    await gallery(chatId, luiz.id).query({ cursor: 'qualquer' }).expect(400);
  });
});
