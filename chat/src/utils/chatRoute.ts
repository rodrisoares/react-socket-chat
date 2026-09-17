import type { NavigateFunction } from 'react-router-dom';

/**
 * A conversa aberta mora na URL, e não num estado da aba.
 *
 * Ela vivia no store: um F5 caía na lista vazia, o link de uma notificação não
 * levava a lugar nenhum, e no Android o botão voltar saía do app em vez de
 * voltar para a lista — porque nunca houve o que voltar. Com `/c/:chatId`, as
 * três coisas passam a ser consequência de o endereço existir.
 *
 * Este arquivo existe por causa de dois chamadores que não são componentes: o
 * módulo de eventos do socket precisa saber qual conversa está aberta (para
 * decidir se a mensagem que chega já conta como lida) e precisa abrir uma
 * conversa quando alguém clica na notificação. Nenhum dos dois pode chamar
 * `useParams` ou `useNavigate`.
 *
 * A saída poderia ter sido manter o store como espelho da URL. Não foi, de
 * propósito: um espelho sincronizado nos dois sentidos é duas fontes para o
 * mesmo estado, e é a forma exata do bug que fazia o botão de bloquear decidir
 * o rótulo por uma fonte e o verbo HTTP por outra. Aqui a leitura vai direto à
 * verdade — o endereço — e a escrita passa pelo mesmo `navigate` que o resto do
 * app usa.
 */

const CHAT_PATH_PREFIX = '/c/';

/** O endereço de uma conversa. */
export function chatPath(chatId: string): string {
  return `${CHAT_PATH_PREFIX}${encodeURIComponent(chatId)}`;
}

/**
 * O id da conversa num caminho, ou null quando ele não é de conversa nenhuma
 * — a lista, as salvas, as configurações.
 */
export function chatIdFromPath(pathname: string): string | null {
  if (!pathname.startsWith(CHAT_PATH_PREFIX)) return null;

  // Só o primeiro segmento: um caminho mais fundo não é uma conversa aberta.
  const raw = pathname.slice(CHAT_PATH_PREFIX.length).split('/')[0] ?? '';
  if (!raw) return null;

  try {
    return decodeURIComponent(raw);
  } catch {
    // Percentagem malformada na URL — digitada à mão, ou truncada por um
    // aplicativo de mensagem. Melhor tratar como "nenhuma conversa" do que
    // deixar o `decodeURIComponent` derrubar quem chamou.
    return null;
  }
}

/**
 * Qual conversa está aberta agora, para quem não é componente.
 *
 * Lê o endereço de verdade, e não uma cópia: é o que garante que esta resposta
 * e a que a tela está renderizando nunca divirjam.
 */
export function currentChatId(): string | null {
  if (typeof window === 'undefined') return null;
  return chatIdFromPath(window.location.pathname);
}

/**
 * O `navigate` do router, guardado para quem não pode usar o hook.
 *
 * Registrado por um componente de dentro do `BrowserRouter` e limpo quando ele
 * sai — sem isso, um `navigate` de uma árvore já desmontada continuaria por
 * aqui depois de um logout.
 */
// `routeNavigator`, e não `navigator`: este último é um global do DOM, e uma
// variável de módulo com o mesmo nome o esconde dentro deste arquivo inteiro.
// Nada aqui usa o global hoje — mas quem vier acrescentar um `navigator.share`
// ou um `navigator.clipboard` receberia `null` sem entender por quê.
let routeNavigator: NavigateFunction | null = null;

export function registerNavigator(next: NavigateFunction | null): void {
  routeNavigator = next;
}

/**
 * Abre uma conversa de fora do React — hoje, o clique na notificação.
 *
 * Empilha no histórico, como o clique na lista: é isso que faz o botão voltar
 * levar de volta para onde a pessoa estava. Não faz nada se ninguém registrou
 * um navegador, o que só acontece fora da árvore do router (nos testes, por
 * exemplo) — e ali não há para onde navegar mesmo.
 */
export function goToChat(chatId: string): void {
  routeNavigator?.(chatPath(chatId));
}
