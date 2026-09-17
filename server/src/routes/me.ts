import express from 'express';
import { updateProfileSchema } from '@react-chat/shared/schemas';

import { upload, verifyUpload } from '../config/upload.js';
import * as me from '../controllers/meController.js';
import { searchLimiter, uploadLimiter } from '../middlewares/rateLimit.js';
import { requireAuth } from '../middlewares/requireAuth.js';
import { validate } from '../middlewares/validate.js';

const meRouter = express.Router();

meRouter.use(requireAuth);

meRouter.get('/', me.profile);
meRouter.patch('/', validate(updateProfileSchema), me.updateProfile);

/**
 * Foto propria, por upload — a alternativa aos 16 avatares.
 *
 * Reaproveita a cadeia do anexo: o `verifyUpload` confere o tipo pelos bytes,
 * poe a extensao certa e apaga o arquivo se a resposta nao o mantiver. Devolve
 * so a URL; quem a grava no perfil e o PATCH acima, que ja aceita
 * `/uploads/<arquivo>` (ver schemas/avatar.ts).
 */
meRouter.post('/avatar', uploadLimiter, upload.single('image'), verifyUpload, me.uploadAvatar);

meRouter.get('/chats', me.listChats);
meRouter.get('/search', searchLimiter, me.search);
// Com limite de busca: a rota virou consulta com termo, e a tela dispara uma a
// cada poucas teclas — o mesmo motivo que pôs o limite na busca de mensagens.
meRouter.get('/contacts', searchLimiter, me.contacts);

meRouter.get('/blocks', me.listBlocks);
meRouter.post('/blocks/:userId', me.block);
meRouter.delete('/blocks/:userId', me.unblock);

meRouter.get('/sessions', me.listSessions);
meRouter.delete('/sessions', me.revokeOtherSessions);
meRouter.delete('/sessions/:id', me.revokeSession);

meRouter.get('/saved/ids', me.savedIds);
meRouter.get('/saved', me.listSaved);
meRouter.post('/saved/:messageId', me.save);
meRouter.delete('/saved/:messageId', me.unsave);

export default meRouter;
