import { z } from 'zod';

import { BIO_MAX_LENGTH, NAME_MIN_LENGTH, STATUS_TEXT_MAX_LENGTH } from '../limits.js';
import { USER_STATUSES } from '../status.js';
import { passwordSchema } from './auth.js';
import { avatarImageOrEmptySchema } from './avatar.js';

export const updateProfileSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(NAME_MIN_LENGTH, `O nome precisa de ao menos ${NAME_MIN_LENGTH} caracteres`)
      .optional(),
    // String vazia e valida de proposito: e como o usuario remove a foto.
    // Só o DiceBear e o upload próprio passam — ver schemas/avatar.ts.
    image: avatarImageOrEmptySchema.optional(),
    // String vazia e valida de proposito: e como o usuario limpa a bio.
    bio: z
      .string()
      .trim()
      .max(BIO_MAX_LENGTH, `A bio pode ter no máximo ${BIO_MAX_LENGTH} caracteres`)
      .optional(),
    status: z.enum(USER_STATUSES, 'Status inválido').optional(),
    // String vazia e valida de proposito: e como o usuario limpa o recado.
    statusText: z
      .string()
      .trim()
      .max(
        STATUS_TEXT_MAX_LENGTH,
        `O recado pode ter no máximo ${STATUS_TEXT_MAX_LENGTH} caracteres`,
      )
      .optional(),
    // Ausencia automatica, mandada pelo proprio navegador quando a pessoa para
    // de mexer. Nao sobrescreve o `status`: sao colunas diferentes de proposito.
    isAway: z.boolean('Valor inválido').optional(),
    // Privacidade do "visto por ultimo". Booleano puro: quem desliga some do
    // horario dos outros, e nao apenas da propria tela.
    showLastSeen: z.boolean('Valor inválido').optional(),
    // Recibo de leitura, nos dois sentidos: quem desliga para de mandar e de
    // receber. Ver o readBy em listForUser.
    showReadReceipts: z.boolean('Valor inválido').optional(),
    currentPassword: z.string().optional(),
    newPassword: passwordSchema.optional(),
  })
  .refine((data) => !data.newPassword || Boolean(data.currentPassword), {
    message: 'Informe a senha atual para trocar de senha',
    path: ['currentPassword'],
  });

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

/**
 * Excluir a propria conta.
 *
 * Pede a senha, e nao um "tem certeza?": e a acao mais irreversivel do app, e a
 * senha e o que garante que quem clicou e o dono — nao alguem que encontrou a
 * aba aberta. Nao se valida forca aqui, como no login: so que veio algo.
 */
export const deleteAccountSchema = z.object({
  password: z.string().min(1, 'Informe a senha para confirmar'),
});

export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;
