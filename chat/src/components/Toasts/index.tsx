import './styles.scss';
import { useEffect } from 'react';
import { IoClose } from 'react-icons/io5';
import { FiAlertCircle, FiInfo } from 'react-icons/fi';

import { useToastStore, type Toast } from 'store/toasts';

/** Quanto tempo um aviso fica na tela antes de sair sozinho. */
const LIFETIME_MS = 6000;

/**
 * Um aviso, com o próprio prazo.
 *
 * O temporizador vive aqui, e não no store: assim ele morre junto com o aviso
 * quando alguém o fecha antes da hora, sem ninguém precisar lembrar de
 * cancelá-lo.
 */
function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onDismiss, LIFETIME_MS);
    return () => window.clearTimeout(timer);
  }, [onDismiss]);

  return (
    <li className={`toast toast--${toast.kind}`}>
      <span className='toast-icon' aria-hidden='true'>
        {toast.kind === 'error' ? <FiAlertCircle size={16} /> : <FiInfo size={16} />}
      </span>
      <p className='toast-text'>{toast.text}</p>
      <button type='button' onClick={onDismiss} aria-label='Fechar aviso' title='Fechar'>
        <IoClose size={16} />
      </button>
    </li>
  );
}

/**
 * Onde os avisos aparecem — montado uma vez, na casca.
 *
 * A lista existe no DOM desde sempre, mesmo vazia: um `aria-live` que nasce
 * junto com o conteúdo não é anunciado pelo leitor de tela, porque ele precisa
 * estar observando a região antes de ela mudar. É o mesmo cuidado da faixa de
 * conexão.
 *
 * `assertive` no erro e `polite` no resto: um erro interrompe o que está sendo
 * lido, e uma confirmação espera a vez.
 */
export default function Toasts() {
  const toasts = useToastStore((state) => state.toasts);
  const dismiss = useToastStore((state) => state.dismiss);

  const hasError = toasts.some((toast) => toast.kind === 'error');

  return (
    <ul
      className='toasts'
      role='status'
      aria-live={hasError ? 'assertive' : 'polite'}
      aria-label='Avisos'
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />
      ))}
    </ul>
  );
}
