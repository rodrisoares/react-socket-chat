import type { Chat, Message, User } from './api.js';

/**
 * Os eventos de socket, com o formato de cada payload.
 *
 * Eram strings soltas nos dois lados: um `socket.emit('nova-mensagem')` com o
 * nome trocado, ou um payload a menos, não quebrava nada na compilação — só
 * deixava a tela parada. Com os mapas abaixo no `Server<...>` e no `io<...>`,
 * o nome e o payload de cada evento são conferidos pelo `tsc`.
 */

export interface NewMessageEvent {
  chatId: string;
  /** Quem enviou — o mesmo id que vai em `newMessage.userId`. */
  id: number;
  newMessage: Message;
  /**
   * Quem esta mensagem menciona, resolvido pelo servidor contra os membros do
   * grupo no momento do envio.
   *
   * Existe para a menção furar o silêncio: uma conversa silenciada não notifica
   * nada, mas ser chamado pelo nome é o caso em que a pessoa quer saber.
   *
   * Vive no evento, e não na `Message`, de propósito. Quem precisa do dado
   * autoritativo é a decisão de notificar, que só acontece ao vivo — pô-lo na
   * mensagem obrigaria a guardá-lo no banco e faria o contrato prometer um
   * campo que o histórico nunca traria. O destaque visual do `@Nome` no balão
   * não depende disto: ele casa nomes no cliente, onde um engano só pinta uma
   * palavra.
   */
  mentions?: number[];
}

export interface MessageUpdatedEvent {
  chatId: string;
  message: Message;
}

export interface TypingEvent {
  chatId: string;
  userId: number;
}

export interface ReadMessageEvent {
  chatId: string;
  /** Quem leu. */
  id: number;
  /**
   * Instante gravado pelo servidor. É ele que se compara com a data de cada
   * mensagem — o relógio de quem recebe o evento pode estar atrasado.
   */
  readAt: string;
}

/** Payload do user-logoff: o horário vem junto para o cabeçalho não esperar. */
export interface UserLogoffEvent {
  id: number;
  lastSeenAt: string | null;
}

export interface ChatEvent {
  chatId: string;
}

/** O que o servidor manda para o navegador. */
export interface ServerToClientEvents {
  'new-message': (event: NewMessageEvent) => void;
  'message-updated': (event: MessageUpdatedEvent) => void;
  typing: (event: TypingEvent) => void;
  'stop-typing': (event: TypingEvent) => void;
  'read-message': (event: ReadMessageEvent) => void;
  /**
   * Perfil atualizado. Para os contatos vai sem e-mail e sem os interruptores
   * de privacidade; para as outras abas do próprio dono, vai inteiro — por
   * isso `User`, que tem esses campos opcionais.
   */
  'user-updated': (user: User) => void;
  'new-login': (userId: number) => void;
  'user-logoff': (event: UserLogoffEvent) => void;
  'chat-created': (event: ChatEvent) => void;
  'chat-updated': (event: ChatEvent) => void;
}

/** O que o navegador manda para o servidor. */
export interface ClientToServerEvents {
  typing: (event: ChatEvent) => void;
  'stop-typing': (event: ChatEvent) => void;
  /** Sair da conta: marca offline sem esperar o disconnect do transporte. */
  logoff: () => void;
}

/**
 * Nada é emitido entre instâncias do servidor hoje — só existe uma. Fica
 * declarado para o dia em que um adapter (Redis) entrar: é o terceiro
 * parâmetro do `Server<...>`.
 */
export type InterServerEvents = Record<string, never>;

/** O que cada conexão guarda sobre si, do lado do servidor. */
export interface SocketData {
  /** Dispositivo de onde a conexão veio; preenchido no handshake. */
  sessionId?: string;
}

/** Uma conversa como o `chat-created`/`chat-updated` a devolve depois. */
export type ChatSummary = Chat | null;
