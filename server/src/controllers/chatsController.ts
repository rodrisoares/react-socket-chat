import type { RequestHandler } from 'express';
import type {
  AddMembersInput,
  CreateChatInput,
  CreateGroupInput,
  MuteChatInput,
  PinMessageInput,
  SetAdminInput,
  UpdateGroupInput,
} from '@react-chat/shared/schemas';

import { currentUserId } from '../middlewares/requireAuth.js';
import * as chatService from '../services/chatService.js';

/**
 * Traduz requisição em chamada de serviço, e o resultado em resposta. Nenhuma
 * regra mora aqui — quem decide quem pode o quê é o `chatService`.
 */

export const openDirect: RequestHandler = async (req, res) => {
  const { otherUserId } = req.body as CreateChatInput;
  const chat = await chatService.openDirect(currentUserId(req), otherUserId);

  // 201 só quando ela nasceu agora; reabrir uma que já existia é 200.
  res.status(chat.isNew ? 201 : 200).json({ id: chat.id, type: chat.type });
};

export const createGroup: RequestHandler = async (req, res) => {
  const { name, memberIds, image, description } = req.body as CreateGroupInput;

  const chat = await chatService.createGroup(currentUserId(req), name, memberIds, {
    ...(image ? { image } : {}),
    ...(description ? { description } : {}),
  });

  res.status(201).json(chat);
};

export const updateGroup: RequestHandler<{ id: string }> = async (req, res) => {
  const { name, image, description, onlyAdminsSend } = req.body as UpdateGroupInput;
  const chatId = req.params.id;

  await chatService.updateGroup(chatId, currentUserId(req), {
    ...(name !== undefined ? { name } : {}),
    ...(image !== undefined ? { image } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(onlyAdminsSend !== undefined ? { onlyAdminsSend } : {}),
  });

  res.json({ id: chatId, name, image, description, onlyAdminsSend });
};

export const setAdmin: RequestHandler<{ id: string; userId: string }> = async (req, res) => {
  const { isAdmin } = req.body as SetAdminInput;
  const targetId = Number(req.params.userId);

  await chatService.setAdmin(req.params.id, currentUserId(req), targetId, isAdmin);
  res.json({ id: targetId, isAdmin });
};

/** Gera o convite — ou troca o que existia, invalidando os links que circulam. */
export const createInvite: RequestHandler<{ id: string }> = async (req, res) => {
  const inviteUrl = await chatService.createInvite(req.params.id, currentUserId(req));
  res.json({ inviteUrl });
};

export const revokeInvite: RequestHandler<{ id: string }> = async (req, res) => {
  await chatService.revokeInvite(req.params.id, currentUserId(req));
  res.json({ inviteUrl: null });
};

/**
 * Entra no grupo pelo link. 201 quando a entrada aconteceu agora; abrir o
 * mesmo link já estando dentro é 200, e só leva à conversa.
 */
export const joinInvite: RequestHandler<{ code: string }> = async (req, res) => {
  const chat = await chatService.joinByInvite(req.params.code, currentUserId(req));
  res.status(chat.isNew ? 201 : 200).json({ id: chat.id });
};

export const addMembers: RequestHandler<{ id: string }> = async (req, res) => {
  const { memberIds } = req.body as AddMembersInput;
  const added = await chatService.addMembers(req.params.id, currentUserId(req), memberIds);

  res.json({ added });
};

export const removeMember: RequestHandler<{ id: string; userId: string }> = async (
  req,
  res,
) => {
  const targetId = Number(req.params.userId);
  await chatService.removeMember(req.params.id, currentUserId(req), targetId);

  res.json({ removed: targetId });
};

export const summary: RequestHandler<{ id: string }> = async (req, res) => {
  res.json({ chat: await chatService.summary(req.params.id, currentUserId(req)) });
};

export const details: RequestHandler<{ id: string }> = async (req, res) => {
  res.json(await chatService.details(req.params.id, currentUserId(req)));
};

export const pinMessage: RequestHandler<{ id: string }> = async (req, res) => {
  const { messageId } = req.body as PinMessageInput;
  await chatService.pinMessage(req.params.id, currentUserId(req), messageId);

  res.json({ pinnedMessageId: messageId });
};

export const unpinMessage: RequestHandler<{ id: string }> = async (req, res) => {
  await chatService.unpinMessage(req.params.id, currentUserId(req));
  res.json({ pinnedMessageId: null });
};

export const markRead: RequestHandler<{ id: string }> = async (req, res) => {
  await chatService.markRead(req.params.id, currentUserId(req));
  res.json({ ok: true });
};

export const markUnread: RequestHandler<{ id: string }> = async (req, res) => {
  await chatService.markUnread(req.params.id, currentUserId(req));
  res.json({ ok: true });
};

export const pin: RequestHandler<{ id: string }> = async (req, res) => {
  await chatService.setPinned(req.params.id, currentUserId(req), true);
  res.json({ isPinned: true });
};

export const unpin: RequestHandler<{ id: string }> = async (req, res) => {
  await chatService.setPinned(req.params.id, currentUserId(req), false);
  res.json({ isPinned: false });
};

export const archive: RequestHandler<{ id: string }> = async (req, res) => {
  await chatService.setArchived(req.params.id, currentUserId(req), true);
  res.json({ isArchived: true });
};

export const unarchive: RequestHandler<{ id: string }> = async (req, res) => {
  await chatService.setArchived(req.params.id, currentUserId(req), false);
  res.json({ isArchived: false });
};

export const mute: RequestHandler<{ id: string }> = async (req, res) => {
  // Sem `minutes` é o "até eu desfazer"; com, é o prazo em minutos.
  const { minutes } = (req.body ?? {}) as MuteChatInput;

  await chatService.setMuted(req.params.id, currentUserId(req), true, minutes);
  res.json({ isMuted: true });
};

export const unmute: RequestHandler<{ id: string }> = async (req, res) => {
  await chatService.setMuted(req.params.id, currentUserId(req), false);
  res.json({ isMuted: false });
};

export const clearHistory: RequestHandler<{ id: string }> = async (req, res) => {
  await chatService.clearHistory(req.params.id, currentUserId(req));
  res.json({ ok: true });
};

export const remove: RequestHandler<{ id: string }> = async (req, res) => {
  await chatService.remove(req.params.id, currentUserId(req));
  res.json({ ok: true });
};
