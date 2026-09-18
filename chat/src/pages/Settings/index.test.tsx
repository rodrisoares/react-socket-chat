import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import Settings from './index';

vi.mock('config/fetchInstance', () => ({
  default: {
    get: vi.fn(() => Promise.resolve({ data: [] })),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

// `getSessionId` entra porque a seção Dispositivos monta o SessionList, que o
// usa para marcar qual das sessões é esta.
vi.mock('config/auth', () => ({
  hasSession: () => true,
  getToken: () => 'token-de-teste',
  getSessionId: () => 'sessao-de-teste',
}));

vi.mock('hooks/session', () => ({
  default: () => ({
    user: { id: 1, name: 'Rodrigo', email: 'rodrigo@exemplo.com' },
    patchUser: vi.fn(),
  }),
}));

vi.mock('hooks/theme', () => ({
  default: () => ({ theme: 'dark', toggle: vi.fn() }),
}));

vi.mock('hooks/notifications', () => ({
  default: () => ({
    enabled: false,
    setEnabled: vi.fn(),
    permission: 'default',
    request: vi.fn(),
  }),
}));

/**
 * A página abre no endereço dado, com as mesmas duas rotas do router de
 * verdade: `/settings` e `/settings/:section`.
 */
function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter
        initialEntries={[path]}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <Routes>
          <Route path='/settings' element={<Settings />} />
          <Route path='/settings/:section' element={<Settings />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Settings · seções por endereço', () => {
  /**
   * Uma seção por vez é o ponto do item: sete numa rolagem só não davam
   * navegação nenhuma. Se as outras voltarem a ser renderizadas junto, este
   * teste cai.
   */
  it('mostra só a seção do endereço', () => {
    renderAt('/settings/privacidade');

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Privacidade');
    expect(screen.getByRole('checkbox', { name: /visto por último/ })).toBeTruthy();
    // O campo de Perfil não está na árvore — e não apenas fora da vista.
    expect(screen.queryByLabelText('Nome')).toBeNull();
  });

  it('abre a segurança direto pelo endereço', () => {
    renderAt('/settings/seguranca');

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Segurança');
    expect(screen.getByRole('button', { name: 'Alterar senha' })).toBeTruthy();
  });

  /** `/settings` puro continua valendo: ele cai na primeira seção. */
  it('sem seção no endereço, abre o perfil', () => {
    renderAt('/settings');

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Perfil');
    expect(screen.getByLabelText('Nome')).toBeTruthy();
  });

  /** Link velho ou erro de digitação não desenha painel vazio. */
  it('endereço desconhecido cai no perfil', () => {
    renderAt('/settings/naoexiste');

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Perfil');
  });

  it('marca no menu a seção aberta', () => {
    renderAt('/settings/dispositivos');

    const active = screen
      .getByRole('navigation', { name: 'Seções das configurações' })
      .querySelector('.is-active');

    expect(active?.textContent).toBe('Dispositivos');
  });

  it('as sete seções estão no menu', () => {
    renderAt('/settings/perfil');

    const nav = screen.getByRole('navigation', { name: 'Seções das configurações' });

    expect(nav.querySelectorAll('a')).toHaveLength(7);
  });

  /**
   * O que foi digitado sobrevive à troca de seção.
   *
   * É a pergunta que a navegação por rota levanta: trocar de aba desmonta o
   * painel do Perfil, e o estado dele mora no componente da página. Se um dia
   * alguém mover esse estado para dentro da seção, o nome digitado some ao
   * visitar Privacidade e voltar — e a barra de salvar leva a sobra errada.
   */
  it('mantem o que foi digitado ao trocar de seção', async () => {
    renderAt('/settings/perfil');

    await userEvent.clear(screen.getByLabelText('Nome'));
    await userEvent.type(screen.getByLabelText('Nome'), 'Rodrigo Almeida');

    await userEvent.click(screen.getByRole('link', { name: 'Privacidade' }));
    expect(screen.queryByLabelText('Nome')).toBeNull();

    await userEvent.click(screen.getByRole('link', { name: 'Perfil' }));
    expect(screen.getByLabelText('Nome')).toHaveProperty('value', 'Rodrigo Almeida');
  });

  /**
   * A barra de salvar é da página, e não da seção: ela precisa continuar à
   * vista de onde quer que a alteração pendente tenha saído.
   */
  it('a barra de salvar segue em outra seção', async () => {
    renderAt('/settings/perfil');

    await userEvent.type(screen.getByLabelText('Nome'), '!');
    expect(screen.getByRole('region', { name: 'Alterações não salvas' })).toBeTruthy();

    await userEvent.click(screen.getByRole('link', { name: 'Aparência' }));
    expect(screen.getByRole('region', { name: 'Alterações não salvas' })).toBeTruthy();
  });
});
