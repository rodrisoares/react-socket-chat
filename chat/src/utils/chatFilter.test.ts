import { describe, expect, it } from 'vitest';
import filterChats from './chatFilter';
import type { Chat, Message } from '@react-chat/shared';

function makeMessage(text: string): Message {
  return {
    id: text,
    userId: 2,
    name: 'Marcia',
    type: 'TEXT',
    text,
    createdAt: '2026-01-01T10:00:00.000Z',
    isEdited: false,
    isDeleted: false,
    isForwarded: false,
    reactions: [],
    attachment: null,
    replyTo: null,
  };
}

function makeChat(name: string): Chat {
  return {
    id: name,
    type: 'DIRECT',
    name,
    isLogged: false,
    isAdmin: false,
    isPinned: false,
    isArchived: false,
    isMuted: false,
    onlyAdminsSend: false,
    isBlocked: false,
    hasLeft: false,
    participants: [1, 2],
    members: [],
    unreadMessages: 0,
    readBy: {},
    pinnedMessage: null,
    lastMessage: null,
  };
}

const chats = [makeChat('Marcia'), makeChat('Luiz')];

/**
 * Quem procura no conteúdo agora é o servidor (ver `useChatSearch` e
 * tests/search.test.ts do servidor). Aqui sobra a parte que roda a cada tecla:
 * casar pelo nome e juntar com as ocorrências que chegaram prontas.
 */
describe('filterChats', () => {
  it('devolve tudo quando o filtro esta vazio', () => {
    expect(filterChats(chats, '   ')).toHaveLength(2);
  });

  it('casa pelo nome e nao marca trecho', () => {
    const [match] = filterChats(chats, 'mar');
    expect(match?.chat.name).toBe('Marcia');
    expect(match?.matchText).toBeUndefined();
  });

  it('nao diferencia maiusculas no nome', () => {
    expect(filterChats(chats, 'MARCIA')).toHaveLength(1);
  });

  it('inclui a conversa cuja ocorrencia veio do servidor, com o trecho', () => {
    const found = filterChats(chats, 'deploy', {
      Marcia: makeMessage('subi o deploy'),
    });

    expect(found).toHaveLength(1);
    expect(found[0]?.chat.name).toBe('Marcia');
    expect(found[0]?.matchText).toBe('subi o deploy');
  });

  it('o nome tem precedencia: casando por nome, nao mostra trecho', () => {
    const found = filterChats(chats, 'marcia', {
      Marcia: makeMessage('qualquer coisa'),
    });

    expect(found[0]?.matchText).toBeUndefined();
  });

  it('sem ocorrencia e sem nome, a conversa fica de fora', () => {
    expect(filterChats(chats, 'deploy')).toHaveLength(0);
  });

  /** Armadilha herdada da busca antiga: "(" derrubava a tela com SyntaxError. */
  it('trata o filtro como texto literal', () => {
    expect(() => filterChats(chats, '(')).not.toThrow();
  });
});
