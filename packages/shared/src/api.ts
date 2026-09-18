import type { UserStatus } from './status.js';

/**
 * O que a API devolve, exatamente como o cliente consome.
 *
 * O servidor tipa os serializadores com estes mesmos tipos: mudar um campo do
 * payload sem mudar a tela (ou o contrário) vira erro de compilação, e não uma
 * surpresa em produção.
 */

export interface Attachment {
  url: string;
  name: string;
  type: string;
  /**
   * Dimensões originais da imagem, medidas no upload.
   *
   * Existem para a tela reservar o espaço antes de a imagem chegar: sem elas o
   * balão nasce com altura zero e empurra a conversa inteira quando a foto
   * carrega — o salto que fazia perder a linha que se estava lendo.
   *
   * Ausentes em vídeo e nos demais anexos: quem as mede é o sharp, que não lê
   * vídeo. Ausentes também nos anexos enviados antes desta mudança.
   */
  width?: number;
  height?: number;
  /**
   * Versão reduzida da imagem, para a lista e a galeria — onde ela aparece com
   * 80px de lado e não havia por que baixar o original inteiro.
   */
  thumbnailUrl?: string;
}

export interface ReplyPreview {
  id: string;
  name: string;
  text: string;
  isDeleted: boolean;
  /**
   * Anexo da mensagem citada. Sem ele, responder a uma foto mostrava uma
   * citação vazia — o texto de uma mensagem só com anexo é ''.
   */
  attachment: Attachment | null;
}

/** Uma linha de reação: o emoji e quem o escolheu. */
export interface Reaction {
  emoji: string;
  userIds: number[];
}

/**
 * O que a linha é: mensagem de gente, ou aviso que o próprio grupo produziu.
 *
 * `SYSTEM` é o "Fulano adicionou Beltrano", o "saiu", o "renomeou o grupo".
 * Entra no histórico na ordem certa, mas não é mensagem de ninguém: não aceita
 * reação, resposta, edição nem encaminhamento, e o balão vira uma linha
 * centralizada. O `userId` diz quem causou o evento.
 */
export type MessageType = 'TEXT' | 'SYSTEM';

export interface Message {
  id: string;
  userId: number;
  name: string;
  /**
   * Obrigatório de propósito: quem monta uma mensagem — inclusive a otimista do
   * composer — precisa dizer o que ela é. Opcional, todo lugar que esquecesse
   * viraria `undefined` silencioso e o aviso do grupo apareceria como balão.
   */
  type: MessageType;
  text: string;
  /**
   * ISO — usado na paginação, no agrupamento por dia e no horário exibido,
   * que o cliente formata no fuso de quem lê. O servidor não manda hora
   * pronta: no fuso dele, ela sairia errada para todo mundo.
   */
  createdAt: string;
  isEdited: boolean;
  isDeleted: boolean;
  /** Chegou por encaminhamento; o balão mostra o rótulo. */
  isForwarded: boolean;
  /** Agrupadas por emoji. Uma reação por pessoa, então cada id aparece uma vez. */
  reactions: Reaction[];
  attachment: Attachment | null;
  replyTo: ReplyPreview | null;
}

export interface Member {
  id: number;
  name: string;
  image?: string;
  /** Texto livre do perfil; aparece em "Detalhes do contato". */
  bio?: string | null;
  /** Já com a ausência automática resolvida — ver effectiveStatus. */
  status?: UserStatus;
  /** Recado livre ao lado do status, ou null. */
  statusText?: string | null;
  isOnline: boolean;
  /**
   * ISO da última saída, ou null. Vem null também de quem desligou o
   * "visto por último" na privacidade e de quem está online agora — a decisão
   * é do servidor, então a UI só precisa saber se tem horário ou não.
   */
  lastSeenAt?: string | null;
  isAdmin: boolean;
}

export interface Chat {
  id: string;
  type: 'DIRECT' | 'GROUP';
  name: string;
  image?: string;
  isLogged: boolean;
  /** Status do outro participante; vazio em grupo. */
  status?: UserStatus;
  /** Recado do outro participante, ao lado do status. Null em grupo. */
  statusText?: string | null;
  /** "Visto por último" do outro participante; null em grupo. Ver Member. */
  lastSeenAt?: string | null;
  isAdmin: boolean;
  /** Fixada pelo usuário: sobe para o topo da lista. */
  isPinned: boolean;
  /** Arquivada por este usuário; some da lista principal. Mensagem nova desfaz. */
  isArchived: boolean;
  /**
   * Silenciada: sem som e sem notificação. O não lido continua contando.
   *
   * Já vem resolvido: vale tanto para o "sempre" quanto para um prazo que ainda
   * não venceu. A tela não precisa comparar relógio com o servidor.
   */
  isMuted: boolean;
  /**
   * Até quando o silêncio vale, ou null quando é "sempre" (ou quando não está
   * silenciada). Serve só para o menu dizer "silenciada até as 15h".
   */
  mutedUntil?: string | null;
  /** Descrição do grupo — o "assunto". Null em conversa direta. */
  description?: string | null;
  /** Só administradores enviam. Sempre false em conversa direta. */
  onlyAdminsSend: boolean;
  /**
   * Eu bloqueei o outro participante. Só em conversa direta — bloqueio não
   * afeta grupo compartilhado.
   */
  isBlocked: boolean;
  /** Saiu do grupo: a conversa fica só para leitura até ser excluída. */
  hasLeft: boolean;
  /**
   * A última mensagem menciona você — o card mostra "Fulano mencionou você".
   *
   * Calculado pelo servidor a cada listagem, e não guardado: ele já carrega os
   * participantes com nome e já sabe quem pediu a lista, então é uma
   * comparação de texto por conversa. Guardar num campo da mensagem custaria
   * uma migração para alimentar um rótulo de card.
   *
   * Só em grupo. Em conversa direta, "mencionou você" seria ruído: toda
   * mensagem ali já é para você.
   */
  mentionsMe?: boolean;
  participants: number[];
  members: Member[];
  unreadMessages: number;
  /**
   * userId -> ISO da última leitura dele. Vem do servidor para o recibo de
   * leitura sobreviver ao F5; os eventos de socket atualizam por cima.
   */
  readBy: Record<number, string>;
  /**
   * Mensagem fixada no topo da conversa. Compartilhada: todos veem a mesma —
   * ao contrário do `isPinned`, que é a conversa fixada na sua lista.
   */
  pinnedMessage: Message | null;
  /**
   * Prévia do card, e só. O histórico não vem junto da lista: ele é buscado
   * quando a conversa é aberta.
   */
  lastMessage: Message | null;
  /**
   * A mensagem que casou com o filtro — por que esta conversa está no
   * resultado.
   *
   * Só vem numa listagem filtrada (`GET /api/me/chats?q=`), e só quando o
   * casamento foi por conteúdo: quem entrou pelo nome da conversa não tem
   * mensagem para mostrar. O card exibe este trecho no lugar da última
   * mensagem, e clicar nele salta até ela.
   */
  matchedMessage?: Message;
}

/** Membro do grupo com a data de entrada — o painel de detalhes mostra. */
export type ChatMember = Member & { joinedAt: string };

export interface ChatDetails {
  id: string;
  type: string;
  name: string | null;
  /** Descrição do grupo, ou null. */
  description: string | null;
  /**
   * Link de convite pronto para copiar, ou null enquanto ninguém gerou um.
   *
   * URL inteira, e não o código: o banco guarda o código, e montar o endereço é
   * trabalho de quem sabe onde o site está — o servidor.
   *
   * Só chega para administrador: com o link, qualquer um entra no grupo.
   */
  inviteUrl?: string | null;
  /** Só administradores enviam. */
  onlyAdminsSend: boolean;
  createdAt: string;
  members: ChatMember[];
}

/** Quem leu a mensagem, e quando — o "Dados da mensagem". */
export interface MessageReadReceipt {
  id: number;
  name: string;
  image?: string;
  /** ISO da leitura. */
  readAt: string;
}

/**
 * GET /api/chats/:id/messages/:messageId/info — quem já leu e quem falta.
 *
 * Só o autor pede: saber quem leu a mensagem de outra pessoa não é assunto de
 * quem está olhando. Quem desligou o recibo de leitura não aparece em nenhuma
 * das duas listas — nem como lido, nem como pendente, porque dizer "ainda não
 * leu" de quem leu em silêncio entregaria o mesmo que o recibo esconde.
 */
export interface MessageInfo {
  messageId: string;
  readBy: MessageReadReceipt[];
  /** Ainda não leram. Vazio em conversa direta depois de o outro ler. */
  pending: Member[];
}

export interface User {
  id: number;
  name: string;
  /**
   * Só vem no próprio perfil: o servidor não manda o e-mail de outra pessoa —
   * nem na lista de contatos, nem no user-updated.
   */
  email?: string;
  /** null quando o usuário removeu a foto; cai no ícone genérico do Avatar. */
  image?: string | null;
  /** null quando o usuário limpou a bio. */
  bio?: string | null;
  /** Já com a ausência automática resolvida — ver effectiveStatus. */
  status?: UserStatus;
  /** Recado livre ao lado do status, ou null. */
  statusText?: string | null;
  /**
   * Ausência automática por inatividade. Só vem para o próprio dono: para os
   * outros ela já está embutida no `status`, e o cru não interessa a ninguém.
   */
  isAway?: boolean;
  isOnline: boolean;
  /** Só chega preenchido de quem não escondeu o campo. */
  lastSeenAt?: string | null;
  /**
   * Só vêm do próprio usuário: o servidor tira estes campos do que envia
   * sobre uma pessoa para as outras.
   */
  showLastSeen?: boolean;
  /** Desligado, o ✓✓ some nos dois sentidos — ver o readBy do servidor. */
  showReadReceipts?: boolean;
}

/** Usuário autenticado. As conversas vêm à parte, no próprio store. */
export interface SessionUser extends User {
  /** O próprio e-mail sempre vem. */
  email: string;
  isLogged: boolean;
}

/**
 * O que /api/auth/me e /api/auth/login devolvem: o usuário e a primeira carga
 * da lista, numa ida só ao servidor.
 */
export interface AuthResponse extends SessionUser {
  /** Primeira página da lista; o resto vem por `chatsCursor`. */
  chats: Chat[];
  /** Id da última conversa da página, ou null quando não há mais nada. */
  chatsCursor: string | null;
}

/** GET /api/me/chats — a lista é paginada por cursor. */
export interface ChatPage {
  chats: Chat[];
  nextCursor: string | null;
}

export interface LoginResponse {
  /**
   * Access token curto. Vive só na memória da aba e vai no header de toda
   * requisição — nada de localStorage, que qualquer XSS lê.
   */
  token: string;
  /** Linha da sessão no servidor — marca "este dispositivo" na lista. */
  sessionId: string;
  user: AuthResponse;
}

/**
 * O que /api/auth/refresh devolve.
 *
 * O token de longa duração não aparece aqui de propósito: ele viaja num cookie
 * httpOnly, que o JavaScript da página não alcança.
 */
export type RefreshResponse = Omit<LoginResponse, 'user'>;

/** Um dispositivo conectado, como GET /api/me/sessions devolve. */
export interface Session {
  id: string;
  userAgent: string | null;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
}

export interface MessagePage {
  messages: Message[];
  /** Há histórico mais antigo que a primeira mensagem desta página. */
  hasMore: boolean;
  /**
   * Há mensagens mais novas que a última daqui.
   *
   * Só vem preenchido na janela do `?around=<id>`, que abre o histórico em
   * volta de uma mensagem específica — a citada, a fixada, um resultado da
   * busca. Na paginação normal a página mais recente é sempre o fim da
   * conversa, e a pergunta não existe.
   */
  hasMoreAfter?: boolean;
}

/** Uma mensagem salva, com a conversa de onde veio. */
export interface SavedMessage {
  chatId: string;
  chatName: string | null;
  chatType: string;
  savedAt: string;
  message: Message;
}

/*
 * Aqui morava o `SearchHit`, de uma rota `/api/me/search` que devolvia uma
 * ocorrência por conversa. A busca na lista passou a sair da própria listagem
 * (`GET /api/me/chats?q=`), que já devolve a conversa inteira — e a conversa
 * que casou pelo conteúdo traz a mensagem em `matchedMessage`.
 */

/** Um link citado em alguma mensagem, como a galeria o lista. */
export interface GalleryLink {
  url: string;
  messageId: string;
  /** Quem mandou. */
  name: string;
  /** ISO da mensagem; o horário é formatado no cliente, como o das mensagens. */
  createdAt: string;
}

/** As três abas da galeria. É o `tab` de `GET /api/chats/:id/media`. */
export type GalleryTab = 'media' | 'files' | 'links';

/**
 * GET /api/chats/:id/media — uma página da galeria.
 *
 * Sem `?tab=`, é a primeira página das três abas de uma vez: elas são a mesma
 * visita, e trocar de aba não deveria custar uma ida à rede. Com `?tab=` e
 * `?cursor=`, é a próxima página **daquela** aba, e as outras duas voltam
 * vazias com `hasMore` falso — o cliente concatena aba por aba.
 *
 * O `hasMore` existe porque a galeria para no `GALLERY_PAGE_SIZE` de cada aba.
 * Antes ela parava calada: sessenta itens apareciam e o resto do acervo não
 * tinha como ser alcançado, nem havia na tela o que dissesse isso.
 */
export interface ChatGallery {
  /** Imagens e vídeos. */
  media: Message[];
  /** Os demais anexos. */
  files: Message[];
  links: GalleryLink[];
  /** Se ainda há mais para trás, aba por aba. */
  hasMore: Record<GalleryTab, boolean>;
}

/** Corpo de erro devolvido pelo errorHandler do servidor. */
export interface ApiError {
  error: string;
  issues?: { campo: string; mensagem: string }[];
}
