import { DateTime } from 'luxon';
import { atMinute, hmToMinutes } from './timezone.js';

export interface Rules {
  timezone: string;
  stepMin: number;
  minNoticeMin: number;
  maxDaysAhead: number;
  lunchStart: string;            // "11:00"
  lunchEnd: string;              // "13:00"
  closedWeekdays: number[];      // ISO 1..7 (7 = domingo)
}
export interface WorkWindow { weekday: number; start: string; end: string }
export interface Interval { start: Date; end: Date }
export interface Slot { startsAt: string; endsAt: string }

export type UnavailableReason =
  | 'closed_day' | 'lunch' | 'outside_hours' | 'off_grid' | 'too_soon' | 'too_far' | 'time_off' | 'overlap';

/** Divide [s,e) removendo [cutS,cutE). */
function subtract(s: number, e: number, cutS: number, cutE: number): Array<[number, number]> {
  if (cutE <= s || cutS >= e) return [[s, e]];
  const out: Array<[number, number]> = [];
  if (cutS > s) out.push([s, cutS]);
  if (cutE < e) out.push([cutE, e]);
  return out;
}

const overlaps = (aS: number, aE: number, b: Interval) => aS < b.end.getTime() && aE > b.start.getTime();

/**
 * Gera os horários livres de um dia (data civil na zona do estabelecimento).
 * Função pura: domingo/dias fechados e almoço nunca geram slots.
 */
export function generateSlots(opts: {
  date: string; durationMin: number; rules: Rules; work: WorkWindow[]; busy: Interval[]; now?: Date;
}): Slot[] {
  const { rules, durationMin, busy } = opts;
  const now = opts.now ?? new Date();
  const day = DateTime.fromISO(opts.date, { zone: rules.timezone });
  if (!day.isValid) return [];
  if (rules.closedWeekdays.includes(day.weekday)) return [];

  const earliest = now.getTime() + rules.minNoticeMin * 60_000;
  const latest = now.getTime() + rules.maxDaysAhead * 86_400_000;
  const lunchS = hmToMinutes(rules.lunchStart);
  const lunchE = hmToMinutes(rules.lunchEnd);
  const slots: Slot[] = [];

  for (const w of opts.work.filter((x) => x.weekday === day.weekday)) {
    for (const [segS, segE] of subtract(hmToMinutes(w.start), hmToMinutes(w.end), lunchS, lunchE)) {
      for (let m = segS; m + durationMin <= segE; m += rules.stepMin) {
        const start = atMinute(day, m).toMillis();
        const end = atMinute(day, m + durationMin).toMillis();
        if (start < earliest || start > latest) continue;
        if (busy.some((b) => overlaps(start, end, b))) continue;
        slots.push({ startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString() });
      }
    }
  }
  return slots.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

/**
 * Valida regras de negócio de um instante específico (sem consultar conflitos; esses o banco garante).
 * Retorna null se válido, ou o motivo. Usa as mesmas regras de generateSlots.
 */
export function checkSlotRules(opts: {
  startsAt: Date; durationMin: number; rules: Rules; work: WorkWindow[]; now?: Date; ignoreNotice?: boolean;
}): UnavailableReason | null {
  const { rules, durationMin } = opts;
  const now = opts.now ?? new Date();
  const start = DateTime.fromJSDate(opts.startsAt, { zone: rules.timezone });
  const day = start.startOf('day');
  if (rules.closedWeekdays.includes(start.weekday)) return 'closed_day';

  const sMin = start.hour * 60 + start.minute;
  const eMin = sMin + durationMin;
  if (eMin > 24 * 60) return 'outside_hours';
  if (sMin < hmToMinutes(rules.lunchEnd) && eMin > hmToMinutes(rules.lunchStart)) return 'lunch';

  const win = opts.work.filter((w) => w.weekday === start.weekday)
    .find((w) => sMin >= hmToMinutes(w.start) && eMin <= hmToMinutes(w.end));
  if (!win) return 'outside_hours';
  if ((sMin - hmToMinutes(win.start)) % rules.stepMin !== 0 || atMinute(day, sMin).toMillis() !== start.toMillis()) return 'off_grid';

  if (!opts.ignoreNotice && start.toMillis() < now.getTime() + rules.minNoticeMin * 60_000) return 'too_soon';
  if (start.toMillis() > now.getTime() + rules.maxDaysAhead * 86_400_000) return 'too_far';
  return null;
}

export const reasonMessages: Record<UnavailableReason, string> = {
  closed_day: 'Não atendemos neste dia (domingo).',
  lunch: 'Horário de almoço: não há agendamentos neste período.',
  outside_hours: 'Fora do horário de atendimento do profissional.',
  off_grid: 'Horário inválido. Escolha um dos horários disponíveis.',
  too_soon: 'Antecedência mínima não respeitada.',
  too_far: 'Data além do limite de agendamento antecipado.',
  time_off: 'Profissional indisponível neste período (folga ou feriado).',
  overlap: 'Este horário acabou de ser ocupado. Escolha outro.',
};
