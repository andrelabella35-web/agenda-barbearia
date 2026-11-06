import { Router } from 'express';
import { z } from 'zod';
import { DateTime } from 'luxon';
import { pool, withTransaction } from '../db.js';
import { wrap } from '../middleware/errors.js';
import { requireAdmin } from '../middleware/auth.js';
import { AppError } from '../domain/errors.js';
import { createAppointment, loadBusiness, moveAppointment, setStatus } from '../domain/booking.js';
import { dayBoundsUtc, hmToMinutes, isValidZone } from '../domain/timezone.js';

export const adminRouter = Router();
adminRouter.use(requireAdmin);

const id = (v: unknown) => z.coerce.number().int().positive().parse(v);
const hm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

// ---------- Dashboard ----------
adminRouter.get('/dashboard', wrap(async (_req, res) => {
  const { rules } = await loadBusiness();
  const today = DateTime.now().setZone(rules.timezone);
  const b = dayBoundsUtc(today.toISODate()!, rules.timezone)!;

  const [customers, todayAppts, upcoming, week, work, services] = await Promise.all([
    pool.query('SELECT count(*)::int AS n FROM customers'),
    pool.query(`SELECT a.id, a.starts_at, a.ends_at, a.status, c.name AS customer, s.name AS service, p.name AS professional, p.color
                  FROM appointments a JOIN customers c ON c.id=a.customer_id JOIN services s ON s.id=a.service_id JOIN professionals p ON p.id=a.professional_id
                 WHERE a.starts_at >= $1 AND a.starts_at < $2 AND a.status <> 'cancelled' ORDER BY a.starts_at`, [b.start, b.end]),
    pool.query(`SELECT count(*)::int AS n FROM appointments WHERE status='booked' AND starts_at >= now()`),
    pool.query(`SELECT to_char(starts_at AT TIME ZONE $1, 'YYYY-MM-DD') AS day, count(*)::int AS n FROM appointments
                 WHERE status IN ('booked','done') AND starts_at >= $2 AND starts_at < $3 GROUP BY 1 ORDER BY 1`,
      [rules.timezone, today.startOf('day').minus({ days: 6 }).toUTC().toJSDate(), b.end]),
    pool.query(`SELECT w.weekday, w.start_time, w.end_time FROM working_hours w JOIN professionals p ON p.id=w.professional_id WHERE p.active`),
    pool.query('SELECT count(*)::int AS n FROM services WHERE active'),
  ]);

  let capacity = 0;
  if (!rules.closedWeekdays.includes(today.weekday)) {
    for (const w of work.rows.filter((r) => r.weekday === today.weekday)) {
      const s = hmToMinutes(w.start_time), e = hmToMinutes(w.end_time);
      const lunch = Math.max(0, Math.min(e, hmToMinutes(rules.lunchEnd)) - Math.max(s, hmToMinutes(rules.lunchStart)));
      capacity += e - s - lunch;
    }
  }
  const booked = todayAppts.rows.filter((a) => a.status !== 'cancelled' && a.status !== 'no_show')
    .reduce((sum, a) => sum + (a.ends_at - a.starts_at) / 60_000, 0);

  res.json({
    timezone: rules.timezone,
    totalCustomers: customers.rows[0].n,
    appointmentsToday: todayAppts.rows.length,
    upcomingAppointments: upcoming.rows[0].n,
    activeServices: services.rows[0].n,
    occupancyToday: capacity ? Math.min(100, Math.round((booked / capacity) * 100)) : 0,
    closedToday: rules.closedWeekdays.includes(today.weekday),
    today: todayAppts.rows,
    last7Days: week.rows,
  });
}));

// ---------- Agendamentos ----------
const APPT_SELECT = `SELECT a.id, a.starts_at AS "startsAt", a.ends_at AS "endsAt", a.status, a.notes,
    a.professional_id AS "professionalId", p.name AS professional, p.color,
    a.service_id AS "serviceId", s.name AS service, s.duration_min AS "durationMin",
    a.customer_id AS "customerId", c.name AS customer, c.phone AS "customerPhone"
  FROM appointments a JOIN professionals p ON p.id=a.professional_id JOIN services s ON s.id=a.service_id JOIN customers c ON c.id=a.customer_id`;

adminRouter.get('/appointments', wrap(async (req, res) => {
  const q = z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    from: z.string().datetime({ offset: true }).optional(), to: z.string().datetime({ offset: true }).optional(),
    professionalId: z.coerce.number().int().optional(),
  }).parse(req.query);
  let from: Date, to: Date;
  if (q.date) {
    const b = dayBoundsUtc(q.date, (await loadBusiness()).rules.timezone);
    if (!b) throw new AppError(400, 'INVALID_DATE', 'Data inválida.');
    ({ start: from, end: to } = b);
  } else if (q.from && q.to) { from = new Date(q.from); to = new Date(q.to); }
  else throw new AppError(400, 'VALIDATION', 'Informe date ou from/to.');
  const { rows } = await pool.query(
    `${APPT_SELECT} WHERE a.starts_at >= $1 AND a.starts_at < $2 AND ($3::int IS NULL OR a.professional_id = $3) AND a.status <> 'cancelled' ORDER BY a.starts_at`,
    [from, to, q.professionalId ?? null]);
  res.json(rows);
}));

adminRouter.post('/appointments', wrap(async (req, res) => {
  const b = z.object({
    serviceId: z.number().int(), professionalId: z.number().int(), startsAt: z.string().datetime({ offset: true }),
    customer: z.object({ name: z.string().trim().min(2), phone: z.string().min(8), email: z.string().email().optional().or(z.literal('')) }),
    notes: z.string().max(500).optional(),
  }).parse(req.body);
  const { appointment } = await createAppointment({ ...b, startsAt: new Date(b.startsAt), asAdmin: true });
  const { rows } = await pool.query(`${APPT_SELECT} WHERE a.id = $1`, [appointment.id]);
  res.status(201).json(rows[0]);
}));

adminRouter.patch('/appointments/:id', wrap(async (req, res) => {
  const b = z.object({
    startsAt: z.string().datetime({ offset: true }).optional(), professionalId: z.number().int().optional(),
    status: z.enum(['booked', 'cancelled', 'done', 'no_show']).optional(), notes: z.string().max(500).optional(),
  }).parse(req.body);
  const apptId = z.string().uuid().parse(req.params.id);
  if (b.startsAt || b.professionalId) {
    const cur = await pool.query('SELECT starts_at FROM appointments WHERE id=$1', [apptId]);
    if (!cur.rows[0]) throw new AppError(404, 'NOT_FOUND', 'Agendamento não encontrado.');
    await moveAppointment(apptId, b.startsAt ? new Date(b.startsAt) : cur.rows[0].starts_at, b.professionalId);
  }
  if (b.status) await setStatus(apptId, b.status);
  if (b.notes !== undefined) await pool.query('UPDATE appointments SET notes=$2 WHERE id=$1', [apptId, b.notes]);
  const { rows } = await pool.query(`${APPT_SELECT} WHERE a.id = $1`, [apptId]);
  if (!rows[0]) throw new AppError(404, 'NOT_FOUND', 'Agendamento não encontrado.');
  res.json(rows[0]);
}));

adminRouter.delete('/appointments/:id', wrap(async (req, res) => {
  await setStatus(z.string().uuid().parse(req.params.id), 'cancelled');
  res.status(204).end();
}));

// ---------- Serviços ----------
const serviceSchema = z.object({
  name: z.string().trim().min(2), description: z.string().optional().nullable(),
  durationMin: z.number().int().min(5).max(480), priceCents: z.number().int().min(0), active: z.boolean().default(true),
});
const SERVICE_COLS = `id, name, description, duration_min AS "durationMin", price_cents AS "priceCents", active`;

adminRouter.get('/services', wrap(async (_req, res) => {
  res.json((await pool.query(`SELECT ${SERVICE_COLS} FROM services ORDER BY name`)).rows);
}));
adminRouter.post('/services', wrap(async (req, res) => {
  const b = serviceSchema.parse(req.body);
  const { rows } = await pool.query(`INSERT INTO services (name, description, duration_min, price_cents, active) VALUES ($1,$2,$3,$4,$5) RETURNING ${SERVICE_COLS}`,
    [b.name, b.description ?? null, b.durationMin, b.priceCents, b.active]);
  res.status(201).json(rows[0]);
}));
adminRouter.put('/services/:id', wrap(async (req, res) => {
  const b = serviceSchema.parse(req.body);
  const { rows } = await pool.query(`UPDATE services SET name=$2, description=$3, duration_min=$4, price_cents=$5, active=$6 WHERE id=$1 RETURNING ${SERVICE_COLS}`,
    [id(req.params.id), b.name, b.description ?? null, b.durationMin, b.priceCents, b.active]);
  if (!rows[0]) throw new AppError(404, 'NOT_FOUND', 'Serviço não encontrado.');
  res.json(rows[0]);
}));
adminRouter.delete('/services/:id', wrap(async (req, res) => {
  await pool.query('UPDATE services SET active=false WHERE id=$1', [id(req.params.id)]); // inativa (preserva histórico)
  res.status(204).end();
}));

// ---------- Profissionais ----------
const profSchema = z.object({
  name: z.string().trim().min(2), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#f5a623'),
  avatarUrl: z.string().url().optional().nullable().or(z.literal('')), active: z.boolean().default(true),
  serviceIds: z.array(z.number().int()).default([]),
  workingHours: z.array(z.object({ weekday: z.number().int().min(1).max(7), start: hm, end: hm })).default([]),
});

async function loadProfessional(pid: number) {
  const { rows } = await pool.query(
    `SELECT p.id, p.name, p.color, p.avatar_url AS "avatarUrl", p.active,
       COALESCE((SELECT array_agg(service_id) FROM professional_services WHERE professional_id=p.id), '{}') AS "serviceIds",
       COALESCE((SELECT json_agg(json_build_object('weekday', weekday, 'start', to_char(start_time,'HH24:MI'), 'end', to_char(end_time,'HH24:MI')) ORDER BY weekday)
                   FROM working_hours WHERE professional_id=p.id), '[]') AS "workingHours"
     FROM professionals p WHERE p.id=$1`, [pid]);
  return rows[0];
}

async function saveProfessional(pid: number | null, b: z.infer<typeof profSchema>) {
  const { rules } = await loadBusiness();
  for (const w of b.workingHours) {
    if (rules.closedWeekdays.includes(w.weekday)) throw new AppError(422, 'CLOSED_DAY', 'O estabelecimento não funciona neste dia da semana (domingo).');
    if (hmToMinutes(w.end) <= hmToMinutes(w.start)) throw new AppError(422, 'BAD_HOURS', 'Horário final deve ser maior que o inicial.');
  }
  return withTransaction(async (c) => {
    let pidFinal = pid;
    if (pid === null) {
      pidFinal = (await c.query('INSERT INTO professionals (name,color,avatar_url,active) VALUES ($1,$2,$3,$4) RETURNING id',
        [b.name, b.color, b.avatarUrl || null, b.active])).rows[0].id;
    } else {
      const r = await c.query('UPDATE professionals SET name=$2,color=$3,avatar_url=$4,active=$5 WHERE id=$1', [pid, b.name, b.color, b.avatarUrl || null, b.active]);
      if (!r.rowCount) throw new AppError(404, 'NOT_FOUND', 'Profissional não encontrado.');
    }
    await c.query('DELETE FROM professional_services WHERE professional_id=$1', [pidFinal]);
    for (const sid of b.serviceIds) await c.query('INSERT INTO professional_services VALUES ($1,$2)', [pidFinal, sid]);
    await c.query('DELETE FROM working_hours WHERE professional_id=$1', [pidFinal]);
    for (const w of b.workingHours) await c.query('INSERT INTO working_hours VALUES ($1,$2,$3,$4)', [pidFinal, w.weekday, w.start, w.end]);
    return pidFinal as number;
  });
}

adminRouter.get('/professionals', wrap(async (_req, res) => {
  const ids = (await pool.query('SELECT id FROM professionals ORDER BY name')).rows;
  res.json(await Promise.all(ids.map((r) => loadProfessional(r.id))));
}));
adminRouter.post('/professionals', wrap(async (req, res) => {
  res.status(201).json(await loadProfessional(await saveProfessional(null, profSchema.parse(req.body))));
}));
adminRouter.put('/professionals/:id', wrap(async (req, res) => {
  const pid = id(req.params.id);
  await saveProfessional(pid, profSchema.parse(req.body));
  res.json(await loadProfessional(pid));
}));

// ---------- Clientes ----------
adminRouter.get('/customers', wrap(async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  const { rows } = await pool.query(
    `SELECT c.id, c.name, c.phone, c.email, c.created_at AS "createdAt",
            (SELECT count(*)::int FROM appointments a WHERE a.customer_id=c.id AND a.status IN ('booked','done')) AS "appointments"
       FROM customers c WHERE $1 = '' OR c.name ILIKE '%'||$1||'%' OR c.phone LIKE '%'||regexp_replace($1,'\\D','','g')||'%'
      ORDER BY c.name LIMIT 200`, [q]);
  res.json(rows);
}));

// ---------- Feriados / folgas ----------
adminRouter.get('/time-off', wrap(async (_req, res) => {
  res.json((await pool.query(`SELECT id, professional_id AS "professionalId", starts_at AS "startsAt", ends_at AS "endsAt", reason FROM time_off ORDER BY starts_at DESC`)).rows);
}));
adminRouter.post('/time-off', wrap(async (req, res) => {
  const b = z.object({ professionalId: z.number().int().nullable().optional(), startsAt: z.string().datetime({ offset: true }),
    endsAt: z.string().datetime({ offset: true }), reason: z.string().max(200).optional() }).parse(req.body);
  if (new Date(b.endsAt) <= new Date(b.startsAt)) throw new AppError(422, 'BAD_RANGE', 'Fim deve ser posterior ao início.');
  const { rows } = await pool.query(
    `INSERT INTO time_off (professional_id, starts_at, ends_at, reason) VALUES ($1,$2,$3,$4) RETURNING id, professional_id AS "professionalId", starts_at AS "startsAt", ends_at AS "endsAt", reason`,
    [b.professionalId ?? null, b.startsAt, b.endsAt, b.reason ?? null]);
  res.status(201).json(rows[0]);
}));
adminRouter.delete('/time-off/:id', wrap(async (req, res) => {
  await pool.query('DELETE FROM time_off WHERE id=$1', [id(req.params.id)]);
  res.status(204).end();
}));

// ---------- Configurações / tema ----------
adminRouter.get('/business', wrap(async (_req, res) => {
  const { rules, name, theme } = await loadBusiness();
  res.json({ name, theme, ...rules });
}));
adminRouter.put('/business', wrap(async (req, res) => {
  const b = z.object({
    name: z.string().trim().min(2), timezone: z.string().refine(isValidZone, 'Fuso horário inválido'),
    stepMin: z.number().int().min(5).max(240), minNoticeMin: z.number().int().min(0), maxDaysAhead: z.number().int().min(1).max(365),
    lunchStart: hm, lunchEnd: hm, closedWeekdays: z.array(z.number().int().min(1).max(7)),
    theme: z.record(z.string(), z.string().max(600)).default({}),
  }).parse(req.body);
  if (hmToMinutes(b.lunchEnd) <= hmToMinutes(b.lunchStart)) throw new AppError(422, 'BAD_LUNCH', 'Fim do almoço deve ser após o início.');
  await pool.query(
    `UPDATE business SET name=$1, timezone=$2, slot_step_min=$3, min_notice_min=$4, max_days_ahead=$5, lunch_start=$6, lunch_end=$7, closed_weekdays=$8, theme=$9 WHERE id=1`,
    [b.name, b.timezone, b.stepMin, b.minNoticeMin, b.maxDaysAhead, b.lunchStart, b.lunchEnd, b.closedWeekdays, JSON.stringify(b.theme)]);
  res.json({ ok: true });
}));
