import { h, clear, api, applyTheme, $ } from '/shared/dom.js';
import { clientTz, fmtDate, fmtTime, money, dateInTz } from '/shared/tz.js';

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

const state = { biz: null, services: [], pros: [], service: null, pro: undefined /* undefined=ainda não, null=qualquer */, date: null, slot: null,
  month: null, days: {}, step: 0, done: null };
const TZ = clientTz();
const STEPS = ['Serviço', 'Profissional', 'Data e horário', 'Seus dados'];
const panel = $('#panel');
const idemKey = crypto.randomUUID();

async function init() {
  const [biz, services, pros] = await Promise.all([api('/public/business'), api('/public/services'), api('/public/professionals')]);
  Object.assign(state, { biz, services, pros });
  const t = biz.theme || {};
  applyTheme(t);
  document.title = `${biz.name} · Agendamento online`;
  $('#logo').textContent = t.logoText || biz.name;
  $('#heroTitle').textContent = t.heroTitle || biz.name;
  $('#heroText').textContent = t.heroText || '';
  $('#cta').textContent = t.ctaText || 'Agendar agora';
  $('#footName').textContent = biz.name;
  if (t.heroImage && /^https?:\/\/|^\//.test(t.heroImage)) document.documentElement.style.setProperty('--hero-image', `url("${t.heroImage.replace(/"/g, '')}")`);
  $('#hoursInfo').textContent = `Fechamos para almoço das ${biz.lunch.start} às ${biz.lunch.end} e aos domingos.`;
  $('#svcGrid').append(...services.map((s) => h('div', { class: 'svc' }, h('h3', {}, s.name), h('p', { class: 'muted' }, s.description || ''),
    h('div', { class: 'price' }, money(s.priceCents)), h('small', { class: 'muted' }, `${s.durationMin} min`))));
  state.month = dateInTz(new Date(), biz.timezone).slice(0, 7);
  render();
}

function renderSteps() {
  clear($('#steps')).append(...STEPS.map((s, i) => h('li', { class: i === state.step ? 'on' : i < state.step ? 'done' : '' }, `${i + 1}. ${s}`)));
}

function render() {
  renderSteps();
  clear(panel);
  if (state.done) return renderDone();
  [stepService, stepPro, stepWhen, stepForm][state.step]();
}

const back = () => h('button', { class: 'btn ghost', onClick: () => { state.step--; if (state.step < 2) { state.slot = null; } render(); } }, '← Voltar');

function stepService() {
  panel.append(h('div', { class: 'opts' }, state.services.map((s) => h('button', { class: 'opt' + (state.service?.id === s.id ? ' sel' : ''),
    onClick: () => { state.service = s; state.pro = undefined; state.date = null; state.slot = null; state.step = 1; render(); } },
    h('div', {}, h('b', {}, s.name), h('small', {}, `${s.durationMin} min · ${money(s.priceCents)}`))))));
}

function stepPro() {
  const pros = state.pros.filter((p) => p.serviceIds.includes(state.service.id));
  const pick = (p) => { state.pro = p; state.date = null; state.slot = null; state.days = {}; state.step = 2; render(); };
  panel.append(h('div', { class: 'opts' },
    h('button', { class: 'opt', onClick: () => pick(null) }, h('span', { class: 'dot', style: { background: '#6b7785' } }, '★'), h('div', {}, h('b', {}, 'Sem preferência'), h('small', {}, 'O primeiro profissional livre'))),
    pros.map((p) => h('button', { class: 'opt', onClick: () => pick(p) }, h('span', { class: 'dot', style: { background: p.color } }, p.name[0]), h('div', {}, h('b', {}, p.name))))),
    h('div', { class: 'actions' }, back()));
}

async function stepWhen() {
  const box = h('div', {});
  panel.append(box, h('div', { class: 'actions' }, back()));
  const q = new URLSearchParams({ serviceId: state.service.id, month: state.month, ...(state.pro ? { professionalId: state.pro.id } : {}) });
  box.classList.add('spin');
  try { state.days = (await api(`/public/availability/days?${q}`)).days; } catch (e) { box.append(h('div', { class: 'msg err' }, e.message)); }
  box.classList.remove('spin');

  const [y, m] = state.month.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const label = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(first);
  const shift = (n) => { const d = new Date(Date.UTC(y, m - 1 + n, 1)); state.month = d.toISOString().slice(0, 7); state.date = null; state.slot = null; render(); };
  const today = dateInTz(new Date(), state.biz.timezone);
  const cells = [...['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((d) => h('div', { class: 'dow' }, d)), ...Array(first.getUTCDay()).fill(0).map(() => h('span'))];
  const nDays = new Date(Date.UTC(y, m, 0)).getUTCDate();
  for (let d = 1; d <= nDays; d++) {
    const iso = `${state.month}-${String(d).padStart(2, '0')}`;
    const isSunday = state.biz.closedWeekdays.includes(((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7) + 1);
    cells.push(h('button', { class: (state.date === iso ? 'sel ' : '') + (isSunday ? 'sunday' : ''), disabled: !state.days[iso] || iso < today,
      title: isSunday ? 'Fechado aos domingos' : '', onClick: () => { state.date = iso; state.slot = null; loadSlots(); renderCalSel(); } }, d));
  }
  box.append(h('div', { class: 'cal-head' }, h('button', { class: 'btn ghost sm', onClick: () => shift(-1), 'aria-label': 'Mês anterior' }, '‹'), label,
    h('button', { class: 'btn ghost sm', onClick: () => shift(1), 'aria-label': 'Próximo mês' }, '›')),
    h('div', { class: 'cal', id: 'cal' }, cells),
    h('p', { class: 'lunch-note' }, `🍽 Sem atendimento das ${state.biz.lunch.start} às ${state.biz.lunch.end} (almoço) e aos domingos.`),
    h('div', { id: 'slots' }));
  if (state.date) loadSlots();
}
function renderCalSel() { document.querySelectorAll('#cal button').forEach((b) => b.classList.toggle('sel', b.textContent === String(+state.date.slice(8)))); }

async function loadSlots() {
  const box = $('#slots'); if (!box) return;
  clear(box).append(h('p', { class: 'muted' }, 'Carregando horários…'));
  const q = new URLSearchParams({ serviceId: state.service.id, date: state.date, tz: TZ, ...(state.pro ? { professionalId: state.pro.id } : {}) });
  try {
    const r = await api(`/public/availability?${q}`);
    clear(box);
    const diff = r.clientTimezone !== r.businessTimezone;
    box.append(h('h3', {}, fmtDate(`${state.date}T12:00:00Z`, 'UTC')));
    if (diff) box.append(h('div', { class: 'msg info' }, `Horários exibidos no seu fuso (${TZ}). A barbearia fica em ${r.businessTimezone}.`));
    if (!r.slots.length) return box.append(h('p', { class: 'muted' }, 'Sem horários livres neste dia.'));
    box.append(h('div', { class: 'times' }, r.slots.map((s) => h('button', { class: state.slot?.startsAt === s.startsAt ? 'sel' : '',
      onClick: () => { state.slot = s; state.step = 3; render(); } }, s.clientTime, diff ? h('small', {}, `loja ${s.businessTime}`) : null))));
  } catch (e) { clear(box).append(h('div', { class: 'msg err' }, e.message)); }
}

function stepForm() {
  const s = state.slot;
  const err = h('div', {});
  const f = { name: h('input', { required: true, autocomplete: 'name', maxlength: 120 }), phone: h('input', { required: true, type: 'tel', autocomplete: 'tel', placeholder: '(11) 99999-0000' }),
    email: h('input', { type: 'email', autocomplete: 'email' }), notes: h('textarea', { rows: 2, maxlength: 500 }) };
  const btn = h('button', { class: 'btn', type: 'submit' }, 'Confirmar agendamento');
  const form = h('form', { onSubmit: async (ev) => {
    ev.preventDefault(); clear(err); btn.disabled = true;
    try {
      state.done = await api('/public/appointments', { method: 'POST', headers: { 'Idempotency-Key': idemKey }, body: {
        serviceId: state.service.id, ...(state.pro ? { professionalId: state.pro.id } : {}), startsAt: s.startsAt,
        customer: { name: f.name.value, phone: f.phone.value, email: f.email.value }, notes: f.notes.value || undefined } });
      render();
    } catch (e) {
      btn.disabled = false;
      err.append(h('div', { class: 'msg err' }, e.message));
      if (e.status === 409 && e.data?.suggestions?.length) {
        err.append(h('p', {}, 'Que tal um destes?'), h('div', { class: 'times' }, e.data.suggestions.map((iso) => h('button', { type: 'button',
          onClick: () => { state.slot = { startsAt: iso, clientTime: fmtTime(iso, TZ) }; state.date = dateInTz(new Date(iso), state.biz.timezone); state.month = state.date.slice(0, 7); state.step = 2; render(); } },
          `${fmtDate(iso, TZ, { day: '2-digit', month: '2-digit' })} ${fmtTime(iso, TZ)}`))));
      } else if (e.status === 409) { state.step = 2; setTimeout(render, 1500); }
    }
  } },
  h('div', { class: 'summary' },
    h('div', {}, h('b', {}, 'Serviço'), `${state.service.name} (${state.service.durationMin} min · ${money(state.service.priceCents)})`),
    h('div', {}, h('b', {}, 'Profissional'), state.pro ? state.pro.name : 'Primeiro disponível'),
    h('div', {}, h('b', {}, 'Quando'), `${fmtDate(s.startsAt, TZ)} às ${fmtTime(s.startsAt, TZ)}`)),
  h('div', { class: 'row' }, h('div', { class: 'field' }, h('label', {}, 'Nome *'), f.name), h('div', { class: 'field' }, h('label', {}, 'WhatsApp / telefone *'), f.phone)),
  h('div', { class: 'field' }, h('label', {}, 'E-mail (opcional)'), f.email),
  h('div', { class: 'field' }, h('label', {}, 'Observações'), f.notes), err,
  h('div', { class: 'actions' }, back(), btn));
  panel.append(form);
}

function renderDone() {
  const a = state.done;
  panel.append(h('div', { class: 'success' }, h('div', { class: 'check' }, '✅'), h('h3', {}, 'Agendamento confirmado!'),
    h('p', {}, `${state.service.name} · ${fmtDate(a.startsAt, TZ)} às ${fmtTime(a.startsAt, TZ)}`),
    h('p', { class: 'muted' }, `Código: ${a.id.slice(0, 8).toUpperCase()}`),
    h('button', { class: 'btn', onClick: () => location.reload() }, 'Novo agendamento')));
  renderSteps(); clear($('#steps'));
}

init().catch((e) => panel.append(h('div', { class: 'msg err' }, `Não foi possível carregar: ${e.message}`)));
