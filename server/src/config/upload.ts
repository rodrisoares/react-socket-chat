import multer from 'multer';
import type { RequestHandler, Response } from 'express';
import { fileTypeFromFile } from 'file-type';
import sharp, { type Sharp } from 'sharp';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { copyFile, open, readdir, rename, rm, stat } from 'node:fs/promises';
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

/** Formatos que podem carregar animacao: o sharp precisa ser avisado. */
const ANIMATED_TYPES = new Set(['image/gif', 'image/webp']);

/**
 * Como cada formato e reescrito. Mantem o formato de origem de proposito:
 * converter tudo para webp quebraria o GIF animado que a pessoa mandou e faria
 * o arquivo baixado ter outra extensao do que ela escolheu.
 */
function encode(pipeline: Sharp, mime: string, animated: boolean): Sharp {
  if (mime === 'image/png') return pipeline.png({ compressionLevel: 9 });
  if (mime === 'image/gif') return pipeline.gif();
  if (mime === 'image/webp') return pipeline.webp({ quality: 85, ...(animated ? { effort: 4 } : {}) });
  return pipeline.jpeg({ quality: 88 });
}

/**
 * Reescreve a imagem sem metadado, com a orientacao ja aplicada.
 *
 * O arquivo servido era o que subiu, byte por byte — com o EXIF inteiro
 * dentro, inclusive a coordenada de GPS que a camera do celular grava por
 * padrao. Mandar uma foto num grupo entregava, junto, o lugar onde ela foi
 * tirada, e nada na tela dizia isso. A miniatura ja nascia limpa (o sharp nao
 * copia metadado para a saida), o que tornava o vazamento ainda mais
 * silencioso: o que aparecia na lista estava limpo, e o original, nao.
 *
 * Reescrever tambem resolve a orientacao de vez: em vez de a tela depender da
 * etiqueta EXIF para saber que a foto esta de lado, os pixels ja vem na posicao
 * certa. E o que permite medir o arquivo direto, sem a troca de largura e
 * altura que a etiqueta obrigava.
 *
 * O preco e uma recodificacao por imagem enviada — perda pequena de qualidade
 * no JPEG, e CPU no upload. O silencio no erro e de proposito: um arquivo que o
 * sharp nao consegue reescrever continua sendo um anexo valido, e nesse caso o
 * original segue como esta.
 */
async function normalizeImage(fileName: string, mime: string): Promise<void> {
  const source = path.join(UPLOAD_DIR, fileName);
  const temp = path.join(UPLOAD_DIR, `${fileName}.tmp`);
  const animated = ANIMATED_TYPES.has(mime);

  try {
    // `rotate()` sem angulo aplica a etiqueta do EXIF. Fora do caminho animado:
    // GIF nao tem EXIF, e girar quadro a quadro so gastaria CPU.
    const pipeline = sharp(source, animated ? { animated: true } : {});
    await encode(animated ? pipeline : pipeline.rotate(), mime, animated).toFile(temp);

    await rename(temp, source);
  } catch (error) {
    logger.error({ error, fileName }, 'uploads: falha ao reescrever a imagem');
    await rm(temp, { force: true }).catch(() => undefined);
  }
}

/**
 * Mede a imagem e gera a miniatura.
 *
 * Roda depois do `normalizeImage`, entao o que o `metadata` devolve ja e o
 * tamanho do que se ve: a rotacao esta nos pixels, e nao numa etiqueta.
 *
 * Silencioso no erro de proposito: um arquivo que o sharp nao consegue abrir
 * ainda e um anexo valido — ele so perde a miniatura e o espaco reservado.
 */
async function describeImage(fileName: string): Promise<AttachmentMeta> {
  const source = path.join(UPLOAD_DIR, fileName);

  try {
    const { width, height } = await sharp(source).metadata();

    const thumbName = thumbNameOf(fileName);
    // Sem `animated`: a miniatura e o primeiro quadro, que e o que a lista e a
    // galeria mostram com 80px de lado.
    await sharp(source)
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

/** Lado maximo da foto de perfil. Acima disto e desperdicio de disco e banda. */
export const AVATAR_SIZE = 512;

/**
 * Reduz a imagem ja conferida a uma foto de perfil, e devolve o nome novo.
 *
 * A tela recorta antes de enviar, mas o `accept` e o recorte sao do cliente: um
 * POST direto em `/api/me/avatar` subia 10 MB e eles viravam a foto que carrega
 * em cada card da lista, em cada balao e em cada painel de detalhes.
 *
 * Sai sempre em webp quadrado: e a foto de perfil, que a tela so mostra em
 * circulo pequeno — manter o formato de origem aqui nao serve a ninguem, ao
 * contrario do anexo, que a pessoa baixa de volta.
 *
 * O original sai do disco junto com a miniatura que o `verifyUpload` gerou para
 * ele: nenhuma das duas tem uso depois desta reducao.
 */
export async function shrinkToAvatar(fileName: string): Promise<string> {
  const base = path.basename(fileName, extname(fileName));
  const name = `${base}.webp`;
  const temp = path.join(UPLOAD_DIR, `${base}.avatar.tmp`);

  try {
    await sharp(path.join(UPLOAD_DIR, fileName))
      .rotate()
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toFile(temp);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    logger.error({ error, fileName }, 'uploads: falha ao reduzir o avatar');
    throw AppError.badRequest('Não foi possível processar esta imagem');
  }

  // Só depois de a versão reduzida existir: uma falha acima não pode deixar o
  // usuário sem foto nenhuma.
  await removeUpload(`/uploads/${fileName}`);
  await rename(temp, path.join(UPLOAD_DIR, name));

  return name;
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

      // Imagem é reescrita antes de qualquer outra coisa: o que for medido,
      // reduzido e servido daqui em diante já é o arquivo limpo.
      if (IMAGE_TYPES.has(mime)) await normalizeImage(name, mime);

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

/** Um arquivo que esta em uploads/, com a idade dele. */
export interface StoredUpload {
  name: string;
  modifiedAt: Date;
}

/** Tudo o que ha na pasta agora. So a varredura de orfaos usa. */
export async function listUploadFiles(): Promise<StoredUpload[]> {
  const entries = await readdir(UPLOAD_DIR, { withFileTypes: true });

  const found = await Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map(async (entry) => {
        try {
          const info = await stat(path.join(UPLOAD_DIR, entry.name));
          return { name: entry.name, modifiedAt: info.mtime };
        } catch {
          // Sumiu entre o listar e o medir: para a varredura, nao existe.
          return null;
        }
      }),
  );

  return found.filter((file): file is StoredUpload => file !== null);
}

/**
 * Apaga um arquivo pelo nome, e so ele.
 *
 * O `removeUpload` leva a miniatura junto, o que e o certo quando se apaga um
 * anexo; aqui nao, porque a varredura ja percorre a miniatura por conta
 * propria — e pedir a exclusao dela duas vezes so faz barulho no log.
 */
export async function removeUploadFile(name: string): Promise<void> {
  try {
    await rm(path.join(UPLOAD_DIR, path.basename(name)), { force: true });
  } catch (error) {
    logger.error({ error, name }, 'uploads: falha ao remover órfão');
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
