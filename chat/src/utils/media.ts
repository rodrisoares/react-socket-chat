/**
 * Anexo que o visor em tela cheia sabe mostrar.
 *
 * Fora do componente de propósito: quem pergunta isto é a mensagem, a galeria
 * e o próprio visor — e um dos três importando os outros dois criaria um ciclo.
 */
export function isPreviewable(type: string | undefined): boolean {
  return Boolean(type && (type.startsWith('image/') || type.startsWith('video/')));
}
