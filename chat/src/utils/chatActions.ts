import type { Chat } from '@react-chat/shared';

/**
 * "Excluir conversa" some com ela só para quem clicou — o outro participante
 * continua vendo tudo. Em grupo isso só faz sentido depois de sair: escondê-la
 * continuando membro daria uma conversa que reaparece na próxima mensagem e da
 * qual não dá para sair. O servidor recusa o mesmo caso; isto é o espelho da
 * regra na UI, para o item nem aparecer no menu.
 */
export default function canDeleteChat(chat: Chat): boolean {
  return chat.type !== 'GROUP' || chat.hasLeft;
}

/**
 * Texto da confirmação. Mora aqui porque a ação sai de dois lugares — o menu
 * do card e o do cabeçalho — e a promessa feita ao usuário tem de ser a mesma.
 */
export function deleteChatMessage(chat: Chat): string {
  return `A conversa sai apenas da sua lista — ${chat.name} continua vendo todas as mensagens. Ela reaparece aqui se chegar mensagem nova.`;
}

/** Mesma razão do texto acima: limpar também é pedido de dois lugares. */
export function clearHistoryMessage(chat: Chat): string {
  return `As mensagens somem apenas da sua tela — ${chat.name} continua vendo todas. A conversa fica na lista, vazia.`;
}
