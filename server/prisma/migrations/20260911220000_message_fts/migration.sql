-- Indice de texto completo das mensagens (FTS5).
--
-- A busca era um LIKE sobre a coluna text, sem indice: varria a tabela, era
-- sensivel a acento e nao tinha nocao de relevancia. O FTS5 resolve os tres —
-- e o `remove_diacritics 2` do tokenizador e o que faz "deploy" achar "depl0y
-- da manha" tanto quanto "reuniao" achar "reunião".
--
-- `content='Message'` deixa o indice sem copia do texto: ele aponta para a
-- tabela original pelo rowid. Em troca, as tres triggers abaixo passam a ser
-- obrigatorias — um indice externo nao se atualiza sozinho.
CREATE VIRTUAL TABLE "MessageFts" USING fts5(
  text,
  content='Message',
  content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);

-- Carga inicial: tudo que ja existe entra no indice.
INSERT INTO "MessageFts"("rowid", "text") SELECT "rowid", "text" FROM "Message";

CREATE TRIGGER "message_fts_insert" AFTER INSERT ON "Message" BEGIN
  INSERT INTO "MessageFts"("rowid", "text") VALUES (new."rowid", new."text");
END;

-- O 'delete' com a coluna antiga e como o FTS5 externo apaga uma linha.
CREATE TRIGGER "message_fts_delete" AFTER DELETE ON "Message" BEGIN
  INSERT INTO "MessageFts"("MessageFts", "rowid", "text")
  VALUES ('delete', old."rowid", old."text");
END;

CREATE TRIGGER "message_fts_update" AFTER UPDATE ON "Message" BEGIN
  INSERT INTO "MessageFts"("MessageFts", "rowid", "text")
  VALUES ('delete', old."rowid", old."text");
  INSERT INTO "MessageFts"("rowid", "text") VALUES (new."rowid", new."text");
END;
