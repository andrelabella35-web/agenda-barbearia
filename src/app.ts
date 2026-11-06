import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { publicRouter } from './routes/public.js';
import { authRouter } from './routes/auth.js';
import { adminRouter } from './routes/admin.js';
import { mediaPublicRouter, mediaUploadRouter } from './routes/media.js';
import { errorHandler } from './middleware/errors.js';

export function createApp() {
  const app = express();
  const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web');
  app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors());
  app.use(express.json({ limit: '100kb' }));

  app.get('/api/v1/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/v1/public', publicRouter);
  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/admin/media', mediaUploadRouter);
  app.use('/api/v1/admin', adminRouter);
  app.use('/api', (_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Rota não encontrada.' } }));

  app.use('/media', mediaPublicRouter);
  app.use('/admin', express.static(path.join(web, 'admin')));
  app.use('/shared', express.static(path.join(web, 'shared')));
  app.use('/', express.static(path.join(web, 'public')));
  app.use(errorHandler);
  return app;
}
