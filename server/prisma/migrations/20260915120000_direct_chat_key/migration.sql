-- Chave do par de uma conversa direta: "menorId:maiorId".
--
-- Nao havia restricao nenhuma para o par, entao duas criacoes simultaneas
-- geravam duas conversas entre as mesmas duas pessoas: a rota lia, nao achava
-- nada, e as duas seguiam para o insert. Com a coluna unica, a segunda falha e
-- a rota devolve a que ja existe.
ALTER TABLE "Chat" ADD COLUMN "directKey" TEXT;

-- Carga inicial: so as diretas com exatamente dois participantes tem par.
UPDATE "Chat" SET "directKey" = (
  SELECT MIN(p."userId") || ':' || MAX(p."userId")
    FROM "ChatParticipant" p
   WHERE p."chatId" = "Chat"."id"
)
WHERE "type" = 'DIRECT'
  AND (SELECT COUNT(*) FROM "ChatParticipant" p WHERE p."chatId" = "Chat"."id") = 2;

-- As duplicatas que ja existiam ficam sem chave, em vez de serem apagadas:
-- nenhuma mensagem se perde, e o unique do SQLite ignora nulos. Fica com a
-- chave a conversa mais recente de cada par — a que a lista mostra no topo e
-- para a qual as novas mensagens vao.
UPDATE "Chat" SET "directKey" = NULL
WHERE "directKey" IS NOT NULL
  AND "id" NOT IN (
    SELECT "id" FROM (
      SELECT "id",
             ROW_NUMBER() OVER (
               PARTITION BY "directKey"
               ORDER BY COALESCE("lastMessageAt", "createdAt") DESC, "id"
             ) AS rn
        FROM "Chat"
       WHERE "directKey" IS NOT NULL
    )
    WHERE rn = 1
  );

CREATE UNIQUE INDEX "Chat_directKey_key" ON "Chat"("directKey");
