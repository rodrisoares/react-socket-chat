/**
 * As regras da senha, numa lista só.
 *
 * O servidor as transforma em schema Zod e o cliente as desenha na lista que
 * acende enquanto a pessoa digita. Eram duas cópias: mudar o mínimo de
 * caracteres no servidor deixava a lista do cliente mentindo.
 */
export const PASSWORD_MIN_LENGTH = 8;

/** O bcrypt trunca em 72 bytes; acima disso a senha extra não valeria nada. */
export const PASSWORD_MAX_LENGTH = 72;

export interface PasswordRule {
  id: string;
  /** Curto, para a lista do cadastro: "ao menos 8 caracteres". */
  label: string;
  /** Frase inteira, para o erro da API: "A senha precisa de...". */
  message: string;
  test: (value: string) => boolean;
}

export const passwordRules: PasswordRule[] = [
  {
    id: 'length',
    label: `ao menos ${PASSWORD_MIN_LENGTH} caracteres`,
    message: `A senha precisa de ao menos ${PASSWORD_MIN_LENGTH} caracteres`,
    test: (value) => value.length >= PASSWORD_MIN_LENGTH,
  },
  {
    id: 'letter',
    label: 'uma letra',
    message: 'A senha precisa conter ao menos uma letra',
    test: (value) => /[a-zA-Z]/.test(value),
  },
  {
    id: 'digit',
    label: 'um número',
    message: 'A senha precisa conter ao menos um número',
    test: (value) => /[0-9]/.test(value),
  },
];

/** Orientação para a tela; quem decide de verdade continua sendo o servidor. */
export function isPasswordValid(value: string): boolean {
  return passwordRules.every((rule) => rule.test(value));
}
