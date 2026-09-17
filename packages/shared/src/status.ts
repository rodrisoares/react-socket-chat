/**
 * Status escolhido à mão pela pessoa. Só vale enquanto ela está online —
 * offline o ponto do avatar sempre pinta cinza.
 *
 * Vive aqui porque os dois lados precisam da mesma lista: o servidor valida
 * contra ela, o cliente desenha um botão para cada uma.
 */
export const USER_STATUSES = ['AVAILABLE', 'BUSY', 'AWAY', 'DND'] as const;

export type UserStatus = (typeof USER_STATUSES)[number];

/**
 * "Não perturbe" silencia tudo: sem som, sem aviso do navegador, nem em
 * conversa que não está silenciada — e nem quando alguém te menciona.
 *
 * É o único status com efeito além da cor do pontinho, e por isso mora aqui,
 * onde os dois lados leem a mesma regra.
 */
export const DO_NOT_DISTURB: UserStatus = 'DND';

/**
 * O status que os outros veem, com a ausência automática já resolvida.
 *
 * A inatividade não sobrescreve a escolha da pessoa — ela vive numa coluna
 * própria justamente para não apagá-la. Quem marcou "Ocupado" e foi tomar café
 * volta "Ocupado". E "Não perturbe" vence a ausência: é uma declaração
 * explícita, e trocá-la por "Ausente" diria menos do que a pessoa pediu.
 */
export function effectiveStatus(status: UserStatus, isAway: boolean): UserStatus {
  if (!isAway || status === DO_NOT_DISTURB) return status;
  return 'AWAY';
}
