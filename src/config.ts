import 'dotenv/config';

const isProd = process.env.NODE_ENV === 'production';
if (isProd && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET é obrigatório em produção (defina uma string longa e aleatória).');
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://agenda:agenda@localhost:5432/agenda',
  dbPoolMax: Number(process.env.DB_POOL_MAX ?? 20),
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
  adminEmail: process.env.ADMIN_EMAIL ?? 'admin@barbearia.local',
  adminPassword: process.env.ADMIN_PASSWORD ?? 'admin123',
};
