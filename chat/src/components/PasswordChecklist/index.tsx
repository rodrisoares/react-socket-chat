import './styles.scss';
import { FiCheck } from 'react-icons/fi';
import { passwordRules } from '@react-chat/shared';

/**
 * Mostra o que falta enquanto a pessoa digita, em vez de só reprovar no envio.
 * O servidor continua sendo quem decide — isto é orientação, não validação.
 */
export default function PasswordChecklist({ value }: { value: string }) {
  return (
    <ul className='pwcheck' aria-live='polite'>
      {passwordRules.map((rule) => {
        const done = rule.test(value);
        return (
          <li key={rule.id} className={done ? 'is-done' : ''}>
            <span className='pwcheck-mark' aria-hidden='true'>
              {done ? <FiCheck size={11} /> : <i />}
            </span>
            {rule.label}
            <span className='pwcheck-sr'>{done ? ' — atendido' : ' — pendente'}</span>
          </li>
        );
      })}
    </ul>
  );
}
