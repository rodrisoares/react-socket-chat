import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AxiosError } from 'axios';

import fetch from 'config/fetchInstance';
import Form from 'components/Form';
import Input from 'components/Input';
import { useSignIn } from 'hooks/session';
import { readApiErrors } from 'utils/apiErrors';
import type { LoginResponse } from '@react-chat/shared';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const signIn = useSignIn();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  /**
   * Sessão que acabou por conta própria — expirou, ou foi encerrada noutro
   * dispositivo. Antes a tela de login simplesmente aparecia no meio do uso,
   * sem dizer nada; a marca na URL é posta por config/session.
   */
  const hasExpired = params.get('expired') === '1';

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors([]);
    setIsSubmitting(true);

    try {
      const response = await fetch.post<LoginResponse>('/api/auth/login', {
        email,
        password,
      });
      signIn(response.data);
      navigate('/');
    } catch (err) {
      setErrors(
        readApiErrors(
          err instanceof AxiosError ? err : undefined,
          'Não foi possível entrar. Tente novamente.',
        ),
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Form
      variant='login'
      title='Entrar'
      subtitle={
        hasExpired
          ? 'Sua sessão expirou. Entre de novo para continuar de onde parou.'
          : 'Use o e-mail e a senha da sua conta.'
      }
      buttonLabel={isSubmitting ? 'Entrando…' : 'Entrar'}
      isSubmitting={isSubmitting}
      errors={errors}
      onSubmit={(event) => void onSubmit(event)}
      footer={
        <>
          Ainda não tem conta? <Link to='/signup'>Criar conta</Link>
        </>
      }
    >
      <Input
        label='E-mail'
        type='email'
        autoComplete='email'
        placeholder='voce@email.com'
        required
        value={email}
        onChange={setEmail}
        hasError={errors.length > 0}
      />
      <Input
        label='Senha'
        type='password'
        autoComplete='current-password'
        placeholder='••••••••'
        required
        value={password}
        onChange={setPassword}
        hasError={errors.length > 0}
      />
    </Form>
  );
}
