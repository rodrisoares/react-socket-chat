import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import type { AuthResponse, LoginResponse, SessionUser } from '@react-chat/shared';

import { clearSession, getToken, setSession } from 'config/auth';
import fetch from 'config/fetchInstance';
import { queryKeys } from 'config/queryKeys';
import { refreshSession } from 'config/session';
import { connectSocket, disconnectSocket, socket } from 'config/socket';
import { seedChatList } from 'hooks/chatList';
import { useUiStore } from 'store/ui';

/**
 * Quem está logado.
 *
 * O access token mora só na memória (ver `config/auth`), então depois do F5
 * não há o que restaurar do storage: quem diz se a sessão vive é o cookie
 * httpOnly, apresentado numa renovação silenciosa antes da primeira chamada.
 */
async function fetchSession(): Promise<SessionUser | null> {
  if (!getToken() && (await refreshSession()) !== 'renewed') return null;

  const response = await fetch.get<AuthResponse>('/api/auth/me');
  return response.data;
}

/**
 * Só a ação de entrar — sem a consulta da sessão.
 *
 * As telas de login e de cadastro não precisam saber quem está logado: elas
 * existem para criar a sessão. Chamando o `useSession` inteiro só para pegar
 * esta função, elas montavam a consulta junto — e ela, sem token na memória,
 * dispara um `POST /api/auth/refresh` para descobrir se existe cookie. Numa aba
 * anônima o 401 é certo, e o resultado não tinha consumidor nenhum: a tela de
 * login não lê quem está logado.
 *
 * Em `/` a mesma sondagem é necessária — é ela que restaura a sessão no F5.
 */
export function useSignIn(): (response: LoginResponse) => void {
  const queryClient = useQueryClient();

  return useCallback(
    (response: LoginResponse) => {
      setSession({ token: response.token, sessionId: response.sessionId });

      // A resposta do login traz a primeira página da lista junto: semear evita
      // pedir ao servidor o que ele acabou de mandar.
      const { chats, chatsCursor, ...session } = response.user;

      queryClient.setQueryData<SessionUser>(queryKeys.session, session);
      seedChatList(queryClient, { chats, nextCursor: chatsCursor });
      connectSocket();
    },
    [queryClient],
  );
}

export default function useSession() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.session,
    queryFn: fetchSession,
    // Um 401 aqui significa "não está logado", e não "tente de novo".
    retry: false,
    staleTime: Infinity,
  });

  const signIn = useSignIn();

  const signOut = useMutation({
    mutationFn: () => fetch.post('/api/auth/logout'),
    onMutate: () => {
      // Avisa antes de cair: o socket marca offline sem esperar o transporte.
      socket.emit('logoff');
      disconnectSocket();
    },
    // Deu certo ou não, esta aba não continua logada: o cookie o servidor
    // apaga, e o resto é local.
    onSettled: () => {
      clearSession();
      useUiStore.getState().reset();
      queryClient.clear();
    },
  });

  /** Aplica no cache o que o PATCH /api/me devolveu (ou o status otimista). */
  const patchUser = useCallback(
    (patch: Partial<SessionUser>) => {
      queryClient.setQueryData<SessionUser>(queryKeys.session, (old) =>
        old ? { ...old, ...patch } : old,
      );
    },
    [queryClient],
  );

  const user = query.data ?? null;

  return {
    user,
    /** Enquanto a primeira tentativa corre não se decide nada: o F5 cairia no /login. */
    isRestoring: query.isPending,
    isLogged: user !== null,
    signIn,
    signOut: () => signOut.mutate(),
    patchUser,
    /** Depois de entrar pelo cadastro, ou ao voltar do login: refaz a sessão. */
    reloadSession: () => queryClient.invalidateQueries({ queryKey: queryKeys.session }),
  };
}
