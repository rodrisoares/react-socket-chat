import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';

import NewChatModal from './index';
import type { Chat, User } from '@react-chat/shared';

const get = vi.fn();
const post = vi.fn();
const reloadChats = vi.fn();

vi.mock('config/fetchInstance', () => ({
  default: {
    get: (url: string) => get(url) as Promise<{ data: unknown }>,
    post: (url: string, payload?: unknown) =>
      post(url, payload) as Promise<{ data: unknown }>,
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('hooks/chatList', () => ({
  default: () => ({ reloadChats: () => reloadChats() as Promise<Chat[]> }),
}));

// A busca de contatos so dispara com sessao — ver `hasSession` em config/auth.
vi.mock('config/auth', () => ({
  hasSession: () => true,
  getToken: () => 'token-de-teste',
}));

const contatos: User[] = [
  { id: 2, name: 'Marcia', isOnline: true },
  { id: 3, name: 'Joao', isOnline: false },
];

function renderModal(element: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{element}</QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  get.mockResolvedValue({ data: contatos });
  reloadChats.mockResolvedValue([]);
});

/** Abre o modal, entra no modo grupo e escolhe a Marcia. */
async function escolherMarcia() {
  renderModal(<NewChatModal onClose={vi.fn()} onCreated={vi.fn()} />);

  await userEvent.click(screen.getByRole('tab', { name: 'Grupo' }));
  await userEvent.click(await screen.findByRole('button', { name: /Marcia/ }));
}

/**
 * Criar grupo em duas etapas.
 *
 * O grupo nascia pelado — so nome e participantes —, e a foto e o assunto
 * dependiam de alguem abrir o painel de detalhes depois. Com os campos novos, a
 * escolha de pessoas e a identidade do grupo passaram a ser duas telas: cinco
 * campos empilhados sobre a lista de contatos nao caberiam numa so.
 */
describe('NewChatModal · criar grupo', () => {
  it('so avanca depois de alguem ser escolhido', async () => {
    renderModal(<NewChatModal onClose={vi.fn()} onCreated={vi.fn()} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Grupo' }));

    expect(screen.getByRole('button', { name: /Continuar/ })).toBeDisabled();

    await userEvent.click(await screen.findByRole('button', { name: /Marcia/ }));
    expect(screen.getByRole('button', { name: /Continuar/ })).toBeEnabled();
  });

  it('a segunda etapa pede nome, foto e descricao', async () => {
    await escolherMarcia();
    await userEvent.click(screen.getByRole('button', { name: /Continuar/ }));

    expect(screen.getByLabelText('Nome do grupo')).toBeInTheDocument();
    expect(screen.getByLabelText('Descrição do grupo')).toBeInTheDocument();
    expect(screen.getByLabelText('Escolher uma foto')).toBeInTheDocument();
    // E diz com quem: criar um grupo sem saber com quem so se descobre depois
    // da primeira mensagem.
    expect(screen.getByText(/Com Marcia/)).toBeInTheDocument();
  });

  /** Voltar e o caminho de quem escolheu a pessoa errada. */
  it('voltar preserva quem ja foi escolhido', async () => {
    await escolherMarcia();
    await userEvent.click(screen.getByRole('button', { name: /Continuar/ }));
    await userEvent.click(screen.getByRole('button', { name: /Escolher participantes/ }));

    // A ficha do escolhido continua la, e o botao segue contando um.
    expect(screen.getByRole('button', { name: 'Remover Marcia' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Continuar \(1\)/ })).toBeInTheDocument();
  });

  it('nao cria sem nome', async () => {
    await escolherMarcia();
    await userEvent.click(screen.getByRole('button', { name: /Continuar/ }));

    expect(screen.getByRole('button', { name: 'Criar grupo' })).toBeDisabled();

    await userEvent.type(screen.getByLabelText('Nome do grupo'), 'Time');
    expect(screen.getByRole('button', { name: 'Criar grupo' })).toBeEnabled();
  });

  it('manda nome, participantes e descricao', async () => {
    post.mockResolvedValue({ data: { id: 'grupo-novo' } });

    await escolherMarcia();
    await userEvent.click(screen.getByRole('button', { name: /Continuar/ }));
    await userEvent.type(screen.getByLabelText('Nome do grupo'), 'Time do Deploy');
    await userEvent.type(screen.getByLabelText('Descrição do grupo'), 'Subidas');
    await userEvent.click(screen.getByRole('button', { name: 'Criar grupo' }));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/api/chats/groups', {
        name: 'Time do Deploy',
        memberIds: [2],
        description: 'Subidas',
      }),
    );
  });

  /** Campo vazio e ausencia: o payload nao carrega chave sem valor. */
  it('omite a descricao quando ela nao foi preenchida', async () => {
    post.mockResolvedValue({ data: { id: 'grupo-novo' } });

    await escolherMarcia();
    await userEvent.click(screen.getByRole('button', { name: /Continuar/ }));
    await userEvent.type(screen.getByLabelText('Nome do grupo'), 'Time');
    await userEvent.click(screen.getByRole('button', { name: 'Criar grupo' }));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/api/chats/groups', {
        name: 'Time',
        memberIds: [2],
      }),
    );
  });

  /** Conversa direta nao tem o que nomear: segue numa tela so. */
  it('conversa direta continua sem segunda etapa', async () => {
    post.mockResolvedValue({ data: { id: 'direta' } });

    renderModal(<NewChatModal onClose={vi.fn()} onCreated={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: /Marcia/ }));

    const criar = screen.getByRole('button', { name: 'Conversar' });
    expect(criar).toBeEnabled();

    await userEvent.click(criar);
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/api/chats', { otherUserId: 2 }),
    );
  });
});
