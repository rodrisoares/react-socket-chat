import type { AxiosError } from 'axios';
import type { ApiError } from '@react-chat/shared';

/**
 * Traduz a resposta do errorHandler numa lista de mensagens.
 *
 * O Zod devolve TODAS as regras que falharam, não só a primeira — mostrar só
 * `issues[0]` faria a pessoa corrigir a senha uma exigência por vez.
 */
export function readApiErrors(error: AxiosError | undefined, fallback: string): string[] {
  const data = error?.response?.data as ApiError | undefined;

  if (data?.issues?.length) {
    return data.issues.map((issue) => issue.mensagem);
  }
  if (data?.error) {
    return [data.error];
  }
  return [fallback];
}
