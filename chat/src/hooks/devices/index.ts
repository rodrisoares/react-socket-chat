import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Session } from '@react-chat/shared';

import { getSessionId, hasSession } from 'config/auth';
import fetch from 'config/fetchInstance';
import { queryKeys } from 'config/queryKeys';

/**
 * Os dispositivos com sessão aberta, e o que encerra cada um.
 *
 * A lista vinha de um `useEffect` e era remendada à mão depois de cada
 * encerramento — `setSessions(old => old.filter(...))`, uma vez para uma
 * sessão e outra para as demais. Duas formas de dizer a mesma coisa, e nenhuma
 * delas voltava atrás se o servidor recusasse.
 */
export default function useDevices() {
  const queryClient = useQueryClient();
  const currentId = getSessionId();

  const query = useQuery({
    queryKey: queryKeys.devices,
    enabled: hasSession(),
    queryFn: () =>
      fetch.get<Session[]>('/api/me/sessions').then((response) => response.data),
  });

  const sessions = query.data ?? null;

  const close = useMutation({
    mutationFn: (sessionId: string) =>
      fetch.delete(`/api/me/sessions/${encodeURIComponent(sessionId)}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.devices }),
  });

  const closeOthers = useMutation({
    mutationFn: () =>
      fetch.delete(`/api/me/sessions?keep=${encodeURIComponent(currentId ?? '')}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.devices }),
  });

  return {
    sessions,
    currentId,
    isLoading: query.isPending,
    isFailed: query.isError,
    /** Qual está sendo encerrada agora; '' quando nenhuma. */
    closing: close.isPending ? close.variables : closeOthers.isPending ? 'others' : '',
    closeDevice: (sessionId: string) => close.mutateAsync(sessionId),
    closeOtherDevices: () => closeOthers.mutateAsync(),
  };
}
