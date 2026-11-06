import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { AppError } from '../domain/errors.js';

export interface AuthUser { id: number; email: string; name: string; role: string }

export const signToken = (u: AuthUser) => jwt.sign(u, config.jwtSecret, { expiresIn: '12h' });

export const requireAdmin: RequestHandler = (req, _res, next) => {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return next(new AppError(401, 'UNAUTHORIZED', 'Autenticação necessária.'));
  try {
    const user = jwt.verify(h.slice(7), config.jwtSecret) as AuthUser;
    if (user.role !== 'admin') return next(new AppError(403, 'FORBIDDEN', 'Acesso restrito.'));
    (req as any).user = user;
    next();
  } catch {
    next(new AppError(401, 'UNAUTHORIZED', 'Sessão inválida ou expirada.'));
  }
};

/** Limitador simples em memória (por IP) para endpoints públicos sensíveis. */
export function rateLimit(max: number, windowMs: number): RequestHandler {
  const hits = new Map<string, { n: number; reset: number }>();
  return (req, _res, next) => {
    if (process.env.NODE_ENV === 'test') return next();
    const k = req.ip ?? 'x';
    const now = Date.now();
    const h = hits.get(k);
    if (!h || h.reset < now) { hits.set(k, { n: 1, reset: now + windowMs }); return next(); }
    if (++h.n > max) return next(new AppError(429, 'RATE_LIMIT', 'Muitas tentativas. Aguarde um instante.'));
    next();
  };
}
