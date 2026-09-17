import { z } from 'zod';

import { IMAGE_URL_MAX_LENGTH } from '../limits.js';

/**
 * De onde pode vir a foto de um perfil ou de um grupo.
 *
 * O campo aceitava qualquer URL — e, no grupo, qualquer string: `z.string()`
 * com um teto de 500 caracteres. Com isso o avatar de alguém podia apontar para
 * um servidor de terceiros, que passa a ver o IP de todo mundo que abre a
 * conversa e pode trocar a imagem por outra coisa depois. Guardar uma URL
 * alheia também é guardar um link que um dia devolve 404.
 *
 * As duas origens legítimas do app são o DiceBear, que gera o avatar a partir
 * de uma semente, e o upload do próprio servidor.
 */

/** `https://api.dicebear.com/9.x/<estilo>/svg?seed=...` e demais parâmetros. */
const DICEBEAR = /^https:\/\/api\.dicebear\.com\/\d+\.x\/[a-z0-9-]+\/svg\?[\w%&=.,+-]*$/i;

/** Arquivo servido por este servidor, como o anexo de uma mensagem. */
const OWN_UPLOAD = /^\/uploads\/[A-Za-z0-9._-]+$/;

export const avatarImageSchema = z
  .string()
  .trim()
  .max(IMAGE_URL_MAX_LENGTH)
  .refine((url) => DICEBEAR.test(url) || OWN_UPLOAD.test(url), {
    message: 'Escolha um dos avatares do app',
  });

/**
 * O mesmo, aceitando string vazia — que é como o usuário remove a foto.
 * Separado porque nem todo campo permite remoção.
 */
export const avatarImageOrEmptySchema = z.union([avatarImageSchema, z.literal('')]);
