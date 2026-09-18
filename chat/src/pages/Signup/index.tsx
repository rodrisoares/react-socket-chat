import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AxiosError } from 'axios';

import fetch from 'config/fetchInstance';
import Form from 'components/Form';
import Input from 'components/Input';
import PasswordChecklist from 'components/PasswordChecklist';
import { useSignIn } from 'hooks/session';
import { readApiErrors } from 'utils/apiErrors';
import { isPasswordValid, type LoginResponse } from '@react-chat/shared';

export default function Signup() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const signIn = useSignIn();
  const navigate = useNavigate();

  // Guia enquanto digita; quem decide continua sendo o servidor.
  const passwordReady = isPasswordValid(password);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors([]);
    setIsSubmitting(true);

    try {
      // O cadastro já devolve a sessão: mandar para o login logo depois de a
      // pessoa digitar a senha duas vezes era pedir a terceira sem motivo.
      //
      // Sem `image`: a conta nasce sem foto e o `Avatar` cai no ícone genérico
      // até a pessoa escolher uma em Configurações > Perfil. O cadastro
      // derivava uma cara do DiceBear a partir do e-mail — uma foto que
      // ninguém pediu, que chegava parecendo escolha de outra pessoa, e que
      // não tinha como ser recusada sem antes descobrir onde se troca.
      const response = await fetch.post<LoginResponse>('/api/auth/register', {
        name,
        email,
        password,
      });

      signIn(response.data);
      navigate('/');
    } catch (err) {
      setErrors(
        readApiErrors(
          err instanceof AxiosError ? err : undefined,
          'Não foi possível criar a conta.',
        ),
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Form
      variant='signup'
      title='Criar conta'
      subtitle='Leva menos de um minuto.'
      buttonLabel={isSubmitting ? 'Criando…' : 'Criar conta'}
      isSubmitting={isSubmitting}
      errors={errors}
      onSubmit={(event) => void onSubmit(event)}
      footer={
        <>
          Já tem conta? <Link to='/login'>Entrar</Link>
        </>
      }
    >
      <Input
        label='Nome'
        autoComplete='name'
        placeholder='Como querem te chamar'
        required
        value={name}
        onChange={setName}
      />
      <Input
        label='E-mail'
        type='email'
        autoComplete='email'
        placeholder='voce@email.com'
        required
        value={email}
        onChange={setEmail}
      />
      <div>
        <Input
          label='Senha'
          type='password'
          autoComplete='new-password'
          placeholder='••••••••'
          required
          value={password}
          onChange={setPassword}
          hasError={password.length > 0 && !passwordReady}
        />
        <PasswordChecklist value={password} />
      </div>
    </Form>
  );
}
