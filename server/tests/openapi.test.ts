import { describe, expect, it } from 'vitest';
import request from 'supertest';

import { app } from '../src/app.js';
import authRouter from '../src/routes/auth.js';
import chatsRouter from '../src/routes/chats.js';
import meRouter from '../src/routes/me.js';
import { documentedOperations, openApiDocument } from '../src/docs/openapi.js';
import { body } from './helpers.js';

/**
 * A trava contra o documento que envelhece.
 *
 * Um OpenAPI escrito a mao mente no dia em que alguem acrescenta uma rota e nao
 * lembra de documenta-la — e ninguem descobre, porque nada quebra. Aqui o
 * roteador do Express e a fonte da verdade: a lista que ele registrou de fato e
 * comparada com a lista que o documento descreve, e qualquer diferenca, nos
 * dois sentidos, derruba o teste.
 *
 * O prefixo de cada roteador esta escrito aqui porque o Express 5 nao o expoe:
 * o caminho de montagem vira uma funcao compilada dentro do layer. Sao tres
 * linhas ao lado das tres do `app.ts`, e o proprio teste avisa se elas
 * divergirem — uma rota sob prefixo errado nao casaria com o documento.
 */
interface RouteLayer {
  route?: { path: string; methods: Record<string, boolean> };
}

/** "GET /api/chats/{id}" a partir do que o roteador registrou. */
function operationsOf(router: unknown, prefix = ''): string[] {
  const stack = (router as { stack?: RouteLayer[] }).stack ?? [];

  return stack.flatMap((layer) => {
    if (!layer.route) return [];

    // `/` de um roteador montado e o proprio prefixo; `:id` vira `{id}`.
    const path = `${prefix}${layer.route.path}`.replace(/\/$/, '') || '/';
    const openApiPath = path.replace(/:(\w+)/g, '{$1}');

    return Object.entries(layer.route.methods)
      .filter(([, enabled]) => enabled)
      .map(([method]) => `${method.toUpperCase()} ${openApiPath}`);
  });
}

function registeredOperations(): string[] {
  const appRouter = (app as unknown as { router: unknown }).router;

  return [
    ...operationsOf(appRouter),
    ...operationsOf(authRouter, '/api/auth'),
    ...operationsOf(meRouter, '/api/me'),
    ...operationsOf(chatsRouter, '/api/chats'),
  ];
}

describe('documento OpenAPI', () => {
  it('descreve exatamente as rotas que o servidor registrou', () => {
    const registradas = [...registeredOperations()].sort();
    const documentadas = [...documentedOperations()].sort();

    // `toEqual` nas duas listas, e nao duas verificacoes de inclusao: assim a
    // falha mostra de um lado o que ficou sem documento e do outro o que o
    // documento promete e a API nao tem.
    expect(documentadas).toEqual(registradas);
  });

  it('serve o documento', async () => {
    const resposta = await request(app).get('/api/openapi.json').expect(200);
    const documento = body<{ openapi: string; paths: Record<string, unknown> }>(resposta);

    expect(documento.openapi).toBe('3.1.0');
    expect(Object.keys(documento.paths).length).toBeGreaterThan(30);
  });

  /**
   * O corpo sai do mesmo schema Zod que valida a requisicao — e o que impede a
   * descricao de divergir da regra. Este teste vigia a ponte: se o
   * `jsonSchemaOf` parar de converter, as rotas ficam sem corpo e ninguem nota.
   */
  it('traz o corpo das rotas que recebem JSON', () => {
    const login = openApiDocument.paths['/api/auth/login'] as {
      post: { requestBody?: { content: Record<string, { schema: Record<string, unknown> }> } };
    };

    const schema = login.post.requestBody?.content['application/json']?.schema;

    expect(schema?.['type']).toBe('object');
    expect(Object.keys(schema?.['properties'] ?? {})).toEqual(['email', 'password']);
  });

  /**
   * O multipart do envio de mensagem mistura as duas fontes: `text` e
   * `replyToId` saem do Zod que os valida, e o arquivo e escrito a mao —
   * schema nenhum o descreve.
   */
  it('descreve o multipart do envio com os campos do schema e o arquivo', () => {
    const envio = openApiDocument.paths['/api/chats/{id}/messages'] as {
      post: { requestBody?: { content: Record<string, { schema: Record<string, unknown> }> } };
    };

    const schema = envio.post.requestBody?.content['multipart/form-data']?.schema;

    expect(Object.keys(schema?.['properties'] ?? {}).sort()).toEqual([
      'attachment',
      'replyToId',
      'text',
    ]);
  });

  /** Toda operacao precisa dizer o que responde: um documento sem isso nao serve. */
  it('nao deixa operacao sem resposta descrita', () => {
    for (const [path, methods] of Object.entries(openApiDocument.paths)) {
      for (const [method, operation] of Object.entries(methods as object)) {
        const responses = (operation as { responses?: object }).responses ?? {};

        expect(
          Object.keys(responses).length,
          `${method.toUpperCase()} ${path} está sem resposta`,
        ).toBeGreaterThan(0);
      }
    }
  });
});
