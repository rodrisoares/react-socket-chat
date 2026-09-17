import { execSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';

/**
 * Roda uma vez antes de toda a suíte: recria o test.db do zero a partir
 * das migrations. O dev.db nunca é tocado — o DATABASE_URL vem do .env.test.
 */
export default function setup() {
  const dbPath = path.resolve('test.db');
  if (existsSync(dbPath)) rmSync(dbPath);

  execSync('pnpm exec prisma migrate deploy', {
    stdio: 'ignore',
    env: { ...process.env, DATABASE_URL: 'file:./test.db' },
  });
}
