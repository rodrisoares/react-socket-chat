/** Erro com status HTTP, tratado pelo errorHandler global. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }

  static notFound(message = 'Recurso não encontrado') {
    return new AppError(404, message);
  }

  static forbidden(message = 'Acesso negado') {
    return new AppError(403, message);
  }

  static conflict(message: string) {
    return new AppError(409, message);
  }

  static badRequest(message: string, details?: unknown) {
    return new AppError(400, message, details);
  }
}
