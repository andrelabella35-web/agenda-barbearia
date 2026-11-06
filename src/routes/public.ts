import { Router } from 'express';
import { z } from 'zod';
import { DateTime } from 'luxon';
import { pool } from '../db.js';
import { wrap, } from '../middleware/errors.js';
import { rateLimit } from '../middleware/auth.js';
import { AppError } from '../domain/errors.js';
import { createAppointment, getAvailability, getMonthAvailability, loadBusiness } from '../domain/booking.js';
import { formatInZone, isValidZone } from '../domain/timezone.js';

export const publicRouter = Router();

const clientTz = (q: unknown, fallback: string) => (typeof q === 'string' && isValidZone(q) ? q : fallback);

publicRouter.get('/business', wrap(async (_req, res) => {
  const { rules, name, theme } = await loadBusiness();
  res.json({ name, theme, timezone: rules.timezone, lunch: { start: rules.lunchStart, end: rules.lunchEnd },
    closedWeekdays: rules.closedWeekdays, maxDaysAhead: rules.maxDaysAhead });
}));

publicRouter.get('/services', wrap(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT id, name, description, duration_min AS "durationMin", price_cents AS "priceCents"
       FROM services WHERE active ORDER BY name`);
  res.json(rows);
}));

publicRouter.get('/professionals', wrap(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT p.id, p.name, p.color, p.avatar_url AS "avatarUrl",
            COALESCE(array_agg(ps.service_id) FILTER (WHERE ps.service_id IS NOT NULL), '{}') AS "serviceIds"
       FROM professionals p LEFT JOIN professional_services ps ON ps.professional_id = p.id
      WHERE p.active GROUP BY p.id ORDER BY p.name`);
  res.json(rows);
}));

const availQuery = z.object({
  serviceId: z.coerce.number().int().positive(),
  professionalId: z.coerce.number().int().positive().optional(),
});

publicRouter.get('/availability', wrap(async (req, res) => {
  const q = availQuery.extend({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(req.query);
  const { rules } = await loadBusiness();
  const tz = clientTz(req.query.tz, rules.timezone);
  const slots = await getAvailability(q);
  res.json({
    date: q.date, businessTimezone: rules.timezone, clientTimezone: tz,
    slots: slots.map((s) => ({ ...s, businessTime: formatInZone(s.startsAt, rules.timezone), clientTime: formatInZone(s.startsAt, tz) })),
  });
}));

publicRouter.get('/availability/days', wrap(async (req, res) => {
  const q = availQuery.extend({ month: z.string().regex(/^\d{4}-\d{2}$/) }).parse(req.query);
  res.json({ month: q.month, days: await getMonthAvailability(q) });
}));

const bookSchema = z.object({
  serviceId: z.number().int().positive(),
  professionalId: z.number().int().positive().optional(),
  startsAt: z.string().datetime({ offset: true }),
  customer: z.object({
    name: z.string().trim().min(2).max(120),
    phone: z.string().refine((p) => { const d = p.replace(/\D/g, ''); return d.length >= 10 && d.length <= 15; }, 'Telefone inválido'),
    email: z.string().email().optional().or(z.literal('')),
  }),
  notes: z.string().max(500).optional(),
});

publicRouter.post('/appointments', rateLimit(30, 60_000), wrap(async (req, res) => {
  const body = bookSchema.parse(req.body);
  const startsAt = new Date(body.startsAt);
  const idem = (req.get('Idempotency-Key') ?? '').slice(0, 100) || null;

  let candidates: number[];
  if (body.professionalId) candidates = [body.professionalId];
  else {
    const slots = await getAvailability({ serviceId: body.serviceId, date: DateTime.fromJSDate(startsAt, { zone: (await loadBusiness()).rules.timezone }).toISODate()! });
    candidates = slots.find((s) => s.startsAt === startsAt.toISOString())?.professionalIds ?? [];
    if (!candidates.length) throw new AppError(409, 'SLOT_TAKEN', 'Este horário não está mais disponível.');
  }

  let lastErr: unknown;
  for (const professionalId of candidates) {
    try {
      const { appointment, created } = await createAppointment({
        serviceId: body.serviceId, professionalId, startsAt, customer: body.customer, notes: body.notes, idempotencyKey: idem,
      });
      return res.status(created ? 201 : 200).json({ id: appointment.id, status: appointment.status, professionalId: appointment.professional_id,
        startsAt: appointment.starts_at, endsAt: appointment.ends_at });
    } catch (e) {
      lastErr = e;
      if (!(e instanceof AppError && e.code === 'SLOT_TAKEN')) throw e;
    }
  }
  throw lastErr;
}));
