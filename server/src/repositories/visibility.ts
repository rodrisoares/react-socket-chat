/**
 * O pedaco do historico que um participante enxerga.
 *
 * `after` e o corte privado de "limpar" e "excluir": nada anterior a ele
 * existe para quem pediu. `until` e a saida do grupo: nada posterior. Sem o
 * `until`, quem saiu — ou foi removido — continuava lendo tudo o que o grupo
 * escrevia depois, pelo historico, pela busca, pela galeria, pelos favoritos e
 * pelo contador de nao lidas.
 *
 * Mora aqui, e nao num repositorio, porque todos eles aplicam o mesmo corte:
 * duas versoes da regra divergiriam na primeira mudanca.
 */
export interface Visibility {
  after: Date | null;
  until: Date | null;
}

/** A mais recente das duas datas; null so quando as duas sao null. */
export function latest(a: Date | null, b: Date | null): Date | null {
  if (a === null) return b;
  if (b === null) return a;
  return a > b ? a : b;
}

export function visibilityOf(participant: {
  clearedAt: Date | null;
  hiddenAt: Date | null;
  leftAt: Date | null;
}): Visibility {
  return {
    after: latest(participant.clearedAt, participant.hiddenAt),
    until: participant.leftAt,
  };
}

export function isVisible(createdAt: Date, visibility: Visibility): boolean {
  if (visibility.after !== null && createdAt <= visibility.after) return false;
  return visibility.until === null || createdAt <= visibility.until;
}

/**
 * O mesmo corte no formato do `where` do Prisma, com o `before` da paginacao
 * quando houver. Vazio quando nao ha corte nenhum.
 */
export function createdAtRange(visibility: Visibility, before?: Date) {
  const range = {
    ...(visibility.after ? { gt: visibility.after } : {}),
    ...(visibility.until ? { lte: visibility.until } : {}),
    ...(before ? { lt: before } : {}),
  };

  return Object.keys(range).length > 0 ? { createdAt: range } : {};
}
