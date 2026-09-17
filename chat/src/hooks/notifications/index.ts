import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

const STORAGE_KEY = 'react-chat:notifications';

/** O que o navegador respondeu ao pedido de notificação — ou que ele nem tem a API. */
export type Permission = 'default' | 'granted' | 'denied' | 'unsupported';

/** Como cada aviso é pedido: a conversa de origem e se o bip deve tocar. */
export interface NotifyOptions {
  /** Vai na tag e volta no clique: é por ele que a conversa certa abre. */
  chatId?: string;
  /** Mensagem da conversa aberta com a aba à frente: avisar seria redundante. */
  silent?: boolean;
  /** Clique na notificação — traz a janela para a frente e abre a conversa. */
  onOpen?: () => void;
}

function readEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

/**
 * A preferencia mora fora do React, num store compartilhado.
 *
 * O hook e usado em dois lugares — o menu do usuario, que liga e desliga, e o
 * provider, que decide se avisa. Com `useState` cada um ficava com a propria
 * copia: desligar o som no menu nao silenciava o provider ate o proximo F5.
 */
let enabledValue = readEnabled();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function publish(next: boolean): void {
  enabledValue = next;
  try {
    localStorage.setItem(STORAGE_KEY, next ? 'on' : 'off');
  } catch {
    // Preferencia vale so nesta aba.
  }
  for (const listener of listeners) listener();
}

/**
 * Notificação do browser + bip curto para mensagem nova.
 * O som é sintetizado com WebAudio — evita carregar um arquivo de áudio.
 *
 * Não é Web Push de verdade (service worker + servidor empurrando com a aba
 * fechada): é a Notification API, que exige a aba viva, ainda que em segundo
 * plano. O passo seguinte seria um service worker com VAPID no servidor.
 */
export default function useNotifications() {
  const enabled = useSyncExternalStore(subscribe, () => enabledValue);
  const [permission, setPermission] = useState<Permission>(
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
  );
  const audioRef = useRef<AudioContext | null>(null);
  /** Notificações abertas, para fechá-las ao voltar para a aba. */
  const openRef = useRef<Notification[]>([]);

  // Voltar para a aba já é ter visto o aviso: deixá-lo na bandeja faria o
  // usuário fechar à mão algo que ele acabou de atender.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState !== 'visible') return;
      for (const notification of openRef.current) notification.close();
      openRef.current = [];
    }

    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  const request = useCallback(async () => {
    if (typeof Notification === 'undefined') return;
    const result = await Notification.requestPermission();
    setPermission(result);
  }, []);

  const playSound = useCallback(() => {
    try {
      audioRef.current ??= new AudioContext();
      const ctx = audioRef.current;
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();

      oscillator.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);

      oscillator.connect(gain).connect(ctx.destination);
      oscillator.start();
      oscillator.stop(ctx.currentTime + 0.25);
    } catch {
      // Áudio bloqueado até a primeira interação do usuário.
    }
  }, []);

  const notify = useCallback(
    (title: string, body: string, options: NotifyOptions = {}) => {
      if (!enabled) return;
      if (!options.silent) playSound();

      // Só notifica quando a aba não está em foco.
      if (document.visibilityState === 'visible') return;
      if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
        return;
      }

      try {
        // Uma tag por conversa: mensagens seguidas do mesmo contato se
        // substituem em vez de empilhar uma torre de avisos.
        const notification = new Notification(title, {
          body,
          tag: options.chatId ? `react-chat:${options.chatId}` : 'react-chat',
        });

        notification.onclick = () => {
          window.focus();
          options.onOpen?.();
          notification.close();
        };

        openRef.current.push(notification);
      } catch {
        // Alguns browsers exigem service worker; falha silenciosa.
      }
    },
    [enabled, playSound],
  );

  return { enabled, setEnabled: publish, permission, request, notify };
}
