import { effectiveStatus, USER_STATUSES } from '@react-chat/shared';
import type { SessionUser, User, UserStatus } from '@react-chat/shared';

/**
 * A ponte entre a linha do banco e o contrato da API.
 *
 * Fica fora dos repositórios de propósito: os dois precisam dela, e um
 * importando o outro só para converter um status criaria ciclo.
 */

/** O status vem do banco como texto: o SQLite não tem enum. */
export function asUserStatus(value: string): UserStatus {
  return (USER_STATUSES as readonly string[]).includes(value)
    ? (value as UserStatus)
    : 'AVAILABLE';
}

/** O que a projeção pública do usuário traz do banco. */
export interface UserRow {
  id: number;
  name: string;
  email: string;
  image: string | null;
  bio: string | null;
  status: string;
  /** Recado livre ao lado do status. */
  statusText: string | null;
  /** Ausência automática por inatividade — ver publicStatusOf. */
  isAway: boolean;
  isOnline: boolean;
  lastSeenAt: Date | null;
  showLastSeen: boolean;
  showReadReceipts: boolean;
}

/**
 * O status como os outros o veem: o escolhido à mão, com a ausência automática
 * já aplicada por cima.
 *
 * As duas colunas são separadas no banco porque a inatividade não pode apagar a
 * escolha da pessoa — quem marcou "Ocupado" e foi almoçar volta "Ocupado". Quem
 * resolve as duas é esta função, e o dono recebe o valor cru (ver sessionUser):
 * é ele quem precisa ver a própria escolha marcada no seletor.
 */
export function publicStatusOf(user: { status: string; isAway: boolean }): UserStatus {
  return effectiveStatus(asUserStatus(user.status), user.isAway);
}

/**
 * "Visto por último" como ele sai para os outros: null quando a pessoa
 * desligou o campo, e null enquanto ela está online — aí o que vale é o ponto
 * verde, não um horário que ficaria parado no passado.
 */
export function lastSeenOf(user: {
  isOnline: boolean;
  lastSeenAt: Date | null;
  showLastSeen: boolean;
}): string | null {
  if (!user.showLastSeen || user.isOnline || user.lastSeenAt === null) return null;
  return user.lastSeenAt.toISOString();
}

/**
 * Outra pessoa, como ela sai para quem não é ela.
 *
 * O e-mail sai sempre: ele viajava na lista de contatos — que traz todos os
 * usuários do banco — e no user-updated, e nenhuma tela mostra o e-mail de
 * outra pessoa. O "visto por último" é removido aqui, na serialização, e não
 * escondido no cliente: com o campo viajando, bastaria abrir o devtools para
 * ler o que a pessoa desligou. O próprio interruptor também não interessa a
 * terceiros — só ao dono.
 */
export function publicUser(user: UserRow): User {
  return {
    id: user.id,
    name: user.name,
    image: user.image,
    bio: user.bio,
    status: publicStatusOf(user),
    statusText: user.statusText,
    isOnline: user.isOnline,
    lastSeenAt: lastSeenOf(user),
  };
}

/** O próprio usuário: com e-mail e com os interruptores de privacidade. */
export function sessionUser(user: UserRow): SessionUser {
  return {
    ...publicUser(user),
    email: user.email,
    // O dono vê o próprio horário mesmo com o campo desligado para os outros.
    lastSeenAt: user.lastSeenAt?.toISOString() ?? null,
    // E o status cru, sem a ausência automática por cima: é ele que o seletor
    // marca. Com o valor resolvido, quem ficou um tempo parado veria "Ausente"
    // selecionado e perderia de vista o que tinha escolhido.
    status: asUserStatus(user.status),
    isAway: user.isAway,
    showLastSeen: user.showLastSeen,
    showReadReceipts: user.showReadReceipts,
    isLogged: true,
  };
}
