import { z } from 'zod';

/**
 * Um schema Zod no formato JSON Schema, para o documento OpenAPI.
 *
 * Mora aqui, e não no servidor, porque é aqui que o Zod vive — e ele fica de
 * fora do pacote que vai para o navegador justamente por este ponto de entrada
 * ser separado. O servidor importa a função pronta e não precisa da biblioteca.
 *
 * `io: 'input'` é o que o documento deve descrever: o que a API **aceita**, e
 * não o que ela devolve depois de aplicar `default` e `coerce`. Um
 * `z.coerce.number()` aceita a string "3"; descrever a saída diria que só
 * número serve, e o documento passaria a recusar no papel o que a API aceita na
 * prática.
 *
 * O `$schema` sai porque dentro de um documento OpenAPI o dialeto é declarado
 * uma vez, no topo — repeti-lo em cada corpo é ruído que alguns validadores
 * ainda recusam.
 */
export function jsonSchemaOf(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _dialect, ...rest } = z.toJSONSchema(schema, {
    io: 'input',
  }) as Record<string, unknown>;

  return rest;
}
