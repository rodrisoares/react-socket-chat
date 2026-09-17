-- Instante da ultima mensagem, desnormalizado na conversa.
--
-- Existe para a lista de conversas poder ser ordenada e paginada pelo banco.
-- Antes a ordem saia de JS, depois de carregar TODAS as participacoes do
-- usuario com uma mensagem cada — e a lista inteira era recarregada a cada
-- chat-updated. Sem uma coluna ordenavel nao da para paginar.
--
-- Mantido na criacao da mensagem, na mesma transacao (ver messageRepository).
ALTER TABLE "Chat" ADD COLUMN "lastMessageAt" DATETIME;

-- Carga inicial: a ultima mensagem de cada conversa, ou a criacao dela quando
-- nunca houve mensagem.
UPDATE "Chat" SET "lastMessageAt" = COALESCE(
  (SELECT MAX(m."createdAt") FROM "Message" m WHERE m."chatId" = "Chat"."id"),
  "createdAt"
);

CREATE INDEX "Chat_lastMessageAt_idx" ON "Chat"("lastMessageAt");
