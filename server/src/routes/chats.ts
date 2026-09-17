import express from 'express';
import {
  addMembersSchema,
  createChatSchema,
  createGroupSchema,
  editMessageSchema,
  forwardSchema,
  muteChatSchema,
  pinMessageSchema,
  reactionSchema,
  sendMessageSchema,
  setAdminSchema,
  updateGroupSchema,
} from '@react-chat/shared/schemas';

import { upload, verifyUpload } from '../config/upload.js';
import * as chats from '../controllers/chatsController.js';
import * as messages from '../controllers/messagesController.js';
import {
  createChatLimiter,
  messageLimiter,
  searchLimiter,
  uploadLimiter,
} from '../middlewares/rateLimit.js';
import { requireAuth } from '../middlewares/requireAuth.js';
import { validate } from '../middlewares/validate.js';

/**
 * Só o mapeamento de URL: limites, validação e autenticação são middlewares, e
 * o que cada rota faz está no controller. Este arquivo tinha 860 linhas com
 * regra de negócio e emissão de socket no meio.
 */
const chatsRouter = express.Router();

chatsRouter.use(requireAuth);

// ------------------------------------------------------------- a conversa

chatsRouter.post('/', createChatLimiter, validate(createChatSchema), chats.openDirect);
chatsRouter.post('/groups', createChatLimiter, validate(createGroupSchema), chats.createGroup);

// Entrar pelo link de convite — o unico caminho de entrada que nao exige ser
// admin, que e justamente o que o link existe para permitir. Declarada antes
// das rotas de `/:id` por clareza; o caminho tem tres segmentos e nao colide
// com nenhuma delas. Com o limite de criacao de conversa: o codigo e a unica
// credencial do grupo, e tentativas em serie sao o ataque obvio.
chatsRouter.post('/invites/:code/join', createChatLimiter, chats.joinInvite);

chatsRouter.patch('/:id', validate(updateGroupSchema), chats.updateGroup);
chatsRouter.post('/:id/members', validate(addMembersSchema), chats.addMembers);
chatsRouter.put(
  '/:id/members/:userId/admin',
  validate(setAdminSchema),
  chats.setAdmin,
);
chatsRouter.delete('/:id/members/:userId', chats.removeMember);
chatsRouter.post('/:id/invite', chats.createInvite);
chatsRouter.delete('/:id/invite', chats.revokeInvite);
chatsRouter.get('/:id/summary', chats.summary);
chatsRouter.get('/:id', chats.details);

// ------------------------------------------------------------- mensagens

chatsRouter.get('/:id/media', messages.gallery);
chatsRouter.get('/:id/messages', messages.list);
// "Dados da mensagem": quem ja leu e quem falta. So o autor pergunta.
chatsRouter.get('/:id/messages/:messageId/info', messages.info);
chatsRouter.get('/:id/search', searchLimiter, messages.search);

chatsRouter.post(
  '/:id/messages',
  messageLimiter,
  // Antes do multer: negar depois de o arquivo ja estar no disco gastaria
  // justamente o que o limite existe para proteger.
  uploadLimiter,
  upload.single('attachment'),
  // Confere o anexo pelos bytes e o apaga se a requisicao for recusada daqui
  // em diante — participante, bloqueio e texto so sao checados depois do disco.
  verifyUpload,
  validate(sendMessageSchema),
  messages.send,
);

chatsRouter.patch(
  '/:id/messages/:messageId',
  messageLimiter,
  validate(editMessageSchema),
  messages.edit,
);
chatsRouter.delete('/:id/messages/:messageId', messages.remove);
chatsRouter.post(
  '/:id/messages/:messageId/forward',
  messageLimiter,
  validate(forwardSchema),
  messages.forward,
);
chatsRouter.put(
  '/:id/messages/:messageId/reaction',
  validate(reactionSchema),
  messages.react,
);
chatsRouter.delete('/:id/messages/:messageId/reaction', messages.removeReaction);

// --------------------------------------------- o que cada um vê da conversa

chatsRouter.post('/:id/pinned', validate(pinMessageSchema), chats.pinMessage);
chatsRouter.delete('/:id/pinned', chats.unpinMessage);
chatsRouter.post('/:id/readMessages', chats.markRead);
chatsRouter.post('/:id/unreadMessages', chats.markUnread);
chatsRouter.post('/:id/pin', chats.pin);
chatsRouter.delete('/:id/pin', chats.unpin);
chatsRouter.post('/:id/archive', chats.archive);
chatsRouter.delete('/:id/archive', chats.unarchive);
// Corpo opcional: sem `minutes` e o "ate eu desfazer"; com, e o prazo.
chatsRouter.post('/:id/mute', validate(muteChatSchema), chats.mute);
chatsRouter.delete('/:id/mute', chats.unmute);
chatsRouter.post('/:id/clear', chats.clearHistory);
chatsRouter.delete('/:id', chats.remove);

export default chatsRouter;
