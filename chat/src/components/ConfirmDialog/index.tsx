import './styles.scss';

import Modal from 'components/Modal';

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  /**
   * Uma segunda saída, para quando a escolha não é "fazer ou não fazer" mas
   * entre dois efeitos diferentes — apagar para todos, ou só para você.
   *
   * Opcional porque a maioria dos usos tem ação única. Fica ao lado do
   * Cancelar, e não do botão principal: é uma alternativa, não a ação que o
   * diálogo veio propor.
   */
  secondaryLabel?: string;
  onSecondary?: () => void;
}

/** Confirmação para ação sem volta. */
export default function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
  secondaryLabel,
  onSecondary,
}: ConfirmDialogProps) {
  return (
    <Modal title={title} onClose={onCancel}>
      <p className='confirm-message'>{message}</p>
      <div className='confirm-actions'>
        <button type='button' className='confirm-actions-cancel' onClick={onCancel}>
          Cancelar
        </button>
        {secondaryLabel && onSecondary && (
          <button type='button' className='confirm-actions-cancel' onClick={onSecondary}>
            {secondaryLabel}
          </button>
        )}
        <button
          type='button'
          className='confirm-actions-ok'
          autoFocus
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
