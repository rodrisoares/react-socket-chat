import './styles.scss';
import type { FormEvent, ReactNode } from 'react';

import AuthShowcase from 'components/AuthShowcase';

interface FormProps {
  variant: 'login' | 'signup';
  title: string;
  subtitle: string;
  children: ReactNode;
  buttonLabel: string;
  isSubmitting?: boolean;
  /** Uma mensagem, ou a lista completa que o Zod devolveu. */
  errors?: string[];
  footer: ReactNode;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

export default function Form({
  variant,
  title,
  subtitle,
  children,
  buttonLabel,
  isSubmitting = false,
  errors = [],
  footer,
  onSubmit,
}: FormProps) {
  return (
    <div className='auth'>
      <AuthShowcase variant={variant} />

      <main className='auth-panel'>
        <form className='auth-form' onSubmit={onSubmit} noValidate>
          <header className='auth-form-head'>
            <h1>{title}</h1>
            <p>{subtitle}</p>
          </header>

          <div className='auth-form-fields'>{children}</div>

          {errors.length > 0 && (
            <div className='auth-form-errors' role='alert'>
              {errors.length === 1 ? (
                <p>{errors[0]}</p>
              ) : (
                <ul>
                  {errors.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <button type='submit' className='auth-form-submit' disabled={isSubmitting}>
            {buttonLabel}
          </button>

          <p className='auth-form-footer'>{footer}</p>
        </form>
      </main>
    </div>
  );
}
