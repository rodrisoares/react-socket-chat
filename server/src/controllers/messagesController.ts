import type { RequestHandler } from 'express';
import type { GalleryTab } from '@react-chat/shared';
import type {
  EditMessageInput,
  ForwardInput,
  ReactionInput,
  SendMessageInput,
} from '@react-chat/shared/schemas';

import { attachmentMetaOf, keepUpload } from '../config/upload.js';
import { AppError } from '../errors/AppError.js';
import { currentUserId } from '../middlewares/requireAuth.js';
import * as messageService from '../services/messageService.js';

/** As mensagens de uma conversa: ler, enviar, editar, apagar, encaminhar, reagir. */

export const list: RequestHandler<{ id: string }> = async (req, res) => {
  // `?around=<id>` abre a janela em volta de uma mensagem, em vez de paginar
  // para trás a partir do fim: é o salto até a citação, a fixada ou um
  // resultado da busca.
  const rawAround = req.query['around'];
  if (typeof rawAround === 'string' && rawAround) {
    res.json(await messageService.listAround(req.params.id, currentUserId(req), rawAround));
    return;
  }

  // `?after=<iso>&afterId=<id>` anda no sentido do presente: é a volta do
  // salto, para quem pulou até uma mensagem antiga poder reencontrar o fim da
  // conversa sem fechá-la.
  const rawAfter = req.query['after'];
  if (typeof rawAfter === 'string' && rawAfter) {
    const after = new Date(rawAfter);
    if (Number.isNaN(after.getTime())) {
      throw AppError.badRequest('Parâmetro "after" inválido');
    }

    const rawAfterId = req.query['afterId'];
    const afterId = typeof rawAfterId === 'string' && rawAfterId ? rawAfterId : undefined;

    res.json(await messageService.listNewer(req.params.id, currentUserId(req), after, afterId));
    return;
  }

  const rawBefore = req.query['before'];
  const before = typeof rawBefore === 'string' ? new Date(rawBefore) : undefined;

  if (before && Number.isNaN(before.getTime())) {
    throw AppError.badRequest('Parâmetro "before" inválido');
  }

  // O id da mesma mensagem do `before`, para desempatar o milissegundo
  // repetido. Opcional: o cliente antigo manda só o instante.
  const rawBeforeId = req.query['beforeId'];
  const beforeId = typeof rawBeforeId === 'string' && rawBeforeId ? rawBeforeId : undefined;

  res.json(
    await messageService.listPage(req.params.id, currentUserId(req), before, beforeId),
  );
};

export const search: RequestHandler<{ id: string }> = async (req, res) => {
  const raw = req.query['q'];
  const term = typeof raw === 'string' ? raw.trim() : '';

  res.json({ messages: await messageService.search(req.params.id, currentUserId(req), term) });
};

/** As abas que `?tab=` aceita — a mesma lista do contrato. */
const GALLERY_TABS: GalleryTab[] = ['media', 'files', 'links'];

export const gallery: RequestHandler<{ id: string }> = async (req, res) => {
  // Sem `?tab=`, é a abertura do painel: a primeira página das três abas. Com
  // ela, é o "Carregar mais" de uma aba só, continuando do `?cursor=`.
  const rawTab = req.query['tab'];
  if (rawTab !== undefined && !GALLERY_TABS.includes(rawTab as GalleryTab)) {
    throw AppError.badRequest('Parâmetro "tab" inválido');
  }

  const tab = rawTab as GalleryTab | undefined;

  const rawCursor = req.query['cursor'];
  const cursor = typeof rawCursor === 'string' && rawCursor ? rawCursor : undefined;

  // Cursor sem aba não diz de qual das três ele é: as três paginam separadas.
  if (cursor && !tab) {
    throw AppError.badRequest('O parâmetro "cursor" exige "tab"');
  }

  res.json(
    await messageService.gallery(req.params.id, currentUserId(req), {
      ...(tab ? { tab } : {}),
      ...(cursor ? { cursor } : {}),
    }),
  );
};

export const send: RequestHandler<{ id: string }> = async (req, res) => {
  const { text, replyToId } = req.body as SendMessageInput;
  const file = req.file;

  const message = await messageService.send(req.params.id, currentUserId(req), {
    text,
    ...(replyToId ? { replyToId } : {}),
    ...(file
      ? {
          attachment: {
            url: `/uploads/${file.filename}`,
            name: file.originalname,
            type: file.mimetype,
            // Medidas e miniatura vêm do verifyUpload, que já abriu o arquivo
            // para conferir os bytes — medir de novo aqui seria abrir duas vezes.
            ...attachmentMetaOf(res),
          },
        }
      : {}),
  });

  // A mensagem existe: o arquivo passa a ser dela e fica no disco.
  keepUpload(res);
  res.json(message);
};

export const edit: RequestHandler<{ id: string; messageId: string }> = async (req, res) => {
  const { text } = req.body as EditMessageInput;

  res.json(
    await messageService.edit(
      req.params.id,
      currentUserId(req),
      req.params.messageId,
      text,
    ),
  );
};

/**
 * `?scope=me` apaga só para quem pediu; sem ele, apaga para todos.
 *
 * "Para mim" é estado privado, como bloquear e silenciar: não emite nada para a
 * sala e não devolve mensagem nenhuma — não há o que a tela dos outros
 * atualizar. "Para todos" devolve a mensagem já apagada, que é o que o socket
 * espalha.
 */
export const remove: RequestHandler<{ id: string; messageId: string }> = async (
  req,
  res,
) => {
  if (req.query['scope'] === 'me') {
    await messageService.removeForMe(
      req.params.id,
      currentUserId(req),
      req.params.messageId,
    );

    res.json({ deletedForMe: true });
    return;
  }

  res.json(
    await messageService.removeForEveryone(
      req.params.id,
      currentUserId(req),
      req.params.messageId,
    ),
  );
};

/** "Dados da mensagem": quem já leu e quem falta. Só o autor pergunta. */
export const info: RequestHandler<{ id: string; messageId: string }> = async (req, res) => {
  res.json(
    await messageService.info(req.params.id, currentUserId(req), req.params.messageId),
  );
};

export const forward: RequestHandler<{ id: string; messageId: string }> = async (
  req,
  res,
) => {
  const { chatIds } = req.body as ForwardInput;

  const forwarded = await messageService.forward(
    req.params.id,
    currentUserId(req),
    req.params.messageId,
    chatIds,
  );

  res.json({ forwarded });
};

export const react: RequestHandler<{ id: string; messageId: string }> = async (req, res) => {
  const { emoji } = req.body as ReactionInput;

  res.json(
    await messageService.react(
      req.params.id,
      currentUserId(req),
      req.params.messageId,
      emoji,
    ),
  );
};

export const removeReaction: RequestHandler<{ id: string; messageId: string }> = async (
  req,
  res,
) => {
  res.json(
    await messageService.removeReaction(
      req.params.id,
      currentUserId(req),
      req.params.messageId,
    ),
  );
};
