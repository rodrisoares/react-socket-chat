import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { io as connect, type Socket } from 'socket.io-client';

import { app } from '../src/app.js';
import { io as socketServer, server } from '../src/config/instances.js';
import { prisma } from '../src/config/prisma.js';
import * as users from '../src/repositories/userRepository.js';
import {
  createDirectChat,
  createUser,
  resetDb,
  sessionTokenFor,
  tokenFor,
} from './helpers.js';

/**
 * Testes do tempo real — salas, presenca e "digitando".
 *
 * Sobem o servidor de verdade numa porta livre e conectam clientes de socket,
 * porque e justamente a fiacao que nao tinha cobertura: o bug de presenca com
 * duas abas passava por todos os testes de HTTP sem ser notado.
 */

let url = '';
/** Tudo que foi aberto no teste, para nenhuma conexao vazar entre eles. */
const open: Socket[] = [];

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    // Porta 0: o sistema escolhe uma livre, e a suite nao briga com o dev.
    server.listen(0, () => resolve());
  });

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  url = `http://localhost:${port}`;
});

afterAll(async () => {
  for (const socket of open.splice(0)) socket.disconnect();
  // `io.close` derruba as conexoes vivas e fecha o HTTP que ele adotou; um
  // `server.close` sozinho ficaria esperando para sempre por elas.
  await socketServer.close();
});

beforeEach(async () => {
  for (const socket of open.splice(0)) socket.disconnect();
  await prisma.session.deleteMany();
  await resetDb();
});

/** Conecta com um token qualquer e resolve quando o handshake passa — ou rejeita com o motivo. */
function connectWith(token: string): Promise<Socket> {
  const socket = connect(url, { auth: { token }, transports: ['websocket'] });
  open.push(socket);

  return new Promise((resolve, reject) => {
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', (error) => reject(error));
  });
}

/** Conecta como o usuario, por uma sessao de verdade: o handshake confere se ela vale. */
async function connectAs(userId: number): Promise<Socket> {
  const { token } = await sessionTokenFor(userId);
  return connectWith(token);
}

/** Espera um evento, com teto de tempo para o teste nao ficar pendurado. */
function waitFor<T>(socket: Socket, event: string, ms = 2000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`sem "${event}" em ${ms}ms`)), ms);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

/** Garante que um evento NAO chega: espera o tempo todo e nao ve nada. */
async function neverArrives(socket: Socket, event: string, ms = 400): Promise<boolean> {
  let seen = false;
  socket.once(event, () => {
    seen = true;
  });

  await new Promise((resolve) => setTimeout(resolve, ms));
  return !seen;
}

/** As salas sao montadas no connect, a partir do banco: da tempo a elas. */
function roomsReady(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 150));
}

/** Espera o banco refletir a presenca, que e escrita fora do fluxo do evento. */
async function isOnline(userId: number, expected: boolean, tries = 20): Promise<boolean> {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    const found = await users.findById(userId);
    if (found?.isOnline === expected) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

describe('handshake do socket', () => {
  it('recusa conexao sem token', async () => {
    await expect(connectWith('')).rejects.toThrow(/autentica/i);
  });

  it('recusa token invalido', async () => {
    await expect(connectWith('nao-e-um-jwt')).rejects.toThrow(/autentica/i);
  });

  it('aceita token valido e marca o usuario online', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    await connectAs(luiz.id);

    expect(await isOnline(luiz.id, true)).toBe(true);
  });
});

describe('sessao encerrada', () => {
  it('recusa o token de uma sessao ja encerrada', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const { token, sessionId } = await sessionTokenFor(luiz.id);

    await prisma.session.update({
      where: { id: sessionId },
      data: { revokedAt: new Date() },
    });

    await expect(connectWith(token)).rejects.toThrow(/autentica/i);
  });

  /** A assinatura vale, mas a sessao nao existe: o HTTP aceita, o socket nao. */
  it('recusa token cuja sessao nao existe', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    await expect(connectWith(tokenFor(luiz.id))).rejects.toThrow(/autentica/i);
  });

  /**
   * O motivo de a conexao guardar a sessao: sem derruba-la, o aparelho
   * encerrado continuava recebendo as mensagens pela conexao que ja existia.
   */
  it('encerrar a sessao derruba o socket dela, e so o dela', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const atual = await sessionTokenFor(luiz.id);
    const outra = await sessionTokenFor(luiz.id);

    const daAtual = await connectWith(atual.token);
    const daOutra = await connectWith(outra.token);
    await roomsReady();

    const queda = waitFor<string>(daOutra, 'disconnect');

    await request(app)
      .delete(`/api/me/sessions/${outra.sessionId}`)
      .set('Authorization', `Bearer ${atual.token}`)
      .expect(200);

    expect(await queda).toBe('io server disconnect');
    expect(daAtual.connected).toBe(true);
  });

  it('trocar a senha derruba os sockets dos outros dispositivos', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const atual = await sessionTokenFor(luiz.id);
    const outra = await sessionTokenFor(luiz.id);

    const daAtual = await connectWith(atual.token);
    const daOutra = await connectWith(outra.token);
    await roomsReady();

    const queda = waitFor<string>(daOutra, 'disconnect');

    await request(app)
      .patch('/api/me')
      .set('Authorization', `Bearer ${atual.token}`)
      .send({ currentPassword: luiz.password, newPassword: 'outrasenha1' })
      .expect(200);

    expect(await queda).toBe('io server disconnect');
    expect(daAtual.connected).toBe(true);
  });
});

describe('presenca com mais de uma aba', () => {
  /**
   * O bug que este arquivo existe para travar: fechar uma aba marcava a pessoa
   * offline para todos os contatos, com a outra aba aberta na frente dela.
   */
  it('fechar uma aba nao derruba a presenca da outra', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');

    const abaA = await connectAs(luiz.id);
    await connectAs(luiz.id);
    expect(await isOnline(luiz.id, true)).toBe(true);

    abaA.disconnect();

    // Continua online: a outra aba segura a presenca.
    expect(await isOnline(luiz.id, false, 6)).toBe(false);
    expect((await users.findById(luiz.id))?.isOnline).toBe(true);
  });

  it('a ultima aba a sair marca offline', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');

    const abaA = await connectAs(luiz.id);
    const abaB = await connectAs(luiz.id);

    abaA.disconnect();
    abaB.disconnect();

    expect(await isOnline(luiz.id, false)).toBe(true);
  });

  it('grava o "visto por ultimo" so na saida de verdade', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');

    const abaA = await connectAs(luiz.id);
    const abaB = await connectAs(luiz.id);

    abaA.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 200));
    // Ainda conectado pela outra aba: nenhum horario de saida foi inventado.
    expect((await users.findById(luiz.id))?.isOnline).toBe(true);

    abaB.disconnect();
    expect(await isOnline(luiz.id, false)).toBe(true);
    expect((await users.findById(luiz.id))?.lastSeenAt).not.toBeNull();
  });
});

describe('salas da conversa', () => {
  it('o "digitando" chega a quem divide a conversa', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);

    const dele = await connectAs(luiz.id);
    const outro = await connectAs(joao.id);

    await roomsReady();
    dele.emit('typing', { chatId });

    const evento = await waitFor<{ chatId: string; userId: number }>(outro, 'typing');
    expect(evento).toEqual({ chatId, userId: luiz.id });
  });

  it('o "digitando" nao volta para quem digitou', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);

    const dele = await connectAs(luiz.id);
    await connectAs(joao.id);
    await roomsReady();

    dele.emit('typing', { chatId });
    expect(await neverArrives(dele, 'typing')).toBe(true);
  });

  /**
   * A sala e decidida pelo servidor, a partir do banco: o client nao escolhe
   * mais o que ouvir. Sem isto, bastava emitir para uma conversa alheia.
   */
  it('quem nao participa da conversa nao alcanca a sala', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const ana = await createUser('Ana', 'ana@email.com');
    const alheia = await createDirectChat(luiz.id, joao.id);

    const intrusa = await connectAs(ana.id);
    const dentro = await connectAs(luiz.id);
    await roomsReady();

    intrusa.emit('typing', { chatId: alheia });
    expect(await neverArrives(dentro, 'typing')).toBe(true);
  });

  it('o "parou de digitar" tambem chega', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);

    const dele = await connectAs(luiz.id);
    const outro = await connectAs(joao.id);
    await roomsReady();

    dele.emit('stop-typing', { chatId });
    const evento = await waitFor<{ userId: number }>(outro, 'stop-typing');
    expect(evento.userId).toBe(luiz.id);
  });

  /**
   * Fechar a aba no meio da frase nunca manda o "parou": sem o servidor
   * avisar no lugar dela, o "digitando…" ficava preso na tela do outro.
   */
  it('fechar a aba no meio da digitacao avisa que parou', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);

    const dele = await connectAs(luiz.id);
    const outro = await connectAs(joao.id);
    await roomsReady();

    const digitando = waitFor(outro, 'typing');
    dele.emit('typing', { chatId });
    await digitando;

    const parou = waitFor<{ chatId: string; userId: number }>(outro, 'stop-typing');
    dele.disconnect();

    expect(await parou).toEqual({ chatId, userId: luiz.id });
  });

  it('avisa os contatos quando alguem entra', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    await createDirectChat(luiz.id, joao.id);

    const outro = await connectAs(joao.id);
    await roomsReady();

    const chegada = waitFor<number>(outro, 'new-login');
    await connectAs(luiz.id);

    expect(await chegada).toBe(luiz.id);
  });

  /** O client compara este instante com o da mensagem; o relogio dele nao entra. */
  it('o recibo de leitura leva o instante gravado', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);

    const outro = await connectAs(joao.id);
    await roomsReady();

    const recibo = waitFor<{ id: number; chatId: string; readAt: string }>(
      outro,
      'read-message',
    );

    await request(app)
      .post(`/api/chats/${chatId}/readMessages`)
      .set('Authorization', `Bearer ${tokenFor(luiz.id)}`)
      .expect(200);

    const evento = await recibo;
    const gravado = await prisma.chatParticipant.findFirst({
      where: { chatId, userId: luiz.id },
    });

    expect(evento).toMatchObject({ id: luiz.id, chatId });
    expect(evento.readAt).toBe(gravado?.lastReadAt?.toISOString());
  });

  it('o perfil atualizado chega aos contatos sem o e-mail', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    await createDirectChat(luiz.id, joao.id);

    const outro = await connectAs(joao.id);
    await roomsReady();

    const aviso = waitFor<Record<string, unknown>>(outro, 'user-updated');

    await request(app)
      .patch('/api/me')
      .set('Authorization', `Bearer ${tokenFor(luiz.id)}`)
      .send({ name: 'Luiz Novo' })
      .expect(200);

    const evento = await aviso;
    expect(evento['name']).toBe('Luiz Novo');
    expect(evento).not.toHaveProperty('email');
  });
});
