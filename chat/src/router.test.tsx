import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { useState } from 'react';

/**
 * A lista e a conversa sao a mesma tela.
 *
 * A conversa aberta virou endereco (`/c/:chatId`), e o `Home` e o elemento de
 * duas rotas irmas: a `index` e a da conversa. Isso levanta uma pergunta que
 * nao da para responder lendo o codigo — trocar de rota desmonta o componente,
 * mesmo sendo o mesmo componente nas duas?
 *
 * Se desmontar, o `Home` perde o que guarda em estado local: o filtro digitado
 * e a aba escolhida. Alguem digitaria "marcia", clicaria na conversa, e o campo
 * de busca voltaria vazio.
 *
 * Este teste usa a mesma forma de rota do router de verdade, com um componente
 * que guarda estado no lugar do Home. Se ele quebrar quando alguem mudar a
 * estrutura das rotas, e porque essa perda voltou.
 */

/** No lugar do Home: guarda algo digitado e navega para uma conversa. */
function Probe() {
  const [filter, setFilter] = useState('');
  const navigate = useNavigate();

  return (
    <div>
      <input
        aria-label='Buscar conversa'
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
      />
      <button type='button' onClick={() => navigate('/c/conversa-1')}>
        Abrir conversa
      </button>
      <button type='button' onClick={() => navigate('/')}>
        Voltar para a lista
      </button>
    </div>
  );
}

function renderRoutes() {
  return render(
    // As mesmas bandeiras do router de verdade. Sem elas o teste espelha um
    // router que nao e o desta aplicacao — e ainda enche a saida com os dois
    // avisos de future flag a cada execucao.
    <MemoryRouter
      initialEntries={['/']}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path='/'>
          <Route index element={<Probe />} />
          <Route path='c/:chatId' element={<Probe />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('rota da conversa', () => {
  it('mantem o que foi digitado ao abrir uma conversa', async () => {
    renderRoutes();

    const busca = screen.getByLabelText('Buscar conversa');
    await userEvent.type(busca, 'marcia');
    await userEvent.click(screen.getByRole('button', { name: 'Abrir conversa' }));

    expect(screen.getByLabelText('Buscar conversa')).toHaveValue('marcia');
  });

  /** E na volta tambem: o caminho do botao voltar do Android. */
  it('mantem o que foi digitado ao voltar para a lista', async () => {
    renderRoutes();

    await userEvent.type(screen.getByLabelText('Buscar conversa'), 'marcia');
    await userEvent.click(screen.getByRole('button', { name: 'Abrir conversa' }));
    await userEvent.click(screen.getByRole('button', { name: 'Voltar para a lista' }));

    expect(screen.getByLabelText('Buscar conversa')).toHaveValue('marcia');
  });
});
