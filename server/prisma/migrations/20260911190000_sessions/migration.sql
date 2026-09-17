-- Sessoes de longa duracao: uma linha por dispositivo conectado.
--
-- O access token continua sendo o JWT curto do header; o que mora aqui e o
-- refresh, que o renova sem pedir a senha de novo. Antes nao havia nenhum: o
-- JWT expirava e o usuario era jogado no /login no meio do que estava fazendo.
--
-- Guarda o hash, e nunca o token: quem ler esta tabela nao consegue se passar
-- por ninguem — a mesma regra do passwordHash.
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" INTEGER NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "revokedAt" DATETIME,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");
CREATE INDEX "Session_userId_idx" ON "Session"("userId");
