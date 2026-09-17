import './styles.scss';
import { useId, useState, type InputHTMLAttributes } from 'react';
import { FiEye, FiEyeOff } from 'react-icons/fi';

interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'id'> {
  label: string;
  onChange: (value: string) => void;
  /** Texto de apoio abaixo do campo. */
  hint?: string;
  hasError?: boolean;
}

export default function Input({
  label,
  onChange,
  hint,
  hasError = false,
  type = 'text',
  ...props
}: InputProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const [revealed, setRevealed] = useState(false);

  const isPassword = type === 'password';
  const inputType = isPassword && revealed ? 'text' : type;

  return (
    <div className='field'>
      <label className='field-label' htmlFor={id}>
        {label}
      </label>

      <div className={`field-box${hasError ? ' field-box--error' : ''}`}>
        <input
          {...props}
          id={id}
          type={inputType}
          className='field-input'
          aria-describedby={hint ? hintId : undefined}
          aria-invalid={hasError || undefined}
          onChange={(event) => onChange(event.target.value)}
        />

        {isPassword && (
          <button
            type='button'
            className='field-reveal'
            onClick={() => setRevealed((shown) => !shown)}
            aria-label={revealed ? 'Ocultar senha' : 'Mostrar senha'}
          >
            {revealed ? <FiEyeOff size={16} /> : <FiEye size={16} />}
          </button>
        )}
      </div>

      {hint && (
        <p className='field-hint' id={hintId}>
          {hint}
        </p>
      )}
    </div>
  );
}
