import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';

import { app } from '../src/app.js';
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
