import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import Avatar from './index';

describe('Avatar', () => {
  /**
   * Os bugs #1 e #2: o app passava `imagem` enquanto o componente lia `image`,
   * então a foto nunca aparecia. Este teste trava a prop correta.
   */
  it('renderiza a imagem quando recebe a prop image', () => {
    render(<Avatar image='https://exemplo.test/foto.png' isLogged />);

    const img = screen.getByRole('presentation', { hidden: true });
    expect(img).toHaveAttribute('src', 'https://exemplo.test/foto.png');
  });

  it('cai no icone generico sem image', () => {
    const { container } = render(<Avatar isLogged={false} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('marca online e offline com classes diferentes', () => {
    const { container: online } = render(<Avatar isLogged />);
    expect(online.firstElementChild?.className).toContain('avatar-container--online');

    const { container: offline } = render(<Avatar isLogged={false} />);
    expect(offline.firstElementChild?.className).toContain('avatar-container--offline');
  });

  it('pinta o ponto conforme o status escolhido', () => {
    const { container: ocupado } = render(<Avatar isLogged status='BUSY' />);
    expect(ocupado.firstElementChild?.className).toContain('avatar-container--busy');

    const { container: ausente } = render(<Avatar isLogged status='AWAY' />);
    expect(ausente.firstElementChild?.className).toContain('avatar-container--away');
  });

  /** Status é escolha de quem está online; desconectado é sempre cinza. */
  it('ignora o status quando a pessoa esta offline', () => {
    const { container } = render(<Avatar isLogged={false} status='BUSY' />);
    expect(container.firstElementChild?.className).toContain('avatar-container--offline');
  });

  it('descreve o estado no title, para quem passa o mouse', () => {
    const { container } = render(<Avatar isLogged status='AWAY' />);
    expect(container.firstElementChild).toHaveAttribute('title', 'Ausente');
  });
});

describe('Avatar · ícone padrão', () => {
  it('usa o ícone de grupo quando o grupo não tem imagem', () => {
    const { container } = render(<Avatar kind='group' />);
    // O react-icons desenha um <svg>; o que muda é qual glifo.
    const pessoa = render(<Avatar />).container.querySelector('svg')?.innerHTML;
    expect(container.querySelector('svg')?.innerHTML).not.toBe(pessoa);
  });

  it('com imagem, o kind não muda nada', () => {
    const { container } = render(
      <Avatar kind='group' image='https://exemplo.test/a.svg' />,
    );
    expect(container.querySelector('img')).toBeInTheDocument();
    expect(container.querySelector('svg')).not.toBeInTheDocument();
  });
});
