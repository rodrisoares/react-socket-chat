import './styles.scss';
import type { ReactNode } from 'react';
import { IoClose } from 'react-icons/io5';

import useEscape from 'hooks/escape';
import useFocusTrap from 'hooks/focusTrap';

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

  /*
   * E o foco fica dentro, e volta ao gatilho no fim.
   *
   * O `aria-modal` abaixo dizia que a tela de trás estava inerte, e ela não
   * estava: o Tab atravessava o diálogo e ia parar nos campos cobertos por ele.
   */
  const dialogRef = useFocusTrap<HTMLDivElement>();

  return (
    <div className='modal-overlay' onClick={onClose} role='presentation'>
      <div
        ref={dialogRef}
        className='modal'
        role='dialog'
        aria-modal='true'
        aria-label={title}
        // Alvo de último recurso: um diálogo sem nada focável ainda precisa
        // receber o foco, ou ele fica na tela de trás.
        tabIndex={-1}
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
