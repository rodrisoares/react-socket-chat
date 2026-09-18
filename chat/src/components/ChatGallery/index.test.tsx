import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import ChatGallery from './index';
import type { ChatGallery as Gallery, Message } from '@react-chat/shared';

const get = vi.fn();

vi.mock('config/fetchInstance', () => ({
  default: {
    get: (url: string) => get(url) as Promise<{ data: unknown }>,
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('config/auth', () => ({
  hasSession: () => true,
  getToken: () => 'token-de-teste',
}));

function makeImage(id: string): Message {
  return {
    id,
    userId: 2,
    name: 'Márcia',
    text: '',
    createdAt: new Date().toISOString(),
    attachment: { url: `/uploads/${id}.png`, name: `${id}.png`, type: 'image/png' },
  } as unknown as Message;
}

function page(media: Message[], hasMoreMedia: boolean): Gallery {
  return {
    media,
    files: [],
    links: [],
    hasMore: { media: hasMoreMedia, files: false, links: false },
  };
}

function renderGallery() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return render(
    <QueryClientProvider client={client}>
      <ChatGallery chatId='conversa-1' />
    </QueryClientProvider>,
  );
}

describe('ChatGallery · carregar mais', () => {
  /*
   * Corpo com chaves, e não `() => get.mockReset()`.
   *
   * O `mockReset` devolve o próprio mock para permitir encadeamento, e o Vitest
   * trata o retorno de um `beforeEach` como função de limpeza quando ele é uma
   * função — o mock era chamado sem argumento no fim de cada teste, e a
   * implementação recebia `undefined` onde esperava a URL.
   */
  beforeEach(() => {
    get.mockReset();
  });

  it('não oferece o botão quando não há mais nada', async () => {
    get.mockResolvedValue({ data: page([makeImage('a')], false) });
    renderGallery();

    await screen.findByRole('button', { name: /Abrir a.png/ });
    expect(screen.queryByRole('button', { name: 'Carregar mais' })).toBeNull();
  });

  it('anexa a próxima página ao que já está na tela', async () => {
    get.mockImplementation((url: string) =>
      Promise.resolve({
        data: url.includes('tab=media')
          ? page([makeImage('c')], false)
          : page([makeImage('a'), makeImage('b')], true),
      }),
    );

    renderGallery();

    await userEvent.click(await screen.findByRole('button', { name: 'Carregar mais' }));

    // As três juntas: a página nova soma à anterior, não a substitui.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Abrir c.png/ })).toBeTruthy();
    });
    expect(screen.getByRole('button', { name: /Abrir a.png/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Abrir b.png/ })).toBeTruthy();

    // E acabou: o botão sai de cena com o `hasMore` da resposta.
    expect(screen.queryByRole('button', { name: 'Carregar mais' })).toBeNull();
  });

  /** O cursor é o id da última mensagem da aba — não um número de página. */
  it('pede a página seguinte a partir da última mensagem', async () => {
    get.mockImplementation((url: string) =>
      Promise.resolve({
        data: url.includes('tab=media')
          ? page([], false)
          : page([makeImage('a'), makeImage('b')], true),
      }),
    );

    renderGallery();
    await userEvent.click(await screen.findByRole('button', { name: 'Carregar mais' }));

    await waitFor(() => {
      expect(get).toHaveBeenCalledWith('/api/chats/conversa-1/media?tab=media&cursor=b');
    });
  });

  /**
   * Uma mensagem nova entre uma página e a seguinte empurra a janela, e o item
   * da emenda volta nas duas. Sem o descarte, o React reclamaria de chave
   * repetida e a mesma foto apareceria duas vezes na grade.
   */
  it('não repete o que já estava na lista', async () => {
    get.mockImplementation((url: string) =>
      Promise.resolve({
        data: url.includes('tab=media')
          ? page([makeImage('b'), makeImage('c')], false)
          : page([makeImage('a'), makeImage('b')], true),
      }),
    );

    renderGallery();
    await userEvent.click(await screen.findByRole('button', { name: 'Carregar mais' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Abrir c.png/ })).toBeTruthy();
    });
    expect(screen.getAllByRole('button', { name: /Abrir b.png/ })).toHaveLength(1);
  });
});
