import { createHmac, timingSafeEqual } from 'node:crypto';
import path from 'node:path';

import { env } from './env.js';

/**
 * Anexos servidos por URL assinada, no lugar do express.static aberto.
 *
 * A assinatura resolve um problema concreto: a foto aparece num <img src>, e o
 * browser nao manda o header Authorization numa tag dessas. Exigir o token do
 * usuario na URL vazaria a sessao para o historico e para os logs — entao a URL
 * carrega uma assinatura propria, que so vale para aquele arquivo e expira.
 *
 * O que isso garante: o link so pode ter sido emitido pelo servidor, dentro de
 * uma mensagem, que so e entregue a quem participa da conversa. O que nao
 * garante: um participante ainda pode repassar o link a terceiros ate ele
 * expirar — e o mesmo modelo das URLs pre-assinadas de S3.
 *
 * A chave e a `attachmentSecret`, e nao a das sessoes: esta assinatura circula
 * em cada <img> da tela e em todo link repassado (ver config/env.ts).
 */
const TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Grade em que o vencimento e arredondado.
 *
 * Sem ela o `exp` saia de `Date.now()`, entao cada resposta trazia uma URL
 * diferente para o mesmo arquivo — e o cache de um dia do navegador nunca
 * acertava: reabrir a galeria baixava tudo de novo. Arredondando para cima numa
 * grade fixa, todas as respostas da mesma hora produzem a mesma URL, e o
 * arquivo e baixado uma vez so.
 *
 * O preco e o prazo variar entre 24h e 25h, o que nao muda nada para quem le.
 */
const WINDOW_MS = 60 * 60 * 1000;

/** Nome do arquivo, sem diretorio e sem query. */
function fileNameOf(storedUrl: string): string {
  return path.basename((storedUrl.split('?')[0] ?? '').trim());
}

function sign(file: string, expiresAt: number): string {
  return createHmac('sha256', env.attachmentSecret)
    .update(`${file}.${expiresAt}`)
    .digest('hex');
}

/** O vencimento da janela atual — igual para todas as assinaturas dela. */
function currentExpiry(): number {
  return Math.ceil((Date.now() + TTL_MS) / WINDOW_MS) * WINDOW_MS;
}

/** URL que o client usa no <img>/<a>, ja assinada. */
export function signedAttachmentUrl(storedUrl: string): string {
  const file = fileNameOf(storedUrl);
  const expiresAt = currentExpiry();

  return `/uploads/${file}?exp=${expiresAt}&sig=${sign(file, expiresAt)}`;
}

export function isSignatureValid(
  file: string,
  exp: unknown,
  sig: unknown,
): boolean {
  if (typeof exp !== 'string' || typeof sig !== 'string') return false;

  const expiresAt = Number(exp);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;

  const expected = Buffer.from(sign(fileNameOf(file), expiresAt), 'utf8');
  const received = Buffer.from(sig, 'utf8');

  // O timingSafeEqual exige mesmo tamanho; sem isto ele lanca em vez de negar.
  if (expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
}
