import { describe, expect, it } from 'vitest';
import { checkSlotRules, generateSlots, type Rules, type WorkWindow } from '../src/domain/availability.js';
import { formatInZone } from '../src/domain/timezone.js';

const rules: Rules = { timezone: 'America/Sao_Paulo', stepMin: 30, minNoticeMin: 60, maxDaysAhead: 60,
  lunchStart: '11:00', lunchEnd: '13:00', closedWeekdays: [7] };
const work: WorkWindow[] = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: '09:00', end: '19:00' }));
const now = new Date('2026-03-01T00:00:00Z');
const hhmm = (iso: string, tz = rules.timezone) => formatInZone(iso, tz);

describe('generateSlots', () => {
  it('não gera nenhum horário aos domingos (mesmo com expediente cadastrado)', () => {
    expect(generateSlots({ date: '2026-03-08', durationMin: 30, rules, work, busy: [], now })).toEqual([]); // domingo
  });

  it('bloqueia o almoço 11:00–13:00 em dia útil', () => {
    const slots = generateSlots({ date: '2026-03-09', durationMin: 30, rules, work, busy: [], now }).map((s) => hhmm(s.startsAt));
    expect(slots[0]).toBe('09:00');
    expect(slots).toContain('10:30');
    for (const h of ['11:00', '11:30', '12:00', '12:30']) expect(slots).not.toContain(h);
    expect(slots).toContain('13:00');
    expect(slots.at(-1)).toBe('18:30');
  });

  it('serviço de 60min não pode invadir o almoço (10:30 termina 11:30)', () => {
    const slots = generateSlots({ date: '2026-03-09', durationMin: 60, rules, work, busy: [], now }).map((s) => hhmm(s.startsAt));
    expect(slots).toContain('10:00');
    expect(slots).not.toContain('10:30');
    expect(slots).toContain('13:00');
  });

  it('remove horários ocupados e respeita antecedência mínima', () => {
    const busy = [{ start: new Date('2026-03-09T12:00:00Z'), end: new Date('2026-03-09T12:30:00Z') }]; // 09:00 BRT
    const slots = generateSlots({ date: '2026-03-09', durationMin: 30, rules, work, busy, now }).map((s) => hhmm(s.startsAt));
    expect(slots).not.toContain('09:00');
    const soon = generateSlots({ date: '2026-03-09', durationMin: 30, rules, work, busy: [], now: new Date('2026-03-09T13:10:00Z') }).map((s) => hhmm(s.startsAt));
    expect(soon[0]).toBe('13:00'); // agora 10:10 + 60min = 11:10, cai no almoço, primeiro livre é 13:00
  });

  it('trata mudança de horário de verão (America/New_York, 08/03/2026)', () => {
    const ny: Rules = { ...rules, timezone: 'America/New_York', closedWeekdays: [] };
    const slots = generateSlots({ date: '2026-03-08', durationMin: 30, rules: ny, work, busy: [], now });
    expect(slots[0].startsAt).toBe('2026-03-08T13:00:00.000Z'); // 09:00 EDT = UTC-4
    const before = generateSlots({ date: '2026-03-07', durationMin: 30, rules: ny, work, busy: [], now });
    expect(before[0].startsAt).toBe('2026-03-07T14:00:00.000Z'); // 09:00 EST = UTC-5
  });

  it('mostra horários no fuso do cliente', () => {
    const s = generateSlots({ date: '2026-03-09', durationMin: 30, rules, work, busy: [], now })[0];
    expect(hhmm(s.startsAt, 'America/Sao_Paulo')).toBe('09:00');
    expect(hhmm(s.startsAt, 'Europe/Lisbon')).toBe('12:00');
    expect(hhmm(s.startsAt, 'America/Manaus')).toBe('08:00');
  });
});

describe('checkSlotRules', () => {
  const at = (iso: string, durationMin = 30) => checkSlotRules({ startsAt: new Date(iso), durationMin, rules, work, now });
  it('rejeita domingo, almoço e fora do expediente', () => {
    expect(at('2026-03-08T13:00:00Z')).toBe('closed_day');   // domingo 10:00
    expect(at('2026-03-09T14:30:00Z')).toBe('lunch');        // seg 11:30
    expect(at('2026-03-09T15:00:00Z')).toBe('lunch');        // seg 12:00
    expect(at('2026-03-09T13:30:00Z', 60)).toBe('lunch');    // seg 10:30 + 60min
    expect(at('2026-03-09T11:00:00Z')).toBe('outside_hours'); // seg 08:00
    expect(at('2026-03-09T12:15:00Z')).toBe('off_grid');     // 09:15
  });
  it('aceita horários válidos e consistentes com generateSlots', () => {
    expect(at('2026-03-09T16:00:00Z')).toBeNull(); // 13:00
    for (const s of generateSlots({ date: '2026-03-10', durationMin: 60, rules, work, busy: [], now }))
      expect(checkSlotRules({ startsAt: new Date(s.startsAt), durationMin: 60, rules, work, now })).toBeNull();
  });
});
