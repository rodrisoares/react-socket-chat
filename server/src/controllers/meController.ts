import type { RequestHandler } from 'express';
import type { UpdateProfileInput } from '@react-chat/shared/schemas';

import { keepUpload } from '../config/upload.js';
import { AppError } from '../errors/AppError.js';
import { currentSessionId, currentUserId } from '../middlewares/requireAuth.js';
import * as meService from '../services/meService.js';

/** O que é do próprio usuário: perfil, lista, busca, bloqueios, sessões e salvas. */

export const profile: RequestHandler = async (req, res) => {
  res.json(await meService.profile(currentUserId(req)));
};

export const updateProfile: RequestHandler = async (req, res) => {
  const updated = await meService.updateProfile(
    currentUserId(req),
    currentSessionId(req),
    req.body as UpdateProfileInput,
  );

  res.json(updated);
};

/**
 * Recebe a foto de perfil e devolve a URL dela.
 *
 * Só imagem: o `verifyUpload` aceita PDF, texto e vídeo, que servem de anexo
 * mas não de avatar. A checagem é contra o `mimetype` que ele deixou no
 * arquivo — e esse já é o tipo real, lido dos bytes, e não o que o navegador
 * declarou no envio.
 *
 * Não grava nada no perfil: quem faz isso é o PATCH /api/me, com a URL que sai
 * daqui. Separar os dois permite trocar a foto e desistir antes de salvar,
 * como já acontece com os 16 avatares.
 */
export const uploadAvatar: RequestHandler = (req, res) => {
  const file = req.file;
  if (!file) throw AppError.badRequest('Envie uma imagem');

  if (!file.mimetype.startsWith('image/')) {
    throw AppError.badRequest('A foto precisa ser uma imagem');
  }

  // Sem isto o verifyUpload apaga o arquivo quando a resposta termina.
  keepUpload(res);
  res.json({ url: `/uploads/${file.filename}` });
};

export const listChats: RequestHandler = async (req, res) => {
  const rawLimit = req.query['limit'];
  const rawCursor = req.query['cursor'];

  const limit = typeof rawLimit === 'string' ? Number(rawLimit) : undefined;
  if (limit !== undefined && !Number.isFinite(limit)) {
    throw AppError.badRequest('Parâmetro "limit" inválido');
  }

  res.json(
    await meService.listChats(currentUserId(req), {
      ...(limit !== undefined ? { limit } : {}),
      ...(typeof rawCursor === 'string' && rawCursor ? { cursor: rawCursor } : {}),
    }),
  );
};

export const search: RequestHandler = async (req, res) => {
  const raw = req.query['q'];
  const term = typeof raw === 'string' ? raw.trim() : '';

  res.json({ results: await meService.search(currentUserId(req), term) });
};

export const listBlocks: RequestHandler = async (req, res) => {
  res.json({ blocked: await meService.listBlocks(currentUserId(req)) });
};

export const block: RequestHandler<{ userId: string }> = async (req, res) => {
  await meService.block(currentUserId(req), Number(req.params.userId));
  res.json({ blocked: true });
};

export const unblock: RequestHandler<{ userId: string }> = async (req, res) => {
  await meService.unblock(currentUserId(req), Number(req.params.userId));
  res.json({ blocked: false });
};

export const listSessions: RequestHandler = async (req, res) => {
  res.json(await meService.listSessions(currentUserId(req)));
};

export const revokeSession: RequestHandler<{ id: string }> = async (req, res) => {
  await meService.revokeSession(currentUserId(req), req.params.id);
  res.json({ ok: true });
};

export const revokeOtherSessions: RequestHandler = async (req, res) => {
  const keep = req.query['keep'];
  if (typeof keep !== 'string' || !keep) {
    throw AppError.badRequest('Informe a sessão atual em "keep"');
  }

  res.json({ closed: await meService.revokeOtherSessions(currentUserId(req), keep) });
};

export const savedIds: RequestHandler = async (req, res) => {
  res.json({ ids: await meService.savedIds(currentUserId(req)) });
};

export const listSaved: RequestHandler = async (req, res) => {
  res.json({ saved: await meService.listSaved(currentUserId(req)) });
};

export const save: RequestHandler<{ messageId: string }> = async (req, res) => {
  await meService.save(currentUserId(req), req.params.messageId);
  res.json({ saved: true });
};

export const unsave: RequestHandler<{ messageId: string }> = async (req, res) => {
  await meService.unsave(currentUserId(req), req.params.messageId);
  res.json({ saved: false });
};

/**
 * `?q=` filtra no servidor. Sem termo vem a primeira página, em ordem
 * alfabética: abrir o seletor e não ver ninguém até digitar seria pior para
 * quem tem três contatos.
 */
export const contacts: RequestHandler = async (req, res) => {
  const raw = req.query['q'];
  const term = typeof raw === 'string' ? raw : '';

  res.json(await meService.contacts(currentUserId(req), term));
};
