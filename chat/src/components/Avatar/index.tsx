import './styles.scss';
import { FaUser, FaUsers } from 'react-icons/fa';
import { STATUS_CLASS, STATUS_LABEL } from 'utils/userStatus';
import type { AvatarKind } from 'utils/avatar';
import type { UserStatus } from '@react-chat/shared';

interface AvatarProps {
  /** null é um valor real da API: usuário sem foto cai no ícone genérico. */
  image?: string | null;
  isLogged?: boolean;
  /** Só pintado quando online — offline é cinza, seja qual for o status. */
  status?: UserStatus;
  /**
   * Decide o ícone de quem não tem imagem. Grupo sem foto mostrava um boneco
   * de pessoa e ficava indistinguível de uma conversa direta na lista.
   */
  kind?: AvatarKind;
}

export default function Avatar({ image, isLogged, status, kind = 'user' }: AvatarProps) {
  const dot = isLogged ? STATUS_CLASS[status ?? 'AVAILABLE'] : 'offline';
  const label = isLogged ? STATUS_LABEL[status ?? 'AVAILABLE'] : 'Offline';

  return (
    <div className={`avatar-container avatar-container--${dot}`} title={label}>
      {image ? (
        <div className='avatar-image'>
          <img src={image} alt='' />
        </div>
      ) : kind === 'group' ? (
        <FaUsers size={20} />
      ) : (
        <FaUser size={20} />
      )}
    </div>
  );
}
