import type { ErrorRequestHandler, RequestHandler } from 'express';
import { MulterError } from 'multer';
import { UPLOAD_MAX_MB } from '@react-chat/shared';

import { logger } from '../config/logger.js';
import { AppError } from '../errors/AppError.js';

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({ error: `Rota não encontrada: ${req.method} ${req.originalUrl}` });
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({
      error: err.message,
      ...(err.details ? { details: err.details } : {}),
    });
    return;
  }

  // Upload: limite de tamanho, campo inesperado, etc.
  if (err instanceof MulterError) {
    const message =
      err.code === 'LIMIT_FILE_SIZE'
        ? `Arquivo maior que o limite de ${UPLOAD_MAX_MB} MB`
        : `Falha no upload: ${err.message}`;
    res.status(400).json({ error: message });
    return;
  }

  // Tipo recusado pelo fileFilter: chega como Error simples.
  if (err instanceof Error && err.message.startsWith('Tipo de arquivo não permitido')) {
    res.status(400).json({ error: err.message });
    return;
  }

  // JSON malformado do body-parser.
  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json({ error: 'Corpo da requisição não é um JSON válido' });
    return;
  }

  // Erro nao previsto: registra completo, devolve generico.
  logger.error({ err }, 'erro não tratado');
  res.status(500).json({ error: 'Erro interno do servidor' });
};
