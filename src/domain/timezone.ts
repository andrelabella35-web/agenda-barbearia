import { DateTime } from 'luxon';

export function isValidZone(tz: string): boolean {
  return DateTime.local().setZone(tz).isValid;
}

/** "HH:mm" ou "HH:mm:ss" -> minutos desde 00:00. */
export function hmToMinutes(hm: string): number {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + (m || 0);
}

export function minutesToHm(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

/** Instante local do dia `day` (zona do estabelecimento) em `minuteOfDay`; seguro em mudança de horário de verão. */
export function atMinute(day: DateTime, minuteOfDay: number): DateTime {
  return day.startOf('day').set({ hour: Math.floor(minuteOfDay / 60), minute: minuteOfDay % 60 });
}

/** Limites UTC [início, fim) de um dia civil na zona informada. */
export function dayBoundsUtc(dateISO: string, tz: string): { start: Date; end: Date } | null {
  const d = DateTime.fromISO(dateISO, { zone: tz });
  if (!d.isValid) return null;
  return { start: d.startOf('day').toUTC().toJSDate(), end: d.endOf('day').plus({ millisecond: 1 }).toUTC().toJSDate() };
}

/** Formata um instante UTC como "HH:mm" em uma zona. */
export function formatInZone(iso: string | Date, tz: string): string {
  const dt = iso instanceof Date ? DateTime.fromJSDate(iso) : DateTime.fromISO(iso);
  return dt.setZone(tz).toFormat('HH:mm');
}
