import { io } from '../config/instances.js';
import { verifyToken } from '../config/jwt.js';
import { logger } from '../config/logger.js';
import * as chats from '../repositories/chatRepository.js';
import { lastSeenOf } from '../repositories/mappers.js';
import * as sessions from '../repositories/sessionRepository.js';
import * as users from '../repositories/userRepository.js';
import * as events from './events.js';
import { keepsPresence } from './presence.js';

declare module 'socket.io' {
  interface Socket {
    /** Preenchido no handshake. */
    userId?: number;
  }
}

/**
 * Autentica o handshake. Sem token valido a conexao e recusada — antes,
 * qualquer cliente podia emitir join-rooms e ouvir conversas alheias.
 *
 * Alem do token, a sessao dele precisa estar viva: o token continua valido ate
 * vencer mesmo depois de a sessao ser encerrada, e sem esta consulta o aparelho
 * derrubado voltaria a se conectar no instante seguinte. A mensagem de erro
 * fala em "autenticacao" de proposito: e a deixa para o client tentar renovar.
 */
io.use((socket, next) => {
  const raw = socket.handshake.auth as { token?: unknown } | undefined;
  const token = typeof raw?.token === 'string' ? raw.token : null;
  const identity = token ? verifyToken(token) : null;

  if (!identity) {
    next(new Error('Autenticação necessária'));
    return;
  }

  sessions
    .isActive(identity.sessionId, identity.userId)
    .then((active) => {
      if (!active) {
        next(new Error('Autenticação necessária: sessão encerrada'));
        return;
      }

      socket.userId = identity.userId;
      socket.data.sessionId = identity.sessionId;
      next();
    })
    .catch((error: unknown) => {
      logger.error({ error }, 'socket: falha ao conferir a sessão');
      next(new Error('Falha ao conferir a sessão'));
    });
});

io.on('connection', (socket) => {
  const userId = socket.userId;
  if (!userId) return;

  void (async () => {
    try {
      await users.setOnline(userId, true);

      // Sala pessoal: permite adicionar o usuario a uma conversa criada depois.
      await socket.join(`user${userId}`);

      // O servidor decide as salas a partir do banco: o client nao escolhe mais.
      // Conversa de grupo que o usuario deixou nao entra: ela fica na lista so
      // para leitura, e a sala traria mensagem de um grupo do qual ele saiu.
      const chatIds = await chats.listChatIds(userId);
      await socket.join(chatIds.map((chatId) => `chat${chatId}`));

      await events.userOnline(userId);
    } catch (error) {
      logger.error({ error }, 'socket: falha ao preparar a conexão');
    }
  })();

  /**
   * Conversas em que esta conexao avisou que esta digitando e ainda nao avisou
   * que parou. Fechar a aba no meio da frase nunca manda o "parou", e o
   * "digitando…" ficava preso na tela dos outros.
   */
  const typingIn = new Set<string>();

  /**
   * "Digitando…" — evento efemero, nunca persistido.
   * Vai so para os outros participantes da sala.
   */
  socket.on('typing', (payload: unknown) => {
    const chatId = (payload as { chatId?: unknown } | undefined)?.chatId;
    if (typeof chatId !== 'string') return;
    if (!socket.rooms.has(`chat${chatId}`)) return;

    typingIn.add(chatId);
    socket.to(`chat${chatId}`).emit('typing', { chatId, userId });
  });

  socket.on('stop-typing', (payload: unknown) => {
    const chatId = (payload as { chatId?: unknown } | undefined)?.chatId;
    if (typeof chatId !== 'string') return;
    if (!socket.rooms.has(`chat${chatId}`)) return;

    typingIn.delete(chatId);
    socket.to(`chat${chatId}`).emit('stop-typing', { chatId, userId });
  });

  /**
   * Retira o "digitando…" que esta conexao deixou aberto.
   *
   * Arrow, e nao `function`: a declaracao e icada, entao o TypeScript a trata
   * como chamavel antes do `if (!userId) return` la de cima — e o `userId`
   * voltaria a ser `number | undefined` aqui dentro.
   */
  const stopTypingEverywhere = (): void => {
    // No disconnect o socket ja saiu das salas, mas emitir para elas continua
    // valendo: o `to` so exclui esta conexao, que de todo modo nao esta mais la.
    for (const chatId of typingIn) {
      socket.to(`chat${chatId}`).emit('stop-typing', { chatId, userId });
    }
    typingIn.clear();
  };

  /** Evita a dobradinha logoff + disconnect marcar a saida duas vezes. */
  let alreadyLeft = false;

  /**
   * Marca o usuario offline — se esta for mesmo a ultima conexao dele.
   *
   * Antes qualquer disconnect marcava offline: fechar uma aba fazia a pessoa
   * "sair" para todos os contatos com a outra aba aberta na frente dela, e
   * ainda gravava um "visto por ultimo" que nao aconteceu.
   */
  const goOffline = async (leavingId: string): Promise<void> => {
    if (alreadyLeft) return;

    try {
      // No disconnect o socket ja saiu das salas, entao ele nao se conta; no
      // logoff ele ainda esta la, e por isso o id vai como parametro.
      const alive = await io.in(`user${userId}`).fetchSockets();
      if (keepsPresence(alive.map((other) => other.id), leavingId)) return;

      alreadyLeft = true;
      const user = await users.setOnline(userId, false);
      // O evento leva o instante da saida junto: e com ele que o cabecalho
      // troca "online" por "visto por ultimo" sem esperar um reload. Quem
      // desligou a privacidade manda null.
      await events.userOffline(userId, lastSeenOf(user));
    } catch (error) {
      logger.error({ error }, 'socket: falha ao marcar offline');
    }
  };

  socket.on('disconnect', () => {
    stopTypingEverywhere();
    void goOffline(socket.id);
  });
  socket.on('logoff', () => void goOffline(socket.id));
});
