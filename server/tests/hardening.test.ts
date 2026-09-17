import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';

import { app } from '../src/app.js';
import { isSignatureValid, signedAttachmentUrl } from '../src/config/attachments.js';
import { prisma } from '../src/config/prisma.js';
import { body, createUser, resetDb } from './helpers.js';

/** Os parametros da URL assinada de um anexo. */
function assinatura(url: string): { exp: string; sig: string } {
  const params = new URLSearchParams(url.split('?')[1] ?? '');
  return { exp: params.get('exp') ?? '', sig: params.get('sig') ?? '' };
}

describe('URL assinada do anexo', () => {
  /**
   * O `exp` saia de `Date.now()`, entao cada resposta trazia uma URL diferente
   * para o mesmo arquivo: o cache de um dia do navegador nunca acertava, e
   * reabrir a galeria baixava tudo de novo.
   */
  it('e a mesma para o mesmo arquivo dentro da janela', () => {
    expect(signedAttachmentUrl('/uploads/foto.png')).toBe(
      signedAttachmentUrl('/uploads/foto.png'),
    );
  });

  it('continua sendo conferida', () => {
    const url = signedAttachmentUrl('/uploads/foto.png');
    const { exp, sig } = assinatura(url);

    expect(isSignatureValid('foto.png', exp, sig)).toBe(true);
  });

  /** A assinatura vale para um arquivo so: ela nao abre a pasta inteira. */
  it('nao serve para outro arquivo', () => {
    const { exp, sig } = assinatura(signedAttachmentUrl('/uploads/foto.png'));

    expect(isSignatureValid('outra.png', exp, sig)).toBe(false);
  });
});

describe('presenca no login', () => {
  beforeEach(resetDb);

  /**
   * Quem escreve o `isOnline` e so o connect/disconnect do socket. Marcando no
   * login, um cliente que nunca abrisse socket — um script, uma conexao que
   * falha — ficava "online" para sempre, porque o disconnect nunca chegava.
   */
  it('o login nao marca o usuario como online', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');

    await request(app)
      .post('/api/auth/login')
      .send({ email: luiz.email, password: luiz.password })
      .expect(200);

    const found = await prisma.user.findUnique({ where: { id: luiz.id } });
    expect(found?.isOnline).toBe(false);
  });
});

describe('foto de perfil no cadastro', () => {
  beforeEach(resetDb);

  /**
   * O campo aceitava qualquer URL: o avatar podia apontar para um servidor de
   * terceiros, que passa a ver o IP de quem abre a conversa e pode trocar a
   * imagem depois.
   */
  it('recusa uma foto de fora do app', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Ana',
        email: 'ana@email.com',
        password: 'segredo123',
        image: 'https://exemplo.test/a.svg',
      })
      .expect(400);
  });

  it('aceita o avatar que o proprio app gera', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Ana',
        email: 'ana2@email.com',
        password: 'segredo123',
        image: 'https://api.dicebear.com/9.x/avataaars/svg?seed=ana',
      })
      .expect(201);
  });
});

describe('GET /health', () => {
  it('responde ok e toca o banco', async () => {
    const resposta = await request(app).get('/health').expect(200);

    expect(body<{ status: string }>(resposta).status).toBe('ok');
  });
});
