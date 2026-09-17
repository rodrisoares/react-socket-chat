-- Conversa fixada no topo da lista. Como o isUnread, e por participante:
-- fixar e uma preferencia de quem fixou, nao um estado da conversa.
ALTER TABLE "ChatParticipant" ADD COLUMN "isPinned" BOOLEAN NOT NULL DEFAULT false;
