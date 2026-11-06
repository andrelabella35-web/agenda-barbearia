import bcrypt from 'bcryptjs';
import { pool } from '../db.js';
import { config } from '../config.js';
import { migrate } from './migrate.js';

export async function seed() {
  await migrate();
  await pool.query(
    `INSERT INTO users (email, name, password_hash, role) VALUES ($1,'Administrador',$2,'admin') ON CONFLICT (email) DO NOTHING`,
    [config.adminEmail, await bcrypt.hash(config.adminPassword, 10)]);
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM professionals');
  if (rows[0].n > 0) return;

  await pool.query(`UPDATE business SET name='Barbearia Studio', theme=$1 WHERE id=1`, [JSON.stringify({
    primary: '#c62828', accent: '#f5a623', dark: '#0b2a3c', heroTitle: 'Cortes Profissionais',
    heroText: 'Agende seu horário online em poucos cliques. Atendimento de segunda a sábado.',
    ctaText: 'Agendar agora', logoText: 'BARBEARIA STUDIO', heroImage: '/img/cabelo.jpg',
  })]);
  const svc = await pool.query(
    `INSERT INTO services (name, description, duration_min, price_cents) VALUES
     ('Corte','Corte masculino na tesoura ou máquina',30,4500),
     ('Barba','Barba com toalha quente',30,3500),
     ('Corte + Barba','Combo completo',60,7500),
     ('Sobrancelha','Design de sobrancelha',30,2000) RETURNING id`);
  const pros = await pool.query(
    `INSERT INTO professionals (name, color) VALUES ('Mitchell','#f5a623'),('Sarah','#4dd0c4'),('Danny','#f48fb1') RETURNING id`);
  for (const p of pros.rows) {
    for (const s of svc.rows) await pool.query('INSERT INTO professional_services VALUES ($1,$2)', [p.id, s.id]);
    for (let wd = 1; wd <= 6; wd++) // segunda a sábado; domingo fechado
      await pool.query('INSERT INTO working_hours VALUES ($1,$2,$3,$4)', [p.id, wd, '09:00', wd === 6 ? '17:00' : '19:00']);
  }
}

if (process.argv[1]?.endsWith('seed.ts')) {
  seed().then(() => { console.log('Seed concluído. Login:', config.adminEmail); return pool.end(); })
    .catch((e) => { console.error(e); process.exit(1); });
}
