import { Router, raw } from 'express';
import { pool } from '../db.js';
import { wrap } from '../middleware/errors.js';
import { requireAdmin } from '../middleware/auth.js';
import { AppError } from '../domain/errors.js';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Descobre o tipo pelos primeiros bytes (não confia no Content-Type enviado). SVG é recusado de propósito (pode conter script). */
export function sniffImage(b: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (b.length > 12 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 12 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/** Upload (admin): POST /api/v1/admin/media com o arquivo no corpo. Devolve { url }. */
export const mediaUploadRouter = Router();
mediaUploadRouter.post('/', requireAdmin,
  raw({ type: () => true, limit: MAX_IMAGE_BYTES }),
  wrap(async (req, res) => {
    const buf: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (buf.length === 0) throw new AppError(400, 'NO_FILE', 'Nenhum arquivo enviado.');
    const type = sniffImage(buf);
    if (!type) throw new AppError(415, 'BAD_IMAGE', 'Formato não suportado. Use JPG, PNG ou WebP.');
    const { rows } = await pool.query('INSERT INTO media (content_type, data) VALUES ($1,$2) RETURNING id', [type, buf]);
    res.status(201).json({ url: `/media/${rows[0].id}` });
  }));

/** Leitura pública: GET /media/:id (o id é sequencial, mas só guarda imagens destinadas ao site público). */
export const mediaPublicRouter = Router();
mediaPublicRouter.get('/:id', wrap(async (req, res) => {
  if (!/^\d{1,15}$/.test(req.params.id)) throw new AppError(404, 'NOT_FOUND', 'Imagem não encontrada.');
  const { rows } = await pool.query('SELECT content_type, data FROM media WHERE id=$1', [req.params.id]);
  if (!rows[0]) throw new AppError(404, 'NOT_FOUND', 'Imagem não encontrada.');
  res.set({ 'Content-Type': rows[0].content_type, 'Cache-Control': 'public, max-age=31536000, immutable' }).send(rows[0].data);
}));
