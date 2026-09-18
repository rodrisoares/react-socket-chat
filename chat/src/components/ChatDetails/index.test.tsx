import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';

import ChatDetails from './index';
import type { Chat, ChatDetails as Details } from '@react-chat/shared';

const get = vi.fn();
const post = vi.fn();
const remove = vi.fn();
const reloadChats = vi.fn();

// O `vi.fn()` devolve `any`; os casts mantêm o mock dentro do contrato real.
//
// O `delete` é espionável como os outros de propósito: ele era um `vi.fn()`
// solto, que devolve `undefined` — e o painel faz `await fetch.delete(...)`.
// Qualquer teste que desbloqueasse morreria no mock, não no código.
vi.mock('config/fetchInstance', () => ({
  default: {
    get: (url: string) => get(url) as Promise<{ data: unknown }>,
    post: (url: string, payload?: unknown) =>
      post(url, payload) as Promise<{ data: unknown }>,
    patch: vi.fn(),
    delete: (url: string) => remove(url) as Promise<{ data: unknown }>,
  },
}));

vi.mock('hooks/session', () => ({
  default: () => ({ user: { id: 1 } }),
}));

vi.mock('hooks/chatList', () => ({
  default: () => ({ reloadChats: () => reloadChats() as Promise<Chat[]> }),
}));

// Os detalhes, os bloqueios e os contatos saem do cache do Query, e as
// consultas so disparam com sessao — ver `hasSession` em config/auth.
vi.mock('config/auth', () => ({
  hasSession: () => true,
  getToken: () => 'token-de-teste',
}));

/**
 * O painel vive dentro do cache do Query.
 *
 * Um client por render, e nao um compartilhado: senao o resultado de um teste
 * ficaria no cache para o seguinte — e um "ja esta bloqueado" vazaria para o
 * teste que espera ninguem bloqueado.
 */
function renderPanel(element: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return render(
    <QueryClientProvider client={client}>{element}</QueryClientProvider>,
  );
}

function makeGroup(): Chat {
  return {
    id: 'grupo-1',
    type: 'GROUP',
    name: 'Time',
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

const details: Details = {
  id: 'grupo-1',
  type: 'GROUP',
  name: 'Time',
  description: null,
  onlyAdminsSend: false,
  createdAt: '2026-01-01T10:00:00.000Z',
  members: [
    {
      id: 1,
      name: 'Rodrigo',
      isOnline: true,
      isAdmin: true,
      joinedAt: '2026-01-01T10:00:00.000Z',
    },
    {
      id: 2,
      name: 'Marcia',
      bio: 'oi',
      isOnline: false,
      isAdmin: false,
      joinedAt: '2026-01-02T10:00:00.000Z',
    },
  ],
};

/** Conversa direta recem-criada, como o /api/me/chats a devolve. */
function makeDirect(id: string): Chat {
  return { ...makeGroup(), id, type: 'DIRECT', name: 'Marcia' };
}

describe('ChatDetails · perfil do membro', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // O painel busca duas coisas ao abrir: os detalhes e a lista de bloqueios.
    get.mockImplementation((url: string) =>
      Promise.resolve(
        url === '/api/me/blocks'
          ? { data: { blocked: [] } }
          : url.startsWith('/api/me/contacts')
            ? { data: [] }
            : { data: details },
      ),
    );
  });

  async function openMemberProfile() {
    renderPanel(<ChatDetails chat={makeGroup()} onClose={vi.fn()} onOpenChat={vi.fn()} />);
    await screen.findByRole('button', { name: 'Ver detalhes de Marcia' });
    await userEvent.click(screen.getByRole('button', { name: 'Ver detalhes de Marcia' }));
  }

  it('abre o perfil do membro ao clicar no nome', async () => {
    await openMemberProfile();
    expect(screen.getByText('oi')).toBeInTheDocument();
    expect(screen.getByText(/No grupo desde/)).toBeInTheDocument();
  });

  /**
   * Bloquear passou a pedir confirmacao (item 28). O caminho tem tres passos, e
   * este teste cobre os tres: o clique abre o dialogo, o dialogo confirma, e a
   * confirmacao e que dispara a requisicao. Antes o primeiro clique ja bloqueava.
   */
  it('bloquear pede confirmacao antes de mandar', async () => {
    post.mockResolvedValue({ data: {} });
    reloadChats.mockResolvedValue([]);

    await openMemberProfile();
    await userEvent.click(screen.getByRole('button', { name: /Bloquear contato/ }));

    // O dialogo aparece, e nada foi mandado ainda.
    expect(await screen.findByText(/não é avisado/)).toBeInTheDocument();
    expect(post).not.toHaveBeenCalledWith('/api/me/blocks/2', undefined);

    await userEvent.click(screen.getByRole('button', { name: 'Bloquear' }));

    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/me/blocks/2', undefined));
    expect(screen.queryByText(/Não foi possível atualizar/)).not.toBeInTheDocument();
  });

  /** Cancelar e um caminho de verdade: nada pode sair pela rede. */
  it('cancelar a confirmacao nao bloqueia ninguem', async () => {
    await openMemberProfile();
    await userEvent.click(screen.getByRole('button', { name: /Bloquear contato/ }));

    await screen.findByText(/não é avisado/);
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(post).not.toHaveBeenCalledWith('/api/me/blocks/2', undefined);
  });

  /**
   * O caminho de "ja bloqueado", que nenhum teste exercitava.
   *
   * Os tres testes de bloqueio acima partem todos de `{ blocked: [] }`, entao a
   * lista nunca chega preenchida a lugar nenhum — e e justamente com ela cheia
   * que o botao muda de verbo.
   *
   * A regressao que isto impede: o GET /api/me/blocks passou a devolver as
   * pessoas, e nao ids, para a tela de bloqueados poder mostrar nomes sem
   * depender da lista de contatos (que agora vem paginada). Lendo a resposta
   * como `number[]`, o `includes` comparava numero com objeto — sempre falso.
   * O botao dizia "Bloquear" para quem ja estava bloqueado, e o clique
   * bloqueava de novo em vez de desbloquear.
   *
   * O `tsc` nao pega: o tipo do `fetch.get<T>` e uma afirmacao sobre o corpo da
   * resposta, e o axios nao confere nada em tempo de execucao.
   */
  it('reconhece quem ja esta bloqueado e oferece desbloquear', async () => {
    get.mockImplementation((url: string) =>
      Promise.resolve(
        url === '/api/me/blocks'
          ? { data: { blocked: [{ id: 2, name: 'Marcia', isOnline: false }] } }
          : url.startsWith('/api/me/contacts')
            ? { data: [] }
            : { data: details },
      ),
    );
    remove.mockResolvedValue({ data: {} });
    reloadChats.mockResolvedValue([]);

    await openMemberProfile();

    // Desbloquear nao passa pelo dialogo: ele desfaz, nao destroi.
    await userEvent.click(
      await screen.findByRole('button', { name: /Desbloquear contato/ }),
    );

    await waitFor(() => expect(remove).toHaveBeenCalledWith('/api/me/blocks/2'));
    // E nao pode ter bloqueado de novo pelo caminho do POST.
    expect(post).not.toHaveBeenCalledWith('/api/me/blocks/2', undefined);
  });

  it('abre a conversa direta quando ela ainda nao existe', async () => {
    const onOpenChat = vi.fn();
    const criada = makeDirect('direta-nova');

    post.mockResolvedValue({ data: { id: 'direta-nova', type: 'DIRECT' } });
    reloadChats.mockResolvedValue([makeGroup(), criada]);

    renderPanel(<ChatDetails chat={makeGroup()} onClose={vi.fn()} onOpenChat={onOpenChat} />);
    await screen.findByRole('button', { name: 'Ver detalhes de Marcia' });
    await userEvent.click(screen.getByRole('button', { name: 'Ver detalhes de Marcia' }));
    await userEvent.click(screen.getByRole('button', { name: /Enviar mensagem/ }));

    await waitFor(() => expect(onOpenChat).toHaveBeenCalledWith(criada));
    expect(screen.queryByText(/Não foi possível abrir/)).not.toBeInTheDocument();
  });
});

/**
 * O outro botao de bloqueio: o da conversa direta.
 *
 * Ele decide se pede confirmacao pelo `chat.isBlocked`, que vem da lista de
 * conversas; ja o `toggleBlock` decide o verbo HTTP pelo `blockedIds`, que vem
 * do GET /api/me/blocks. Sao duas fontes para o mesmo estado, e e isso que
 * estes testes existem para vigiar.
 */
describe('ChatDetails · bloqueio na conversa direta', () => {
  const direct: Details = {
    id: 'direta-1',
    type: 'DIRECT',
    name: 'Marcia',
    description: null,
    onlyAdminsSend: false,
    createdAt: '2026-01-01T10:00:00.000Z',
    members: [
      { id: 1, name: 'Rodrigo', isOnline: true, isAdmin: false, joinedAt: '2026-01-01T10:00:00.000Z' },
      { id: 2, name: 'Marcia', isOnline: false, isAdmin: false, joinedAt: '2026-01-01T10:00:00.000Z' },
    ],
  };

  /** O que o painel busca ao abrir: os detalhes e a lista de bloqueios. */
  function mockBlocks(blocked: number[]) {
    get.mockImplementation((url: string) =>
      Promise.resolve(
        url === '/api/me/blocks'
          ? { data: { blocked } }
          : url.startsWith('/api/me/contacts')
            ? { data: [] }
            : { data: direct },
      ),
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    reloadChats.mockResolvedValue([]);
  });

  it('bloquear pede confirmacao e manda o POST', async () => {
    mockBlocks([]);
    post.mockResolvedValue({ data: {} });

    renderPanel(<ChatDetails chat={makeDirect('direta-1')} onClose={vi.fn()} onOpenChat={vi.fn()} />);

    await userEvent.click(await screen.findByRole('button', { name: /Bloquear contato/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Bloquear' }));

    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/me/blocks/2', undefined));
  });

  /** Desbloquear desfaz, nao destroi: vai direto, sem confirmacao. */
  it('desbloquear manda o DELETE, sem passar pelo dialogo', async () => {
    mockBlocks([2]);
    remove.mockResolvedValue({ data: {} });

    const blocked = { ...makeDirect('direta-1'), isBlocked: true };
    renderPanel(<ChatDetails chat={blocked} onClose={vi.fn()} onOpenChat={vi.fn()} />);

    await userEvent.click(await screen.findByRole('button', { name: /Desbloquear contato/ }));

    await waitFor(() => expect(remove).toHaveBeenCalledWith('/api/me/blocks/2'));
    expect(post).not.toHaveBeenCalled();
  });

  /**
   * A divergencia em si: a conversa diz "bloqueado", a lista de bloqueios ainda
   * nao chegou (ou falhou — o catch dela e silencioso). O botao oferece
   * "Desbloquear", e o verbo tem de acompanhar o que o botao prometeu.
   */
  it('desbloquear continua desbloqueando quando a lista de bloqueios nao chegou', async () => {
    mockBlocks([]);
    remove.mockResolvedValue({ data: {} });
    post.mockResolvedValue({ data: {} });

    const blocked = { ...makeDirect('direta-1'), isBlocked: true };
    renderPanel(<ChatDetails chat={blocked} onClose={vi.fn()} onOpenChat={vi.fn()} />);

    await userEvent.click(await screen.findByRole('button', { name: /Desbloquear contato/ }));

    await waitFor(() => expect(remove).toHaveBeenCalledWith('/api/me/blocks/2'));
    // O erro que este teste caca: mandar POST e bloquear de novo quem se
    // pediu para desbloquear.
    expect(post).not.toHaveBeenCalled();
  });
});
