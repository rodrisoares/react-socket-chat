/**
 * O cabeçalho que marca uma requisição como vinda da aplicação.
 *
 * Existe por causa do cookie do refresh. Ele é `httpOnly` e `sameSite`, o que
 * já resolve o caso comum — com `lax`, o navegador não o manda numa requisição
 * disparada por outro site. Mas `lax` só serve enquanto a API e a tela dividem
 * o mesmo site; em domínios diferentes o cookie precisa ser `none`, e aí ele
 * volta a viajar em requisição de terceiro.
 *
 * O estrago nesse cenário não é leitura: o CORS impede o site atacante de ler a
 * resposta. É a rotação. `POST /api/auth/refresh` troca o refresh token por um
 * novo, então basta disparar a requisição — mesmo sem ver o resultado — para o
 * token que a vítima tem na mão deixar de valer, e a sessão dela cair. O
 * mesmo com `/logout`, que é ainda mais direto.
 *
 * Um cabeçalho fora da lista simples do CORS é o que fecha: para mandá-lo, o
 * navegador é obrigado a fazer o preflight antes, e o preflight falha porque a
 * origem do atacante não está no `CORS_ORIGIN`. Um `<form>` cross-site, que
 * não passa por preflight nenhum, simplesmente não consegue escrevê-lo.
 *
 * Mora aqui, e não num dos dois lados, porque é acordo: o servidor exige
 * exatamente o que o cliente manda, e duas cópias divergiriam na primeira
 * renomeação — com o sintoma sendo "ninguém mais consegue renovar a sessão".
 */
export const APP_REQUEST_HEADER = 'X-Requested-With';

/** O valor esperado. Qualquer outro é recusado. */
export const APP_REQUEST_VALUE = 'react-chat';
