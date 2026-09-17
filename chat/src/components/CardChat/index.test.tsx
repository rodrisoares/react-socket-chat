import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import CardChat from './index';
import type { Chat } from '@react-chat/shared';

function makeChat(overrides: Partial<Chat> = {}): Chat {
  return {
    id: 'chat-1',
    type: 'DIRECT',
    name: 'Marcia',
    image: 'https://exemplo.test/avatar.png',
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
    // Só a última: o card mostra a prévia, e o histórico não vem mais na lista.
    lastMessage: {
      id: 'm2',
      userId: 2,
      name: 'Marcia',
      type: 'TEXT',
      text: 'ultima mensagem',
      // Montada no fuso local, e antiga de propósito: o card escolhe o formato
      // pela idade da mensagem, e cada faixa tem o seu teste logo abaixo.
      createdAt: new Date(2026, 0, 1, 10, 5).toISOString(),
      isEdited: false,
      isDeleted: false,
      isForwarded: false,
      reactions: [],
      attachment: null,
      replyTo: null,
    },
    ...overrides,
  };
}

/**
 * A última mensagem do fixture, com o instante que o teste precisa.
 *
 * As datas são relativas a agora, e não fixas: o card mostra a hora, "Ontem",
 * o dia da semana ou a data conforme a idade da mensagem, então uma data
 * cravada no calendário mudaria de faixa sozinha com o passar do tempo.
 */
function lastMessageAt(date: Date): Chat['lastMessage'] {
  const { lastMessage } = makeChat();
  return lastMessage ? { ...lastMessage, createdAt: date.toISOString() } : null;
}

describe('CardChat', () => {
  it('mostra o nome e a previa da ultima mensagem', () => {
    render(<CardChat chat={makeChat()} onClick={vi.fn()} />);

    expect(screen.getByText('Marcia')).toBeInTheDocument();
    expect(screen.getByText('ultima mensagem')).toBeInTheDocument();
  });

  it('mostra a hora quando a ultima mensagem e de hoje', () => {
    const hoje = new Date();
    hoje.setHours(10, 5, 0, 0);

    render(
      <CardChat chat={makeChat({ lastMessage: lastMessageAt(hoje) })} onClick={vi.fn()} />,
    );

    expect(screen.getByText('10:05')).toBeInTheDocument();
  });

  it('diz "Ontem" na mensagem do dia anterior', () => {
    const ontem = new Date();
    ontem.setDate(ontem.getDate() - 1);

    render(
      <CardChat chat={makeChat({ lastMessage: lastMessageAt(ontem) })} onClick={vi.fn()} />,
    );

    expect(screen.getByText('Ontem')).toBeInTheDocument();
  });

  /** "09:14" num card de um mes atras nao diz nada: ali a data e que situa. */
  it('usa a data quando a ultima mensagem passou da semana', () => {
    const antiga = new Date();
    antiga.setDate(antiga.getDate() - 30);

    render(
      <CardChat chat={makeChat({ lastMessage: lastMessageAt(antiga) })} onClick={vi.fn()} />,
    );

    // O formato, e nao a string exata: fixa-la seria reimplementar o
    // formatador dentro do teste.
    expect(screen.getByText(/^\d{2}\/\d{2}$/)).toBeInTheDocument();
  });

  it('exibe o contador de nao lidas quando ha alguma', () => {
    render(<CardChat chat={makeChat({ unreadMessages: 3 })} onClick={vi.fn()} />);
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('esconde o contador quando esta zerado', () => {
    render(<CardChat chat={makeChat({ unreadMessages: 0 })} onClick={vi.fn()} />);
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('chama onClick com a conversa ao ser clicado', async () => {
    const onClick = vi.fn();
    const chat = makeChat();
    render(<CardChat chat={chat} onClick={onClick} />);

    await userEvent.click(screen.getByRole('button'));

    expect(onClick).toHaveBeenCalledWith(chat);
  });

  /** Era uma div sem role nem tabIndex: inalcançável por teclado. */
  it('e acessivel por teclado com Enter e espaco', async () => {
    const onClick = vi.fn();
    render(<CardChat chat={makeChat()} onClick={onClick} />);

    const card = screen.getByRole('button');
    card.focus();
    expect(card).toHaveFocus();

    await userEvent.keyboard('{Enter}');
    expect(onClick).toHaveBeenCalledTimes(1);

    await userEvent.keyboard(' ');
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  /**
   * O nome longo quebrava em duas linhas e invadia a mensagem abaixo.
   * O consertoem si é CSS — e o Vitest não carrega o SCSS no jsdom, então
   * getComputedStyle aqui não provaria nada. Aqui fica só o que o DOM garante:
   * nome e mensagem em nós separados, cada um no seu lugar.
   */
  it('mantem nome e ultima mensagem em elementos separados', () => {
    const { container } = render(
      <CardChat
        chat={makeChat({ name: 'Time do Chat — Migração e Arquitetura' })}
        onClick={vi.fn()}
      />,
    );

    const name = container.querySelector('.cardChat-content-name');
    const message = container.querySelector('.cardChat-content-message');

    expect(name?.textContent).toBe('Time do Chat — Migração e Arquitetura');
    expect(message?.textContent).toBe('ultima mensagem');
    expect(name?.contains(message ?? null)).toBe(false);
  });

  it('aguenta conversa sem nenhuma mensagem', () => {
    expect(() =>
      render(<CardChat chat={makeChat({ lastMessage: null })} onClick={vi.fn()} />),
    ).not.toThrow();
  });

  /** Sem os handlers o card fica como era: um botão só, sem menu. */
  it('so mostra o menu quando recebe as acoes de leitura', () => {
    const { rerender } = render(<CardChat chat={makeChat()} onClick={vi.fn()} />);
    expect(screen.queryByLabelText(/Opcoes da conversa|Opções da conversa/)).toBeNull();

    rerender(
      <CardChat
        chat={makeChat()}
        onClick={vi.fn()}
        onMarkRead={vi.fn()}
        onMarkUnread={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Opções da conversa com Marcia')).toBeInTheDocument();
  });

  it('marca como nao lida sem abrir a conversa', async () => {
    const onClick = vi.fn();
    const onMarkUnread = vi.fn();
    const chat = makeChat({ unreadMessages: 0 });

    render(
      <CardChat
        chat={chat}
        onClick={onClick}
        onMarkRead={vi.fn()}
        onMarkUnread={onMarkUnread}
      />,
    );

    await userEvent.click(screen.getByLabelText('Opções da conversa com Marcia'));
    await userEvent.click(screen.getByRole('menuitem', { name: /não lida/ }));

    expect(onMarkUnread).toHaveBeenCalledWith(chat);
    // O card inteiro é clicável: o menu não pode disparar a seleção junto.
    expect(onClick).not.toHaveBeenCalled();
  });

  it('oferece "marcar como lida" quando ha nao lidas', async () => {
    const onMarkRead = vi.fn();
    const chat = makeChat({ unreadMessages: 2 });

    render(
      <CardChat
        chat={chat}
        onClick={vi.fn()}
        onMarkRead={onMarkRead}
        onMarkUnread={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByLabelText('Opções da conversa com Marcia'));
    await userEvent.click(screen.getByRole('menuitem', { name: /Marcar como lida/ }));

    expect(onMarkRead).toHaveBeenCalledWith(chat);
  });

  it('abre o menu com o clique direito no card', () => {
    const { container } = render(
      <CardChat
        chat={makeChat()}
        onClick={vi.fn()}
        onMarkRead={vi.fn()}
        onMarkUnread={vi.fn()}
      />,
    );

    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.contextMenu(container.querySelector('.cardChat-wrapper') as Element);
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('destaca a conversa aberta', () => {
    const { container, rerender } = render(
      <CardChat chat={makeChat()} onClick={vi.fn()} />,
    );
    expect(container.querySelector('.is-active')).toBeNull();

    rerender(<CardChat chat={makeChat()} onClick={vi.fn()} isActive />);
    expect(container.querySelector('.is-active')).not.toBeNull();
    expect(screen.getByRole('button')).toHaveAttribute('aria-current', 'true');
  });

  it('troca a previa por "digitando" enquanto alguem escreve', () => {
    render(
      <CardChat chat={makeChat()} onClick={vi.fn()} typingLabel='digitando…' />,
    );

    expect(screen.getByText('digitando…')).toBeInTheDocument();
    expect(screen.queryByText('ultima mensagem')).not.toBeInTheDocument();
  });

  it('prefixa "Voce:" quando a ultima mensagem e sua', () => {
    const chat = makeChat();
    render(<CardChat chat={chat} onClick={vi.fn()} myId={2} />);
    expect(screen.getByText('Você: ultima mensagem')).toBeInTheDocument();
  });

  it('nao prefixa quando a ultima mensagem e do outro', () => {
    render(<CardChat chat={makeChat()} onClick={vi.fn()} myId={1} />);
    expect(screen.getByText('ultima mensagem')).toBeInTheDocument();
  });

  it('mostra o trecho que casou com a busca no lugar da ultima mensagem', () => {
    render(
      <CardChat chat={makeChat()} onClick={vi.fn()} matchText='subi o deploy' />,
    );

    expect(screen.getByText('subi o deploy')).toBeInTheDocument();
    expect(screen.queryByText('ultima mensagem')).not.toBeInTheDocument();
  });

  it('fixa e desafixa pelo menu', async () => {
    const onTogglePin = vi.fn();
    const chat = makeChat({ isPinned: false });

    const { rerender } = render(
      <CardChat
        chat={chat}
        onClick={vi.fn()}
        onMarkRead={vi.fn()}
        onMarkUnread={vi.fn()}
        onTogglePin={onTogglePin}
      />,
    );

    await userEvent.click(screen.getByLabelText('Opções da conversa com Marcia'));
    await userEvent.click(screen.getByRole('menuitem', { name: /Fixar no topo/ }));
    expect(onTogglePin).toHaveBeenCalledWith(chat);

    const fixada = makeChat({ isPinned: true });
    rerender(
      <CardChat
        chat={fixada}
        onClick={vi.fn()}
        onMarkRead={vi.fn()}
        onMarkUnread={vi.fn()}
        onTogglePin={onTogglePin}
      />,
    );

    await userEvent.click(screen.getByLabelText('Opções da conversa com Marcia'));
    expect(screen.getByRole('menuitem', { name: /Desafixar/ })).toBeInTheDocument();
  });

  it('so mostra o botao de desarquivar quando a conversa esta arquivada', () => {
    const { rerender } = render(
      <CardChat chat={makeChat()} onClick={vi.fn()} onToggleArchive={vi.fn()} />,
    );
    expect(
      screen.queryByLabelText('Desarquivar conversa com Marcia'),
    ).not.toBeInTheDocument();

    rerender(
      <CardChat
        chat={makeChat({ isArchived: true })}
        onClick={vi.fn()}
        onToggleArchive={vi.fn()}
      />,
    );
    expect(
      screen.getByLabelText('Desarquivar conversa com Marcia'),
    ).toBeInTheDocument();
  });

  it('desarquiva pelo botao sem abrir a conversa', async () => {
    const onToggleArchive = vi.fn();
    const onClick = vi.fn();
    const chat = makeChat({ isArchived: true });

    render(
      <CardChat chat={chat} onClick={onClick} onToggleArchive={onToggleArchive} />,
    );

    await userEvent.click(screen.getByLabelText('Desarquivar conversa com Marcia'));
    expect(onToggleArchive).toHaveBeenCalledWith(chat);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('limpar e excluir so aparecem no menu quando ha o que fazer', async () => {
    const onClearHistory = vi.fn();
    const chat = makeChat();

    render(
      <CardChat
        chat={chat}
        onClick={vi.fn()}
        onMarkRead={vi.fn()}
        onMarkUnread={vi.fn()}
        onClearHistory={onClearHistory}
      />,
    );

    await userEvent.click(screen.getByLabelText('Opções da conversa com Marcia'));
    // Sem onDelete o item nao existe; limpar veio, entao esta la.
    expect(
      screen.queryByRole('menuitem', { name: /Excluir conversa/ }),
    ).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('menuitem', { name: /Limpar conversa/ }));
    expect(onClearHistory).toHaveBeenCalledWith(chat);
  });

  it('nao oferece excluir em grupo de que o usuario ainda participa', async () => {
    render(
      <CardChat
        chat={makeChat({ type: 'GROUP', hasLeft: false })}
        onClick={vi.fn()}
        onMarkRead={vi.fn()}
        onMarkUnread={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByLabelText('Opções da conversa com Marcia'));
    expect(
      screen.queryByRole('menuitem', { name: /Excluir conversa/ }),
    ).not.toBeInTheDocument();
  });

  it('oferece excluir depois que o usuario saiu do grupo', async () => {
    const onDelete = vi.fn();
    const chat = makeChat({ type: 'GROUP', hasLeft: true });

    render(
      <CardChat
        chat={chat}
        onClick={vi.fn()}
        onMarkRead={vi.fn()}
        onMarkUnread={vi.fn()}
        onDelete={onDelete}
      />,
    );

    await userEvent.click(screen.getByLabelText('Opções da conversa com Marcia'));
    await userEvent.click(screen.getByRole('menuitem', { name: /Excluir conversa/ }));
    expect(onDelete).toHaveBeenCalledWith(chat);
  });
});

/**
 * O gesto do toque: arrastar para a esquerda arquiva, para a direita silencia.
 * O jsdom nao tem toque de verdade, entao o teste dispara os eventos na mao —
 * o que se garante aqui e a regra do limiar e da direcao, nao a animacao.
 */
describe('CardChat · gesto no toque', () => {
  function swipe(element: Element, deltaX: number, deltaY = 0) {
    fireEvent.touchStart(element, { touches: [{ clientX: 120, clientY: 200 }] });
    fireEvent.touchMove(element, {
      touches: [{ clientX: 120 + deltaX, clientY: 200 + deltaY }],
    });
    fireEvent.touchEnd(element);
  }

  it('arrastar para a esquerda arquiva', () => {
    const onToggleArchive = vi.fn();
    const chat = makeChat();
    const { container } = render(
      <CardChat chat={chat} onClick={vi.fn()} onToggleArchive={onToggleArchive} />,
    );

    swipe(container.querySelector('.cardChat-wrapper') as Element, -90);
    expect(onToggleArchive).toHaveBeenCalledWith(chat);
  });

  it('arrastar para a direita silencia', () => {
    const onToggleMute = vi.fn();
    const chat = makeChat();
    const { container } = render(
      <CardChat chat={chat} onClick={vi.fn()} onToggleMute={onToggleMute} />,
    );

    swipe(container.querySelector('.cardChat-wrapper') as Element, 90);
    expect(onToggleMute).toHaveBeenCalledWith(chat);
  });

  it('um arrasto curto nao dispara nada', () => {
    const onToggleArchive = vi.fn();
    const { container } = render(
      <CardChat chat={makeChat()} onClick={vi.fn()} onToggleArchive={onToggleArchive} />,
    );

    swipe(container.querySelector('.cardChat-wrapper') as Element, -20);
    expect(onToggleArchive).not.toHaveBeenCalled();
  });

  /** Rolar a lista e movimento vertical: o card nao pode reagir a ele. */
  it('movimento vertical nao dispara acao', () => {
    const onToggleArchive = vi.fn();
    const { container } = render(
      <CardChat chat={makeChat()} onClick={vi.fn()} onToggleArchive={onToggleArchive} />,
    );

    swipe(container.querySelector('.cardChat-wrapper') as Element, -90, -140);
    expect(onToggleArchive).not.toHaveBeenCalled();
  });
});

/**
 * O menu sai da arvore do card.
 *
 * A lista de conversas rola (`overflow-y: auto` em `.home-chat-list`), e um
 * descendente `absolute` e recortado por qualquer ancestral com overflow: nas
 * conversas do fim da lista o menu abria para baixo e perdia os ultimos itens
 * — limpar e excluir — na borda do container.
 *
 * jsdom nao calcula layout, entao nao da para medir recorte aqui. O que da para
 * garantir e a condicao que o evita: que o menu nao esteja dentro do card.
 */
describe('CardChat · menu flutuante', () => {
  it('renderiza o menu fora da arvore do card', async () => {
    const { container } = render(
      <CardChat
        chat={makeChat()}
        onClick={vi.fn()}
        onMarkRead={vi.fn()}
        onMarkUnread={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /Opções da conversa/ }));

    const menu = screen.getByRole('menu');
    expect(menu).toBeInTheDocument();
    expect(container).not.toContainElement(menu);
  });

  /** Portado, um clique num item deixaria de ser "dentro" — e fecharia antes de agir. */
  it('nao fecha ao clicar num item do proprio menu', async () => {
    const onMarkUnread = vi.fn();

    render(
      <CardChat
        chat={makeChat({ unreadMessages: 0 })}
        onClick={vi.fn()}
        onMarkRead={vi.fn()}
        onMarkUnread={onMarkUnread}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /Opções da conversa/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Marcar como não lida/ }));

    expect(onMarkUnread).toHaveBeenCalled();
  });
});

describe('CardChat · prévia e silenciada', () => {
  /**
   * O "@" antes da previa, quando a ultima mensagem chama voce pelo nome.
   *
   * A afirmacao e sobre o `<em>` do proprio "@", e nao sobre a frase inteira:
   * "mencionou voce" aparece tambem no texto dos elementos ancestrais, e o
   * matcher acusaria multiplos resultados.
   */
  it('marca a previa quando a mensagem menciona voce', () => {
    render(
      <CardChat chat={makeChat({ type: 'GROUP', mentionsMe: true })} onClick={vi.fn()} />,
    );

    expect(screen.getByText('@')).toHaveClass('cardChat-content-mention');
  });

  /**
   * Sem mencao, nenhum rotulo: e o estado em que o card passa a maior parte do
   * tempo, e e ele que quebraria se o ramo fosse invertido por engano.
   */
  it('nao marca a previa sem mencao', () => {
    render(<CardChat chat={makeChat({ type: 'GROUP' })} onClick={vi.fn()} />);

    expect(screen.queryByText('@')).toBeNull();
  });

  it('descreve o anexo quando a mensagem nao tem texto', () => {
    const chat = makeChat({
      lastMessage: {
        id: 'm3',
        userId: 2,
        name: 'Marcia',
        type: 'TEXT',
        text: '',
        createdAt: '2026-01-01T10:06:00.000Z',
        isEdited: false,
        isDeleted: false,
        isForwarded: false,
        reactions: [],
        attachment: { url: '/uploads/a.png', name: 'a.png', type: 'image/png' },
        replyTo: null,
      },
    });

    render(<CardChat chat={chat} onClick={vi.fn()} myId={1} />);
    expect(screen.getByText('📷 Foto')).toBeInTheDocument();
  });

  it('apaga o laranja do contador em conversa silenciada', () => {
    const { container } = render(
      <CardChat chat={makeChat({ unreadMessages: 2, isMuted: true })} onClick={vi.fn()} />,
    );

    expect(container.querySelector('.cardChat-metadata-unread')?.className).toContain(
      'is-muted',
    );
  });

  it('marca o card como nao lido', () => {
    const { container } = render(
      <CardChat chat={makeChat({ unreadMessages: 1 })} onClick={vi.fn()} />,
    );

    expect(container.querySelector('.cardChat-wrapper')?.className).toContain(
      'is-unread',
    );
  });
});
