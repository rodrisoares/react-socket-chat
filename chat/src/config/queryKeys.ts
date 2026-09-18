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
  /**
   * A mesma lista, filtrada por nome ou conteúdo no servidor.
   *
   * Sob `['chats', ...]` de propósito: o que mexe no cache das conversas
   * alcança a listagem filtrada pelo mesmo caminho, e ela não congela
   * enquanto se digita.
   */
  chatFilter: (term: string) => ['chats', 'filter', term] as const,
  chatDetails: (chatId: string) => ['chats', chatId, 'details'] as const,
  chatGallery: (chatId: string) => ['chats', chatId, 'gallery'] as const,
  chatSearch: (chatId: string, term: string) =>
    ['chats', chatId, 'search', term] as const,

  /** O histórico de uma conversa, paginado para trás. */
  messages: (chatId: string) => ['messages', chatId] as const,

  /** Contatos para iniciar conversa, filtrados no servidor. */
  contacts: (term: string) => ['contacts', term] as const,
  blocks: ['blocks'] as const,
  devices: ['devices'] as const,

  /** Só os ids, para a estrela de cada mensagem; e a lista inteira, no modal. */
  savedIds: ['saved', 'ids'] as const,
  saved: ['saved'] as const,
};
