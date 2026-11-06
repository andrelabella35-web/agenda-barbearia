export default async function setup() {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://agenda:agenda@localhost:5432/agenda_test';
  process.env.JWT_SECRET = 'test-secret';
  const { pool } = await import('../src/db.js');
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  const { seed } = await import('../src/scripts/seed.js');
  await seed();
  await pool.end();
}
