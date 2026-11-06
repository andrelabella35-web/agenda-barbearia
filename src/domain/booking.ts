import { DateTime } from 'luxon';
import type { Queryable } from '../db.js';
import { pool, withTransaction } from '../db.js';
import { AppError } from './errors.js';
import {
  checkSlotRules, generateSlots, reasonMessages,
  type Interval, type Rules, type Slot, type UnavailableReason, type WorkWindow,
} from './availability.js';
import { dayBoundsUtc } from './timezone.js';

export async function loadBusiness(q: Queryable = pool) {
  const { rows } = await q.query('SELECT * FROM business WHERE id = 1');
  const b = rows[0];
  const rules: Rules = {
    timezone: b.timezone,
    stepMin: b.slot_step_min,
    minNoticeMin: b.min_notice_min,
    maxDaysAhead: b.max_days_ahead,
    lunchStart: String(b.lunch_start).slice(0, 5),
    lunchEnd: String(b.lunch_end).slice(0, 5),
    closedWeekdays: b.closed_weekdays,
  };
  return { rules, name: b.name as string, theme: b.theme as Record<string, unknown> };
}

export async function loadWork(q: Queryable, professionalId: number): Promise<WorkWindow[]> {
  const { rows } = await q.query(
    'SELECT weekday, to_char(start_time,\'HH24:MI\') AS start, to_char(end_time,\'HH24:MI\') AS "end" FROM working_hours WHERE professional_id = $1',
    [professionalId],
  );
  return rows;
}

export async function loadBusy(q: Queryable, professionalId: number, from: Date, to: Date): Promise<Interval[]> {
  const { rows } = await q.query(
    `SELECT starts_at AS start, ends_at AS "end" FROM appointments
      WHERE professional_id = $1 AND status = 'booked' AND starts_at < $3 AND ends_at > $2
     UNION ALL
     SELECT starts_at, ends_at FROM time_off
      WHERE (professional_id IS NULL OR professional_id = $1) AND starts_at < $3 AND ends_at > $2`,
    [professionalId, from, to],
  );
  return rows;
}

async function getService(q: Queryable, serviceId: number) {
  const { rows } = await q.query('SELECT * FROM services WHERE id = $1 AND active', [serviceId]);
  if (!rows[0]) throw new AppError(404, 'SERVICE_NOT_FOUND', 'Serviço não encontrado.');
  return rows[0] as { id: number; name: string; duration_min: number; price_cents: number };
}

async function professionalsForService(q: Queryable, serviceId: number, professionalId?: number): Promise<number[]> {
  const { rows } = await q.query(
    `SELECT p.id FROM professionals p JOIN professional_services ps ON ps.professional_id = p.id
      WHERE p.active AND ps.service_id = $1 AND ($2::int IS NULL OR p.id = $2) ORDER BY p.id`,
    [serviceId, professionalId ?? null],
  );
  return rows.map((r) => r.id);
}

export interface PublicSlot extends Slot { professionalIds: number[] }

/** Horários livres de um dia para um serviço (um profissional ou todos). */
export async function getAvailability(opts: { serviceId: number; professionalId?: number; date: string; now?: Date }): Promise<PublicSlot[]> {
  const { rules } = await loadBusiness();
  const service = await getService(pool, opts.serviceId);
  const bounds = dayBoundsUtc(opts.date, rules.timezone);
  if (!bounds) throw new AppError(400, 'INVALID_DATE', 'Data inválida (use AAAA-MM-DD).');

  const map = new Map<string, PublicSlot>();
  for (const pid of await professionalsForService(pool, opts.serviceId, opts.professionalId)) {
    const [work, busy] = await Promise.all([loadWork(pool, pid), loadBusy(pool, pid, bounds.start, bounds.end)]);
    for (const s of generateSlots({ date: opts.date, durationMin: service.duration_min, rules, work, busy, now: opts.now })) {
      const cur = map.get(s.startsAt);
      if (cur) cur.professionalIds.push(pid); else map.set(s.startsAt, { ...s, professionalIds: [pid] });
    }
  }
  return [...map.values()].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

/** Dias do mês (AAAA-MM) com pelo menos um horário livre. */
export async function getMonthAvailability(opts: { serviceId: number; professionalId?: number; month: string; now?: Date }) {
  const { rules } = await loadBusiness();
  const service = await getService(pool, opts.serviceId);
  const first = DateTime.fromISO(`${opts.month}-01`, { zone: rules.timezone });
  if (!first.isValid) throw new AppError(400, 'INVALID_DATE', 'Mês inválido (use AAAA-MM).');
  const from = first.startOf('month').toUTC().toJSDate();
  const to = first.endOf('month').toUTC().toJSDate();
  const pids = await professionalsForService(pool, opts.serviceId, opts.professionalId);
  const data = await Promise.all(pids.map(async (pid) => ({ work: await loadWork(pool, pid), busy: await loadBusy(pool, pid, from, to) })));
  const days: Record<string, boolean> = {};
  for (let d = first; d.month === first.month; d = d.plus({ days: 1 })) {
    const iso = d.toISODate()!;
    days[iso] = data.some(({ work, busy }) =>
      generateSlots({ date: iso, durationMin: service.duration_min, rules, work, busy, now: opts.now }).length > 0);
  }
  return days;
}

export interface CustomerInput { name: string; phone: string; email?: string | null }
export interface BookingInput {
  serviceId: number; professionalId: number; startsAt: Date; customer: CustomerInput;
  notes?: string | null; idempotencyKey?: string | null; asAdmin?: boolean; now?: Date;
}

export const normalizePhone = (p: string) => p.replace(/\D/g, '');

const PG_CODE_TO_REASON: Record<string, UnavailableReason> = {
  '23P01': 'overlap', AG001: 'closed_day', AG002: 'lunch', AG003: 'outside_hours', AG004: 'time_off',
};

function translatePgError(err: unknown): never {
  const code = (err as { code?: string })?.code;
  const reason = code ? PG_CODE_TO_REASON[code] : undefined;
  if (reason === 'overlap') throw new AppError(409, 'SLOT_TAKEN', reasonMessages.overlap);
  if (reason) throw new AppError(422, reason.toUpperCase(), reasonMessages[reason]);
  throw err;
}

async function validateRules(q: Queryable, professionalId: number, serviceId: number, startsAt: Date, durationMin: number, opts: { asAdmin?: boolean; now?: Date }) {
  const { rules } = await loadBusiness(q);
  const linked = await professionalsForService(q, serviceId, professionalId);
  if (!linked.length) throw new AppError(422, 'PROFESSIONAL_SERVICE', 'Este profissional não realiza o serviço escolhido.');
  const work = await loadWork(q, professionalId);
  // Domingo e almoço NUNCA são ignorados, nem para administradores; só a antecedência mínima.
  const reason = checkSlotRules({ startsAt, durationMin, rules, work, now: opts.now, ignoreNotice: opts.asAdmin });
  if (reason) throw new AppError(422, reason.toUpperCase(), reasonMessages[reason]);
}

export interface AppointmentRow {
  id: string; professional_id: number; customer_id: number; service_id: number;
  starts_at: Date; ends_at: Date; status: string; notes: string | null;
}

/** Cria um agendamento dentro de uma transação. Conflitos são barrados pela constraint EXCLUDE do PostgreSQL. */
export async function createAppointment(input: BookingInput): Promise<{ appointment: AppointmentRow; created: boolean }> {
  if (Number.isNaN(input.startsAt.getTime())) throw new AppError(400, 'INVALID_DATE', 'Data/hora inválida.');
  try {
    return await withTransaction(async (client) => {
      if (input.idempotencyKey) {
        const prev = await client.query('SELECT * FROM appointments WHERE idempotency_key = $1', [input.idempotencyKey]);
        if (prev.rows[0]) return { appointment: prev.rows[0], created: false };
      }
      const service = await getService(client, input.serviceId);
      await validateRules(client, input.professionalId, input.serviceId, input.startsAt, service.duration_min, input);
      const endsAt = new Date(input.startsAt.getTime() + service.duration_min * 60_000);

      const phone = normalizePhone(input.customer.phone);
      const cust = await client.query(
        `INSERT INTO customers (name, phone, email) VALUES ($1,$2,$3)
         ON CONFLICT (phone) DO UPDATE SET name = EXCLUDED.name, email = COALESCE(EXCLUDED.email, customers.email)
         RETURNING id`,
        [input.customer.name.trim(), phone, input.customer.email || null],
      );
      const ins = await client.query(
        `INSERT INTO appointments (professional_id, customer_id, service_id, starts_at, ends_at, notes, idempotency_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [input.professionalId, cust.rows[0].id, input.serviceId, input.startsAt, endsAt, input.notes ?? null, input.idempotencyKey ?? null],
      );
      return { appointment: ins.rows[0], created: true };
    });
  } catch (err) {
    if (['23505', '23P01'].includes((err as { code?: string }).code ?? '') && input.idempotencyKey) {
      const prev = await pool.query('SELECT * FROM appointments WHERE idempotency_key = $1', [input.idempotencyKey]);
      if (prev.rows[0]) return { appointment: prev.rows[0], created: false };
    }
    if (err instanceof AppError) throw err;
    try { translatePgError(err); } catch (e) {
      if (e instanceof AppError && e.code === 'SLOT_TAKEN') {
        e.extra = { suggestions: await suggestSlots(input) };
      }
      throw e;
    }
    throw err;
  }
}

/** Próximos horários livres do mesmo dia (ou dos próximos dias) para sugerir após um conflito. */
async function suggestSlots(input: BookingInput) {
  try {
    const { rules } = await loadBusiness();
    let day = DateTime.fromJSDate(input.startsAt, { zone: rules.timezone }).startOf('day');
    for (let i = 0; i < 7; i++, day = day.plus({ days: 1 })) {
      const slots = (await getAvailability({ serviceId: input.serviceId, professionalId: input.professionalId, date: day.toISODate()!, now: input.now }))
        .filter((s) => new Date(s.startsAt) > input.startsAt || i > 0);
      if (slots.length) return slots.slice(0, 5).map((s) => s.startsAt);
    }
  } catch { /* sugestões são opcionais */ }
  return [];
}

export async function moveAppointment(id: string, startsAt: Date, professionalId?: number) {
  try {
    return await withTransaction(async (client) => {
      const cur = (await client.query('SELECT * FROM appointments WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!cur) throw new AppError(404, 'NOT_FOUND', 'Agendamento não encontrado.');
      if (cur.status !== 'booked') throw new AppError(409, 'NOT_BOOKED', 'Só é possível remarcar agendamentos ativos.');
      const service = await getService(client, cur.service_id);
      const pid = professionalId ?? cur.professional_id;
      await validateRules(client, pid, cur.service_id, startsAt, service.duration_min, { asAdmin: true });
      const endsAt = new Date(startsAt.getTime() + service.duration_min * 60_000);
      const up = await client.query(
        'UPDATE appointments SET starts_at=$2, ends_at=$3, professional_id=$4 WHERE id=$1 RETURNING *',
        [id, startsAt, endsAt, pid],
      );
      return up.rows[0] as AppointmentRow;
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    return translatePgError(err);
  }
}

export async function setStatus(id: string, status: 'booked' | 'cancelled' | 'done' | 'no_show') {
  try {
    const { rows } = await pool.query('UPDATE appointments SET status = $2 WHERE id = $1 RETURNING *', [id, status]);
    if (!rows[0]) throw new AppError(404, 'NOT_FOUND', 'Agendamento não encontrado.');
    return rows[0] as AppointmentRow;
  } catch (err) {
    if (err instanceof AppError) throw err;
    return translatePgError(err);
  }
}
