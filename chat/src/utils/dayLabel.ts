/**
 * Rótulo do separador de dia entre blocos de mensagens.
 * Isolado do componente para poder ser testado sem renderizar nada.
 */
export function dayLabel(iso: string, today = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';

  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (sameDay(date, today)) return 'Hoje';
  if (sameDay(date, yesterday)) return 'Ontem';

  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long' }).format(date);
}

const TIME_FORMAT = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
const WEEKDAY_FORMAT = new Intl.DateTimeFormat('pt-BR', { weekday: 'long' });
const SHORT_DATE_FORMAT = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
});
const FULL_FORMAT = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'full',
  timeStyle: 'short',
});

/**
 * "HH:mm" no fuso de quem está lendo. O servidor manda só o instante: antes
 * mandava o horário pronto, formatado no fuso dele — num deploy em UTC, três
 * horas adiantado para quem está no Brasil.
 */
export function timeLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return TIME_FORMAT.format(date);
}

/** Dias de calendário entre as duas datas — a hora não conta. */
function daysApart(date: Date, today: Date): number {
  const from = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const to = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

/**
 * O carimbo de tempo do card da lista.
 *
 * Era sempre "HH:mm", mesmo numa conversa parada há duas semanas — e "09:14"
 * num card de outubro não diz nada a ninguém. A régua é a que WhatsApp e
 * Telegram usam: hoje mostra a hora, ontem diz "Ontem", a última semana mostra
 * o dia, e o que passou disso vira data.
 */
export function cardTimeLabel(iso: string, today = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';

  const day = dayLabel(iso, today);
  if (day === 'Hoje') return timeLabel(iso);
  if (day === 'Ontem') return 'Ontem';

  // Dentro da semana o dia se localiza sozinho: "sábado" é mais claro que
  // "14/03" para quem lembra da conversa, e não da data.
  if (daysApart(date, today) < 7) return WEEKDAY_FORMAT.format(date);

  return SHORT_DATE_FORMAT.format(date);
}

/**
 * Data e hora por extenso — o `title` do horário dentro do balão.
 *
 * O balão mostra só "HH:mm" para caber; a data completa fica a um passe de
 * mouse de distância, em vez de obrigar a rolar até o separador de dia.
 */
export function fullDateLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';

  return FULL_FORMAT.format(date);
}

/**
 * Onde entra o separador de dia, por índice da mensagem: o rótulo na primeira
 * de cada dia, `null` nas demais.
 *
 * Isolado do componente porque a lista virtualizada renderiza os itens fora de
 * ordem e só os visíveis — a variável mutável que fazia isso dentro do `map`
 * deixaria de funcionar, e este é o tipo de regressão que passa despercebida.
 */
export function dayMarkers(dates: string[], today = new Date()): (string | null)[] {
  let previous = '';

  return dates.map((iso) => {
    const day = dayLabel(iso, today);
    const show = day !== previous;
    previous = day;
    return show ? day : null;
  });
}
