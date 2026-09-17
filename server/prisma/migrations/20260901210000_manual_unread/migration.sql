-- "Marcar como nao lida": o nao-lido continua derivado de lastReadAt, e esta
-- flag so cobre o caso em que o usuario pede para manter a conversa marcada.
ALTER TABLE "ChatParticipant" ADD COLUMN "isUnread" BOOLEAN NOT NULL DEFAULT false;
