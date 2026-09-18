import { z } from 'zod';

import {
  FORWARD_MAX_CHATS,
  GROUP_DESCRIPTION_MAX_LENGTH,
  GROUP_NAME_MAX_LENGTH,
  MESSAGE_MAX_LENGTH,
  MUTE_DURATIONS,
  NAME_MIN_LENGTH,
  REACTION_MAX_LENGTH,
} from '../limits.js';
import { avatarImageOrEmptySchema } from './avatar.js';

/** O maior prazo oferecido pela tela — ver muteChatSchema. */
const MAX_MUTE_MINUTES = Math.max(
  ...MUTE_DURATIONS.flatMap((duration) => (duration.minutes === null ? [] : [duration.minutes])),
);

export const sendMessageSchema = z.object({
  text: z.string().trim().max(MESSAGE_MAX_LENGTH).default(''),
  replyToId: z.string().uuid().optional(),
});

export const editMessageSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1, 'A mensagem não pode ficar vazia')
    .max(MESSAGE_MAX_LENGTH),
});

export const createChatSchema = z.object({
  otherUserId: z.coerce.number().int().positive('Informe o outro participante'),
});

const groupName = z
  .string()
  .trim()
  .min(NAME_MIN_LENGTH, `O nome do grupo precisa de ao menos ${NAME_MIN_LENGTH} caracteres`)
  .max(GROUP_NAME_MAX_LENGTH);

/** A descricao do grupo — o "assunto", que o painel de detalhes mostra. */
const groupDescription = z
  .string()
  .trim()
  .max(
    GROUP_DESCRIPTION_MAX_LENGTH,
    `A descrição pode ter no máximo ${GROUP_DESCRIPTION_MAX_LENGTH} caracteres`,
  );

/**
 * O grupo nasce vestido.
 *
 * `image` e `description` passaram a entrar aqui porque o grupo nascia pelado:
 * so nome e participantes, e a foto e o assunto vinham depois, pelo painel de
 * detalhes — que muita gente nunca abre. O resultado eram grupos sem cara na
 * lista, indistinguiveis uns dos outros, e sem nada dizendo do que se tratam.
 *
 * Os dois continuam opcionais: quem so quer juntar tres pessoas e conversar
 * nao deve ser obrigado a preencher formulario.
 */
export const createGroupSchema = z.object({
  name: groupName,
  memberIds: z
    .array(z.coerce.number().int().positive())
    .min(1, 'Escolha ao menos um participante'),
  // Aceita string vazia por tolerancia: e o que um campo nao preenchido manda.
  image: avatarImageOrEmptySchema.optional(),
  description: groupDescription.optional(),
});

/**
 * Nome e/ou foto. Os dois sao opcionais, mas mandar nenhum nao faz sentido —
 * o refine evita um PATCH que nao muda nada.
 */
export const updateGroupSchema = z
  .object({
    name: groupName.optional(),
    // String vazia significa "remover a foto", como no perfil do usuario.
    // Aceitava qualquer string: nem URL precisava ser. Ver schemas/avatar.ts.
    image: avatarImageOrEmptySchema.optional(),
    // Como a bio: string vazia limpa a descricao.
    description: groupDescription.optional(),
    onlyAdminsSend: z.boolean('Valor inválido').optional(),
  })
  .refine(
    (data) =>
      data.name !== undefined ||
      data.image !== undefined ||
      data.description !== undefined ||
      data.onlyAdminsSend !== undefined,
    { message: 'Informe o que mudar no grupo' },
  );

/** Promover a administrador, ou tirar. */
export const setAdminSchema = z.object({
  isAdmin: z.boolean('Valor inválido'),
});

/**
 * Silenciar. Sem `minutes` e o "sempre"; com, e o prazo em minutos.
 *
 * O teto e a maior duracao oferecida: aceitar qualquer numero deixaria gravar
 * um silencio de mil anos, que na pratica e o "sempre" por outro caminho — so
 * que sem a tela saber dizer isso.
 */
export const muteChatSchema = z
  .object({
    minutes: z.coerce
      .number()
      .int()
      .positive('Informe um prazo válido')
      .max(MAX_MUTE_MINUTES, 'Prazo longo demais')
      .optional(),
  })
  // Corpo ausente vira `{}`, e nao erro: "silenciar para sempre" e um POST sem
  // nada para mandar, e e a chamada mais comum. Sem isto o middleware recusaria
  // justamente ela — o `safeParse` de um z.object nao aceita `undefined`.
  .default({});

export const addMembersSchema = z.object({
  memberIds: z
    .array(z.coerce.number().int().positive())
    .min(1, 'Escolha alguém para adicionar'),
});

/** Uma reacao por pessoa: o emoji novo substitui o anterior. */
export const reactionSchema = z.object({
  emoji: z.string().trim().min(1, 'Escolha um emoji').max(REACTION_MAX_LENGTH),
});

export const forwardSchema = z.object({
  chatIds: z
    .array(z.string().uuid())
    .min(1, 'Escolha ao menos uma conversa')
    .max(FORWARD_MAX_CHATS, `No máximo ${FORWARD_MAX_CHATS} conversas por vez`),
});

/** Mensagem a fixar no topo da conversa. */
export const pinMessageSchema = z.object({
  messageId: z.string().uuid('Mensagem inválida'),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type EditMessageInput = z.infer<typeof editMessageSchema>;
export type CreateChatInput = z.infer<typeof createChatSchema>;
export type CreateGroupInput = z.infer<typeof createGroupSchema>;
export type UpdateGroupInput = z.infer<typeof updateGroupSchema>;
export type SetAdminInput = z.infer<typeof setAdminSchema>;
export type MuteChatInput = z.infer<typeof muteChatSchema>;
export type AddMembersInput = z.infer<typeof addMembersSchema>;
export type ReactionInput = z.infer<typeof reactionSchema>;
export type ForwardInput = z.infer<typeof forwardSchema>;
export type PinMessageInput = z.infer<typeof pinMessageSchema>;
