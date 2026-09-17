import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { readdirSync } from 'node:fs';
import sharp from 'sharp';

import { app } from '../src/app.js';
import { signedAttachmentUrl } from '../src/config/attachments.js';
import { UPLOAD_DIR } from '../src/config/upload.js';
import {
  body,
  createDirectChat,
  createUser,
  PDF_MIN,
  PNG_1PX,
  resetDb,
  tokenFor,
} from './helpers.js';
import type { ErrorBody } from './helpers.js';

/** O que ha em uploads/ agora — para provar que uma recusa nao deixou nada. */
function uploadsNow(): string[] {
  return readdirSync(UPLOAD_DIR).sort();
}

/** Envia um anexo qualquer, sem esperar status: quem confere e o teste. */
function sendFile(
  chatId: string,
  userId: number,
  content: Buffer,
  file: { filename: string; contentType: string },
) {
  return request(app)
    .post(`/api/chats/${chatId}/messages`)
    .set('Authorization', `Bearer ${tokenFor(userId)}`)
    .field('text', 'segue')
    .attach('attachment', content, file);
}

interface SentMessage {
  id: string;
  attachment: { url: string; name: string; type: string } | null;
}

/** Envia uma mensagem com anexo e devolve o que o servidor serializou. */
async function sendWithAttachment(chatId: string, userId: number) {
  const response = await request(app)
    .post(`/api/chats/${chatId}/messages`)
    .set('Authorization', `Bearer ${tokenFor(userId)}`)
    .field('text', 'segue')
    .attach('attachment', Buffer.from('conteudo secreto'), {
      filename: 'nota.txt',
      contentType: 'text/plain',
    })
    .expect(200);

  return body<SentMessage>(response);
}

/** Uma resposta, com o que a citacao carrega da mensagem original. */
interface QuotingMessage {
  id: string;
  replyTo: {
    isDeleted: boolean;
    attachment: { url: string; name: string; type: string } | null;
  } | null;
}

describe('anexos servidos por URL assinada', () => {
  beforeEach(resetDb);

  it('a URL da mensagem ja vem assinada e serve o arquivo', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);

    const enviada = await sendWithAttachment(chatId, luiz.id);
    const url = enviada.attachment?.url ?? '';

    expect(url).toMatch(/^\/uploads\/[^?]+\?exp=\d+&sig=[0-9a-f]{64}$/);

    // Sem header de autenticacao: o <img> do browser tambem nao manda nenhum.
    const arquivo = await request(app).get(url).expect(200);
    expect(arquivo.text).toBe('conteudo secreto');
  });

  it('recusa o arquivo sem assinatura', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);

    const enviada = await sendWithAttachment(chatId, luiz.id);
    const nu = (enviada.attachment?.url ?? '').split('?')[0] ?? '';

    await request(app).get(nu).expect(403);
  });

  it('recusa assinatura adulterada', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);

    const enviada = await sendWithAttachment(chatId, luiz.id);
    const url = enviada.attachment?.url ?? '';

    // Troca o primeiro caractere da assinatura por outro, sempre diferente do
    // que estava la. O `sig=.` -> `sig=0` de antes nao adulterava nada quando a
    // assinatura ja comecava com zero — e ai o teste cobrava 403 de um link
    // intacto. Como o nome do arquivo e um UUID novo a cada execucao, isso
    // acontecia em uma de cada dezesseis rodadas.
    const adulterada = url.replace(
      /sig=([0-9a-f])/,
      (_match, primeiro: string) => `sig=${primeiro === '0' ? '1' : '0'}`,
    );

    await request(app).get(adulterada).expect(403);
  });

  it('recusa link expirado', async () => {
    const vencida = signedAttachmentUrl('/uploads/qualquer.txt');
    const [caminho] = vencida.split('?');
    const sig = new URLSearchParams(vencida.split('?')[1]).get('sig');

    // Mesma assinatura, prazo no passado: o exp entra no HMAC, entao mexer
    // nele ja invalida — o teste garante que nao existe atalho pelo prazo.
    await request(app)
      .get(`${caminho}?exp=${Date.now() - 1000}&sig=${sig}`)
      .expect(403);
  });

  it('nao vaza arquivo fora da pasta de uploads', async () => {
    await request(app).get('/uploads/..%2F..%2F.env?exp=1&sig=abc').expect(403);
  });
});

describe('anexo na mensagem citada', () => {
  beforeEach(resetDb);

  /**
   * Mensagem so com anexo tem texto vazio: sem o anexo viajando dentro do
   * replyTo, a citacao chegava muda ao client.
   */
  it('o replyTo leva o anexo da mensagem original, ja assinado', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);

    const original = await sendWithAttachment(chatId, luiz.id);

    await request(app)
      .post(`/api/chats/${chatId}/messages`)
      .set('Authorization', `Bearer ${tokenFor(joao.id)}`)
      .field('text', 'recebi')
      .field('replyToId', original.id)
      .expect(200);

    const response = await request(app)
      .get(`/api/chats/${chatId}/messages`)
      .set('Authorization', `Bearer ${tokenFor(joao.id)}`)
      .expect(200);

    const { messages } = body<{ messages: QuotingMessage[] }>(response);
    const resposta = messages.find((message) => message.replyTo !== null);

    expect(resposta?.replyTo?.attachment?.name).toBe('nota.txt');
    expect(resposta?.replyTo?.attachment?.url).toMatch(
      /^\/uploads\/[^?]+\?exp=\d+&sig=[0-9a-f]{64}$/,
    );
  });

  /** Apagar leva o anexo junto: a citacao nao pode continuar exibindo-o. */
  it('mensagem citada apagada nao carrega anexo', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);

    const original = await sendWithAttachment(chatId, luiz.id);

    await request(app)
      .post(`/api/chats/${chatId}/messages`)
      .set('Authorization', `Bearer ${tokenFor(joao.id)}`)
      .field('text', 'recebi')
      .field('replyToId', original.id)
      .expect(200);

    await request(app)
      .delete(`/api/chats/${chatId}/messages/${original.id}`)
      .set('Authorization', `Bearer ${tokenFor(luiz.id)}`)
      .expect(200);

    const response = await request(app)
      .get(`/api/chats/${chatId}/messages`)
      .set('Authorization', `Bearer ${tokenFor(joao.id)}`)
      .expect(200);

    const { messages } = body<{ messages: QuotingMessage[] }>(response);
    const resposta = messages.find((message) => message.replyTo !== null);

    expect(resposta?.replyTo?.isDeleted).toBe(true);
    expect(resposta?.replyTo?.attachment).toBeNull();
  });
});

describe('anexo conferido pelo conteudo', () => {
  beforeEach(resetDb);

  /** O caso que motivou a conferencia: a extensao vinha do nome enviado. */
  it('recusa HTML disfarcado de imagem, sem deixar nada no disco', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);
    const antes = uploadsNow();

    const response = await sendFile(
      chatId,
      luiz.id,
      Buffer.from('<html><script>alert(1)</script></html>'),
      { filename: 'foto.html', contentType: 'image/png' },
    ).expect(400);

    expect(body<ErrorBody>(response).error).toMatch(/tipo permitido/);
    await vi.waitFor(() => expect(uploadsNow()).toEqual(antes));
  });

  it('a extensao no disco sai do conteudo, e nao do nome enviado', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);

    const response = await sendFile(chatId, luiz.id, PNG_1PX, {
      filename: 'foto.html',
      contentType: 'image/png',
    }).expect(200);

    const enviada = body<SentMessage>(response);
    expect(enviada.attachment?.type).toBe('image/png');
    expect(enviada.attachment?.url).toMatch(/^\/uploads\/[0-9a-f-]+\.png\?/);
    // O nome que o usuario mandou continua sendo o que a tela mostra.
    expect(enviada.attachment?.name).toBe('foto.html');
  });

  it('serve a imagem com o tipo gravado e sem deixar o browser adivinhar', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);

    const response = await sendFile(chatId, luiz.id, PNG_1PX, {
      filename: 'foto.png',
      contentType: 'image/png',
    }).expect(200);

    const arquivo = await request(app)
      .get(body<SentMessage>(response).attachment?.url ?? '')
      .expect(200);

    expect(arquivo.headers['content-type']).toBe('image/png');
    expect(arquivo.headers['x-content-type-options']).toBe('nosniff');
    // Midia abre no proprio <img>/<video>: nada de download.
    expect(arquivo.headers['content-disposition']).toBeUndefined();
  });

  /**
   * O botao "Baixar" do visor.
   *
   * O atributo `download` de um `<a>` e ignorado em origem cruzada — e a tela e
   * a API sao origens diferentes —, entao o clique so abria a foto noutra aba.
   * Quem manda salvar e o `Content-Disposition`, e por isso o pedido vem parar
   * aqui com `?download=1`.
   */
  it('baixa a imagem quando a URL pede download', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);

    const response = await sendFile(chatId, luiz.id, PNG_1PX, {
      filename: 'foto.png',
      contentType: 'image/png',
    }).expect(200);

    const url = body<SentMessage>(response).attachment?.url ?? '';
    const arquivo = await request(app).get(`${url}&download=1`).expect(200);

    // O nome volta a ser o que o usuario mandou, com a extensao conferida.
    expect(arquivo.headers['content-disposition']).toBe(
      'attachment; filename="foto.png"',
    );
    // E o tipo continua o gravado: o download nao vira octet-stream.
    expect(arquivo.headers['content-type']).toBe('image/png');
  });

  /** O `download` fica fora da assinatura: ela cobre o arquivo, nao o uso. */
  it('o pedido de download nao dispensa a assinatura', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);

    const enviada = await sendWithAttachment(chatId, luiz.id);
    const nu = (enviada.attachment?.url ?? '').split('?')[0] ?? '';

    await request(app).get(`${nu}?download=1`).expect(403);
  });

  /** Texto com cara de pagina e aceito como texto — e sai como texto, para baixar. */
  it('o que nao e midia vai como download, com a extensao do tipo conferido', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);

    const response = await sendFile(
      chatId,
      luiz.id,
      Buffer.from('<html><body>oi</body></html>'),
      { filename: 'pagina.html', contentType: 'text/plain' },
    ).expect(200);

    const url = body<SentMessage>(response).attachment?.url ?? '';
    expect(url).toMatch(/\.txt\?/);

    const arquivo = await request(app).get(url).expect(200);
    expect(arquivo.headers['content-type']).toMatch(/^text\/plain/);
    expect(arquivo.headers['x-content-type-options']).toBe('nosniff');
    expect(arquivo.headers['content-disposition']).toBe('attachment; filename="pagina.txt"');
  });

  /** O multer grava antes de a rota checar quem envia: a recusa tem de apagar. */
  it('nao deixa arquivo no disco quando a rota recusa o envio', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const ana = await createUser('Ana', 'ana@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);
    const antes = uploadsNow();

    // A Ana nao participa da conversa: o 403 sai depois de o arquivo estar no disco.
    await sendFile(chatId, ana.id, PNG_1PX, {
      filename: 'a.png',
      contentType: 'image/png',
    }).expect(403);

    await vi.waitFor(() => expect(uploadsNow()).toEqual(antes));
  });
});

/**
 * O EXIF que sobrevivia no original.
 *
 * A miniatura ja nascia limpa — o sharp nao copia metadado para a saida —, e o
 * arquivo servido era o que subiu, byte por byte: com a coordenada de GPS que a
 * camera do celular grava por padrao. Mandar uma foto num grupo entregava,
 * junto, o lugar onde ela foi tirada.
 */
describe('imagem reescrita no upload', () => {
  beforeEach(resetDb);

  /** Um JPEG com metadado de verdade dentro. */
  async function comExif(): Promise<Buffer> {
    return sharp({
      create: { width: 60, height: 40, channels: 3, background: '#336699' },
    })
      .jpeg()
      .withExif({ IFD0: { Copyright: 'camera-secreta', Artist: 'dono' } })
      .toBuffer();
  }

  /** O arquivo como o servidor o entrega, em bytes. */
  async function baixar(url: string): Promise<Buffer> {
    const resposta = await request(app).get(url).responseType('blob').expect(200);
    return resposta.body as Buffer;
  }

  it('remove o metadado da imagem servida', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);

    const original = await comExif();
    // Confere a premissa: o arquivo enviado tinha metadado mesmo.
    expect((await sharp(original).metadata()).exif).toBeDefined();

    const enviada = await sendFile(chatId, luiz.id, original, {
      filename: 'foto.jpg',
      contentType: 'image/jpeg',
    }).expect(200);

    const servida = await baixar(body<SentMessage>(enviada).attachment?.url ?? '');
    expect((await sharp(servida).metadata()).exif).toBeUndefined();
  });

  /**
   * A orientacao passa a estar nos pixels, e nao numa etiqueta — e por isso as
   * dimensoes gravadas sao as do que se ve.
   */
  it('aplica a orientacao do EXIF e mede o resultado', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);

    // Orientation 6 = girar um quarto de volta: 60x40 deitado vira 40x60 em pe.
    // `withMetadata`, e nao `withExif`: o segundo grava a etiqueta e o sharp a
    // sobrescreve com 1 na saida, entao o arquivo saia sem a rotacao pedida.
    const deitada = await sharp({
      create: { width: 60, height: 40, channels: 3, background: '#aa3344' },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();

    expect((await sharp(deitada).metadata()).orientation).toBe(6);

    const enviada = await sendFile(chatId, luiz.id, deitada, {
      filename: 'emPe.jpg',
      contentType: 'image/jpeg',
    }).expect(200);

    const mensagem = body<SentMessage & { attachment: { width: number; height: number } }>(
      enviada,
    );

    expect(mensagem.attachment.width).toBe(40);
    expect(mensagem.attachment.height).toBe(60);

    const servida = await baixar(mensagem.attachment.url);
    const meta = await sharp(servida).metadata();
    expect([meta.width, meta.height]).toEqual([40, 60]);
  });

  /**
   * GIF animado continua animado.
   *
   * Reescrever a imagem sem avisar o sharp de que ela tem quadros achata tudo
   * no primeiro — o GIF que a pessoa mandou chegaria parado do outro lado. O
   * `animated: true` do `normalizeImage` e o que impede isso, e e exatamente a
   * diferenca que este teste mede.
   */
  it('preserva a animacao de um GIF', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');
    const joao = await createUser('Joao', 'joao@email.com');
    const chatId = await createDirectChat(luiz.id, joao.id);

    // Tres quadros de cores diferentes: com quadros iguais o codificador os
    // funde, e o fixture nasceria com uma pagina so.
    const quadros = await Promise.all(
      ['#ff0000', '#00ff00', '#0000ff'].map((cor) =>
        sharp({ create: { width: 20, height: 20, channels: 4, background: cor } })
          .png()
          .toBuffer(),
      ),
    );

    const animado = await sharp(quadros, { join: { animated: true } })
      .gif({ loop: 0 })
      .toBuffer();

    const enviado = await sendFile(chatId, luiz.id, animado, {
      filename: 'animado.gif',
      contentType: 'image/gif',
    }).expect(200);

    const servido = await baixar(body<SentMessage>(enviado).attachment?.url ?? '');
    const meta = await sharp(servido, { animated: true }).metadata();

    expect(meta.format).toBe('gif');
    expect(meta.pages).toBe(3);
  });
});

/**
 * A foto de perfil enviada direto pela API.
 *
 * A tela recorta antes de mandar, mas o recorte e do cliente: um POST em
 * /api/me/avatar subia os 10 MB inteiros, e eles viravam a imagem que carrega
 * em cada card da lista e em cada balao.
 */
describe('foto de perfil reduzida', () => {
  beforeEach(resetDb);

  it('reduz a imagem e a serve em webp', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');

    const grande = await sharp({
      create: { width: 1400, height: 1100, channels: 3, background: '#553377' },
    })
      .png()
      .toBuffer();

    const resposta = await request(app)
      .post('/api/me/avatar')
      .set('Authorization', `Bearer ${tokenFor(luiz.id)}`)
      .attach('image', grande, { filename: 'eu.png', contentType: 'image/png' })
      .expect(200);

    const { url } = body<{ url: string }>(resposta);
    expect(url).toMatch(/\.webp$/);

    const servida = await request(app)
      .get(signedAttachmentUrl(url))
      .responseType('blob')
      .expect(200);

    const meta = await sharp(servida.body as Buffer).metadata();
    expect(meta.format).toBe('webp');
    // Quadrada e dentro do teto: o `cover` corta o excedente.
    expect(meta.width).toBe(512);
    expect(meta.height).toBe(512);
  });

  it('recusa o que nao e imagem', async () => {
    const luiz = await createUser('Luiz', 'luiz@email.com');

    await request(app)
      .post('/api/me/avatar')
      .set('Authorization', `Bearer ${tokenFor(luiz.id)}`)
      .attach('image', PDF_MIN, { filename: 'doc.pdf', contentType: 'application/pdf' })
      .expect(400);
  });
});
