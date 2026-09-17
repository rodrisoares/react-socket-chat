import { QueryClient } from '@tanstack/react-query';

/**
 * O cache do que vem do servidor.
 *
 * `retry: 1` em vez dos três padrões: numa falha real, três tentativas só
 * atrasam o erro que a tela já sabe mostrar. `refetchOnWindowFocus` desligado
 * porque quem mantém a tela em dia é o socket — voltar para a aba não precisa
 * custar uma rodada de requisições.
 *
 * `refetchOnReconnect` fica ligado de propósito: ele é metade da correção da
 * queda de conexão. A outra metade é o socket, que ao reconectar invalida o
 * que mudou enquanto esteve fora.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      // O socket empurra as mudanças; sem esta folga, cada montagem de
      // componente pediria de novo o que acabou de chegar.
      staleTime: 30_000,
    },
    mutations: {
      // Ação do usuário não se repete sozinha: mandar a mesma mensagem duas
      // vezes é pior do que mostrar o erro.
      retry: 0,
    },
  },
});
