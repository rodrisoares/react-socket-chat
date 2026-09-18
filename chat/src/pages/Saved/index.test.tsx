import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import Saved from './index';
import { SAVED_LIMIT, type Message, type SavedMessage } from '@react-chat/shared';

const saved = vi.fn<() => SavedMessage[] | null>(() => []);

vi.mock('hooks/saved', () => ({
  default: () => ({ toggleSaved: vi.fn() }),
  useSavedMessages: () => ({ saved: saved(), isFailed: false }),
}));

vi.mock('hooks/chatList', () => ({
  default: () => ({ chats: [] }),
}));

vi.mock('hooks/openChat', () => ({
  default: () => ({ openChatAt: vi.fn() }),
}));

/** Um dia inteiro de distância, para cair noutro grupo. */
const DIA = 24 * 60 * 60 * 1000;

function makeSaved(
  id: string,
  text: string,
  chat: { id: string; name: string },
  daysAgo = 0,
  author = 'Márcia',
): SavedMessage {
  const message = {
    id,
    userId: 2,
    name: author,
    text,
    createdAt: new Date(Date.now() - daysAgo * DIA).toISOString(),
    chatId: chat.id,
    type: 'TEXT',
    reactions: [],
    isRead: true,
  } as unknown as Message;

  return {
    chatId: chat.id,
    chatName: chat.name,
    chatType: 'DIRECT',
    savedAt: message.createdAt,
    message,
  };
}

const TIME = { id: 'c-time', name: 'Time' };
const MARCIA = { id: 'c-marcia', name: 'Márcia' };

function renderSaved() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Saved />
    </MemoryRouter>,
  );
}

describe('Saved · busca, filtro e agrupamento', () => {
  it('sem nada salvo, nem oferece os filtros', () => {
    saved.mockReturnValue([]);
    renderSaved();

    expect(screen.getByText('Nada salvo ainda.')).toBeTruthy();
    expect(screen.queryByLabelText('Buscar nas mensagens salvas')).toBeNull();
  });

  it('a busca alcança o texto da mensagem', async () => {
    saved.mockReturnValue([
      makeSaved('m1', 'combinamos terça', TIME),
      makeSaved('m2', 'o boleto vence sexta', TIME),
    ]);
    renderSaved();

    await userEvent.type(screen.getByLabelText('Buscar nas mensagens salvas'), 'boleto');

    expect(screen.queryByText('combinamos terça')).toBeNull();
    expect(screen.getByText('o boleto vence sexta')).toBeTruthy();
  });

  /** Quem escreveu é tão procurável quanto o que foi escrito. */
  it('a busca alcança quem escreveu', async () => {
    saved.mockReturnValue([
      makeSaved('m1', 'combinamos terça', TIME, 0, 'Márcia'),
      makeSaved('m2', 'o boleto vence sexta', TIME, 0, 'Joana'),
    ]);
    renderSaved();

    await userEvent.type(screen.getByLabelText('Buscar nas mensagens salvas'), 'joana');

    expect(screen.getByText('o boleto vence sexta')).toBeTruthy();
    expect(screen.queryByText('combinamos terça')).toBeNull();
  });

  it('nenhum resultado diz que é do filtro, e não que a lista está vazia', async () => {
    saved.mockReturnValue([makeSaved('m1', 'combinamos terça', TIME)]);
    renderSaved();

    await userEvent.type(screen.getByLabelText('Buscar nas mensagens salvas'), 'zzz');

    expect(screen.getByText('Nenhuma salva com esse filtro.')).toBeTruthy();
  });

  it('filtra por conversa', async () => {
    saved.mockReturnValue([
      makeSaved('m1', 'combinamos terça', TIME),
      makeSaved('m2', 'chego às 18h', MARCIA),
    ]);
    renderSaved();

    await userEvent.selectOptions(
      screen.getByLabelText('Filtrar por conversa'),
      MARCIA.id,
    );

    expect(screen.getByText('chego às 18h')).toBeTruthy();
    expect(screen.queryByText('combinamos terça')).toBeNull();
  });

  /** Um filtro que oferece conversa sem nada salvo leva a uma tela vazia. */
  it('o filtro só oferece conversas que aparecem na lista', () => {
    saved.mockReturnValue([
      makeSaved('m1', 'combinamos terça', TIME),
      makeSaved('m2', 'e na quinta', TIME),
      makeSaved('m3', 'chego às 18h', MARCIA),
    ]);
    renderSaved();

    const options = screen
      .getByLabelText('Filtrar por conversa')
      .querySelectorAll('option');

    // Duas conversas, e não três salvas — mais a opção "Todas".
    expect(options).toHaveLength(3);
  });

  /** Com uma conversa só, escolher entre uma coisa não é escolha. */
  it('não oferece o filtro havendo uma conversa só', () => {
    saved.mockReturnValue([makeSaved('m1', 'combinamos terça', TIME)]);
    renderSaved();

    expect(screen.queryByLabelText('Filtrar por conversa')).toBeNull();
  });

  it('agrupa por dia', () => {
    saved.mockReturnValue([
      makeSaved('m1', 'de hoje', TIME, 0),
      makeSaved('m2', 'de ontem', TIME, 1),
      makeSaved('m3', 'tambem de ontem', TIME, 1),
    ]);
    renderSaved();

    const labels = [...document.querySelectorAll('.saved-messages-day-label')].map(
      (element) => element.textContent,
    );

    expect(labels).toEqual(['Hoje', 'Ontem']);
  });

  /** O teto do servidor existia em silêncio; agora ele aparece. */
  it('avisa ao bater no teto da lista', () => {
    saved.mockReturnValue(
      Array.from({ length: SAVED_LIMIT }, (_, index) =>
        makeSaved(`m${index}`, `mensagem ${index}`, TIME),
      ),
    );
    renderSaved();

    expect(screen.getByText(new RegExp(`Mostrando as ${SAVED_LIMIT} mais recentes`))).toBeTruthy();
  });

  it('abaixo do teto, não avisa nada', () => {
    saved.mockReturnValue([makeSaved('m1', 'combinamos terça', TIME)]);
    renderSaved();

    expect(screen.queryByText(/Mostrando as/)).toBeNull();
  });
});
