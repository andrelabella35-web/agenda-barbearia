// Utilitários de fuso horário (Intl) usados nas duas interfaces.
export const clientTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

export function fmtTime(iso, tz) {
  return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).format(new Date(iso));
}
export function fmtDate(iso, tz, opts = { weekday: 'long', day: '2-digit', month: 'long' }) {
  return new Intl.DateTimeFormat('pt-BR', { ...opts, timeZone: tz }).format(new Date(iso));
}
/** Data civil (AAAA-MM-DD) de um instante em um fuso. */
export function dateInTz(date, tz) {
  const p = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: tz }).format(date);
  return p; // en-CA => AAAA-MM-DD
}
function offsetMs(utcMs, tz) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}
/** "AAAA-MM-DD" + "HH:mm" no fuso `tz` => ISO UTC. */
export function zonedToUtcISO(dateStr, hm, tz) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const [h, mi] = hm.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let t = guess - offsetMs(guess, tz);
  t = guess - offsetMs(t, tz);
  return new Date(t).toISOString();
}
export const money = (cents) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
