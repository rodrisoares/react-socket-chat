import { z } from 'zod';

import { NAME_MIN_LENGTH } from '../limits.js';
import { PASSWORD_MAX_LENGTH, passwordRules } from '../password.js';
import { avatarImageSchema } from './avatar.js';

/**
 * A senha, conferida contra as mesmas regras que o cadastro desenha enquanto
 * a pessoa digita (ver `password.ts`).
 *
 * `superRefine` em vez de uma cadeia de `.refine`: encadeado, o primeiro erro
 * interrompe o resto, e a pessoa corrigiria uma exigência por vez. Assim a
 * resposta traz todas as que faltaram.
 */
export const passwordSchema = z
  .string()
  .max(PASSWORD_MAX_LENGTH, `A senha pode ter no máximo ${PASSWORD_MAX_LENGTH} caracteres`)
  .superRefine((value, ctx) => {
    for (const rule of passwordRules) {
      if (!rule.test(value)) ctx.addIssue({ code: 'custom', message: rule.message });
    }
  });

export const registerSchema = z.object({
  name: z
    .string()
    .trim()
    .min(NAME_MIN_LENGTH, `O nome precisa de ao menos ${NAME_MIN_LENGTH} caracteres`),
  email: z.email('E-mail inválido').trim().toLowerCase(),
  password: passwordSchema,
  // O cadastro também define a foto do perfil: se só o PATCH fosse restrito, a
  // porta continuaria aberta por aqui. Ver schemas/avatar.ts.
  image: avatarImageSchema.optional(),
});

export const loginSchema = z.object({
  email: z.email('E-mail inválido').trim().toLowerCase(),
  // No login não se valida força: só que veio algo.
  password: z.string().min(1, 'Informe a senha'),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
