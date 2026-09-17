import { Prisma } from '../generated/prisma/client.js';
import { prisma } from '../config/prisma.js';
import type { Visibility } from './visibility.js';

/**
 * Ponte com o indice de texto completo (FTS5), criado na migracao
 * `message_fts`.
 *
 * A busca era um LIKE sobre a coluna text: varria a tabela inteira, era
 * sensivel a acento ("reuniao" nao achava "reunião") e nao tinha nocao de
 * relevancia. O Prisma nao enxerga tabela virtual, entao so estas consultas
 * vao em SQL cru — o resto do repositorio continua tipado.
 */

/** Uma conversa do usuario, com o pedaco do historico que ele enxerga. */
interface Scope extends Visibility {
  chatId: string;
}

/**
 * Traduz o que o usuario digitou para a sintaxe do MATCH.
 *
 * Cada palavra vira um termo entre aspas com `*` no fim: aspas porque hifen,
 * dois-pontos e aspas tem significado proprio no FTS5 e um termo cru derrubaria
 * a consulta; o `*` porque quem digita "depl" espera achar "deploy" — casar so
 * palavra inteira pareceria quebrado enquanto se digita.
 */
export function toMatchQuery(term: string): string {
  const words = term
    .trim()
    .split(/\s+/)
    // As aspas do usuario somem: dentro do termo citado elas encerrariam a
    // citacao e o resto viraria sintaxe solta.
    .map((word) => word.replace(/"/g, '').trim())
    .filter(Boolean);

  if (words.length === 0) return '';
  return words.map((word) => `"${word}"*`).join(' ');
}

/**
 * O que a busca nunca deve devolver, em qualquer consulta.
 *
 * Aviso de grupo ("Fulano saiu") mora na mesma tabela das mensagens, para entrar
 * no historico na ordem certa — e as triggers do FTS indexam todo insert, sem
 * condicao. Sem este filtro, procurar por um nome traria de volta cada vez que
 * a pessoa entrou ou saiu de um grupo, misturado com o que ela de fato escreveu.
 *
 * O "apagar para mim" entra junto: se a pessoa apagou a mensagem da propria
 * visao, acha-la na busca a traria de volta pela porta dos fundos.
 */
function searchable(userId: number): Prisma.Sql {
  return Prisma.sql`
    m."deletedAt" IS NULL
    AND m."type" = 'TEXT'
    AND NOT EXISTS (
      SELECT 1 FROM "MessageDeletion" d
      WHERE d."messageId" = m."id" AND d."userId" = ${userId}
    )
  `;
}

/** As conversas do usuario, cada uma com o proprio corte de visibilidade. */
function visibleIn(scopes: Scope[]): Prisma.Sql {
  return Prisma.join(
    scopes.map(({ chatId, after, until }) => {
      const conditions = [Prisma.sql`m."chatId" = ${chatId}`];
      if (after) conditions.push(Prisma.sql`m."createdAt" > ${after}`);
      // Quem saiu do grupo nao acha o que foi escrito depois da saida.
      if (until) conditions.push(Prisma.sql`m."createdAt" <= ${until}`);

      return Prisma.sql`(${Prisma.join(conditions, ' AND ')})`;
    }),
    ' OR ',
  );
}

/**
 * A melhor ocorrencia de cada conversa, sem teto nenhum.
 *
 * "Melhor" e a mais relevante segundo o bm25 e, no empate, a mais recente —
 * que e o caso comum: duas mensagens com a mesma palavra pontuam igual, e ai
 * quem procura espera a ultima, nao a primeira de 2023.
 *
 * A CTE `hits` existe por uma limitacao do SQLite: o `bm25` so pode ser chamado
 * numa consulta cuja tabela e a propria FTS, e o planejador achatava a
 * subconsulta dentro do agrupamento — "unable to use function bm25 in the
 * requested context". O `MATERIALIZED` impede o achatamento, e o rank fica
 * pronto antes do join.
 *
 * O recorte de "quais conversas sao suas, e ate onde voce ve cada uma" vem de
 * um join com ChatParticipant. Antes vinha de fora: a rota carregava todas as
 * participacoes do usuario e montava um `OR` por conversa aqui dentro — uma
 * consulta que crescia com a agenda de quem procura, e que com algumas centenas
 * de conversas virava um SQL de centenas de clausulas. As tres condicoes abaixo
 * dizem exatamente o que o `visibilityOf` diz em TypeScript: o corte de limpar,
 * o de excluir, e a saida do grupo.
 */
export async function bestPerChat(term: string, userId: number): Promise<string[]> {
  const match = toMatchQuery(term);
  if (!match) return [];

  const rows = await prisma.$queryRaw<{ id: string }[]>`
    WITH hits AS MATERIALIZED (
      SELECT "rowid" AS rid, bm25("MessageFts") AS rank
      FROM "MessageFts"
      WHERE "MessageFts" MATCH ${match}
    ),
    visiveis AS (
      SELECT m."id" AS id, m."chatId" AS chatId, hits.rank AS rank,
             m."createdAt" AS createdAt
      FROM hits
      JOIN "Message" m ON m."rowid" = hits.rid
      JOIN "ChatParticipant" p
        ON p."chatId" = m."chatId" AND p."userId" = ${userId}
      WHERE ${searchable(userId)}
        AND (p."clearedAt" IS NULL OR m."createdAt" > p."clearedAt")
        AND (p."hiddenAt" IS NULL OR m."createdAt" > p."hiddenAt")
        AND (p."leftAt" IS NULL OR m."createdAt" <= p."leftAt")
    )
    SELECT id FROM (
      SELECT id,
             ROW_NUMBER() OVER (
               PARTITION BY chatId ORDER BY rank ASC, createdAt DESC
             ) AS posicao
      FROM visiveis
    )
    WHERE posicao = 1
  `;

  return rows.map((row) => row.id);
}

/**
 * Ocorrencias dentro de uma conversa, das mais recentes para as mais antigas.
 *
 * Aqui a ordem e cronologica, e nao por relevancia: a tela lista tudo e o
 * usuario anda entre as ocorrencias com as setas — ordenar por bm25 faria as
 * setas pularem no tempo.
 */
export async function searchInChat(
  chatId: string,
  term: string,
  visibility: Visibility,
  limit: number,
  userId: number,
): Promise<string[]> {
  const match = toMatchQuery(term);
  if (!match) return [];

  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT m."id" AS id
    FROM "MessageFts"
    JOIN "Message" m ON m."rowid" = "MessageFts"."rowid"
    WHERE "MessageFts" MATCH ${match}
      AND ${searchable(userId)}
      AND (${visibleIn([{ chatId, ...visibility }])})
    ORDER BY m."createdAt" DESC
    LIMIT ${limit}
  `;

  return rows.map((row) => row.id);
}
