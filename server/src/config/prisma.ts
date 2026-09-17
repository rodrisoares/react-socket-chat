import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '../generated/prisma/client.js';
import { env } from './env.js';

/**
 * O Prisma 7 exige um driver adapter — o engine binario nao conecta mais sozinho.
 * Instancia unica reutilizada por todos os repositorios.
 */
const adapter = new PrismaBetterSqlite3({ url: env.databaseUrl });

export const prisma = new PrismaClient({ adapter });
