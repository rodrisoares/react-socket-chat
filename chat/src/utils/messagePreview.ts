import type { Attachment, Chat, Message } from '@react-chat/shared';

/**
 * Rótulo de um anexo: o que se escreve onde só cabe uma linha.
 *
 * Usado na prévia da lista e na citação de uma resposta — nos dois casos o
 * texto da mensagem pode ser vazio, e sem o rótulo a linha fica muda.
 */
export function attachmentTypeLabel(attachment: Attachment | null): string {
  if (!attachment) return '';
  if (attachment.type.startsWith('image/')) return '📷 Foto';
  if (attachment.type.startsWith('video/')) return '🎬 Vídeo';
  if (attachment.type.startsWith('audio/')) return '🎤 Áudio';
  return `📎 ${attachment.name || 'Arquivo'}`;
}

/** O mesmo rótulo, a partir da mensagem. */
export function attachmentLabel(message: Message): string {
  return attachmentTypeLabel(message.attachment) || '📎 Arquivo';
}

/**
 * A prévia do card: quem falou + o que foi dito.
 *
 * O anexo tem rótulo próprio porque a mensagem só com arquivo tem texto vazio
 * — antes o card ficava mudo justamente quando algo tinha acabado de chegar.
 */
export function messagePreview(chat: Chat, myId?: number): string {
  const message = chat.lastMessage;
  if (!message) return '';

  const author =
    myId === undefined
      ? ''
      : message.userId === myId
        ? 'Você: '
        : chat.type === 'GROUP'
          ? `${message.name}: `
          : '';

  if (message.isDeleted) return `${author}mensagem apagada`;

  /*
   * Mencionado: o card troca o conteúdo pelo chamado.
   *
   * Ser chamado pelo nome é mais urgente que a frase em si — e a frase está a
   * um toque de distância, enquanto o chamado, misturado ao texto, passa
   * despercebido numa lista de conversas.
   *
   * Depois do ramo de apagada de propósito: a mensagem que sumiu não anuncia um
   * chamado que já não existe. Quem decide isto é o servidor, que aplica a
   * mesma regra usada para notificar (ver `mentionsName`).
   */
  if (chat.mentionsMe) return `${message.name} mencionou você`;

  const body = message.attachment
    ? message.text
      ? `${attachmentLabel(message)} · ${message.text}`
      : attachmentLabel(message)
    : message.text;

  return `${author}${body}`;
}
