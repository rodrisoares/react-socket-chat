import type { RequestHandler } from 'express';

/**
 * Só o que o middleware precisa de um schema.
 *
 * Estruturalmente igual ao `safeParse` do Zod, mas sem importar o Zod: os
 * schemas vêm do pacote compartilhado, que tem a própria cópia da biblioteca —
 * e o servidor não precisa saber disso.
 */
interface Validatable {
  safeParse: (
    data: unknown,
  ) =>
    | { success: true; data: unknown }
    | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } };
}

/** Valida req.body contra o schema e substitui pelo dado ja parseado. */
export function validate(schema: Validatable): RequestHandler {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      res.status(400).json({
        error: 'Dados invalidos',
        issues: result.error.issues.map((issue) => ({
          campo: issue.path.join('.'),
          mensagem: issue.message,
        })),
      });
      return;
    }

    req.body = result.data;
    next();
  };
}
