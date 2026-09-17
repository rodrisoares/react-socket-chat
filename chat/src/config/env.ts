/**
 * Onde a API está — num lugar só.
 *
 * O mesmo `import.meta.env.VITE_API_URL ?? 'http://localhost:8080'` estava
 * copiado no axios, no socket e na renovação de sessão. Pior: havia uma quarta
 * cópia, em `utils/dayLabel.ts`, com um fallback **diferente** (`''`) — e com
 * ela o anexo de uma mensagem era pedido à origem da tela (5173) em vez da API
 * (8080). Só funcionava quando a variável estava definida; sem ela, toda foto
 * quebrava em silêncio.
 */
export const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8080';

/**
 * URL absoluta de um anexo servido pelo backend.
 *
 * Mora aqui, e não em `utils/dayLabel.ts`: montar endereço de anexo nunca teve
 * nada a ver com formatar data — era só onde a função tinha caído.
 */
export function attachmentUrl(path: string): string {
  return `${API_URL}${path}`;
}

/**
 * A mesma URL, mas pedindo o arquivo como download.
 *
 * O atributo `download` de um `<a>` só vale na mesma origem: com o anexo vindo
 * da API e a tela noutra porta, o navegador o ignorava e o botão "Baixar" do
 * visor apenas abria a foto noutra aba. Quem manda salvar é o
 * `Content-Disposition`, e por isso o pedido vai ao servidor — ver a rota
 * `/uploads/:file`.
 *
 * O `&` é condicional porque o caminho já chega assinado (`?exp=…&sig=…`), mas
 * um anexo antigo, sem assinatura, não teria query nenhuma.
 */
export function downloadUrl(path: string): string {
  const url = attachmentUrl(path);
  return `${url}${url.includes('?') ? '&' : '?'}download=1`;
}
