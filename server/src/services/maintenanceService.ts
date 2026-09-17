import path from 'node:path';

import { listUploadFiles, removeUploadFile } from '../config/upload.js';
import * as chats from '../repositories/chatRepository.js';
import * as messages from '../repositories/messageRepository.js';
import * as users from '../repositories/userRepository.js';

/**
 * A faxina que roda sozinha — hoje, os anexos sem dono.
 *
 * Fica fora dos serviços de domínio de propósito: nada aqui responde a uma
 * requisição. Quem a chama é o `index.ts`, na subida e uma vez por dia.
 */

/**
 * Idade mínima para um arquivo ser considerado órfão.
 *
 * Sem ela a varredura brigaria com o upload em curso: o multer grava no disco
 * antes de a rota gravar a mensagem, e um arquivo que ainda não virou mensagem
 * é indistinguível de um abandonado. Um dia de folga torna a corrida
 * impossível na prática, e o órfão de verdade some no dia seguinte.
 */
const MIN_AGE_MS = 24 * 60 * 60 * 1000;

/** Só o nome do arquivo: o banco guarda `/uploads/<arquivo>`. */
function fileNameOf(storedUrl: string): string {
  return path.basename((storedUrl.split('?')[0] ?? '').trim());
}

/**
 * Apaga de `uploads/` o que nenhuma linha do banco referencia mais.
 *
 * Havia três caminhos que deixavam arquivo para trás, e só o primeiro tinha
 * conserto: apagar uma mensagem para todos chama o `removeUpload`, e trocar a
 * foto de perfil também. O resto não — o `onDelete: Cascade` do Prisma leva as
 * linhas de `Message` quando uma conversa ou um usuário some, e o disco não
 * sabe de nada; e um processo que morre entre o multer gravar e a rota
 * responder deixa o arquivo sem ninguém para removê-lo.
 *
 * A varredura fecha os três de uma vez, e por um caminho que não depende de
 * cada rota lembrar de limpar o que sujou. A conta é a lista do disco menos a
 * lista do banco — anexo de mensagem, miniatura, foto de perfil e foto de
 * grupo.
 *
 * Devolve quantos arquivos saíram.
 */
export async function sweepOrphanUploads(): Promise<number> {
  const [stored, attachments, userImages, chatImages] = await Promise.all([
    listUploadFiles(),
    messages.listAttachmentPaths(),
    users.listUploadedImages(),
    chats.listUploadedImages(),
  ]);

  const referenced = new Set(
    [...attachments, ...userImages, ...chatImages].map(fileNameOf),
  );

  const cutoff = Date.now() - MIN_AGE_MS;
  const orphans = stored.filter(
    (file) => !referenced.has(file.name) && file.modifiedAt.getTime() < cutoff,
  );

  for (const orphan of orphans) await removeUploadFile(orphan.name);

  return orphans.length;
}
