import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';

import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';
import { keepsPresence } from '../src/socket/presence.js';
import * as sessions from '../src/repositories/sessionRepository.js';
import { APP_REQUEST_HEADER, APP_REQUEST_VALUE } from '@react-chat/shared';
import { body, createUser, resetDb, sessionTokenFor, tokenFor } from './helpers.js';

interface SessionBody {
  token: string;
  sessionId: string;
}

interface DeviceBody {
  id: string;
  userAgent: string | null;
}

/**
 * O refresh token vive num cookie httpOnly: o teste o carrega de uma
 * requisição para a outra, como o navegador faria.
 */
function refreshCookie(response: request.Response): string {
  const header = response.headers['set-cookie'] ?? [];
  const cookies = Array.isArray(header) ? header : [header];
  const refresh = cookies.find((cookie) => cookie.startsWith('react-chat.refresh='));

  return refresh?.split(';')[0] ?? '';
}

/** Login de verdade: e dele que saem o access token e o cookie. */
async function login(email: string, password = 'segredo123', agent = 'Firefox/1.0') {
  const response = await request(app)
    .post('/api/auth/login')
    .set('User-Agent', agent)
    .send({ email, password })
    .expect(200);

  return { ...body<SessionBody>(response), cookie: refreshCookie(response) };
}

/**
 * Renovar e sair exigem a marca de "veio do app" — e o que impede um site
 * terceiro de disparar as duas rotas que agem a partir do cookie. O cliente a
 * manda em toda requisicao; aqui ela vai a mao, como o navegador faria.
 */
function fromApp(test: request.Test) {
  return test.set(APP_REQUEST_HEADER, APP_REQUEST_VALUE);
}

function renew(cookie: string) {
  return fromApp(request(app).post('/api/auth/refresh')).set('Cookie', cookie);
}

/** Limpa as sessoes junto: o resetDb do helper nao conhece a tabela nova. */
async function reset() {
  await prisma.session.deleteMany();
  await resetDb();
}

describe('sessao de longa duracao', () => {
  beforeEach(reset);

  it('o login devolve o access token e guarda o refresh num cookie httpOnly', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: luiz.email, password: luiz.password })
      .expect(200);

    const entrada = body<SessionBody>(response);
    expect(entrada.token).toBeTruthy();
    expect(entrada.sessionId).toBeTruthy();

    // O refresh nao passa pelo corpo: qualquer XSS leria o que esta ali.
    expect(JSON.stringify(response.body)).not.toContain('refreshToken');

    const cookie = (response.headers['set-cookie'] as string[]).find((item) =>
      item.startsWith('react-chat.refresh='),
    );
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\/api\/auth/i);

    // O token cru nunca e gravado: a tabela guarda so o hash.
    const row = await prisma.session.findUnique({ where: { id: entrada.sessionId } });
    expect(row?.tokenHash).toBeTruthy();
    expect(cookie).not.toContain(row?.tokenHash ?? 'nao-existe');
  });

  it('renova o acesso sem pedir a senha de novo', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const entrada = await login(luiz.email);

    const response = await renew(entrada.cookie).expect(200);
    const renovada = body<SessionBody>(response);

    expect(renovada.token).toBeTruthy();
    // Mesma sessao, token novo: o dispositivo continua sendo o mesmo na lista.
    expect(renovada.sessionId).toBe(entrada.sessionId);
    expect(refreshCookie(response)).not.toBe(entrada.cookie);

    // E o token novo abre as rotas autenticadas.
    await request(app)
      .get('/api/me')
      .set('Authorization', `Bearer ${renovada.token}`)
      .expect(200);
  });

  /**
   * A rotacao e o que limita o estrago de um refresh vazado: ele vale ate a
   * proxima renovacao, e nao pelos 30 dias inteiros.
   */
  it('o refresh anterior morre assim que e usado', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const entrada = await login(luiz.email);

    await renew(entrada.cookie).expect(200);
    await renew(entrada.cookie).expect(401);
  });

  it('sem cookie nenhum nao ha o que renovar', async () => {
    await fromApp(request(app).post('/api/auth/refresh')).expect(401);
  });

  it('sair encerra a sessao no servidor e apaga o cookie', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const entrada = await login(luiz.email);

    const saida = await fromApp(request(app).post('/api/auth/logout'))
      .set('Cookie', entrada.cookie)
      .expect(200);

    // O navegador recebe a ordem de esquecer o cookie.
    expect(refreshCookie(saida)).toBe('react-chat.refresh=');

    await renew(entrada.cookie).expect(401);
  });

  it('recusa refresh expirado', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const entrada = await login(luiz.email);

    await prisma.session.update({
      where: { id: entrada.sessionId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await renew(entrada.cookie).expect(401);
  });

  it('a limpeza da subida remove sessao morta e poupa a viva', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const viva = await login(luiz.email);
    const morta = await login(luiz.email);

    await prisma.session.update({
      where: { id: morta.sessionId },
      data: { revokedAt: new Date() },
    });

    await sessions.purgeDead();

    expect(await prisma.session.findUnique({ where: { id: morta.sessionId } })).toBeNull();
    expect(await prisma.session.findUnique({ where: { id: viva.sessionId } })).not.toBeNull();
  });
});

describe('dispositivos conectados', () => {
  beforeEach(reset);

  it('lista as sessoes abertas, com o dispositivo de cada uma', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const desktop = await login(luiz.email, 'segredo123', 'Chrome/1.0 Windows');
    await login(luiz.email, 'segredo123', 'Safari/1.0 iPhone');

    const response = await request(app)
      .get('/api/me/sessions')
      .set('Authorization', `Bearer ${desktop.token}`)
      .expect(200);

    const lista = body<DeviceBody[]>(response);
    expect(lista).toHaveLength(2);
    expect(lista.map((item) => item.userAgent)).toContain('Chrome/1.0 Windows');
  });

  it('encerrar uma sessao invalida o refresh dela', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const atual = await login(luiz.email);
    const outra = await login(luiz.email);

    await request(app)
      .delete(`/api/me/sessions/${outra.sessionId}`)
      .set('Authorization', `Bearer ${atual.token}`)
      .expect(200);

    await renew(outra.cookie).expect(401);
  });

  /** So as proprias: o filtro por userId e o que garante isso. */
  it('nao encerra sessao de outra pessoa', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const dele = await login(joao.email);
    const minha = await login(luiz.email);

    await request(app)
      .delete(`/api/me/sessions/${dele.sessionId}`)
      .set('Authorization', `Bearer ${minha.token}`)
      .expect(404);

    // Continua valendo para o dono.
    await renew(dele.cookie).expect(200);
  });

  it('"sair dos outros dispositivos" poupa o atual', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const atual = await login(luiz.email);
    const outra = await login(luiz.email);

    await request(app)
      .delete(`/api/me/sessions?keep=${atual.sessionId}`)
      .set('Authorization', `Bearer ${atual.token}`)
      .expect(200);

    await renew(atual.cookie).expect(200);
    await renew(outra.cookie).expect(401);
  });

  /** Trocar a senha e o caminho de quem desconfia de acesso alheio. */
  it('trocar a senha derruba os outros dispositivos', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const atual = await login(luiz.email);
    const outra = await login(luiz.email);

    await request(app)
      .patch('/api/me')
      .set('Authorization', `Bearer ${atual.token}`)
      .send({ currentPassword: 'segredo123', newPassword: 'outrasenha1' })
      .expect(200);

    await renew(outra.cookie).expect(401);
    await renew(atual.cookie).expect(200);
  });
});

/**
 * A presenca e do usuario, e nao do socket: fechar uma aba nao pode marcar
 * offline quem continua com outra aberta.
 */
describe('presenca com mais de uma conexao', () => {
  it('outra aba viva segura a presenca', () => {
    expect(keepsPresence(['aba-a', 'aba-b'], 'aba-a')).toBe(true);
  });

  it('a ultima conexao libera a saida', () => {
    // No logoff o socket ainda esta na sala e precisa se descontar.
    expect(keepsPresence(['aba-a'], 'aba-a')).toBe(false);
    // No disconnect ele ja saiu: a sala chega vazia.
    expect(keepsPresence([], 'aba-a')).toBe(false);
  });
});

/**
 * O buraco que o access token sem estado deixava: encerrar uma sessao derrubava
 * o socket na hora, e o aparelho continuava lendo e escrevendo pelo HTTP ate o
 * token dela vencer — quinze minutos depois de a pessoa clicar em "encerrar".
 */
describe('sessao encerrada alcanca o HTTP', () => {
  beforeEach(reset);

  it('o token de uma sessao encerrada deixa de valer na hora', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const aparelho = await sessionTokenFor(luiz.id);
    const dele = `Bearer ${aparelho.token}`;

    // Antes de encerrar, o token funciona.
    await request(app).get('/api/me').set('Authorization', dele).expect(200);

    await request(app)
      .delete(`/api/me/sessions/${aparelho.sessionId}`)
      .set('Authorization', `Bearer ${tokenFor(luiz.id)}`)
      .expect(200);

    // O token continua assinado e dentro da validade — e nao vale mais nada.
    const recusa = await request(app).get('/api/me').set('Authorization', dele).expect(401);
    expect(body<{ error: string }>(recusa).error).toContain('encerrada');
  });

  it('sair da conta encerra o acesso HTTP daquela aba', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const entrada = await login(luiz.email);
    const dele = `Bearer ${entrada.token}`;

    await request(app).get('/api/me').set('Authorization', dele).expect(200);

    await fromApp(request(app).post('/api/auth/logout'))
      .set('Cookie', entrada.cookie)
      .expect(200);

    await request(app).get('/api/me').set('Authorization', dele).expect(401);
  });

  /** A troca de senha derruba os outros dispositivos — inclusive o HTTP deles. */
  it('trocar a senha encerra o acesso dos outros aparelhos', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const antigo = await sessionTokenFor(luiz.id);
    const atual = await sessionTokenFor(luiz.id);

    await request(app)
      .patch('/api/me')
      .set('Authorization', `Bearer ${atual.token}`)
      .send({ currentPassword: luiz.password, newPassword: 'outraSenha9' })
      .expect(200);

    await request(app)
      .get('/api/me')
      .set('Authorization', `Bearer ${antigo.token}`)
      .expect(401);

    // A que pediu a troca continua de pe: encerra-la devolveria quem trocou a
    // senha para a tela de login.
    await request(app)
      .get('/api/me')
      .set('Authorization', `Bearer ${atual.token}`)
      .expect(200);
  });
});

/**
 * Renovar e sair sao as duas rotas que agem a partir do cookie, e as unicas sem
 * header de autenticacao. Com `sameSite=none` — obrigatorio quando a tela e a
 * API vivem em dominios diferentes — um site terceiro conseguiria dispara-las:
 * nao leria a resposta, mas a rotacao do refresh ja derrubaria a sessao da
 * vitima.
 */
describe('as rotas do cookie exigem a marca do app', () => {
  beforeEach(reset);

  it('recusa a renovacao sem o cabecalho', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const entrada = await login(luiz.email);

    await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', entrada.cookie)
      .expect(403);

    // E com ele, a mesma requisicao passa: o que muda e so a marca.
    await renew(entrada.cookie).expect(200);
  });

  it('recusa a saida sem o cabecalho', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const entrada = await login(luiz.email);

    await request(app)
      .post('/api/auth/logout')
      .set('Cookie', entrada.cookie)
      .expect(403);

    // A sessao continua viva: a recusa nao pode ter efeito nenhum.
    await renew(entrada.cookie).expect(200);
  });
});
