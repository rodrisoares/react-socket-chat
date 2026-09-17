import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import { Server } from 'socket.io';
import { createServer } from 'node:http';
import type {
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData,
} from '@react-chat/shared';
import { env } from './env.js';

export const app = express();

/**
 * Cabeçalhos de segurança, antes de qualquer rota.
 *
 * O `crossOriginResourcePolicy` precisa ser explícito: o padrão do helmet é
 * `same-origin`, e os anexos são servidos por esta API (8080) dentro de uma
 * tela que está noutra origem (5173) — com o padrão, o navegador recusaria
 * silenciosamente cada <img> de anexo.
 */
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

/**
 * `credentials: true` porque o refresh token viaja num cookie httpOnly: sem
 * isso o navegador não o envia para outra origem, e a tela (5173) e a API
 * (8080) são origens diferentes.
 */
app.use(cors({ origin: env.corsOrigin, credentials: true }));
app.use(express.json());
app.use(cookieParser());

export const server = createServer(app);

/**
 * Os mapas de eventos vêm do pacote compartilhado — os mesmos que o cliente usa
 * no `io<...>`. Com eles, o nome e o payload de cada evento passam a ser
 * conferidos pelo compilador dos dois lados: um `emit` com nome trocado, ou com
 * um campo a menos, deixou de ser um bug silencioso.
 */
export const io = new Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>(server, {
  cors: {
    origin: env.corsOrigin,
    credentials: true,
  },
});
