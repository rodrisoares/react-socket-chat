/**
 * Os limites da API.
 *
 * Estavam escritos duas vezes: o servidor no schema Zod, o cliente no
 * `maxLength` do campo e no aviso da tela. Quando um mudava, o outro só
 * descobria pelo erro 400.
 */

/** Texto de uma mensagem. */
export const MESSAGE_MAX_LENGTH = 4000;

/** Bio do perfil. */
export const BIO_MAX_LENGTH = 200;

/** Recado ao lado do status: cabe uma frase, não um parágrafo. */
export const STATUS_TEXT_MAX_LENGTH = 60;

/** Nome de pessoa e de grupo. */
export const NAME_MIN_LENGTH = 2;
export const GROUP_NAME_MAX_LENGTH = 60;

/** Descrição do grupo — o "assunto", no painel de detalhes. */
export const GROUP_DESCRIPTION_MAX_LENGTH = 300;

/**
 * Prazo para "apagar para todos", em minutos.
 *
 * Existe porque apagar sem prazo reescreve o passado: alguém poderia sumir com
 * o que combinou meses atrás, na conversa de todo mundo. Passado o prazo resta
 * "apagar para mim", que não mexe na tela dos outros.
 */
export const DELETE_FOR_EVERYONE_MINUTES = 60;

/**
 * As opções de "silenciar por tempo". `null` é o "até eu desfazer".
 *
 * Mora aqui porque o servidor valida contra esta lista e o cliente desenha um
 * botão para cada uma — duas cópias divergiriam na primeira mudança.
 */
export const MUTE_DURATIONS = [
  { label: '8 horas', minutes: 8 * 60 },
  { label: '1 semana', minutes: 7 * 24 * 60 },
  { label: 'Sempre', minutes: null },
] as const;

/** Contatos por página da busca — ver GET /api/me/contacts?q=. */
export const CONTACTS_PAGE_SIZE = 30;

/** URL de avatar — do perfil e do grupo. */
export const IMAGE_URL_MAX_LENGTH = 500;

/** Emoji de uma reação: cabe um emoji composto, não uma frase. */
export const REACTION_MAX_LENGTH = 16;

/** Destinos de um encaminhamento de uma vez só. */
export const FORWARD_MAX_CHATS = 20;

/** Mensagens por página do histórico. */
export const MESSAGES_PAGE_SIZE = 30;

/** Conversas por página da lista. */
export const CHATS_PAGE_SIZE = 30;

/** Teto de um anexo, em MB. */
export const UPLOAD_MAX_MB = 10;

/**
 * Tipos que o servidor aceita como anexo, no formato do `accept` de um
 * `<input type="file">`.
 *
 * A mesma lista mora no `EXTENSION_OF` do servidor, que é quem decide de
 * verdade — aqui ela serve para o seletor de arquivos já abrir filtrado, em vez
 * de deixar a pessoa escolher um .zip e descobrir pelo erro da API.
 */
export const UPLOAD_ACCEPT = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'video/mp4',
  'video/webm',
  'application/pdf',
  'text/plain',
].join(',');
