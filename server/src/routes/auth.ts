import express from 'express';
import { loginSchema, registerSchema } from '@react-chat/shared/schemas';

import * as auth from '../controllers/authController.js';
import {
  loginLimiter,
  refreshLimiter,
  registerLimiter,
} from '../middlewares/rateLimit.js';
import { requireAuth } from '../middlewares/requireAuth.js';
import { validate } from '../middlewares/validate.js';

const authRouter = express.Router();

authRouter.post('/register', registerLimiter, validate(registerSchema), auth.register);
authRouter.post('/login', loginLimiter, validate(loginSchema), auth.login);

/**
 * Renovar e sair não exigem o header de autenticação de propósito: quem chama
 * é justamente quem está com o access token expirado.
 *
 * O limite do refresh é por IP, e não por usuário: quem tenta adivinhar um
 * refresh token não tem sessão nenhuma para servir de chave.
 */
authRouter.post('/refresh', refreshLimiter, auth.refresh);
authRouter.post('/logout', auth.logout);

authRouter.get('/me', requireAuth, auth.restore);

export default authRouter;
