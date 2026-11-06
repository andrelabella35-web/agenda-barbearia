import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { DateTime } from 'luxon';
import { createApp } from '../src/app.js';
import { pool } from '../src/db.js';

const app = createApp();
const TZ = 'America/Sao_Paulo';
let svc30: number, svc60: number, pro: number;

/** Próximo dia da semana ISO (1=seg..7=dom), pelo menos 3 dias à frente, às HH:mm do fuso do estabelecimento. */
function nextLocal(weekday: number, hm: string): DateTime {
  let d = DateTime.now().setZone(TZ).plus({ days: 3 }).startOf('day');
  while (d.weekday !== weekday) d = d.plus({ days: 1 });
  const [h, m] = hm.split(':').map(Number);
  return d.set({ hour: h, minute: m });
}
const ANY = 0; // sem profissional escolhido
const body = (startsAt: DateTime, serviceId = svc30, professionalId = pro, n = 1) => ({
  serviceId, ...(professionalId === ANY ? {} : { professionalId }), startsAt: startsAt.toUTC().toISO(),
  customer: { name: `Cliente ${n}`, phone: `1199999${String(1000 + n)}` },
});
const post = (b: object, key?: string) => {
  const r = request(app).post('/api/v1/public/appointments');
  if (key) r.set('Idempotency-Key', key);
  return r.send(b);
};

beforeEach(async () => {
  await pool.query('DELETE FROM appointments; DELETE FROM time_off; DELETE FROM customers');
  svc30 = (await pool.query("SELECT id FROM services WHERE name='Corte'")).rows[0].id;
  svc60 = (await pool.query("SELECT id FROM services WHERE name='Corte + Barba'")).rows[0].id;
  pro = (await pool.query("SELECT id FROM professionals WHERE name='Mitchell'")).rows[0].id;
});
afterAll(() => pool.end());

describe('anti-duplicidade', () => {
  it('20 requisições simultâneas no mesmo horário: exatamente 1 sucesso e 19 conflitos', async () => {
    const slot = nextLocal(3, '10:00');
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => post(body(slot, svc30, pro, i))));
    const codes = results.map((r) => r.status);
    expect(codes.filter((c) => c === 201)).toHaveLength(1);
    expect(codes.filter((c) => c === 409)).toHaveLength(19);
    expect(results.find((r) => r.status === 409)!.body.error.code).toBe('SLOT_TAKEN');
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM appointments WHERE status='booked'");
    expect(rows[0].n).toBe(1);
  });

  it('rejeita sobreposição parcial, mas aceita o horário adjacente', async () => {
    expect((await post(body(nextLocal(3, '10:00'), svc30))).status).toBe(201);          // 10:00–10:30
    const overlap = await post(body(nextLocal(3, '10:00'), svc60, pro, 2));             // 10:00–11:00
    expect(overlap.status).toBe(409);
    expect(overlap.body.error.suggestions.length).toBeGreaterThan(0);
    expect((await post(body(nextLocal(3, '10:30'), svc30, pro, 3))).status).toBe(201);  // adjacente
  });

  it('profissionais diferentes podem ter o mesmo horário; cancelar libera o slot', async () => {
    const other = (await pool.query("SELECT id FROM professionals WHERE name='Sarah'")).rows[0].id;
    const slot = nextLocal(4, '14:00');
    const a = await post(body(slot));
    expect(a.status).toBe(201);
    expect((await post(body(slot, svc30, other, 2))).status).toBe(201);
    expect((await post(body(slot, svc30, pro, 3))).status).toBe(409);
    await pool.query("UPDATE appointments SET status='cancelled' WHERE id=$1", [a.body.id]);
    expect((await post(body(slot, svc30, pro, 4))).status).toBe(201);
  });

  it('sem profissional escolhido: atribui um livre e esgota após 3', async () => {
    const slot = nextLocal(5, '15:00');
    const ids = new Set<number>();
    for (let i = 0; i < 3; i++) {
      const r = await post(body(slot, svc30, ANY, i));
      expect(r.status).toBe(201);
      ids.add(r.body.professionalId);
    }
    expect(ids.size).toBe(3);
    expect((await post(body(slot, svc30, ANY, 9))).status).toBe(409);
  });

  it('Idempotency-Key evita duplicar em duplo clique', async () => {
    const slot = nextLocal(2, '09:00');
    const [a, b] = await Promise.all([post(body(slot), 'k-123'), post(body(slot), 'k-123')]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(a.body.id).toBe(b.body.id);
  });
});

describe('domingo e almoço (11:00–13:00)', () => {
  it('domingo: API recusa (422) e disponibilidade vem vazia', async () => {
    const sunday = nextLocal(7, '10:00');
    const r = await post(body(sunday));
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('CLOSED_DAY');
    const av = await request(app).get('/api/v1/public/availability').query({ serviceId: svc30, date: sunday.toISODate() });
    expect(av.body.slots).toEqual([]);
  });

  it.each(['11:00', '11:30', '12:00', '12:30'])('almoço: %s é recusado', async (hm) => {
    const r = await post(body(nextLocal(3, hm)));
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('LUNCH');
  });

  it('serviço de 60min às 10:30 invadiria o almoço e é recusado; 10:00 e 13:00 passam', async () => {
    expect((await post(body(nextLocal(3, '10:30'), svc60))).body.error.code).toBe('LUNCH');
    expect((await post(body(nextLocal(3, '10:00'), svc60, pro, 2))).status).toBe(201);
    expect((await post(body(nextLocal(3, '13:00'), svc60, pro, 3))).status).toBe(201);
  });

  it('disponibilidade nunca lista horários entre 11:00 e 12:59', async () => {
    const day = nextLocal(3, '09:00');
    const av = await request(app).get('/api/v1/public/availability').query({ serviceId: svc30, date: day.toISODate() });
    const times: string[] = av.body.slots.map((s: any) => s.businessTime);
    expect(times).toContain('10:30');
    expect(times).toContain('13:00');
    expect(times.filter((t) => t >= '11:00' && t < '13:00')).toEqual([]);
  });

  it('admin também não consegue agendar domingo/almoço', async () => {
    const login = await request(app).post('/api/v1/auth/login').send({ email: 'admin@barbearia.local', password: 'admin123' });
    const auth = { Authorization: `Bearer ${login.body.token}` };
    const mk = (d: DateTime) => request(app).post('/api/v1/admin/appointments').set(auth)
      .send({ ...body(d), customer: { name: 'Balcão', phone: '11988887777' } });
    expect((await mk(nextLocal(7, '10:00'))).status).toBe(422);
    expect((await mk(nextLocal(2, '12:00'))).status).toBe(422);
    expect((await mk(nextLocal(2, '10:00'))).status).toBe(201);
  });

  it('banco recusa INSERT direto em domingo e no almoço (trigger)', async () => {
    const ins = (d: DateTime, dur = 30) => pool.query(
      `INSERT INTO appointments (professional_id, customer_id, service_id, starts_at, ends_at)
       VALUES ($1, (SELECT id FROM customers LIMIT 1), $2, $3, $4)`, [pro, svc30, d.toUTC().toJSDate(), d.plus({ minutes: dur }).toUTC().toJSDate()]);
    await pool.query("INSERT INTO customers (name, phone) VALUES ('X','11900000000')");
    await expect(ins(nextLocal(7, '10:00'))).rejects.toMatchObject({ code: 'AG001' });
    await expect(ins(nextLocal(3, '12:00'))).rejects.toMatchObject({ code: 'AG002' });
    await expect(ins(nextLocal(3, '08:00'))).rejects.toMatchObject({ code: 'AG003' });
    await expect(ins(nextLocal(3, '10:00'))).resolves.toBeTruthy();
    await expect(ins(nextLocal(3, '10:15'))).rejects.toMatchObject({ code: '23P01' }); // sobreposição no banco
  });
});

describe('fuso horário e remarcação', () => {
  it('exibe o horário no fuso do cliente', async () => {
    const day = nextLocal(3, '09:00');
    const av = await request(app).get('/api/v1/public/availability')
      .query({ serviceId: svc30, professionalId: pro, date: day.toISODate(), tz: 'Europe/Lisbon' });
    expect(av.body.clientTimezone).toBe('Europe/Lisbon');
    const first = av.body.slots[0];
    expect(first.businessTime).toBe('09:00');
    expect(first.clientTime).toBe(DateTime.fromISO(first.startsAt).setZone('Europe/Lisbon').toFormat('HH:mm'));
    expect(first.clientTime).not.toBe('09:00');
  });

  it('aceita instante com offset diferente e grava o mesmo momento em UTC', async () => {
    const slot = nextLocal(3, '10:00');
    const r = await post({ ...body(slot), startsAt: slot.setZone('Asia/Tokyo').toISO() });
    expect(r.status).toBe(201);
    expect(new Date(r.body.startsAt).getTime()).toBe(slot.toMillis());
  });

  it('remarcar para horário ocupado/almoço falha; para livre funciona', async () => {
    const login = await request(app).post('/api/v1/auth/login').send({ email: 'admin@barbearia.local', password: 'admin123' });
    const auth = { Authorization: `Bearer ${login.body.token}` };
    const a = await post(body(nextLocal(3, '10:00')));
    await post(body(nextLocal(3, '14:00'), svc30, pro, 2));
    const move = (d: DateTime) => request(app).patch(`/api/v1/admin/appointments/${a.body.id}`).set(auth).send({ startsAt: d.toUTC().toISO() });
    expect((await move(nextLocal(3, '14:00'))).status).toBe(409);
    expect((await move(nextLocal(3, '12:00'))).status).toBe(422);
    expect((await move(nextLocal(3, '15:00'))).status).toBe(200);
  });

  it('rotas admin exigem autenticação', async () => {
    expect((await request(app).get('/api/v1/admin/dashboard')).status).toBe(401);
    const login = await request(app).post('/api/v1/auth/login').send({ email: 'admin@barbearia.local', password: 'admin123' });
    const d = await request(app).get('/api/v1/admin/dashboard').set('Authorization', `Bearer ${login.body.token}`);
    expect(d.status).toBe(200);
    expect(d.body).toHaveProperty('occupancyToday');
  });
});
