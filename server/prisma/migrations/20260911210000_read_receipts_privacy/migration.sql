-- Recibo de leitura desligavel, o par do showLastSeen.
--
-- Vale para os dois lados, como no WhatsApp: quem desliga para de mandar o
-- proprio ✓✓ e para de receber o dos outros. Sem a reciprocidade, o ajuste
-- seria so uma forma de ver sem ser visto.
ALTER TABLE "User" ADD COLUMN "showReadReceipts" BOOLEAN NOT NULL DEFAULT true;
