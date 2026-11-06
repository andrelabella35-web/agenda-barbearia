import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../domain/errors.js';

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, ...err.extra } });
  } else if (err instanceof ZodError) {
    res.status(400).json({ error: { code: 'VALIDATION', message: 'Dados inválidos.', issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) } });
  } else if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'BAD_JSON', message: 'JSON inválido.' } });
  } else if (err?.type === 'entity.too.large') {
    res.status(413).json({ error: { code: 'TOO_LARGE', message: 'Arquivo muito grande (máximo 5 MB).' } });
  } else {
    console.error(err);
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Erro interno.' } });
  }
};

/** Permite handlers async em Express 4. */
export const wrap = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);
