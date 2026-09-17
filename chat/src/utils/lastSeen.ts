import { STATUS_LABEL } from 'utils/userStatus';
import type { UserStatus } from '@react-chat/shared';

/**
 * Rótulo do "visto por último", no formato do WhatsApp.
 *
 * Fora do componente para poder ser testado sem relógio real: o `now` é
 * parâmetro, e não `new Date()` escondido no meio da função.
 */
export function lastSeenLabel(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return '';

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';

  const time = new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (sameDay(date, now)) return `visto por último hoje às ${time}`;
  if (sameDay(date, yesterday)) return `visto por último ontem às ${time}`;

  const day = new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
  }).format(date);

  return `visto por último em ${day} às ${time}`;
}

/**
 * O que vai sob o nome no cabeçalho e nos detalhes.
 *
 * Online, quem manda é o status escolhido: "Ocupado" e "Ausente" têm cor
 * própria no ponto do avatar, e a linha de texto dizia "Online" para os três
 * — o ponto laranja e a palavra "Online" na mesma tela se contradiziam.
 * "Disponível" continua saindo como "Online", que é a palavra que todo mundo
 * espera do estado normal.
 *
 * Offline, vale o horário — e "Offline" seco quando não há horário, que é o
 * caso de quem escondeu o campo na privacidade e de quem nunca se conectou.
 */
export function presenceLabel(
  isOnline: boolean,
  lastSeenAt: string | null | undefined,
  status?: UserStatus,
  now = new Date(),
): string {
  if (isOnline) {
    return status && status !== 'AVAILABLE' ? STATUS_LABEL[status] : 'Online';
  }
  return lastSeenLabel(lastSeenAt, now) || 'Offline';
}
