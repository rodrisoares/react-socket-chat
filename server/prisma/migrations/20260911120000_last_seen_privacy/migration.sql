-- "Visto por ultimo": instante em que a pessoa saiu, gravado no disconnect do
-- socket junto com o isOnline. Null enquanto ela nunca se desconectou.
ALTER TABLE "User" ADD COLUMN "lastSeenAt" DATETIME;

-- Privacidade, no modelo do WhatsApp: quem esconde o proprio "visto por ultimo"
-- deixa de ve-lo dos outros? Nao — aqui a escolha e so sobre o proprio dado.
-- O campo nunca sai do servidor para terceiros; ver publicUser no repositorio.
ALTER TABLE "User" ADD COLUMN "showLastSeen" BOOLEAN NOT NULL DEFAULT true;
