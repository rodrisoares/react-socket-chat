import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';

import { getToken } from 'config/auth';
import { API_URL } from 'config/env';
import { refreshSession, sessionLost } from 'config/session';

const instance = axios.create({
  baseURL: API_URL,
  // O cookie do refresh precisa viajar para a API, que está noutra origem. Só
  // o /api/auth o recebe: é o `path` com que o servidor o grava.
  withCredentials: true,
});

/**
 * Requisição com o que o interceptador de resposta precisa saber: se ela já
 * foi repetida (só tenta uma vez) e com qual token saiu.
 */
type TrackedConfig = InternalAxiosRequestConfig & {
  retried?: boolean;
  /** O access token que foi no header — comparado com o da memória no 401. */
  sentToken?: string | null;
};

// Anexa o token em toda requisição. Ele vem da memória: nada de localStorage.
instance.interceptors.request.use((config: TrackedConfig) => {
  const token = getToken();
  config.sentToken = token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

/**
 * Token expirado: renova e repete, em vez de jogar no login.
 *
 * Antes, todo 401 limpava a sessão e navegava para /login — no meio de uma
 * mensagem sendo escrita, sem aviso nenhum. Agora o 401 é a deixa para trocar
 * o access token usando o cookie; só quando isso falha é que a sessão acabou de
 * verdade, e aí a tela de login ao menos explica o motivo.
 *
 * Com o access token curto, dois casos a mais: se outra requisição desta aba já
 * renovou, o token guardado é outro e basta repetir; e servidor fora do ar não
 * é fim de sessão — o erro volta para a tela, e a sessão fica para a próxima.
 */
instance.interceptors.response.use(
  (response) => response,
  async (error: unknown) => {
    const failure = error as AxiosError;
    const config = failure.config as TrackedConfig | undefined;
    const status = failure.response?.status;
    const rejection = error instanceof Error ? error : new Error(String(error));

    if (status !== 401 || !config || config.retried) {
      // Só é "sessão perdida" quando esta requisição levava um token: um 401
      // numa requisição que saiu sem token nenhum significa "não está logado",
      // e disso cuida o redirecionamento do Layout — sem o aviso de expiração,
      // que seria mentira para quem nunca entrou.
      if (status === 401 && config?.sentToken) sessionLost();
      return Promise.reject(rejection);
    }

    config.retried = true;

    // Outra requisição renovou depois que esta saiu: repetir já basta.
    const current = getToken();
    if (current && current !== config.sentToken) return instance.request(config);

    const result = await refreshSession();
    // O interceptador de requisição lê o token novo da memória sozinho.
    if (result === 'renewed') return instance.request(config);

    // Mesma regra de cima: sem token enviado, não havia sessão para perder.
    if (result === 'rejected' && config.sentToken) sessionLost();
    return Promise.reject(rejection);
  },
);

const fetch = {
  get: instance.get.bind(instance),
  post: instance.post.bind(instance),
  patch: instance.patch.bind(instance),
  put: instance.put.bind(instance),
  delete: instance.delete.bind(instance),
};

export default fetch;
