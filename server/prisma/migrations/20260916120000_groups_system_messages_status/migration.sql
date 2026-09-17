-- Gestao de grupo, mensagens de sistema, apagar para mim e status mais ricos.
--
-- Uma migracao so para os quatro assuntos: eles chegaram juntos e separa-los
-- daria quatro idas ao banco sem nenhum ganho — nada aqui depende do que veio
-- antes, e o SQLite reescreve a tabela a cada ALTER.

-- ------------------------------------------------------------------ mensagem

-- "TEXT" ou "SYSTEM". O aviso que o grupo produz ("Fulano saiu") mora na mesma
-- tabela para entrar no historico na ordem certa, mas nao e mensagem de
-- ninguem: nao aceita reacao, resposta, edicao nem encaminhamento.
--
-- Tudo que ja existe e TEXT — o default cobre as linhas antigas, e nenhuma
-- delas foi criada por evento de grupo.
ALTER TABLE "Message" ADD COLUMN "type" TEXT NOT NULL DEFAULT 'TEXT';

-- "Apagar para mim": a mensagem some para uma pessoa so.
--
-- Tabela, e nao coluna, porque a mensagem e compartilhada e cada participante
-- decide por si. E o oposto do deletedAt, que apaga para todos e deixa
-- "mensagem apagada" no lugar: aqui some sem deixar buraco.
CREATE TABLE "MessageDeletion" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "messageId" TEXT NOT NULL,
  "userId" INTEGER NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MessageDeletion_messageId_fkey" FOREIGN KEY ("messageId")
    REFERENCES "Message" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MessageDeletion_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Uma linha por pessoa por mensagem: apagar de novo nao duplica nada.
CREATE UNIQUE INDEX "MessageDeletion_messageId_userId_key"
  ON "MessageDeletion"("messageId", "userId");

-- O filtro roda em toda consulta que devolve mensagem, sempre por usuario.
CREATE INDEX "MessageDeletion_userId_idx" ON "MessageDeletion"("userId");

-- --------------------------------------------------------------------- grupo

-- Descricao: o "assunto" do grupo, que o painel de detalhes mostra.
ALTER TABLE "Chat" ADD COLUMN "description" TEXT;

-- Codigo do link de convite. Guardado como codigo, e nao como URL inteira: o
-- endereco do site pode mudar, o convite nao. Gerar outro invalida o anterior,
-- que e como se revoga um link.
--
-- Nulo em todo grupo que ja existe, e nulo para sempre em conversa direta. No
-- SQLite o unique ignora nulos, entao os nulos nao brigam entre si.
ALTER TABLE "Chat" ADD COLUMN "inviteCode" TEXT;
CREATE UNIQUE INDEX "Chat_inviteCode_key" ON "Chat"("inviteCode");

-- So administradores escrevem. Nao fecha o grupo para leitura: quem nao e admin
-- continua lendo tudo, so nao envia.
ALTER TABLE "Chat" ADD COLUMN "onlyAdminsSend" BOOLEAN NOT NULL DEFAULT false;

-- Silenciar por tempo. O isMuted continua sendo o "ate eu desfazer"; este e o
-- prazo. Instante, e nao booleano com tarefa agendada: passado o horario a
-- conversa volta a avisar sozinha, sem nada precisar rodar para desligar.
ALTER TABLE "ChatParticipant" ADD COLUMN "mutedUntil" DATETIME;

-- ------------------------------------------------------------------- pessoa

-- Recado livre ao lado do status: "Em reuniao ate as 15h".
ALTER TABLE "User" ADD COLUMN "statusText" TEXT;

-- Ausencia automatica por inatividade, detectada pelo proprio navegador.
--
-- Coluna separada do status de proposito: sobrescrever o status apagaria a
-- escolha da pessoa. Quem marcou "Ocupado" e foi tomar cafe volta "Ocupado", e
-- nao "Disponivel". Quem le resolve as duas colunas.
ALTER TABLE "User" ADD COLUMN "isAway" BOOLEAN NOT NULL DEFAULT false;
