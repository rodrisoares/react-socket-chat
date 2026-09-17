import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { existsSync } from 'node:fs';
import { utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';
import { UPLOAD_DIR } from '../src/config/upload.js';
import { sweepOrphanUploads } from '../src/services/maintenanceService.js';
import {
  body,
  chatList,
  createDirectChat,
  createUser,
  resetDb,
  sessionTokenFor,
  tokenFor,
} from './helpers.js';

interface ChatItem {
  id: string;
  name: string;
  lastMessage: { text: string } | null;
}

/** Limpa as sessoes junto: o resetDb do helper nao conhece a tabela. */
async function reset() {
  await prisma.session.deleteMany();
  await resetDb();
}

/**
 * Exclusao de conta.
 *
 * A escolha e anonimizar, e nao apagar a linha: o `senderId` de toda mensagem
 * aponta para o usuario com `onDelete: Cascade`, e apagar levaria junto tudo o
 * que a pessoa escreveu — cada grupo ficaria com metade do dialogo, na conversa
 * de outras pessoas, que nao pediram nada disso.
 */
describe('DELETE /api/me', () => {
  beforeEach(reset);

  /** Prepara uma conversa com mensagem dos dois lados. */
  async function conversaEntreDois() {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);

    await request(app)
      .post(`/api/chats/${chatId}/messages`)
      .set('Authorization', `Bearer ${tokenFor(luiz.id)}`)
      .field('text', 'combinado entao')
      .expect(200);

    return { luiz, joao, chatId };
  }

  it('recusa sem a senha certa', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');

    const recusa = await request(app)
      .delete('/api/me')
      .set('Authorization', `Bearer ${tokenFor(luiz.id)}`)
      .send({ password: 'chute' })
      .expect(400);

    expect(body<{ error: string }>(recusa).error).toContain('Senha');

    // Nada mudou: a conta continua entrando.
    await request(app)
      .post('/api/auth/login')
      .send({ email: luiz.email, password: luiz.password })
      .expect(200);
  });

  it('raspa o dado pessoal e mantem a mensagem na conversa do outro', async () => {
    const { luiz, joao, chatId } = await conversaEntreDois();

    await request(app)
      .delete('/api/me')
      .set('Authorization', `Bearer ${tokenFor(luiz.id)}`)
      .send({ password: luiz.password })
      .expect(200);

    // O que era pessoal saiu.
    const raspado = await prisma.user.findUnique({ where: { id: luiz.id } });
    expect(raspado?.name).toBe('Usuário excluído');
    expect(raspado?.email).not.toBe('luiz@email.com');
    expect(raspado?.deletedAt).not.toBeNull();

    // O que a pessoa escreveu continua la, para quem ficou.
    const lista = chatList<ChatItem>(
      await request(app)
        .get('/api/me/chats')
        .set('Authorization', `Bearer ${tokenFor(joao.id)}`)
        .expect(200),
    );

    const conversa = lista.find((chat) => chat.id === chatId);
    expect(conversa?.lastMessage?.text).toBe('combinado entao');
    // E atribuida a ninguem em particular.
    expect(conversa?.name).toBe('Usuário excluído');
  });

  it('a conta excluida nao entra mais', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');

    await request(app)
      .delete('/api/me')
      .set('Authorization', `Bearer ${tokenFor(luiz.id)}`)
      .send({ password: luiz.password })
      .expect(200);

    await request(app)
      .post('/api/auth/login')
      .send({ email: luiz.email, password: luiz.password })
      .expect(401);
  });

  /** Todas as sessoes caem, inclusive a que pediu: nao ha conta para voltar. */
  it('derruba o acesso de todos os aparelhos', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const celular = await sessionTokenFor(luiz.id);
    const desktop = await sessionTokenFor(luiz.id);

    await request(app)
      .delete('/api/me')
      .set('Authorization', `Bearer ${desktop.token}`)
      .send({ password: luiz.password })
      .expect(200);

    await request(app)
      .get('/api/me')
      .set('Authorization', `Bearer ${celular.token}`)
      .expect(401);
    await request(app)
      .get('/api/me')
      .set('Authorization', `Bearer ${desktop.token}`)
      .expect(401);
  });

  /**
   * Sai das conversas sem anunciar nada. Continuando participante ativa, a
   * conta anonimizada seria contada em "N participantes" e ficaria eternamente
   * pendente no recibo de leitura — o ✓✓ daquele grupo nunca mais fecharia.
   */
  it('sai das conversas, e em silencio', async () => {
    const { luiz, chatId } = await conversaEntreDois();

    await request(app)
      .delete('/api/me')
      .set('Authorization', `Bearer ${tokenFor(luiz.id)}`)
      .send({ password: luiz.password })
      .expect(200);

    const participacao = await prisma.chatParticipant.findFirst({
      where: { chatId, userId: luiz.id },
    });
    expect(participacao?.leftAt).not.toBeNull();

    // Nenhum aviso de grupo foi escrito: o nome e o que a exclusao veio apagar.
    const avisos = await prisma.message.count({ where: { chatId, type: 'SYSTEM' } });
    expect(avisos).toBe(0);
  });

  it('some da busca de contatos', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');

    await request(app)
      .delete('/api/me')
      .set('Authorization', `Bearer ${tokenFor(luiz.id)}`)
      .send({ password: luiz.password })
      .expect(200);

    const contatos = body<{ id: number }[]>(
      await request(app)
        .get('/api/me/contacts')
        .set('Authorization', `Bearer ${tokenFor(joao.id)}`)
        .expect(200),
    );

    expect(contatos.map((contato) => contato.id)).not.toContain(luiz.id);
  });
});

describe('GET /api/me/export', () => {
  beforeEach(reset);

  it('leva o que voce escreveu, e nao o que escreveram para voce', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);

    await request(app)
      .post(`/api/chats/${chatId}/messages`)
      .set('Authorization', `Bearer ${tokenFor(luiz.id)}`)
      .field('text', 'minha mensagem')
      .expect(200);

    await request(app)
      .post(`/api/chats/${chatId}/messages`)
      .set('Authorization', `Bearer ${tokenFor(joao.id)}`)
      .field('text', 'segredo do joao')
      .expect(200);

    const resposta = await request(app)
      .get('/api/me/export')
      .set('Authorization', `Bearer ${tokenFor(luiz.id)}`)
      .expect(200);

    // Vai como arquivo: e o que a pessoa leva embora.
    expect(resposta.headers['content-disposition']).toContain('attachment');

    const dados = JSON.parse(resposta.text) as {
      perfil: { email: string };
      conversas: { id: string }[];
      mensagens: { texto: string }[];
    };

    expect(dados.perfil.email).toBe('luiz@email.com');
    expect(dados.conversas.map((conversa) => conversa.id)).toContain(chatId);

    const textos = dados.mensagens.map((mensagem) => mensagem.texto);
    expect(textos).toContain('minha mensagem');
    expect(textos).not.toContain('segredo do joao');
  });
});

/**
 * A varredura de anexos sem dono.
 *
 * Havia tres caminhos que deixavam arquivo para tras e so um tinha conserto:
 * apagar a mensagem para todos chama o `removeUpload`. O cascade do Prisma, que
 * leva as linhas de Message quando uma conversa some, nao; nem o processo que
 * morre entre o multer gravar e a rota responder.
 */
describe('varredura de anexos orfaos', () => {
  beforeEach(reset);

  /** Escreve um arquivo em uploads/ com a idade pedida. */
  async function arquivo(nome: string, idadeMs: number): Promise<string> {
    const alvo = path.join(UPLOAD_DIR, nome);
    await writeFile(alvo, 'conteudo');

    const quando = new Date(Date.now() - idadeMs);
    await utimes(alvo, quando, quando);

    return alvo;
  }

  const DOIS_DIAS = 2 * 24 * 60 * 60 * 1000;

  it('apaga o que nenhuma linha referencia', async () => {
    const orfao = await arquivo(`orfao-${Date.now().toString()}.txt`, DOIS_DIAS);

    await sweepOrphanUploads();

    expect(existsSync(orfao)).toBe(false);
  });

  /**
   * O multer grava antes de a rota gravar a mensagem: um arquivo que ainda nao
   * virou mensagem e indistinguivel de um abandonado, e so o tempo os separa.
   */
  it('poupa o arquivo recem-chegado', async () => {
    const novo = await arquivo(`novo-${Date.now().toString()}.txt`, 0);

    await sweepOrphanUploads();

    expect(existsSync(novo)).toBe(true);
  });

  it('poupa o anexo que ainda e de uma mensagem', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);

    const nome = `usado-${Date.now().toString()}.txt`;
    const usado = await arquivo(nome, DOIS_DIAS);

    await prisma.message.create({
      data: {
        chatId,
        senderId: luiz.id,
        text: 'segue',
        attachmentUrl: `/uploads/${nome}`,
        attachmentName: 'nota.txt',
        attachmentType: 'text/plain',
      },
    });

    await sweepOrphanUploads();

    expect(existsSync(usado)).toBe(true);
  });

  it('poupa a foto de perfil de alguem', async () => {
    const nome = `avatar-${Date.now().toString()}.webp`;
    const foto = await arquivo(nome, DOIS_DIAS);

    const luiz = await createUser('Luiz', 'luiz@email.com');
    await prisma.user.update({
      where: { id: luiz.id },
      data: { image: `/uploads/${nome}` },
    });

    await sweepOrphanUploads();

    expect(existsSync(foto)).toBe(true);
  });
});
