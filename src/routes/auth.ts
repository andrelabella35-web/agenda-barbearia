import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { pool } from '../db.js';
import { wrap } from '../middleware/errors.js';
import { rateLimit, signToken } from '../middleware/auth.js';
import { AppError } from '../domain/errors.js';

export const authRouter = Router();

authRouter.post('/login', rateLimit(10, 60_000), wrap(async (req, res) => {
  const { email, password } = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
  const { rows } = await pool.query('SELECT * FROM users WHERE lower(email) = lower($1)', [email]);
  const u = rows[0];
  if (!u || !(await bcrypt.compare(password, u.password_hash))) throw new AppError(401, 'BAD_CREDENTIALS', 'E-mail ou senha incorretos.');
  const user = { id: u.id, email: u.email, name: u.name, role: u.role };
  res.json({ token: signToken(user), user });
}));
