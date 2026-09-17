import 'dotenv/config';
import { createHash } from 'node:crypto';

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(`Variável de ambiente ausente: ${name}. Copie o .env.example para .env.`);
  }
  return value;
}

/**
 * Como o cookie do refresh viaja.
 *
 * 'lax' basta quando a API e a tela dividem o mesmo site — o caso do dev, em
 * que muda só a porta do localhost. Em domínios diferentes é 'none', e aí o
 * navegador exige HTTPS (ver COOKIE_SECURE).
 */
function sameSite(value: string): 'lax' | 'strict' | 'none' {
  if (value === 'lax' || value === 'strict' || value === 'none') return value;
  throw new Error('COOKIE_SAME_SITE deve ser "lax", "strict" ou "none"');
}

const cookieSameSite = sameSite(required('COOKIE_SAME_SITE', 'lax'));
const jwtSecret = required('JWT_SECRET');

const corsOrigin = required('CORS_ORIGIN', 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

/**
 * Onde a tela vive — a base do link de convite de grupo.
 *
 * Sai do CORS_ORIGIN de propósito: é a mesma informação, e uma variável nova só
 * para isto seria mais um lugar de onde a verdade pode divergir. Quando há mais
 * de uma origem liberada vale a primeira, que é a do site; o APP_URL existe para
 * quando o convite precisa apontar para um endereço que não é nenhuma delas —
 * atrás de um proxy, por exemplo.
 */
const appUrl = process.env['APP_URL']?.trim() || (corsOrigin[0] ?? 'http://localhost:5173');

/**
 * Chave das URLs assinadas dos anexos, separada da que assina as sessões.
 *
 * A assinatura do anexo circula em cada <img> da tela, fica no histórico do
 * navegador e viaja em todo link compartilhado: ela é exposta de um jeito que o
 * segredo das sessões nunca é. Usar a mesma chave para as duas coisas junta
 * dois riscos que não têm por que andar juntos.
 *
 * Sem a variável, deriva-se uma chave do JWT_SECRET para a aplicação subir sem
 * configuração nova. A derivação é de mão única: quem obtiver a chave dos
 * anexos não chega ao segredo das sessões por ela.
 */
/**
 * Uma duração no formato que o jsonwebtoken aceita ('15m', '1h', '7d', ou um
 * número de segundos), em milissegundos.
 *
 * Quem precisa disto é a lista de sessões encerradas: ela guarda cada `sid`
 * revogado só até o access token daquela sessão vencer, e para saber quando
 * isso acontece é preciso ler a mesma variável que assina o token.
 *
 * O que não casar com nenhum formato cai num dia. O erro seguro aqui é para
 * cima: uma entrada guardada tempo demais gasta um punhado de bytes, e uma
 * guardada de menos deixaria a sessão encerrada voltar a valer.
 */
const DURATION = /^(\d+)\s*(s|m|h|d)?$/i;
const UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

function durationMs(value: string): number {
  const found = DURATION.exec(value.trim());
  const amount = Number(found?.[1]);

  if (!found || !Number.isFinite(amount)) return UNIT_MS['d'] ?? 86_400_000;

  // Sem unidade, o jsonwebtoken lê o número como segundos.
  return amount * (UNIT_MS[(found[2] ?? 's').toLowerCase()] ?? 1000);
}

function attachmentSecret(): string {
  return (
    process.env['ATTACHMENT_SECRET'] ??
    createHash('sha256').update(`${jwtSecret}:anexos`).digest('hex')
  );
}

export const env = {
  port: Number(required('PORT', '8080')),
  databaseUrl: required('DATABASE_URL', 'file:./dev.db'),
  jwtSecret,
  attachmentSecret: attachmentSecret(),
  /**
   * Validade do access token. Curta de proposito: ele e sem estado, entao
   * encerrar uma sessao so o alcanca quando ele vence. Eram 7 dias, e
   * "encerrar sessao" deixava o aparelho com acesso por uma semana. Quem mantem
   * a pessoa logada e o refresh, logo abaixo.
   */
  jwtExpiresIn: required('JWT_EXPIRES_IN', '15m'),
  /**
   * O mesmo prazo em milissegundos, para quem precisa fazer conta com ele —
   * hoje, a lista de sessões encerradas (ver config/revokedSessions.ts).
   */
  accessTokenMs: durationMs(required('JWT_EXPIRES_IN', '15m')),
  /**
   * Validade do refresh token, em dias. E ele que mantem a sessao viva sem
   * pedir a senha de novo; o JWT acima segue curto e sem estado.
   */
  refreshExpiresDays: Number(required('REFRESH_EXPIRES_DAYS', '30')),
  cookieSameSite,
  /**
   * Cookie só por HTTPS. Obrigatório com sameSite 'none' — o navegador recusa
   * a combinação sem ele — e recomendado em qualquer deploy de verdade.
   */
  cookieSecure:
    required('COOKIE_SECURE', cookieSameSite === 'none' ? 'true' : 'false') === 'true',
  /** Tentativas de login por janela. Elevado nos testes. */
  loginRateLimit: Number(required('LOGIN_RATE_LIMIT', '10')),
  /**
   * Cadastros por janela de 15 min, por IP. Criar conta era a única rota aberta
   * sem limite nenhum: um laço enchia a tabela de usuários e, com ela, a lista
   * de contatos de todo mundo.
   */
  registerRateLimit: Number(required('REGISTER_RATE_LIMIT', '20')),
  /**
   * Renovações por janela de 15 min, por IP. Generoso de propósito: cada aba
   * renova a cada 15 min, e o limite existe para o laço automatizado que tenta
   * adivinhar refresh token, não para o uso normal.
   */
  refreshRateLimit: Number(required('REFRESH_RATE_LIMIT', '120')),
  /** Mensagens por minuto, por usuario. */
  messageRateLimit: Number(required('MESSAGE_RATE_LIMIT', '60')),
  /** Conversas e grupos criados por janela de 15 min, por usuario. */
  createChatRateLimit: Number(required('CREATE_CHAT_RATE_LIMIT', '30')),
  /**
   * Buscas por minuto, por usuario. A tela dispara uma a cada 250ms de
   * digitacao: um termo longo ja custa varias idas ao banco.
   */
  searchRateLimit: Number(required('SEARCH_RATE_LIMIT', '90')),
  /** Anexos enviados por janela de 15 min, por usuario. */
  uploadRateLimit: Number(required('UPLOAD_RATE_LIMIT', '40')),
  /**
   * Exportacoes de dados por hora, por usuario. Baixo de proposito: cada uma
   * le o historico inteiro da pessoa e monta um JSON com ele.
   */
  exportRateLimit: Number(required('EXPORT_RATE_LIMIT', '5')),
  /** Custo do bcrypt. Reduzido nos testes para a suite nao arrastar. */
  bcryptRounds: Number(required('BCRYPT_ROUNDS', '10')),
  corsOrigin,
  /** Base do link de convite de grupo — ver appUrl acima. */
  appUrl,
} as const;
