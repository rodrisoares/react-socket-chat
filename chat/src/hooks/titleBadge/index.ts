import { useEffect } from 'react';

/** Título original da aba, lido uma vez: o badge é um prefixo dele. */
const BASE_TITLE = typeof document === 'undefined' ? '' : document.title;

/**
 * Contador de não lidas no título da aba, e no ícone do app quando o browser
 * oferece a Badging API.
 *
 * Existe porque a notificação do sistema pode estar negada ou silenciada — o
 * título é o único aviso que não depende de permissão nenhuma.
 */
export default function useTitleBadge(unreadTotal: number): void {
  useEffect(() => {
    document.title = unreadTotal > 0 ? `(${unreadTotal}) ${BASE_TITLE}` : BASE_TITLE;

    // Só o Chromium tem; onde não existe, o título já resolveu.
    const navigatorWithBadge = navigator as Navigator & {
      setAppBadge?: (count?: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };

    try {
      if (unreadTotal > 0) void navigatorWithBadge.setAppBadge?.(unreadTotal);
      else void navigatorWithBadge.clearAppBadge?.();
    } catch {
      // Badge é enfeite: falhar aqui não pode derrubar o render.
    }

    return () => {
      document.title = BASE_TITLE;
    };
  }, [unreadTotal]);
}
