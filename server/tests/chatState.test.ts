import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';

import { existsSync } from 'node:fs';
import path from 'node:path';

import { app } from '../src/app.js';
import { UPLOAD_DIR } from '../src/config/upload.js';
import {
  body,
  chatList,
  createDirectChat,
  createUser,
  resetDb,
  seedMessages,
  tokenFor,
} from './helpers.js';

interface ChatBody {
  id: string;
  name: string;
  isArchived: boolean;
  isMuted: boolean;
  hasLeft: boolean;
  unreadMessages: number;
  lastMessage: { text: string } | null;
  members: { id: number }[];
  readBy: Record<number, string>;
}

async function listChats(userId: number): Promise<ChatBody[]> {
  const response = await request(app)
    .get('/api/me/chats')
    .set('Authorization', `Bearer ${tokenFor(userId)}`);

  return chatList<ChatBody>(response);
}

/** Grupo criado pela API, para o criador ja sair como admin. */
async function createGroup(
  creatorId: number,
  memberIds: number[],
  name = 'Time',
): Promise<string> {
  const response = await request(app)
    .post('/api/chats/groups')
    .set('Authorization', `Bearer ${tokenFor(creatorId)}`)
    .send({ name, memberIds });

  return body<{ id: string }>(response).id;
}

function send(chatId: string, userId: number, text: string) {
  return request(app)
    .post(`/api/chats/${chatId}/messages`)
    .set('Authorization', `Bearer ${tokenFor(userId)}`)
    .field('text', text);
}

describe('arquivar conversa', () => {
  beforeEach(resetDb);

  it('arquiva e desarquiva', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);
    const token = `Bearer ${tokenFor(luiz.id)}`;

    expect((await listChats(luiz.id))[0]?.isArchived).toBe(false);

    await request(app)
      .post(`/api/chats/${chatId}/archive`)
      .set('Authorization', token)
      .expect(200);
    expect((await listChats(luiz.id))[0]?.isArchived).toBe(true);

    await request(app)
      .delete(`/api/chats/${chatId}/archive`)
      .set('Authorization', token)
      .expect(200);
    expect((await listChats(luiz.id))[0]?.isArchived).toBe(false);
  });

  /** O motivo de guardar o instante em vez de um booleano. */
  it('mensagem nova desarquiva sozinha', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);
    await seedMessages(chatId, joao.id, 2);

    await request(app)
      .post(`/api/chats/${chatId}/archive`)
      .set('Authorization', `Bearer ${tokenFor(luiz.id)}`);
    expect((await listChats(luiz.id))[0]?.isArchived).toBe(true);

    await send(chatId, joao.id, 'oi de novo').expect(200);
    expect((await listChats(luiz.id))[0]?.isArchived).toBe(false);
  });

  it('e privado: arquivar nao afeta a lista do outro', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);

    await request(app)
      .post(`/api/chats/${chatId}/archive`)
      .set('Authorization', `Bearer ${tokenFor(luiz.id)}`);

    expect((await listChats(joao.id))[0]?.isArchived).toBe(false);
  });
});

describe('silenciar conversa', () => {
  beforeEach(resetDb);

  it('silencia e reativa, sem afetar o outro', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);
    const token = `Bearer ${tokenFor(luiz.id)}`;

    await request(app)
      .post(`/api/chats/${chatId}/mute`)
      .set('Authorization', token)
      .expect(200);
    expect((await listChats(luiz.id))[0]?.isMuted).toBe(true);
    expect((await listChats(joao.id))[0]?.isMuted).toBe(false);

    await request(app)
      .delete(`/api/chats/${chatId}/mute`)
      .set('Authorization', token)
      .expect(200);
    expect((await listChats(luiz.id))[0]?.isMuted).toBe(false);
  });

  it('nao mexe no nao lido', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);
    await seedMessages(chatId, joao.id, 3);

    await request(app)
      .post(`/api/chats/${chatId}/mute`)
      .set('Authorization', `Bearer ${tokenFor(luiz.id)}`);

    expect((await listChats(luiz.id))[0]?.unreadMessages).toBe(3);
  });
});

describe('limpar conversa', () => {
  beforeEach(resetDb);

  it('esvazia o historico e mantem a conversa na lista', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);
    await seedMessages(chatId, joao.id, 4);

    await request(app)
      .post(`/api/chats/${chatId}/clear`)
      .set('Authorization', `Bearer ${tokenFor(luiz.id)}`)
      .expect(200);

    const lista = await listChats(luiz.id);
    expect(lista).toHaveLength(1);
    expect(lista[0]?.lastMessage).toBeNull();
    expect(lista[0]?.unreadMessages).toBe(0);
  });

  it('e privado: o outro continua com o historico inteiro', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);
    await seedMessages(chatId, joao.id, 4);

    await request(app)
      .post(`/api/chats/${chatId}/clear`)
      .set('Authorization', `Bearer ${tokenFor(luiz.id)}`);

    expect((await listChats(joao.id))[0]?.lastMessage?.text).toBe('msg 4');
  });

  it('limpa grupo sem exigir sair antes', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createGroup(luiz.id, [joao.id]);
    await send(chatId, joao.id, 'oi');

    await request(app)
      .post(`/api/chats/${chatId}/clear`)
      .set('Authorization', `Bearer ${tokenFor(luiz.id)}`)
      .expect(200);

    const lista = await listChats(luiz.id);
    expect(lista).toHaveLength(1);
    expect(lista[0]?.lastMessage).toBeNull();
  });

  /** O motivo de o limpar zerar o hiddenAt em vez de so mover o corte. */
  it('traz de volta uma conversa que tinha sido excluida', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);
    await seedMessages(chatId, joao.id, 2);
    const token = `Bearer ${tokenFor(luiz.id)}`;

    await request(app).delete(`/api/chats/${chatId}`).set('Authorization', token);
    await send(chatId, joao.id, 'voltei').expect(200);
    expect(await listChats(luiz.id)).toHaveLength(1);

    await request(app)
      .post(`/api/chats/${chatId}/clear`)
      .set('Authorization', token)
      .expect(200);

    const lista = await listChats(luiz.id);
    expect(lista).toHaveLength(1);
    expect(lista[0]?.lastMessage).toBeNull();
  });
});

describe('excluir conversa so para mim', () => {
  beforeEach(resetDb);

  it('some da minha lista e continua na do outro', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);
    await seedMessages(chatId, joao.id, 3);

    await request(app)
      .delete(`/api/chats/${chatId}`)
      .set('Authorization', `Bearer ${tokenFor(luiz.id)}`)
      .expect(200);

    expect(await listChats(luiz.id)).toHaveLength(0);

    const doJoao = await listChats(joao.id);
    expect(doJoao).toHaveLength(1);
    expect(doJoao[0]?.lastMessage?.text).toBe('msg 3');
  });

  it('volta com mensagem nova, e so com o que veio depois', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);
    await seedMessages(chatId, joao.id, 3);

    await request(app)
      .delete(`/api/chats/${chatId}`)
      .set('Authorization', `Bearer ${tokenFor(luiz.id)}`);
    await send(chatId, joao.id, 'ainda esta ai?').expect(200);

    const depois = await listChats(luiz.id);
    expect(depois).toHaveLength(1);
    expect(depois[0]?.lastMessage?.text).toBe('ainda esta ai?');
  });

  it('paginar para tras nao devolve o historico excluido', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);
    await seedMessages(chatId, joao.id, 5);

    await request(app)
      .delete(`/api/chats/${chatId}`)
      .set('Authorization', `Bearer ${tokenFor(luiz.id)}`);
    await send(chatId, joao.id, 'nova').expect(200);

    const before = encodeURIComponent(new Date(Date.now() + 1000).toISOString());
    const response = await request(app)
      .get(`/api/chats/${chatId}/messages?before=${before}`)
      .set('Authorization', `Bearer ${tokenFor(luiz.id)}`)
      .expect(200);

    const page = body<{ messages: { text: string }[] }>(response);
    expect(page.messages.map((m) => m.text)).toEqual(['nova']);
  });

  /**
   * O caso que quebrava o "Enviar mensagem": a conversa excluida continua no
   * banco, entao o POST /api/chats a encontrava e devolvia um id que o
   * /api/me/chats nao listava.
   */
  it('abrir a conversa de novo a traz de volta para a lista', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);
    await seedMessages(chatId, joao.id, 3);
    const token = `Bearer ${tokenFor(luiz.id)}`;

    await request(app).delete(`/api/chats/${chatId}`).set('Authorization', token);
    expect(await listChats(luiz.id)).toHaveLength(0);

    const reaberta = await request(app)
      .post('/api/chats')
      .set('Authorization', token)
      .send({ otherUserId: joao.id })
      .expect(200);

    expect(body<{ id: string }>(reaberta).id).toBe(chatId);

    const lista = await listChats(luiz.id);
    expect(lista).toHaveLength(1);
    expect(lista[0]?.id).toBe(chatId);
    // Voltar para a lista nao desfaz o "limpar": o historico segue escondido.
    expect(lista[0]?.lastMessage).toBeNull();
  });

  it('nao traz a conversa de volta para o outro participante', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);
    await seedMessages(chatId, joao.id, 2);

    // Os dois excluem; so o Luiz reabre.
    for (const user of [luiz, joao]) {
      await request(app)
        .delete(`/api/chats/${chatId}`)
        .set('Authorization', `Bearer ${tokenFor(user.id)}`);
    }

    await request(app)
      .post('/api/chats')
      .set('Authorization', `Bearer ${tokenFor(luiz.id)}`)
      .send({ otherUserId: joao.id })
      .expect(200);

    expect(await listChats(luiz.id)).toHaveLength(1);
    expect(await listChats(joao.id)).toHaveLength(0);
  });

  it('recusa excluir grupo antes de sair', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createGroup(luiz.id, [joao.id]);

    await request(app)
      .delete(`/api/chats/${chatId}`)
      .set('Authorization', `Bearer ${tokenFor(luiz.id)}`)
      .expect(400);
  });
});

describe('sair do grupo', () => {
  beforeEach(resetDb);

  it('mantem a conversa na lista, em somente leitura', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createGroup(luiz.id, [joao.id]);
    await send(chatId, joao.id, 'ate mais');

    await request(app)
      .delete(`/api/chats/${chatId}/members/${luiz.id}`)
      .set('Authorization', `Bearer ${tokenFor(luiz.id)}`)
      .expect(200);

    const lista = await listChats(luiz.id);
    expect(lista).toHaveLength(1);
    expect(lista[0]?.hasLeft).toBe(true);
    expect(lista[0]?.lastMessage?.text).toBe('ate mais');

    await send(chatId, luiz.id, 'voltei').expect(403);
  });

  it('sai da lista de participantes de quem ficou', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createGroup(luiz.id, [joao.id]);

    await request(app)
      .delete(`/api/chats/${chatId}/members/${luiz.id}`)
      .set('Authorization', `Bearer ${tokenFor(luiz.id)}`);

    const doJoao = await listChats(joao.id);
    expect(doJoao[0]?.members.map((m) => m.id)).toEqual([joao.id]);
  });

  it('depois de sair, excluir tira a conversa de vez', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createGroup(luiz.id, [joao.id]);
    await send(chatId, joao.id, 'oi');

    const token = `Bearer ${tokenFor(luiz.id)}`;
    await request(app)
      .delete(`/api/chats/${chatId}/members/${luiz.id}`)
      .set('Authorization', token);
    await request(app)
      .delete(`/api/chats/${chatId}`)
      .set('Authorization', token)
      .expect(200);

    expect(await listChats(luiz.id)).toHaveLength(0);
  });

  it('readmite quem saiu, com o grupo limpo do corte anterior', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createGroup(joao.id, [luiz.id]);
    await send(chatId, joao.id, 'primeira');

    const token = `Bearer ${tokenFor(luiz.id)}`;
    await request(app)
      .delete(`/api/chats/${chatId}/members/${luiz.id}`)
      .set('Authorization', token);
    await request(app).delete(`/api/chats/${chatId}`).set('Authorization', token);
    expect(await listChats(luiz.id)).toHaveLength(0);

    await request(app)
      .post(`/api/chats/${chatId}/members`)
      .set('Authorization', `Bearer ${tokenFor(joao.id)}`)
      .send({ memberIds: [luiz.id] })
      .expect(200);

    const lista = await listChats(luiz.id);
    expect(lista).toHaveLength(1);
    expect(lista[0]?.hasLeft).toBe(false);
    await send(chatId, luiz.id, 'de volta').expect(200);
  });

  it('conversa direta nao tem como sair', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);

    await request(app)
      .delete(`/api/chats/${chatId}/members/${luiz.id}`)
      .set('Authorization', `Bearer ${tokenFor(luiz.id)}`)
      .expect(400);
  });
});

describe('recibo de leitura na lista', () => {
  beforeEach(resetDb);

  /**
   * Antes o recibo so existia enquanto o evento de socket estivesse na memoria
   * da aba: recarregar a pagina devolvia tudo para "enviada".
   */
  it('traz a ultima leitura dos outros participantes', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);
    await send(chatId, luiz.id, 'leu?').expect(200);

    // Antes de o Joao abrir, nao ha o que mostrar.
    expect((await listChats(luiz.id))[0]?.readBy).toEqual({});

    await request(app)
      .post(`/api/chats/${chatId}/readMessages`)
      .set('Authorization', `Bearer ${tokenFor(joao.id)}`)
      .expect(200);

    const lista = await listChats(luiz.id);
    expect(Object.keys(lista[0]?.readBy ?? {})).toEqual([String(joao.id)]);
  });

  it('nao inclui a propria leitura', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);
    await send(chatId, luiz.id, 'oi').expect(200);

    // Enviar ja grava o lastReadAt do remetente; ele nao pode virar recibo.
    expect((await listChats(luiz.id))[0]?.readBy).toEqual({});
  });
});

describe('anexo apagado sai do disco', () => {
  beforeEach(resetDb);

  it('remove o arquivo ao apagar a mensagem', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);
    const token = `Bearer ${tokenFor(luiz.id)}`;

    const enviada = await request(app)
      .post(`/api/chats/${chatId}/messages`)
      .set('Authorization', token)
      .field('text', 'segue o arquivo')
      .attach('attachment', Buffer.from('conteudo'), {
        filename: 'nota.txt',
        contentType: 'text/plain',
      })
      .expect(200);

    const enviado = body<{ id: string; attachment: { url: string } | null }>(enviada);
    const url = enviado.attachment?.url ?? '';
    // A URL vem assinada (?exp=&sig=); o arquivo no disco e so o nome.
    const arquivo = path.join(UPLOAD_DIR, path.basename(url.split('?')[0] ?? ''));

    expect(url).not.toBe('');
    expect(existsSync(arquivo)).toBe(true);

    await request(app)
      .delete(`/api/chats/${chatId}/messages/${enviado.id}`)
      .set('Authorization', token)
      .expect(200);

    expect(existsSync(arquivo)).toBe(false);
  });
});
