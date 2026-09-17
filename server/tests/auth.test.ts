import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';

import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';
import { body, createUser, resetDb, tokenFor as accessTokenFor } from './helpers.js';
import type { ErrorBody, LoginBody, MeBody } from './helpers.js';

describe('POST /api/auth/register', () => {
  beforeEach(resetDb);

  it('cria o usuario e devolve 201 sem a senha', async () => {
    const response = await request(app).post('/api/auth/register').send({
      name: 'Ana',
      email: 'ana@email.com',
      password: 'segredo123',
    });

    expect(response.status).toBe(201);

    // O cadastro ja entra: a resposta e a mesma do login — access token, sessao
    // e usuario. Antes devolvia so o usuario, e a tela mandava para o /login
    // pedir a senha que a pessoa tinha acabado de digitar duas vezes.
    const criado = body<LoginBody>(response);

    expect(criado.token).toBeTruthy();
    expect(criado.user).toMatchObject({ name: 'Ana', email: 'ana@email.com' });
    expect(criado.user).not.toHaveProperty('password');
    expect(criado.user).not.toHaveProperty('passwordHash');
  });

  it('grava a senha como hash bcrypt, nunca em texto puro', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ name: 'Ana', email: 'ana@email.com', password: 'segredo123' });

    const user = await prisma.user.findUnique({ where: { email: 'ana@email.com' } });

    expect(user?.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(user?.passwordHash).not.toBe('segredo123');
  });

  it('recusa senha curta com 400 e diz qual campo falhou', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Ana', email: 'ana@email.com', password: '123' });

    expect(response.status).toBe(400);
    expect(body<ErrorBody>(response).issues?.[0]?.campo).toBe('password');
  });

  it('recusa email invalido com 400', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Ana', email: 'nao-e-email', password: 'segredo123' });

    expect(response.status).toBe(400);
  });

  it('recusa email duplicado com 409', async () => {
    await createUser('Ana', 'ana@email.com');

    const response = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Outra', email: 'ana@email.com', password: 'segredo123' });

    expect(response.status).toBe(409);
  });

  it('normaliza o email para minusculas', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ name: 'Ana', email: 'ANA@Email.com', password: 'segredo123' });

    const user = await prisma.user.findUnique({ where: { email: 'ana@email.com' } });
    expect(user).not.toBeNull();
  });
});

describe('POST /api/auth/login', () => {
  beforeEach(resetDb);

  it('devolve token e usuario sem senha', async () => {
    const user = await createUser('Luiz', 'luiz@email.com');

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: user.password });

    expect(response.status).toBe(200);
    expect(typeof body<LoginBody>(response).token).toBe('string');
    expect(body<LoginBody>(response).user).toMatchObject({ name: 'Luiz' });
    expect(JSON.stringify(response.body)).not.toMatch(/password/i);
    expect(JSON.stringify(response.body)).not.toMatch(/\$2[aby]\$/);
  });

  it('recusa senha errada com 401', async () => {
    const user = await createUser('Luiz', 'luiz@email.com');

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: 'errada' });

    expect(response.status).toBe(401);
  });

  it('nao revela se o email existe: mesma mensagem nos dois casos', async () => {
    const user = await createUser('Luiz', 'luiz@email.com');

    const senhaErrada = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: 'errada' });

    const emailInexistente = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ninguem@email.com', password: 'errada' });

    expect(senhaErrada.status).toBe(emailInexistente.status);
    expect(body<ErrorBody>(senhaErrada).error).toBe(body<ErrorBody>(emailInexistente).error);
  });

  /**
   * Conversa nasce sob demanda. O login criava uma com cada usuario do banco:
   * N consultas por entrada e uma lista cheia de conversas vazias.
   */
  it('nao cria conversa com quem nunca conversou', async () => {
    const user = await createUser('Luiz', 'luiz@email.com');
    await createUser('Joao', 'joao@email.com');

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: user.password })
      .expect(200);

    expect(body<LoginBody>(response).user.chats).toEqual([]);
    expect(await prisma.chat.count()).toBe(0);
  });
});

describe('e-mail de outras pessoas', () => {
  beforeEach(resetDb);

  /** A lista de contatos traz todos os usuarios do banco: o e-mail ia junto. */
  it('a lista de contatos nao traz o e-mail de ninguem', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    await createUser('Joao', 'joao@email.com');

    const response = await request(app)
      .get('/api/me/contacts')
      .set('Authorization', `Bearer ${accessTokenFor(luiz.id)}`)
      .expect(200);

    const contatos = body<Record<string, unknown>[]>(response);
    expect(contatos).toHaveLength(1);
    expect(contatos[0]).not.toHaveProperty('email');
    expect(JSON.stringify(contatos)).not.toContain('joao@email.com');
  });

  it('o proprio perfil continua com o e-mail', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');

    const response = await request(app)
      .get('/api/me')
      .set('Authorization', `Bearer ${accessTokenFor(luiz.id)}`)
      .expect(200);

    expect(body<{ email: string }>(response).email).toBe('luiz@email.com');
  });
});

describe('GET /api/auth/me — restauracao de sessao', () => {
  beforeEach(resetDb);

  async function tokenFor(email: string, password: string) {
    const response = await request(app).post('/api/auth/login').send({ email, password });
    return body<LoginBody>(response).token;
  }

  it('recusa 401 sem header Authorization', async () => {
    const response = await request(app).get('/api/auth/me');
    expect(response.status).toBe(401);
  });

  it('recusa 401 com token adulterado', async () => {
    const response = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer abc.def.ghi');

    expect(response.status).toBe(401);
  });

  it('recusa 401 quando o esquema nao e Bearer', async () => {
    const user = await createUser('Luiz', 'luiz@email.com');
    const token = await tokenFor(user.email, user.password);

    const response = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Basic ${token}`);

    expect(response.status).toBe(401);
  });

  it('devolve o usuario e as conversas com token valido', async () => {
    const user = await createUser('Luiz', 'luiz@email.com');
    const token = await tokenFor(user.email, user.password);

    const response = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ name: 'Luiz', isLogged: true });
    expect(Array.isArray(body<MeBody>(response).chats)).toBe(true);
  });
});

describe('rotas protegidas', () => {
  beforeEach(resetDb);

  it('recusa 401 em /api/chats sem token', async () => {
    const response = await request(app).post('/api/chats').send({ otherUserId: 2 });
    expect(response.status).toBe(401);
  });

  it('recusa 401 em /api/me/chats sem token', async () => {
    const response = await request(app).get('/api/me/chats');
    expect(response.status).toBe(401);
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});
