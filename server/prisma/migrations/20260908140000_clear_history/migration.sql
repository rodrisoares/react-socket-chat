-- Separa os dois efeitos que antes vinham juntos no clearedAt.
--
-- "Limpar conversa" esconde o historico e deixa a conversa na lista, vazia.
-- "Excluir conversa" faz o mesmo e ainda tira a conversa da lista. Sem este
-- campo nao havia como pedir um sem o outro.
ALTER TABLE "ChatParticipant" ADD COLUMN "hiddenAt" DATETIME;

-- Quem ja tinha excluido uma conversa fez as duas coisas: preserva o efeito.
UPDATE "ChatParticipant" SET "hiddenAt" = "clearedAt" WHERE "clearedAt" IS NOT NULL;
