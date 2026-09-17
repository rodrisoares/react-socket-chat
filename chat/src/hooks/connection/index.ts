import { useEffect, useState } from 'react';

import { socket } from 'config/socket';

/**
 * 'idle' cobre o intervalo antes do primeiro connect: sem isso a tela abriria
 * gritando "sem conexão" enquanto o socket nem tinha sido ligado.
 */
export type ConnectionStatus = 'idle' | 'connected' | 'reconnecting' | 'offline';

/** Tentativas seguidas antes de parar de chamar de "reconectando". */
const GIVE_UP_AFTER = 3;

export const CONNECTION_LABEL: Record<ConnectionStatus, string> = {
  idle: '',
  connected: 'Conectado',
  reconnecting: 'Reconectando…',
  offline: 'Sem conexão',
};

/** Estado da conexão do socket, para o indicador do rail. */
export default function useConnection(): ConnectionStatus {
  const [status, setStatus] = useState<ConnectionStatus>(() =>
    socket.connected ? 'connected' : 'idle',
  );

  useEffect(() => {
    const manager = socket.io;

    function onConnect() {
      setStatus('connected');
    }

    function onDisconnect(reason: string) {
      // Saída provocada por nós (logout, unmount) não é falha de rede.
      setStatus(reason === 'io client disconnect' ? 'idle' : 'reconnecting');
    }

    function onAttempt(attempt: number) {
      setStatus(attempt > GIVE_UP_AFTER ? 'offline' : 'reconnecting');
    }

    function onError() {
      // Só vira alarme depois de já ter conectado uma vez.
      setStatus((current) => (current === 'idle' ? 'idle' : 'reconnecting'));
    }

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onError);
    manager.on('reconnect_attempt', onAttempt);
    manager.on('reconnect_failed', () => setStatus('offline'));

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onError);
      manager.off('reconnect_attempt', onAttempt);
      manager.off('reconnect_failed');
    };
  }, []);

  return status;
}
