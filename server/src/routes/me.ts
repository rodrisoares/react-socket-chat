import express from 'express';
import { deleteAccountSchema, updateProfileSchema } from '@react-chat/shared/schemas';

import { upload, verifyUpload } from '../config/upload.js';
import * as me from '../controllers/meController.js';
import { exportLimiter, searchLimiter, uploadLimiter } from '../middlewares/rateLimit.js';
import { requireAuth } from '../middlewares/requireAuth.js';
import { validate } from '../middlewares/validate.js';

const meRouter = express.Router();

meRouter.use(requireAuth);

meRouter.get('/', me.profile);
meRouter.patch('/', validate(updateProfileSchema), me.updateProfile);

/**
 * Levar os dados embora, e ir embora.
 *
 * As duas andam juntas de propósito: quem exclui a conta costuma querer o
 * arquivo antes, e oferecer só a porta de saída seria oferecer meia coisa.
 *
 * A exclusão pede a senha no corpo — é a única ação sem volta do app, e a senha
 * é o que distingue o dono de quem encontrou a aba aberta.
 */
meRouter.get('/export', exportLimiter, me.exportData);
meRouter.delete('/', validate(deleteAccountSchema), me.deleteAccount);

/**
 * Foto propria, por upload — a alternativa aos 16 avatares.
 *
 * Reaproveita a cadeia do anexo: o `verifyUpload` confere o tipo pelos bytes,
 * poe a extensao certa e apaga o arquivo se a resposta nao o mantiver. Devolve
 * so a URL; quem a grava no perfil e o PATCH acima, que ja aceita
 * `/uploads/<arquivo>` (ver schemas/avatar.ts).
 */
meRouter.post('/avatar', uploadLimiter, upload.single('image'), verifyUpload, me.uploadAvatar);

/**
 * A lista de conversas — e tambem a busca nelas.
 *
 * Com `?q=`, ela filtra por nome e por conteudo. Eram duas fontes: o nome
 * casado no navegador, sobre as paginas ja carregadas, e o conteudo numa rota
 * `/search` a parte. Para o filtro por nome nao esconder conversa que existe, a
 * tela era obrigada a puxar a lista inteira ao primeiro caractere digitado.
 *
 * Com o limite de busca porque, com termo, a rota passa pelo indice FTS — e a
 * tela dispara uma requisicao a cada poucas teclas.
 */
meRouter.get('/chats', searchLimiter, me.listChats);
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
