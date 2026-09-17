-- Estado privado por participante, na mesma linhagem do isUnread e do isPinned:
-- o que cada um faz com a conversa nao muda a conversa do outro.

-- Arquivar. Instante em vez de booleano para a mensagem nova desarquivar
-- sozinha: basta comparar com a ultima mensagem, sem escrita a cada envio.
ALTER TABLE "ChatParticipant" ADD COLUMN "archivedAt" DATETIME;

-- Silenciar: sem som e sem notificacao. O nao-lido continua contando.
ALTER TABLE "ChatParticipant" ADD COLUMN "isMuted" BOOLEAN NOT NULL DEFAULT false;

-- "Excluir conversa" so para mim. As mensagens sao compartilhadas numa tabela
-- unica, entao excluir nao apaga nada: e um corte temporal privado.
ALTER TABLE "ChatParticipant" ADD COLUMN "clearedAt" DATETIME;

-- Sair do grupo virou saida logica. Antes a linha era apagada e a conversa
-- sumia na hora; agora ela fica em somente leitura ate o usuario excluir.
ALTER TABLE "ChatParticipant" ADD COLUMN "leftAt" DATETIME;
