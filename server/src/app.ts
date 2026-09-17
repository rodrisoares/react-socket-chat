import path from 'node:path';

import authRouter from './routes/auth.js';
import chatsRouter from './routes/chats.js';
import meRouter from './routes/me.js';
import { app } from './config/instances.js';
import { logger } from './config/logger.js';
import { prisma } from './config/prisma.js';
import { servedTypeOf, UPLOAD_DIR } from './config/upload.js';
import { isSignatureValid } from './config/attachments.js';
import { openApiDocument } from './docs/openapi.js';
import { errorHandler, notFoundHandler } from './middlewares/errorHandler.js';
import * as messages from './repositories/messageRepository.js';
import './socket/index.js';

/**
 * Monta rotas e middlewares sem subir o servidor.
 * Separado do index.ts para que os testes usem o app com supertest.
 *
 * Os handlers são `async` e não têm mais o `asyncHandler` em volta: o Express 5
 * encaminha a promessa rejeitada para o errorHandler sozinho.
 */

/**
 * Anexos das mensagens. Era um express.static aberto: quem tivesse a URL abria
 * o arquivo sem participar da conversa. Agora a URL vem assinada de dentro da
 * mensagem — ver config/attachments.ts.
 *
 * O tipo sai da extensão gravada, que o upload só põe depois de conferir os
 * bytes, e o `nosniff` impede o browser de adivinhar outro. O que não é imagem
 * nem vídeo vai como download: um PDF ou um texto nunca abre como página no
 * domínio da API.
 *
 * `?download=1` força o download também de imagem e vídeo. É o que o botão
 * "Baixar" do visor precisa: o `download` de um `<a>` é ignorado quando o
 * arquivo vem de outra origem — e a tela e a API são origens diferentes —,
 * então o clique abria a foto numa aba nova em vez de salvá-la. Quem decide
 * isso tem de ser o `Content-Disposition`, que só o servidor escreve.
 *
 * O parâmetro fica fora da assinatura de propósito: ela cobre o arquivo e o
 * vencimento, e não o que se faz com ele.
 */
app.get('/uploads/:file', async (req, res) => {
  const file = path.basename(req.params.file);

  if (!isSignatureValid(file, req.query['exp'], req.query['sig'])) {
    res.status(403).json({ error: 'Link do anexo inválido ou expirado' });
    return;
  }

  const type = servedTypeOf(file);
  if (!type) {
    res.status(404).json({ error: 'Anexo não encontrado' });
    return;
  }

  res.setHeader('X-Content-Type-Options', 'nosniff');

  const asDownload = req.query['download'] !== undefined;

  if (asDownload || (!type.startsWith('image/') && !type.startsWith('video/'))) {
    // O nome que o usuário mandou, mas com a extensão do tipo confirmado:
    // um "x.html" gravado como texto baixa como "x.txt".
    const original = (await messages.findAttachmentName(`/uploads/${file}`)) ?? file;
    res.attachment(`${path.basename(original, path.extname(original))}${path.extname(file)}`);
  }

  // Depois do attachment, que deduz um tipo pelo nome: quem manda é a extensão
  // gravada.
  res.type(type);

  res.sendFile(path.join(UPLOAD_DIR, file), { maxAge: '1d' }, (error) => {
    if (error && !res.headersSent) {
      res.status(404).json({ error: 'Anexo não encontrado' });
    }
  });
});

/**
 * Sonda de saúde, para quem orquestra saber se este processo ainda serve.
 *
 * Toca o banco de propósito: um processo que responde HTTP mas perdeu o SQLite
 * está de pé sem servir para nada, e é exatamente esse caso que a sonda existe
 * para pegar. A consulta é a mais barata que existe.
 */
app.get('/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', uptime: Math.round(process.uptime()) });
  } catch (error) {
    logger.error({ error }, 'health: banco indisponível');
    res.status(503).json({ status: 'degraded' });
  }
});

/**
 * O documento OpenAPI da API.
 *
 * Servido pelo próprio servidor que ele descreve: assim não há como abrir uma
 * versão de outro deploy por engano. Para ler, cole a resposta em
 * editor.swagger.io — ou aponte qualquer cliente de API para esta URL.
 */
app.get('/api/openapi.json', (_req, res) => {
  res.json(openApiDocument);
});

app.use('/api/auth', authRouter);
app.use('/api/me', meRouter);
app.use('/api/chats', chatsRouter);

// Depois de todas as rotas: 404 para o que sobrar, e o handler de erro por ultimo.
app.use(notFoundHandler);
app.use(errorHandler);

export { app };
