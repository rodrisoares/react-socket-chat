import type { UserStatus } from '@react-chat/shared';

/** Ordem em que os status aparecem no menu. */
export const USER_STATUSES: UserStatus[] = ['AVAILABLE', 'BUSY', 'AWAY', 'DND'];

export const STATUS_LABEL: Record<UserStatus, string> = {
  AVAILABLE: 'Disponível',
  BUSY: 'Ocupado',
  AWAY: 'Ausente',
  DND: 'Não perturbe',
};

/**
 * O que cada status quer dizer, no menu de escolha.
 *
 * Só o "Não perturbe" tem efeito além da cor do ponto — os outros três são
 * recado para quem olha. Sem esta linha, escolher entre "Ocupado" e "Não
 * perturbe" seria adivinhar qual dos dois cala a notificação.
 */
export const STATUS_HINT: Record<UserStatus, string> = {
  AVAILABLE: 'Você recebe avisos normalmente.',
  BUSY: 'Só um recado para os outros: os avisos continuam.',
  AWAY: 'Também entra sozinho quando você fica um tempo sem mexer.',
  DND: 'Silencia tudo: sem som e sem aviso, mesmo em conversa não silenciada.',
};

/** Sufixo da classe do ponto no Avatar. */
export const STATUS_CLASS: Record<UserStatus, string> = {
  AVAILABLE: 'online',
  BUSY: 'busy',
  AWAY: 'away',
  DND: 'dnd',
};
