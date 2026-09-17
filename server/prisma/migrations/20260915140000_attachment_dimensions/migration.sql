-- Dimensoes e miniatura do anexo de imagem.
--
-- As dimensoes existem para a tela reservar o espaco antes de a imagem chegar:
-- sem elas o balao nasce com altura zero e empurra a conversa inteira quando a
-- foto carrega — o salto que fazia perder a linha que se estava lendo.
--
-- A miniatura existe porque a lista e a galeria mostram a imagem com 80px de
-- lado, e ate agora baixavam o original inteiro para isso.
--
-- Tudo nulo nas mensagens que ja existem: nao ha como medir depois sem reabrir
-- cada arquivo, e o cliente trata a ausencia como "sem dimensao conhecida".
ALTER TABLE "Message" ADD COLUMN "attachmentWidth" INTEGER;
ALTER TABLE "Message" ADD COLUMN "attachmentHeight" INTEGER;
ALTER TABLE "Message" ADD COLUMN "attachmentThumbUrl" TEXT;
