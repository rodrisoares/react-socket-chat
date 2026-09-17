/**
 * As chaves do cache, num lugar só.
 *
 * Espalhadas pelos hooks, um `['chats']` aqui e um `['chat', id]` ali divergem
 * na primeira renomeação — e invalidar a chave errada não dá erro nenhum: só
 * deixa a tela mostrando o que já não vale.
 *
 * A hierarquia é de propósito: `['chats', id, 'gallery']` some junto quando a
 * conversa inteira é invalidada.
 */
export const queryKeys = {
  /** O próprio usuário — o que /api/auth/me devolve. */
  session: ['session'] as const,

  /** A lista de conversas, paginada por cursor. */
  chats: ['chats'] as const,
  chat: (chatId: string) => ['chats', chatId] as const,
  chatDetails: (chatId: string) => ['chats', chatId, 'details'] as const,
  chatGallery: (chatId: string) => ['chats', chatId, 'gallery'] as const,
  chatSearch: (chatId: string, term: string) =>
    ['chats', chatId, 'search', term] as const,

  /** O histórico de uma conversa, paginado para trás. */
  messages: (chatId: string) => ['messages', chatId] as const,

  /** Busca por conteúdo em todas as conversas. */
  search: (term: string) => ['search', term] as const,

  contacts: ['contacts'] as const,
  blocks: ['blocks'] as const,
  devices: ['devices'] as const,

  /** Só os ids, para a estrela de cada mensagem; e a lista inteira, no modal. */
  savedIds: ['saved', 'ids'] as const,
  saved: ['saved'] as const,
};
