import './styles.scss';
import type { ReactNode } from 'react';
import { IoClose } from 'react-icons/io5';

import useEscape from 'hooks/escape';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

export default function Modal({ title, onClose, children }: ModalProps) {
  /*
   * Esc pela pilha compartilhada: um diálogo sobre outro (o seletor de avatar
   * dentro do perfil) fecha só o de cima, e nenhum deles fecha mais a conversa
   * aberta atrás. A pilha própria que existia aqui só ordenava os modais entre
   * si — o Esc continuava chegando ao resto da tela.
   */
  useEscape(onClose);

  return (
    <div className='modal-overlay' onClick={onClose} role='presentation'>
      <div
        className='modal'
        role='dialog'
        aria-modal='true'
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <header className='modal-header'>
          <h2>{title}</h2>
          <button type='button' onClick={onClose} aria-label='Fechar'>
            <IoClose size={20} />
          </button>
        </header>
        <div className='modal-body'>{children}</div>
      </div>
    </div>
  );
}
