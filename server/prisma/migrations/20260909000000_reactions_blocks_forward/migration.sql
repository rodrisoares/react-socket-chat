-- Bloqueio: mais um estado privado de quem age, como o isPinned e o isMuted.
-- Fica em tabela propria porque vale entre dois usuarios, e nao dentro de uma
-- conversa — um bloqueio sobrevive a conversa ser excluida.
CREATE TABLE "Block" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "blockerId" INTEGER NOT NULL,
    "blockedId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Block_blockerId_fkey" FOREIGN KEY ("blockerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Block_blockedId_fkey" FOREIGN KEY ("blockedId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Block_blockerId_blockedId_key" ON "Block"("blockerId", "blockedId");
CREATE INDEX "Block_blockedId_idx" ON "Block"("blockedId");

-- Uma reacao por pessoa por mensagem: o unique e o que garante a regra, em vez
-- de a rota conferir antes e torcer para nao haver corrida.
CREATE TABLE "MessageReaction" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "messageId" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "emoji" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MessageReaction_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MessageReaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "MessageReaction_messageId_userId_key" ON "MessageReaction"("messageId", "userId");
CREATE INDEX "MessageReaction_messageId_idx" ON "MessageReaction"("messageId");

-- Encaminhada: so o rotulo. O conteudo e o anexo sao copiados de verdade.
ALTER TABLE "Message" ADD COLUMN "isForwarded" BOOLEAN NOT NULL DEFAULT false;
