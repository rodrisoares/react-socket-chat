import multer from 'multer';
import type { RequestHandler, Response } from 'express';
import { fileTypeFromFile } from 'file-type';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { copyFile, open, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { extname } from 'node:path';
import { UPLOAD_MAX_MB } from '@react-chat/shared';

import { AppError } from '../errors/AppError.js';
import { logger } from './logger.js';

/** Onde os anexos ficam. Servido por URL assinada em /uploads. */
export const UPLOAD_DIR = path.resolve('uploads');

if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });

/** O teto vem do pacote compartilhado: a tela avisa o mesmo número. */
const MAX_BYTES = UPLOAD_MAX_MB * 1024 * 1024;

/**
 * Tipos aceitos, e a extensao com que cada um vai para o disco.
 *
 * A extensao sai daqui, e nunca do nome enviado: e ela que decide o
 * Content-Type na hora de servir, e um "x.html" declarado como imagem ia para
 * o disco como .html e voltava como pagina, no dominio da API.
 */
const EXTENSION_OF = new Map<string, string>([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/gif', 'gif'],
  ['image/webp', 'webp'],
  // Video curto: a galeria e o lightbox tocam os dois formatos que todo
  // browser moderno decodifica sem plugin nenhum.
  ['video/mp4', 'mp4'],
  ['video/webm', 'webm'],
  ['application/pdf', 'pdf'],
  ['text/plain', 'txt'],
]);

/** O mesmo formato com outro nome: o PNG animado e um PNG para qualquer browser. */
const SAME_AS = new Map<string, string>([['image/apng', 'image/png']]);

/** So imagem tem dimensao e miniatura: o sharp nao le video. */
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

/** Largura da miniatura. A lista e a galeria a mostram com 80px de lado. */
const THUMB_WIDTH = 320;

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  // Nome gerado e ainda sem extensao: ela so e posta depois que os bytes
  // confirmam o tipo — ver verifyUpload. O nome original vai para o banco.
  filename: (_req, _file, cb) => cb(null, randomUUID()),
});

export const upload = multer({
  storage,
  limits: { fileSize: MAX_BYTES, files: 1 },
  // Primeira peneira, pelo que o client declarou: barra o obvio antes de o
  // arquivo ir para o disco. Quem decide de verdade e o verifyUpload.
  fileFilter: (_req, file, cb) => {
    if (!EXTENSION_OF.has(file.mimetype)) {
      cb(new Error(`Tipo de arquivo não permitido: ${file.mimetype}`));
      return;
    }
    cb(null, true);
  },
});

/** Texto puro nao tem assinatura: o que se confere e a falta de byte nulo, marca de binario. */
async function looksLikeText(filePath: string): Promise<boolean> {
  const handle = await open(filePath, 'r');

  try {
    const sample = Buffer.alloc(8192);
    const { bytesRead } = await handle.read(sample, 0, sample.length, 0);
    return !sample.subarray(0, bytesRead).includes(0);
  } finally {
    await handle.close();
  }
}

/**
 * O tipo do arquivo pelos bytes, e nao pelo que o client declarou — ou null
 * quando o conteudo nao e nenhum dos formatos aceitos.
 */
async function detectType(filePath: string, declared: string): Promise<string | null> {
  const found = await fileTypeFromFile(filePath);

  if (found) {
    const mime = SAME_AS.get(found.mime) ?? found.mime;
    return mime !== 'text/plain' && EXTENSION_OF.has(mime) ? mime : null;
  }

  // Sem assinatura nenhuma, so passa o que foi declarado texto e parece texto.
  // Um HTML tambem passaria — e por isso ele e gravado e servido como .txt.
  return declared === 'text/plain' && (await looksLikeText(filePath)) ? 'text/plain' : null;
}

/** Nome da miniatura de um anexo, pela convencao do upload. */
function thumbNameOf(fileName: string): string {
  return `${path.basename(fileName, extname(fileName))}.thumb.webp`;
}

/** O que o upload descobriu sobre a imagem, alem do tipo. */
export interface AttachmentMeta {
  width?: number;
  height?: number;
  thumbnailUrl?: string;
}

/**
 * Mede a imagem e gera a miniatura.
 *
 * O `rotate()` aplica a orientacao do EXIF antes de reduzir: sem ele a foto
 * tirada em pe sai deitada na miniatura. E as dimensoes sao trocadas quando o
 * EXIF pede rotacao de um quarto de volta — o `metadata` devolve o tamanho do
 * arquivo, nao o do que se ve.
 *
 * Silencioso no erro de proposito: um arquivo que o sharp nao consegue abrir
 * ainda e um anexo valido — ele so perde a miniatura e o espaco reservado.
 */
async function describeImage(fileName: string): Promise<AttachmentMeta> {
  const source = path.join(UPLOAD_DIR, fileName);

  try {
    const meta = await sharp(source).metadata();
    const quarterTurn = (meta.orientation ?? 1) >= 5;
    const width = quarterTurn ? meta.height : meta.width;
    const height = quarterTurn ? meta.width : meta.height;

    const thumbName = thumbNameOf(fileName);
    await sharp(source)
      .rotate()
      .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
      .webp({ quality: 72 })
      .toFile(path.join(UPLOAD_DIR, thumbName));

    return {
      ...(width ? { width } : {}),
      ...(height ? { height } : {}),
      thumbnailUrl: `/uploads/${thumbName}`,
    };
  } catch (error) {
    logger.error({ error, fileName }, 'uploads: falha ao medir a imagem');
    return {};
  }
}

/** Respostas cujo anexo virou mensagem: o arquivo delas fica no disco. */
const kept = new WeakSet<Response>();

/** A rota chama depois de gravar a mensagem que usa o arquivo. */
export function keepUpload(res: Response): void {
  kept.add(res);
}

/**
 * Confere o anexo pelo conteudo, poe nele a extensao do tipo confirmado e,
 * sendo imagem, mede as dimensoes e gera a miniatura.
 *
 * E garante que nada sobre no disco: o multer grava antes de a rota checar
 * participante, bloqueio e texto, e qualquer recusa depois disso deixava o
 * arquivo em uploads/ para sempre. Agora, se a resposta termina sem a rota ter
 * chamado keepUpload, o arquivo e a miniatura sao apagados.
 */
export const verifyUpload: RequestHandler = (req, res, next) => {
  const file = req.file;
  if (!file) {
    next();
    return;
  }

  res.on('finish', () => {
    if (kept.has(res)) return;
    // `file.filename` e lido so agora, e nao antes: o rename abaixo o troca.
    void removeUpload(`/uploads/${file.filename}`);
  });

  detectType(file.path, file.mimetype)
    .then(async (mime) => {
      const extension = mime ? EXTENSION_OF.get(mime) : undefined;
      if (!mime || !extension) {
        throw AppError.badRequest(
          'O conteúdo do arquivo não corresponde a nenhum tipo permitido',
        );
      }

      const name = `${file.filename}.${extension}`;
      const target = path.join(UPLOAD_DIR, name);
      await rename(file.path, target);

      file.filename = name;
      file.path = target;
      file.mimetype = mime;

      // O controller lê daqui para gravar na mensagem. `res.locals` porque o
      // dado é derivado desta requisição e morre com ela.
      const locals = res.locals as { attachment?: AttachmentMeta };
      locals.attachment = IMAGE_TYPES.has(mime) ? await describeImage(name) : {};

      next();
    })
    .catch(next);
};

/** O que o verifyUpload descobriu sobre o anexo desta requisição. */
export function attachmentMetaOf(res: Response): AttachmentMeta {
  const locals = res.locals as { attachment?: AttachmentMeta };
  return locals.attachment ?? {};
}

/** Content-Type de cada extensao que o upload grava. O que nao esta aqui nao e servido. */
const SERVED_TYPES = new Map<string, string>([
  ['png', 'image/png'],
  ['jpg', 'image/jpeg'],
  // Anexos de antes da conferencia pelos bytes guardavam a extensao do nome.
  ['jpeg', 'image/jpeg'],
  ['gif', 'image/gif'],
  ['webp', 'image/webp'],
  ['mp4', 'video/mp4'],
  ['webm', 'video/webm'],
  ['pdf', 'application/pdf'],
  ['txt', 'text/plain; charset=utf-8'],
]);

/** Tipo com que um arquivo gravado sai para o browser, ou null se ele nao deve sair. */
export function servedTypeOf(file: string): string | null {
  return SERVED_TYPES.get(extname(file).slice(1).toLowerCase()) ?? null;
}

/** So o nome, e so se ele estiver mesmo dentro da pasta de uploads. */
function safeNameOf(attachmentUrl: string): string | null {
  // A URL vem do banco, mas montar caminho com dado gravado sem conferir o
  // diretorio final e como se escapa de uma pasta. O `split` tira a
  // assinatura, caso venha de uma URL ja servida ao client.
  const name = path.basename((attachmentUrl.split('?')[0] ?? '').trim());
  return path.dirname(path.join(UPLOAD_DIR, name)) === UPLOAD_DIR ? name : null;
}

/**
 * Apaga o arquivo de um anexo, e a miniatura junto. Sem isto, apagar a
 * mensagem limpava a referencia no banco e deixava os arquivos em /uploads
 * para sempre.
 *
 * Silencioso de proposito: o arquivo pode ja ter sumido, e a exclusao da
 * mensagem nao pode falhar por causa do disco.
 */
export async function removeUpload(attachmentUrl: string | null): Promise<void> {
  if (!attachmentUrl) return;

  const name = safeNameOf(attachmentUrl);
  if (!name) return;

  // A miniatura sai por convencao de nome: ela nao tem registro proprio, e
  // deixa-la para tras encheria a pasta de orfas.
  for (const target of [name, thumbNameOf(name)]) {
    try {
      await rm(path.join(UPLOAD_DIR, target), { force: true });
    } catch (error) {
      logger.error({ error, target }, 'uploads: falha ao remover anexo');
    }
  }
}

/** Uma copia de anexo: o arquivo e a miniatura dele, quando existe. */
export interface CopiedUpload {
  url: string;
  thumbnailUrl?: string;
}

/**
 * Duplica o arquivo de um anexo e devolve o caminho da copia.
 *
 * Encaminhar copia em vez de reaproveitar o mesmo arquivo de proposito: as
 * mensagens sao independentes, e apagar a original chama o removeUpload — que
 * levaria junto o anexo de todas as copias.
 *
 * A miniatura vai junto: sem ela a copia encaminhada apontaria para a miniatura
 * da original, que some quando a original e apagada.
 */
export async function copyUpload(attachmentUrl: string | null): Promise<CopiedUpload | null> {
  if (!attachmentUrl) return null;

  const name = safeNameOf(attachmentUrl);
  if (!name) return null;

  const target = `${randomUUID()}${extname(name).toLowerCase()}`;

  try {
    await copyFile(path.join(UPLOAD_DIR, name), path.join(UPLOAD_DIR, target));
  } catch (error) {
    logger.error({ error }, 'uploads: falha ao copiar anexo');
    return null;
  }

  const copy: CopiedUpload = { url: `/uploads/${target}` };

  try {
    const thumb = thumbNameOf(target);
    await copyFile(
      path.join(UPLOAD_DIR, thumbNameOf(name)),
      path.join(UPLOAD_DIR, thumb),
    );
    copy.thumbnailUrl = `/uploads/${thumb}`;
  } catch {
    // Anexo sem miniatura — video, PDF, ou imagem de antes desta mudanca. A
    // copia existe do mesmo jeito, so sem a versao reduzida.
  }

  return copy;
}
