import './app.js';
import { io, server } from './config/instances.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { prisma } from './config/prisma.js';
import * as users from './repositories/userRepository.js';
import * as sessions from './repositories/sessionRepository.js';

/**
 * A presenca vive no banco e so e escrita no connect/disconnect do socket.
 * Uma queda do processo deixa todo mundo marcado como online; zerar aqui e o
 * unico ponto que sabe que ninguem esta conectado ainda.
 */
async function start() {
  try {
    await users.setAllOffline();
  } catch (error) {
    logger.error({ error }, 'boot: falha ao zerar a presença');
  }

  try {
    // Sessao expirada ou encerrada so ocupa espaco, e guardar o hash de um
    // token morto nao protege ninguem.
    const { count } = await sessions.purgeDead();
    if (count > 0) logger.info({ count }, 'boot: sessões antigas removidas');
  } catch (error) {
    logger.error({ error }, 'boot: falha ao limpar sessões');
  }

  server.listen(env.port, () => {
    logger.info({ port: env.port }, 'servidor no ar');
  });
}

/**
 * Desligamento limpo.
 *
 * Sem isto o processo morria no meio do que estivesse fazendo: requisição
 * cortada pela metade, conexão de socket sem aviso e, pior, o SQLite fechado à
 * força — o `$disconnect` é o que garante que o que foi escrito está no disco.
 *
 * A ordem importa: primeiro para de aceitar coisa nova (o `io.close` fecha
 * também o servidor HTTP por baixo), depois zera a presença de quem estava
 * conectado, e só então solta o banco.
 */
let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info({ signal }, 'desligando');

  // Rede de segurança: se algo travar no meio, o processo ainda sai. Sem o
  // `unref`, este timer sozinho manteria o Node vivo pelos 10 segundos.
  const giveUp = setTimeout(() => {
    logger.error('o desligamento demorou demais; saindo à força');
    process.exit(1);
  }, 10_000);
  giveUp.unref();

  try {
    // O `close` do socket.io ja devolve promessa, e fecha junto o servidor
    // HTTP por baixo: nao ha o que embrulhar nem o que fechar duas vezes.
    await io.close();
    await users.setAllOffline();
    await prisma.$disconnect();
  } catch (error) {
    logger.error({ error }, 'falha no desligamento');
  }

  clearTimeout(giveUp);
  process.exit(0);
}

process.on('SIGTERM', (signal) => void shutdown(signal));
process.on('SIGINT', (signal) => void shutdown(signal));

void start();
