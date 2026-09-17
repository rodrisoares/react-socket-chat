import { describe, expect, it } from 'vitest';

import { attachmentLabel, messagePreview } from './messagePreview';
import type { Chat, Message } from '@react-chat/shared';

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'm1',
    userId: 2,
    name: 'Marcia',
    type: 'TEXT',
    text: 'ultima mensagem',
    createdAt: '2026-01-01T10:05:00.000Z',
    isEdited: false,
    isDeleted: false,
    isForwarded: false,
    reactions: [],
    attachment: null,
    replyTo: null,
    ...overrides,
  };
}

function makeChat(overrides: Partial<Chat> = {}): Chat {
  return {
    id: 'chat-1',
    type: 'DIRECT',
    name: 'Marcia',
    isLogged: true,
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
    lastMessage: makeMessage(),
    ...overrides,
  };
}

describe('attachmentLabel', () => {
  it('nomeia foto, video e audio pelo tipo', () => {
    const image = makeMessage({
      attachment: { url: '/uploads/a.png', name: 'a.png', type: 'image/png' },
    });
    const video = makeMessage({
      attachment: { url: '/uploads/a.mp4', name: 'a.mp4', type: 'video/mp4' },
    });

    expect(attachmentLabel(image)).toBe('📷 Foto');
    expect(attachmentLabel(video)).toBe('🎬 Vídeo');
  });

  /** Nos outros tipos o nome do arquivo diz mais do que a palavra "arquivo". */
  it('usa o nome do arquivo nos demais tipos', () => {
    const pdf = makeMessage({
      attachment: { url: '/uploads/a.pdf', name: 'contrato.pdf', type: 'application/pdf' },
    });

    expect(attachmentLabel(pdf)).toBe('📎 contrato.pdf');
  });
});

describe('messagePreview', () => {
  it('prefixa "Você:" na propria mensagem', () => {
    expect(messagePreview(makeChat(), 2)).toBe('Você: ultima mensagem');
  });

  it('nao prefixa nada na conversa direta com o outro', () => {
    expect(messagePreview(makeChat(), 1)).toBe('ultima mensagem');
  });

  it('mostra quem falou no grupo', () => {
    expect(messagePreview(makeChat({ type: 'GROUP' }), 1)).toBe(
      'Marcia: ultima mensagem',
    );
  });

  /** Era o caso mudo: anexo sem texto deixava o card em branco. */
  it('descreve o anexo quando nao ha texto', () => {
    const chat = makeChat({
      lastMessage: makeMessage({
        text: '',
        attachment: { url: '/uploads/a.png', name: 'a.png', type: 'image/png' },
      }),
    });

    expect(messagePreview(chat, 1)).toBe('📷 Foto');
  });

  it('junta anexo e legenda quando ha os dois', () => {
    const chat = makeChat({
      lastMessage: makeMessage({
        text: 'olha isso',
        attachment: { url: '/uploads/a.png', name: 'a.png', type: 'image/png' },
      }),
    });

    expect(messagePreview(chat, 1)).toBe('📷 Foto · olha isso');
  });

  it('descreve a mensagem apagada', () => {
    const chat = makeChat({ lastMessage: makeMessage({ isDeleted: true, text: '' }) });
    expect(messagePreview(chat, 1)).toBe('mensagem apagada');
  });

  it('devolve vazio na conversa sem mensagem', () => {
    expect(messagePreview(makeChat({ lastMessage: null }), 1)).toBe('');
  });

  /**
   * O chamado toma o lugar do conteudo.
   *
   * Ser chamado pelo nome e mais urgente que a frase — e a frase esta a um
   * toque de distancia, enquanto o chamado, diluido no texto, passa batido numa
   * lista de conversas. Quem decide que houve mencao e o servidor, com a mesma
   * regra que decide quem notificar (ver `mentionsName`).
   */
  it('anuncia a mencao no lugar do texto', () => {
    const chat = makeChat({ type: 'GROUP', mentionsMe: true });
    expect(messagePreview(chat, 1)).toBe('Marcia mencionou você');
  });

  /**
   * Apagada vence o chamado.
   *
   * Este teste existe para fixar a ordem dos dois ramos: invertidos, o card
   * anunciaria uma mencao que sumiu junto com a mensagem — e nada mais na
   * suite acusaria isso.
   */
  it('nao anuncia mencao em mensagem apagada', () => {
    const chat = makeChat({
      type: 'GROUP',
      mentionsMe: true,
      lastMessage: makeMessage({ isDeleted: true, text: '' }),
    });

    expect(messagePreview(chat, 1)).toBe('Marcia: mensagem apagada');
  });
});
