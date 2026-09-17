import { config } from 'dotenv';

// Precisa vir antes de qualquer import que leia process.env (config/env.ts).
config({ path: '.env.test', override: true });
