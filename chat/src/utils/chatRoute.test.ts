import { describe, expect, it } from 'vitest';

import { chatIdFromPath, chatPath } from './chatRoute';

/**
 * O endereco da conversa aberta, nos dois sentidos.
 *
 * Estas funcoes sao a unica fonte da verdade sobre qual conversa esta aberta —
 * a tela le pelo `useOpenChat`, e o modulo de socket le pelo `currentChatId`,
 * os dois passando por aqui. Divergirem seria o bug que a decisao de nao ter
 * espelho no store existe para evitar.
 */
describe('chatPath', () => {
  it('monta o endereco da conversa', () => {
    expect(chatPath('abc-123')).toBe('/c/abc-123');
  });

  /** O id e um uuid hoje, mas escapar e o que impede um id exotico quebrar a URL. */
  it('escapa o que nao pode ir cru na URL', () => {
    expect(chatPath('a/b')).toBe('/c/a%2Fb');
  });
});

describe('chatIdFromPath', () => {
  it('le o id de uma conversa aberta', () => {
    expect(chatIdFromPath('/c/abc-123')).toBe('abc-123');
  });

  it('desfaz o escape, fechando a volta do chatPath', () => {
    expect(chatIdFromPath(chatPath('a/b'))).toBe('a/b');
  });

  /** As outras telas nao tem conversa aberta nenhuma. */
  it('devolve null fora da rota de conversa', () => {
    expect(chatIdFromPath('/')).toBeNull();
    expect(chatIdFromPath('/saved')).toBeNull();
    expect(chatIdFromPath('/settings')).toBeNull();
  });

  /** `/c/` sem id nao e uma conversa. */
  it('devolve null com o prefixo vazio', () => {
    expect(chatIdFromPath('/c/')).toBeNull();
  });

  /** So o primeiro segmento: um caminho mais fundo nao e uma conversa aberta. */
  it('ignora o que vem depois do id', () => {
    expect(chatIdFromPath('/c/abc-123/qualquer')).toBe('abc-123');
  });

  /**
   * O ramo que so existe por precaucao, e que nada exercitava.
   *
   * Um `%` solto derruba o `decodeURIComponent` com URIError. Acontece em link
   * truncado por aplicativo de mensagem, ou digitado a mao — e derrubar quem
   * chamou seria pior do que tratar como "nenhuma conversa".
   */
  it('devolve null em vez de estourar com escape malformado', () => {
    expect(chatIdFromPath('/c/%E0%A4%A')).toBeNull();
  });
});
