import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import MessageItem from './index';
import type { Message } from '@react-chat/shared';

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'm1',
    userId: 1,
    name: 'Luiz',
    type: 'TEXT',
    text: 'ola',
    createdAt: '2026-03-15T10:00:00.000Z',
    isEdited: false,
    isDeleted: false,
    isForwarded: false,
    reactions: [],
    attachment: null,
    replyTo: null,
    ...overrides,
  };
}

const noop = {
  onReply: vi.fn(),
  onEdit: vi.fn(),
  onDelete: vi.fn(),
};

/**
 * A mencao depende de o balao receber os nomes dos membros.
 *
 * O tokenizador ja tem testes proprios (utils/richText.test.ts) e reconhece a
 * mencao — o que estes testes vigiam e o outro lado: se a lista chega ate aqui.
 * Sao dois pontos de falha diferentes, e sem separa-los nao da para saber se um
 * destaque que nao aparece na tela e falta de estilo ou falta de dado.
 */
describe('MessageItem · menções', () => {
  it('marca a mencao a quem esta na conversa', () => {
    render(
      <MessageItem
        message={makeMessage({ text: 'oi @Marcia, viu isso?' })}
        currentUserId={1}
        isRead={false}
        names={['Marcia', 'Luiz']}
      />,
    );

    expect(screen.getByText('@Marcia')).toHaveClass('display-messages-item-mention');
  });

  /**
   * O chamado geral e destacado como se fosse mais um nome: quem passa a lista
   * acrescenta "todos" e "all" quando a conversa e grupo, e o tokenizador ja
   * sabe casar `@` seguido de um nome conhecido.
   */
  it('marca o chamado ao grupo inteiro', () => {
    render(
      <MessageItem
        message={makeMessage({ text: 'pessoal, @todos olhem isso' })}
        currentUserId={1}
        isRead={false}
        names={['Marcia', 'todos', 'all']}
      />,
    );

    expect(screen.getByText('@todos')).toHaveClass('display-messages-item-mention');
  });

  /** Sem a lista o balao nao adivinha: `@` seguido de palavra fica texto comum. */
  it('nao marca nada sem a lista de nomes', () => {
    render(
      <MessageItem
        message={makeMessage({ text: 'oi @Marcia, viu isso?' })}
        currentUserId={1}
        isRead={false}
      />,
    );

    // O texto inteiro sai num pedaco so, entao nao ha "@Marcia" isolado.
    expect(screen.queryByText('@Marcia')).toBeNull();
    expect(screen.getByText('oi @Marcia, viu isso?')).toBeInTheDocument();
  });
});

describe('MessageItem', () => {
  it('usa a classe owner quando a mensagem e do usuario logado', () => {
    const { container } = render(
      <MessageItem message={makeMessage()} currentUserId={1} isRead={false} {...noop} />,
    );
    expect(container.firstElementChild?.className).toContain(
      'display-messages-item--owner',
    );
  });

  it('usa a classe foreign quando a mensagem e de outra pessoa', () => {
    const { container } = render(
      <MessageItem message={makeMessage()} currentUserId={2} isRead={false} {...noop} />,
    );
    expect(container.firstElementChild?.className).toContain(
      'display-messages-item--foreign',
    );
  });

  it('marca "editada" so quando editedAt existe', () => {
    const { rerender } = render(
      <MessageItem message={makeMessage()} currentUserId={1} isRead={false} {...noop} />,
    );
    expect(screen.queryByText('editada')).not.toBeInTheDocument();

    rerender(
      <MessageItem
        message={makeMessage({ isEdited: true })}
        currentUserId={1}
        isRead={false}
        {...noop}
      />,
    );
    expect(screen.getByText('editada')).toBeInTheDocument();
  });

  it('esconde texto e acoes quando a mensagem foi apagada', () => {
    render(
      <MessageItem
        message={makeMessage({ isDeleted: true, text: '' })}
        currentUserId={1}
        isRead={false}
        {...noop}
      />,
    );

    expect(screen.getByText('Esta mensagem foi apagada')).toBeInTheDocument();
    expect(screen.queryByLabelText('Responder')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Apagar')).not.toBeInTheDocument();
  });

  it('mostra a citacao da mensagem respondida', () => {
    render(
      <MessageItem
        message={makeMessage({
          replyTo: {
            id: 'm0',
            name: 'Marcia',
            text: 'pergunta',
            isDeleted: false,
            attachment: null,
          },
        })}
        currentUserId={1}
        isRead={false}
        {...noop}
      />,
    );
    expect(screen.getByText('Marcia')).toBeInTheDocument();
    expect(screen.getByText('pergunta')).toBeInTheDocument();
  });

  it('mostra "mensagem apagada" na citacao de um original excluido', () => {
    render(
      <MessageItem
        message={makeMessage({
          replyTo: { id: 'm0', name: 'Marcia', text: '', isDeleted: true, attachment: null },
        })}
        currentUserId={1}
        isRead={false}
        {...noop}
      />,
    );
    expect(screen.getByText('mensagem apagada')).toBeInTheDocument();
  });

  it('oferece editar so ao autor', () => {
    const { rerender } = render(
      <MessageItem message={makeMessage()} currentUserId={1} isRead={false} {...noop} />,
    );
    expect(screen.getByLabelText('Editar')).toBeInTheDocument();

    rerender(
      <MessageItem message={makeMessage()} currentUserId={2} isRead={false} {...noop} />,
    );
    expect(screen.queryByLabelText('Editar')).not.toBeInTheDocument();
    // Responder continua disponível para todos.
    expect(screen.getByLabelText('Responder')).toBeInTheDocument();
  });

  /**
   * Apagar vale para qualquer mensagem: na dos outros ele e o "apagar para
   * mim", privado e sem tocar na conversa de ninguem. O botao ficava dentro do
   * `isMine`, e com isso o caminho — que existe no servidor e tem ate texto
   * proprio no dialogo — nao tinha porta de entrada.
   */
  it('oferece apagar tambem na mensagem de outra pessoa', () => {
    const { rerender } = render(
      <MessageItem message={makeMessage()} currentUserId={1} isRead={false} {...noop} />,
    );
    expect(screen.getByLabelText('Apagar')).toBeInTheDocument();

    rerender(
      <MessageItem message={makeMessage()} currentUserId={2} isRead={false} {...noop} />,
    );
    // O rotulo muda junto com o alcance: na dos outros so da para apagar para si.
    expect(screen.getByLabelText('Apagar para mim')).toBeInTheDocument();
  });

  it('dispara onDelete com a mensagem clicada', async () => {
    const onDelete = vi.fn();
    const message = makeMessage();
    render(
      <MessageItem
        message={message}
        currentUserId={1}
        isRead={false}
        onReply={vi.fn()}
        onEdit={vi.fn()}
        onDelete={onDelete}
      />,
    );

    await userEvent.click(screen.getByLabelText('Apagar'));
    expect(onDelete).toHaveBeenCalledWith(message);
  });

  it('troca o recibo de enviada para lida', () => {
    const { rerender } = render(
      <MessageItem message={makeMessage()} currentUserId={1} isRead={false} {...noop} />,
    );
    expect(screen.getByTitle('Enviada')).toBeInTheDocument();

    rerender(
      <MessageItem message={makeMessage()} currentUserId={1} isRead {...noop} />,
    );
    expect(screen.getByTitle('Lida')).toBeInTheDocument();
  });

  it('nao mostra recibo em mensagem de outra pessoa', () => {
    render(
      <MessageItem message={makeMessage()} currentUserId={2} isRead {...noop} />,
    );
    expect(screen.queryByTitle('Lida')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Enviada')).not.toBeInTheDocument();
  });

  it('renderiza imagem quando o anexo e imagem', () => {
    render(
      <MessageItem
        message={makeMessage({
          attachment: { url: '/uploads/a.png', name: 'a.png', type: 'image/png' },
        })}
        currentUserId={1}
        isRead={false}
        {...noop}
      />,
    );
    expect(screen.getByAltText('a.png')).toBeInTheDocument();
  });

  it('renderiza link com o nome quando o anexo nao e imagem', () => {
    render(
      <MessageItem
        message={makeMessage({
          attachment: { url: '/uploads/a.pdf', name: 'contrato.pdf', type: 'application/pdf' },
        })}
        currentUserId={1}
        isRead={false}
        {...noop}
      />,
    );
    expect(screen.getByText('contrato.pdf')).toBeInTheDocument();
    expect(screen.queryByAltText('contrato.pdf')).not.toBeInTheDocument();
  });
});

describe('MessageItem · reações', () => {
  it('mostra o emoji com a contagem', () => {
    render(
      <MessageItem
        message={makeMessage({ reactions: [{ emoji: '👍', userIds: [2, 3] }] })}
        currentUserId={1}
        isRead={false}
      />,
    );

    expect(screen.getByLabelText('👍, 2')).toBeInTheDocument();
  });

  it('destaca a reação de quem está lendo', () => {
    render(
      <MessageItem
        message={makeMessage({ reactions: [{ emoji: '👍', userIds: [1] }] })}
        currentUserId={1}
        isRead={false}
        onReact={vi.fn()}
      />,
    );

    // Sem `nameOf`, o unico nome que o balao resolve sozinho e o de quem le.
    expect(screen.getByLabelText('Você reagiu com 👍').className).toContain('is-mine');
  });

  it('nao destaca a reação de outra pessoa', () => {
    render(
      <MessageItem
        message={makeMessage({ reactions: [{ emoji: '👍', userIds: [2] }] })}
        currentUserId={1}
        isRead={false}
        onReact={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('👍, 1').className).not.toContain('is-mine');
  });

  /**
   * A contagem sozinha dizia que tres pessoas reagiram, e nao quem. O nome vem
   * da conversa, pelo `nameOf`: dentro do balao nao ha largura para uma lista
   * de gente, entao ele vive no rotulo acessivel e na dica do mouse.
   */
  it('diz quem reagiu, pelo nome', () => {
    render(
      <MessageItem
        message={makeMessage({ reactions: [{ emoji: '👍', userIds: [1, 2] }] })}
        currentUserId={1}
        isRead={false}
        onReact={vi.fn()}
        nameOf={(id) => (id === 2 ? 'Marcia' : undefined)}
      />,
    );

    expect(screen.getByLabelText('Você, Marcia reagiram com 👍')).toBeInTheDocument();
  });

  /** Sem quem traduza o id em nome, resta a contagem — e ela nao pode sumir. */
  it('cai na contagem quando o nome nao resolve', () => {
    render(
      <MessageItem
        message={makeMessage({ reactions: [{ emoji: '🎉', userIds: [2, 3] }] })}
        currentUserId={1}
        isRead={false}
        onReact={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('🎉, 2')).toBeInTheDocument();
  });

  /** A regra escolhida: clicar na própria reação remove, e o emoji vazio diz isso. */
  it('clicar na propria reação pede a remoção', async () => {
    const onReact = vi.fn();
    const message = makeMessage({ reactions: [{ emoji: '👍', userIds: [1] }] });

    render(
      <MessageItem
        message={message}
        currentUserId={1}
        isRead={false}
        onReact={onReact}
      />,
    );

    await userEvent.click(screen.getByLabelText('Você reagiu com 👍'));
    expect(onReact).toHaveBeenCalledWith(message, '');
  });

  it('clicar na reação de outro adiciona a minha', async () => {
    const onReact = vi.fn();
    const message = makeMessage({ reactions: [{ emoji: '👍', userIds: [2] }] });

    render(
      <MessageItem
        message={message}
        currentUserId={1}
        isRead={false}
        onReact={onReact}
      />,
    );

    await userEvent.click(screen.getByLabelText('👍, 1'));
    expect(onReact).toHaveBeenCalledWith(message, '👍');
  });

  /**
   * A lista de mensagens é virtualizada e recorta o que passa da linha: um
   * painel desenhado dentro do balão nasce cortado.
   */
  it('o painel sai da mensagem por um portal', async () => {
    const { container } = render(
      <MessageItem
        message={makeMessage()}
        currentUserId={1}
        isRead={false}
        onReact={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByLabelText('Reagir'));
    // Espera o chunk do seletor chegar antes de procurar onde ele foi parar.
    // O prazo e maior que o padrao de propósito: o emoji-mart tem meio
    // megabyte, e carrega-lo e inicializa-lo dentro do jsdom encosta no limite
    // de 1s — com isso o teste falhava ou passava conforme a maquina.
    await screen.findByRole('dialog', { name: 'Escolher emoji' }, { timeout: 5000 });

    expect(container.querySelector('.emoji-picker')).not.toBeInTheDocument();
    expect(document.body.querySelector('.emoji-picker--floating')).toBeInTheDocument();
  });

  /**
   * Eram 32 emojis fixos, desenhados por nos, e o painel se reconhecia pelos
   * rotulos "Reagir com X" que punhamos em cada botao. O seletor agora e o
   * emoji-mart, com o conjunto Unicode inteiro, e os botoes sao dele — nao ha
   * mais duas listas que possam divergir. O que continua sendo nosso, e o que
   * este teste cobra, e que o painel so apareca depois do clique no gatilho.
   */
  it('a barra de emojis so abre no botao Reagir', async () => {
    render(
      <MessageItem
        message={makeMessage()}
        currentUserId={1}
        isRead={false}
        onReact={vi.fn()}
      />,
    );

    expect(screen.queryByRole('dialog', { name: 'Escolher emoji' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByLabelText('Reagir'));

    // `findBy`, e nao `getBy`: o seletor vive num chunk proprio e chega um
    // tique depois do clique — com prazo folgado, porque esse chunk e grande
    // (ver o comentario no teste do portal).
    expect(
      await screen.findByRole('dialog', { name: 'Escolher emoji' }, { timeout: 5000 }),
    ).toBeInTheDocument();
  });

  it('sem onReact as reações ficam so para leitura', () => {
    render(
      <MessageItem
        message={makeMessage({ reactions: [{ emoji: '👍', userIds: [2] }] })}
        currentUserId={1}
        isRead={false}
      />,
    );

    expect(screen.getByLabelText('👍, 1')).toBeDisabled();
    expect(screen.queryByLabelText('Reagir')).not.toBeInTheDocument();
  });

  it('mostra o rotulo de encaminhada', () => {
    render(
      <MessageItem
        message={makeMessage({ isForwarded: true })}
        currentUserId={1}
        isRead={false}
      />,
    );

    expect(screen.getByText('Encaminhada')).toBeInTheDocument();
  });

  it('mensagem apagada nao oferece encaminhar nem reagir', () => {
    render(
      <MessageItem
        message={makeMessage({ isDeleted: true })}
        currentUserId={1}
        isRead={false}
        onReact={vi.fn()}
        onForward={vi.fn()}
      />,
    );

    expect(screen.queryByLabelText('Reagir')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Encaminhar')).not.toBeInTheDocument();
  });
});

describe('MessageItem · recibo por participante', () => {
  it('em conversa direta o recibo continua so o icone', () => {
    render(
      <MessageItem
        message={makeMessage()}
        currentUserId={1}
        isRead
        receipt={{ readers: ['Marcia'], pending: [] }}
      />,
    );

    expect(screen.getByTitle('Lida')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Lida por/)).not.toBeInTheDocument();
  });

  it('em grupo mostra quantos leram', () => {
    render(
      <MessageItem
        message={makeMessage()}
        currentUserId={1}
        isRead={false}
        receipt={{ readers: ['Marcia'], pending: ['Luiz', 'Ana'] }}
      />,
    );

    expect(screen.getByLabelText('Lida por 1 de 3')).toBeInTheDocument();
    expect(screen.getByText('1/3')).toBeInTheDocument();
  });

  it('abre a lista de quem leu e de quem falta', async () => {
    const { container } = render(
      <MessageItem
        message={makeMessage()}
        currentUserId={1}
        isRead={false}
        receipt={{ readers: ['Marcia'], pending: ['Luiz'] }}
      />,
    );

    await userEvent.click(screen.getByLabelText('Lida por 1 de 2'));

    // Dentro do painel, e nao na mensagem: o autor do balao tambem se chama
    // Luiz, e um getByText solto acharia os dois.
    const panel = container.querySelector('.display-messages-item-readers');
    expect(panel?.textContent).toContain('Lida por Marcia');
    expect(panel?.textContent).toContain('Falta Luiz');
  });

  it('diz quando ninguem leu ainda', async () => {
    render(
      <MessageItem
        message={makeMessage()}
        currentUserId={1}
        isRead={false}
        receipt={{ readers: [], pending: ['Luiz', 'Ana'] }}
      />,
    );

    await userEvent.click(screen.getByLabelText('Lida por 0 de 2'));
    expect(screen.getByText(/ninguém ainda/)).toBeInTheDocument();
  });

  /** O recibo e de quem enviou: na mensagem dos outros ele nao existe. */
  it('nao mostra recibo detalhado na mensagem de outra pessoa', () => {
    render(
      <MessageItem
        message={makeMessage()}
        currentUserId={2}
        isRead
        receipt={{ readers: ['Marcia'], pending: ['Luiz'] }}
      />,
    );

    expect(screen.queryByLabelText(/Lida por/)).not.toBeInTheDocument();
  });
});

describe('MessageItem · mídia', () => {
  it('abre o visor ao clicar na imagem', async () => {
    const onOpenMedia = vi.fn();
    const message = makeMessage({
      attachment: { url: '/uploads/a.png', name: 'a.png', type: 'image/png' },
    });

    render(
      <MessageItem
        message={message}
        currentUserId={1}
        isRead={false}
        onOpenMedia={onOpenMedia}
      />,
    );

    await userEvent.click(screen.getByLabelText('Abrir a.png'));
    expect(onOpenMedia).toHaveBeenCalledWith(message);
  });

  /** Sem o visor (conversa so de leitura) a imagem volta a ser um link. */
  it('sem onOpenMedia a imagem fica como link', () => {
    render(
      <MessageItem
        message={makeMessage({
          attachment: { url: '/uploads/a.png', name: 'a.png', type: 'image/png' },
        })}
        currentUserId={1}
        isRead={false}
      />,
    );

    expect(screen.queryByLabelText('Abrir a.png')).not.toBeInTheDocument();
    expect(screen.getByAltText('a.png')).toBeInTheDocument();
  });

  it('toca o video no proprio balao', () => {
    const { container } = render(
      <MessageItem
        message={makeMessage({
          attachment: { url: '/uploads/a.mp4', name: 'a.mp4', type: 'video/mp4' },
        })}
        currentUserId={1}
        isRead={false}
        onOpenMedia={vi.fn()}
      />,
    );

    expect(container.querySelector('video')).toBeInTheDocument();
    expect(screen.getByLabelText('Abrir vídeo em tela cheia')).toBeInTheDocument();
  });
});

describe('MessageItem · salto pela citação', () => {
  const quoted = {
    id: 'm0',
    name: 'Marcia',
    text: 'pergunta',
    isDeleted: false,
    attachment: null,
  };

  it('a citação leva à mensagem original', async () => {
    const onJumpTo = vi.fn();

    render(
      <MessageItem
        message={makeMessage({ replyTo: quoted })}
        currentUserId={1}
        isRead={false}
        onJumpTo={onJumpTo}
      />,
    );

    await userEvent.click(screen.getByLabelText('Ir para a mensagem de Marcia'));
    expect(onJumpTo).toHaveBeenCalledWith('m0');
  });

  /** Era o estado anterior de todas as citações: mostrava e não levava a nada. */
  it('sem onJumpTo a citação continua decorativa', () => {
    render(
      <MessageItem
        message={makeMessage({ replyTo: quoted })}
        currentUserId={1}
        isRead={false}
      />,
    );

    expect(screen.queryByLabelText(/Ir para a mensagem/)).not.toBeInTheDocument();
    expect(screen.getByText('pergunta')).toBeInTheDocument();
  });

  /** Saltar para uma mensagem apagada não mostraria nada: não vira botão. */
  it('citação de mensagem apagada não leva a lugar nenhum', () => {
    render(
      <MessageItem
        message={makeMessage({
          replyTo: { id: 'm0', name: 'Marcia', text: '', isDeleted: true, attachment: null },
        })}
        currentUserId={1}
        isRead={false}
        onJumpTo={vi.fn()}
      />,
    );

    expect(screen.queryByLabelText(/Ir para a mensagem/)).not.toBeInTheDocument();
    expect(screen.getByText('mensagem apagada')).toBeInTheDocument();
  });

  it('destaca o balão quando ele é o alvo', () => {
    const { container, rerender } = render(
      <MessageItem message={makeMessage()} currentUserId={1} isRead={false} />,
    );
    expect(container.firstElementChild?.className).not.toContain('is-highlighted');

    rerender(
      <MessageItem message={makeMessage()} currentUserId={1} isRead={false} isHighlighted />,
    );
    expect(container.firstElementChild?.className).toContain('is-highlighted');
  });
});

describe('MessageItem · destaque da busca', () => {
  it('marca a ocorrência dentro do texto', () => {
    const { container } = render(
      <MessageItem
        message={makeMessage({ text: 'subi o deploy hoje' })}
        currentUserId={1}
        isRead={false}
        highlight='deploy'
      />,
    );

    const marks = container.querySelectorAll('mark');
    expect(marks).toHaveLength(1);
    expect(marks[0]?.textContent).toBe('deploy');
  });

  it('sem termo nenhum o texto fica inteiro e sem marca', () => {
    const { container } = render(
      <MessageItem
        message={makeMessage({ text: 'subi o deploy hoje' })}
        currentUserId={1}
        isRead={false}
      />,
    );

    expect(container.querySelectorAll('mark')).toHaveLength(0);
    expect(screen.getByText('subi o deploy hoje')).toBeInTheDocument();
  });
});

describe('MessageItem · citação com anexo', () => {
  const foto = { url: '/uploads/a.png', name: 'a.png', type: 'image/png' };

  /** Mensagem só com anexo tem texto vazio: a citação ficava muda. */
  it('descreve o anexo quando a mensagem citada não tem texto', () => {
    render(
      <MessageItem
        message={makeMessage({
          replyTo: {
            id: 'm0',
            name: 'Marcia',
            text: '',
            isDeleted: false,
            attachment: foto,
          },
        })}
        currentUserId={1}
        isRead={false}
      />,
    );

    expect(screen.getByText('📷 Foto')).toBeInTheDocument();
  });

  it('mostra a miniatura da imagem citada', () => {
    const { container } = render(
      <MessageItem
        message={makeMessage({
          replyTo: {
            id: 'm0',
            name: 'Marcia',
            text: '',
            isDeleted: false,
            attachment: foto,
          },
        })}
        currentUserId={1}
        isRead={false}
      />,
    );

    expect(
      container.querySelector('.display-messages-item-reply-thumb'),
    ).toBeInTheDocument();
  });

  /** Com legenda, quem manda é a legenda: o rótulo seria redundante. */
  it('prefere a legenda ao rótulo do anexo', () => {
    render(
      <MessageItem
        message={makeMessage({
          replyTo: {
            id: 'm0',
            name: 'Marcia',
            text: 'olha isso',
            isDeleted: false,
            attachment: foto,
          },
        })}
        currentUserId={1}
        isRead={false}
      />,
    );

    expect(screen.getByText('olha isso')).toBeInTheDocument();
    expect(screen.queryByText('📷 Foto')).not.toBeInTheDocument();
  });

  it('anexo comum aparece pelo nome do arquivo', () => {
    render(
      <MessageItem
        message={makeMessage({
          replyTo: {
            id: 'm0',
            name: 'Marcia',
            text: '',
            isDeleted: false,
            attachment: {
              url: '/uploads/a.pdf',
              name: 'contrato.pdf',
              type: 'application/pdf',
            },
          },
        })}
        currentUserId={1}
        isRead={false}
      />,
    );

    expect(screen.getByText('📎 contrato.pdf')).toBeInTheDocument();
  });
});
