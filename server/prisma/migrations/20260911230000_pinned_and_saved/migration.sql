-- Mensagem fixada na conversa: estado compartilhado, diferente do isPinned do
-- ChatParticipant, que e a conversa fixada na lista de quem fixou. Aqui todo
-- mundo ve o mesmo banner.
ALTER TABLE "Chat" ADD COLUMN "pinnedMessageId" TEXT REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Chat" ADD COLUMN "pinnedAt" DATETIME;
ALTER TABLE "Chat" ADD COLUMN "pinnedById" INTEGER;

CREATE INDEX "Chat_pinnedMessageId_idx" ON "Chat"("pinnedMessageId");

-- Favoritos: privado de quem salvou, como o bloqueio e o silenciar.
CREATE TABLE "SavedMessage" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "messageId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SavedMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SavedMessage_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "SavedMessage_userId_messageId_key" ON "SavedMessage"("userId", "messageId");
CREATE INDEX "SavedMessage_userId_idx" ON "SavedMessage"("userId");
