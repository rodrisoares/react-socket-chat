import { beforeEach, describe, expect, it } from 'vitest';

import { showToast, useToastStore } from './toasts';

function texts(): string[] {
  return useToastStore.getState().toasts.map((toast) => toast.text);
}

beforeEach(() => {
  useToastStore.setState({ toasts: [] });
});

describe('store de avisos', () => {
  it('empilha os avisos na ordem em que chegam', () => {
    showToast('primeiro');
    showToast('segundo');

    expect(texts()).toEqual(['primeiro', 'segundo']);
  });

  /**
   * Clicar de novo no botao que falhou nao deve empilhar o mesmo aviso: e uma
   * repeticao, e nao dois problemas.
   */
  it('nao repete o aviso que acabou de aparecer', () => {
    showToast('Não foi possível enviar.');
    showToast('Não foi possível enviar.');

    expect(texts()).toEqual(['Não foi possível enviar.']);
  });

  /** So o ultimo conta como repeticao: o mesmo erro depois de outro e novo. */
  it('aceita o mesmo texto depois de outro aviso', () => {
    showToast('falhou');
    showToast('outra coisa');
    showToast('falhou');

    expect(texts()).toEqual(['falhou', 'outra coisa', 'falhou']);
  });

  it('tira o aviso fechado, e so ele', () => {
    showToast('fica');
    showToast('sai');

    const alvo = useToastStore.getState().toasts[1];
    useToastStore.getState().dismiss(alvo?.id ?? 0);

    expect(texts()).toEqual(['fica']);
  });

  /** Dois avisos no mesmo milissegundo precisam de chaves diferentes. */
  it('da um id proprio a cada aviso', () => {
    showToast('um');
    showToast('dois');

    const [primeiro, segundo] = useToastStore.getState().toasts;
    expect(primeiro?.id).not.toBe(segundo?.id);
  });

  it('marca o tipo pedido', () => {
    showToast('deu certo', 'info');

    expect(useToastStore.getState().toasts[0]?.kind).toBe('info');
  });
});
