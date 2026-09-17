import './styles.scss';
import { useEffect, useRef, useState } from 'react';
import { FiLogOut } from 'react-icons/fi';

import Avatar from 'components/Avatar';
import useEscape from 'hooks/escape';
import { STATUS_HINT, STATUS_LABEL, USER_STATUSES } from 'utils/userStatus';
import type { UserStatus } from '@react-chat/shared';

interface UserMenuProps {
  name?: string;
  email?: string;
  image?: string | null;
  status: UserStatus;
  onChangeStatus: (status: UserStatus) => void;
  onLogout: () => void;
}

/**
 * Âncora do rail: o avatar abre o que é da conta.
 *
 * Ele já foi o menu de tudo — perfil, salvas, tema, notificações. Com o rail
 * levando a Salvas e a Configurações, e com tema e notificações virando seções
 * de lá, sobrou o que de fato pertence ao avatar: o seu status, e sair. Manter
 * os outros aqui seria oferecer duas portas para cada sala.
 */
export default function UserMenu({
  name,
  email,
  image,
  status,
  onChangeStatus,
  onLogout,
}: UserMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Aberto, o menu é o topo da pilha do Esc: fecha ele, e não a conversa.
  useEscape(() => setIsOpen(false), isOpen);

  useEffect(() => {
    if (!isOpen) return;

    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
    }

    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [isOpen]);

  return (
    <div className='user-menu' ref={rootRef}>
      {isOpen && (
        <div className='user-menu-panel' role='menu'>
          <div className='user-menu-head'>
            <Avatar image={image} isLogged status={status} />
            <div className='user-menu-head-text'>
              <strong>{name}</strong>
              <span>{email}</span>
            </div>
          </div>

          <div className='user-menu-status' role='group' aria-label='Meu status'>
            {USER_STATUSES.map((option) => (
              <button
                key={option}
                type='button'
                role='menuitemradio'
                aria-checked={status === option}
                className={`user-menu-status-item${status === option ? ' is-active' : ''}`}
                onClick={() => onChangeStatus(option)}
              >
                <span className={`user-menu-dot user-menu-dot--${option}`} />
                {/*
                  A dica não é enfeite: só "Não perturbe" tem efeito além da cor
                  do ponto, e sem uma linha explicando isso a escolha entre ele e
                  "Ocupado" é adivinhação.
                */}
                <span className='user-menu-status-text'>
                  <strong>{STATUS_LABEL[option]}</strong>
                  <small>{STATUS_HINT[option]}</small>
                </span>
              </button>
            ))}
          </div>

          <div className='user-menu-divider' />

          <button
            type='button'
            role='menuitem'
            className='user-menu-item user-menu-item--danger'
            onClick={() => {
              setIsOpen(false);
              onLogout();
            }}
          >
            <FiLogOut size={16} /> Sair
          </button>
        </div>
      )}

      <button
        type='button'
        className={`user-menu-trigger${isOpen ? ' is-open' : ''}`}
        aria-haspopup='menu'
        aria-expanded={isOpen}
        aria-label={`Conta de ${name ?? 'usuário'}`}
        title={name}
        onClick={() => setIsOpen((open) => !open)}
      >
        <Avatar image={image} isLogged status={status} />
      </button>
    </div>
  );
}
