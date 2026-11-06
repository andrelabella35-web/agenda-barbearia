import { h, clear, api as rawApi, applyTheme, $ } from '/shared/dom.js';
import { fmtTime, fmtDate, dateInTz, zonedToUtcISO, money } from '/shared/tz.js';

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/admin/sw.js', { scope: '/admin/' }).catch(() => {});

const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* ignore */ } },
};
const S = { token: store.get('token'), user: null, biz: null, pros: [], services: [], view: 'home', date: null };
const root = $('#app');
const WD = ['', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];

async function api(path, opts = {}) {
  try { return await rawApi(path, { ...opts, token: S.token }); }
  catch (e) { if (e.status === 401) { logout(); } throw e; }
}
function toast(msg) { const t = h('div', { class: 'toast' }, msg); document.body.append(t); setTimeout(() => t.remove(), 2600); }
function logout() { S.token = null; store.set('token', null); boot(); }

// ---------- Login ----------
function loginView() {
  const err = h('div', {});
  const email = h('input', { type: 'email', required: true, value: '', autocomplete: 'username' });
  const pass = h('input', { type: 'password', required: true, autocomplete: 'current-password' });
  clear(root).append(h('div', { class: 'login' }, h('form', { class: 'card', onSubmit: async (e) => {
    e.preventDefault(); clear(err);
    try {
      const r = await rawApi('/auth/login', { method: 'POST', body: { email: email.value, password: pass.value } });
      S.token = r.token; store.set('token', r.token); boot();
    } catch (x) { err.append(h('div', { class: 'msg err' }, x.message)); }
  } }, h('h1', {}, 'Sistema Barbearia'), h('p', { class: 'muted' }, 'Entre para gerenciar a agenda'),
  h('div', { class: 'field' }, h('label', {}, 'E-mail'), email), h('div', { class: 'field' }, h('label', {}, 'Senha'), pass), err,
  h('button', { class: 'btn', style: { width: '100%' } }, 'Entrar'))));
}

// ---------- Shell ----------
const NAV = [['home', '🏠', 'Home'], ['agenda', '📅', 'Agenda'], ['customers', '👥', 'Clientes'], ['services', '✂️', 'Serviços'],
  ['pros', '💈', 'Profissionais'], ['timeoff', '🚫', 'Feriados / Folgas'], ['settings', '⚙️', 'Configurações']];

function shell() {
  const side = h('aside', { class: 'side' }, h('div', { class: 'brand' }, '📊 SISTEMA', h('small', {}, S.biz.name)), h('div', { class: 'menu-title' }, 'Menu de navegação'),
    NAV.map(([k, ic, label]) => h('a', { href: `#${k}`, class: S.view === k ? 'on' : '', onClick: () => side.classList.remove('open') }, h('span', {}, ic), label)));
  const main = h('div', {}, h('div', { class: 'topbar' },
    h('button', { class: 'burger', 'aria-label': 'Menu', onClick: () => side.classList.toggle('open') }, '☰'), h('span', { class: 'sp' }),
    h('div', { class: 'who' }, h('b', {}, S.user?.name || 'Admin'), h('small', {}, 'Administrador')),
    h('button', { class: 'btn ghost sm', onClick: logout }, 'Sair')), h('div', { class: 'content', id: 'content' }));
  clear(root).append(h('div', { class: 'shell' }, side, main));
}

async function route() {
  S.view = location.hash.slice(1) || 'home';
  if (!NAV.some(([k]) => k === S.view)) S.view = 'home';
  shell();
  const c = $('#content');
  try { await ({ home: homeView, agenda: agendaView, customers: customersView, services: servicesView, pros: prosView, timeoff: timeoffView, settings: settingsView })[S.view](c); }
  catch (e) { if (e.status !== 401) c.append(h('div', { class: 'msg err' }, e.message)); }
}

// ---------- Modal ----------
function modal(title, body, actions) {
  const bg = h('div', { class: 'modal-bg', onClick: (e) => { if (e.target === bg) bg.remove(); } },
    h('div', { class: 'modal', role: 'dialog', 'aria-label': title }, h('h3', {}, title), body, h('div', { class: 'actions' }, actions(() => bg.remove()))));
  document.body.append(bg);
  return bg;
}
const field = (label, input) => h('div', { class: 'field' }, h('label', {}, label), input);
const errBox = () => h('div', {});
const showErr = (box, e) => { clear(box).append(h('div', { class: 'msg err' }, e.message)); };

// ---------- Home ----------
async function homeView(c) {
  const d = await api('/admin/dashboard');
  const kpi = (n, label, ic, color) => h('div', { class: 'kpi' }, h('div', { class: 'ic', style: { background: color } }, ic), h('div', {}, h('b', {}, n), h('span', {}, label)));
  const max = Math.max(1, ...d.last7Days.map((x) => x.n));
  const bars = [];
  for (let i = 6; i >= 0; i--) {
    const day = dateInTz(new Date(Date.now() - i * 86400000), d.timezone);
    const n = d.last7Days.find((x) => x.day === day)?.n || 0;
    bars.push(h('div', {}, h('b', {}, n), h('i', { style: { height: `${(n / max) * 100}%` } }), day.slice(8) + '/' + day.slice(5, 7)));
  }
  c.append(h('div', { class: 'kpis' },
    kpi(d.totalCustomers, 'Total de Clientes', '👥', '#7a5af8'), kpi(d.appointmentsToday, 'Agendamentos Hoje', '📅', '#1fa971'),
    kpi(d.upcomingAppointments, 'Próximos Agendamentos', '⏰', '#f5a623'), kpi(d.activeServices, 'Serviços Ativos', '✂️', '#e8436e')),
  h('div', { class: 'grid2' },
    h('div', { class: 'panel' }, h('h3', {}, 'Ocupação de hoje'), d.closedToday ? h('p', { class: 'muted' }, 'Fechado hoje (domingo).') :
      h('div', { style: { display: 'flex', gap: '16px', alignItems: 'center' } }, h('div', { class: 'ring', style: { '--p': d.occupancyToday }, 'data-l': `${d.occupancyToday}%` }),
        h('p', { class: 'muted' }, 'Tempo agendado ÷ tempo disponível (descontando almoço).'))),
    h('div', { class: 'panel' }, h('h3', {}, 'Agendamentos — últimos 7 dias'), h('div', { class: 'bars' }, bars))),
  h('div', { class: 'panel', style: { marginTop: '16px' } }, h('h3', {}, 'Hoje'),
    d.today.length ? h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Hora', 'Cliente', 'Serviço', 'Profissional', 'Status'].map((x) => h('th', {}, x)))),
      h('tbody', {}, d.today.map((a) => h('tr', {}, h('td', {}, `${fmtTime(a.starts_at, d.timezone)}–${fmtTime(a.ends_at, d.timezone)}`), h('td', {}, a.customer), h('td', {}, a.service),
        h('td', {}, h('span', { style: { color: a.color } }, '● '), a.professional), h('td', {}, h('span', { class: 'tag' }, STATUS[a.status] || a.status))))))) :
      h('p', { class: 'muted' }, 'Nenhum agendamento hoje.')));
}
const STATUS = { booked: 'Agendado', done: 'Concluído', no_show: 'Faltou', cancelled: 'Cancelado' };

// ---------- Agenda ----------
const toMin = (hm) => { const [a, b] = hm.split(':').map(Number); return a * 60 + b; };
const isoWeekday = (dateStr) => { const [y, m, d] = dateStr.split('-').map(Number); return ((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7) + 1; };
const shiftDate = (dateStr, n) => { const [y, m, d] = dateStr.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const ROW = 30; // px por passo

async function agendaView(c) {
  const tz = S.biz.timezone;
  S.date ||= dateInTz(new Date(), tz);
  const pros = S.pros.filter((p) => p.active);
  const step = S.biz.stepMin;
  const wd = isoWeekday(S.date);
  const closed = S.biz.closedWeekdays.includes(wd);
  const appts = closed ? [] : await api(`/admin/appointments?date=${S.date}`);

  const hoursAll = pros.flatMap((p) => p.workingHours.filter((w) => w.weekday === wd));
  const gStart = Math.floor((hoursAll.length ? Math.min(...hoursAll.map((w) => toMin(w.start))) : 8 * 60) / 60) * 60;
  const gEnd = Math.ceil((hoursAll.length ? Math.max(...hoursAll.map((w) => toMin(w.end))) : 20 * 60) / 60) * 60;
  const lunchS = toMin(S.biz.lunchStart), lunchE = toMin(S.biz.lunchEnd);

  const dateInput = h('input', { type: 'date', value: S.date, onChange: (e) => { if (e.target.value) { S.date = e.target.value; route(); } } });
  c.append(h('div', { class: 'toolbar' }, h('h2', { class: 'title', style: { margin: 0 } }, 'Agenda'), h('span', { class: 'sp' }),
    h('button', { class: 'btn ghost sm', onClick: () => { S.date = shiftDate(S.date, -1); route(); } }, '‹'), dateInput,
    h('button', { class: 'btn ghost sm', onClick: () => { S.date = shiftDate(S.date, 1); route(); } }, '›'),
    h('button', { class: 'btn ghost sm', onClick: () => { S.date = dateInTz(new Date(), tz); route(); } }, 'Hoje'),
    h('button', { class: 'btn sm', onClick: () => newAppt(pros[0]?.id, S.date, '09:00') }, '+ Novo agendamento')),
  h('p', { class: 'muted', style: { marginTop: 0 } }, fmtDate(`${S.date}T12:00:00Z`, 'UTC', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }) + ` · fuso ${tz}`));

  if (closed) return c.append(h('div', { class: 'agenda closed-banner' }, '🔒 Estabelecimento fechado neste dia. Não é possível agendar aos domingos.'));
  if (!pros.length) return c.append(h('div', { class: 'msg info' }, 'Cadastre profissionais para ver a agenda.'));

  const rows = (gEnd - gStart) / step;
  const times = h('div', { class: 'ag-times' }, [h('div', { class: 'ag-head', style: { visibility: 'hidden' } }, '.'), ...Array.from({ length: rows }, (_, i) => h('div', { style: { height: `${ROW}px` } }, i % (60 / step) === 0 ? `${String(Math.floor((gStart + i * step) / 60)).padStart(2, '0')}:00` : ''))]);
  const cols = pros.map((p) => {
    const hrs = p.workingHours.find((w) => w.weekday === wd);
    const col = h('div', { class: 'ag-col' }, h('div', { class: 'ag-head' }, h('span', { class: 'dot', style: { background: p.color } }, p.name[0]), p.name));
    for (let i = 0; i < rows; i++) {
      const m = gStart + i * step, hm = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      const lunch = m < lunchE && m + step > lunchS;
      const off = !hrs || m < toMin(hrs.start) || m + step > toMin(hrs.end);
      col.append(h('div', { class: 'ag-slot' + (lunch ? ' lunch' : off ? ' off' : ''), style: { height: `${ROW}px` }, title: lunch ? 'Horário de almoço' : off ? 'Fora do expediente' : hm,
        onClick: lunch || off ? null : () => newAppt(p.id, S.date, hm) }));
    }
    const wrap = h('div', { style: { position: 'absolute', inset: '56px 0 0 0' } });
    for (const a of appts.filter((x) => x.professionalId === p.id)) {
      const s = toMin(fmtTime(a.startsAt, tz)), e = toMin(fmtTime(a.endsAt, tz));
      wrap.append(h('button', { class: `ag-ev ${a.status}`, style: { top: `${((s - gStart) / step) * ROW + 1}px`, height: `${((e - s) / step) * ROW - 2}px`, background: `color-mix(in srgb, ${a.color} 55%, #fff)` },
        onClick: () => apptModal(a) }, h('b', {}, `${fmtTime(a.startsAt, tz)} - ${fmtTime(a.endsAt, tz)}`), `${a.customer} · ${a.service}`));
    }
    col.append(wrap);
    return col;
  });
  const grid = h('div', { class: 'ag-grid', style: { gridTemplateColumns: `56px repeat(${pros.length}, minmax(150px, 1fr))` } }, times, cols);
  c.append(h('div', { class: 'agenda' }, grid));
}

function newAppt(proId, date, hm) {
  const tz = S.biz.timezone;
  const pro = h('select', {}, S.pros.filter((p) => p.active).map((p) => h('option', { value: p.id, selected: p.id === proId }, p.name)));
  const svc = h('select', {}); const refreshSvc = () => { const p = S.pros.find((x) => x.id === +pro.value); clear(svc).append(...S.services.filter((s) => s.active && p?.serviceIds.includes(s.id)).map((s) => h('option', { value: s.id }, `${s.name} (${s.durationMin} min)`))); };
  pro.addEventListener('change', refreshSvc); refreshSvc();
  const dIn = h('input', { type: 'date', value: date }), tIn = h('input', { type: 'time', value: hm, step: S.biz.stepMin * 60 });
  const name = h('input', { required: true }), phone = h('input', { type: 'tel', placeholder: '(11) 99999-0000' }), err = errBox();
  modal('Novo agendamento', h('div', {}, h('div', { class: 'row' }, field('Profissional', pro), field('Serviço', svc)), h('div', { class: 'row' }, field('Data', dIn), field('Hora', tIn)),
    h('div', { class: 'row' }, field('Cliente', name), field('Telefone', phone)), err), (close) => [
    h('button', { class: 'btn ghost', onClick: close }, 'Cancelar'),
    h('button', { class: 'btn', onClick: async () => {
      try {
        await api('/admin/appointments', { method: 'POST', body: { serviceId: +svc.value, professionalId: +pro.value, startsAt: zonedToUtcISO(dIn.value, tIn.value, tz), customer: { name: name.value, phone: phone.value } } });
        close(); toast('Agendamento criado'); route();
      } catch (e) { showErr(err, e); }
    } }, 'Salvar')]);
}

function apptModal(a) {
  const tz = S.biz.timezone;
  const dIn = h('input', { type: 'date', value: dateInTz(new Date(a.startsAt), tz) }), tIn = h('input', { type: 'time', value: fmtTime(a.startsAt, tz), step: S.biz.stepMin * 60 }), err = errBox();
  const act = (fn, msg) => async () => { try { await fn(); toast(msg); document.querySelector('.modal-bg')?.remove(); route(); } catch (e) { showErr(err, e); } };
  modal(`${a.customer}`, h('div', {}, h('p', {}, `${a.service} · ${a.professional}`), h('p', { class: 'muted' }, `${a.customerPhone} · ${STATUS[a.status]}`),
    h('div', { class: 'row' }, field('Data', dIn), field('Hora', tIn)), err), (close) => [
    h('button', { class: 'btn ghost', onClick: close }, 'Fechar'),
    h('button', { class: 'btn ghost', onClick: act(() => api(`/admin/appointments/${a.id}`, { method: 'PATCH', body: { startsAt: zonedToUtcISO(dIn.value, tIn.value, tz) } }), 'Remarcado') }, 'Remarcar'),
    h('button', { class: 'btn ghost', onClick: act(() => api(`/admin/appointments/${a.id}`, { method: 'PATCH', body: { status: 'no_show' } }), 'Marcado como falta') }, 'Faltou'),
    h('button', { class: 'btn ok', onClick: act(() => api(`/admin/appointments/${a.id}`, { method: 'PATCH', body: { status: 'done' } }), 'Concluído') }, 'Concluir'),
    h('button', { class: 'btn danger', onClick: act(() => api(`/admin/appointments/${a.id}`, { method: 'DELETE' }), 'Cancelado') }, 'Cancelar')]);
}

// ---------- Clientes ----------
async function customersView(c) {
  const list = h('div', {});
  const load = async (q = '') => {
    const rows = await api(`/admin/customers?q=${encodeURIComponent(q)}`);
    clear(list).append(h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Nome', 'Telefone', 'E-mail', 'Agendamentos'].map((x) => h('th', {}, x)))),
      h('tbody', {}, rows.map((r) => h('tr', {}, h('td', {}, r.name), h('td', {}, r.phone), h('td', {}, r.email || '—'), h('td', {}, r.appointments)))))), rows.length ? null : h('p', { class: 'muted' }, 'Nenhum cliente.'));
  };
  let t; c.append(h('h2', { class: 'title' }, 'Clientes'), h('div', { class: 'toolbar' }, h('input', { placeholder: 'Buscar por nome ou telefone', style: { maxWidth: '340px' }, onInput: (e) => { clearTimeout(t); t = setTimeout(() => load(e.target.value), 250); } })), h('div', { class: 'panel' }, list));
  await load();
}

// ---------- Serviços ----------
async function servicesView(c) {
  S.services = await api('/admin/services');
  c.append(h('div', { class: 'toolbar' }, h('h2', { class: 'title', style: { margin: 0 } }, 'Serviços'), h('span', { class: 'sp' }), h('button', { class: 'btn sm', onClick: () => editService() }, '+ Novo serviço')),
    h('div', { class: 'panel table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Serviço', 'Duração', 'Preço', 'Status', ''].map((x) => h('th', {}, x)))),
      h('tbody', {}, S.services.map((s) => h('tr', {}, h('td', {}, s.name), h('td', {}, `${s.durationMin} min`), h('td', {}, money(s.priceCents)), h('td', {}, h('span', { class: 'tag' + (s.active ? '' : ' off') }, s.active ? 'Ativo' : 'Inativo')),
        h('td', {}, h('button', { class: 'btn ghost sm', onClick: () => editService(s) }, 'Editar'))))))));
}
function editService(s = { name: '', description: '', durationMin: 30, priceCents: 0, active: true }) {
  const f = { name: h('input', { value: s.name }), description: h('input', { value: s.description || '' }), dur: h('input', { type: 'number', min: 5, step: 5, value: s.durationMin }),
    price: h('input', { type: 'number', min: 0, step: '0.01', value: (s.priceCents / 100).toFixed(2) }), active: h('select', {}, h('option', { value: '1', selected: s.active }, 'Ativo'), h('option', { value: '0', selected: !s.active }, 'Inativo')) };
  const err = errBox();
  modal(s.id ? 'Editar serviço' : 'Novo serviço', h('div', {}, field('Nome', f.name), field('Descrição', f.description), h('div', { class: 'row' }, field('Duração (min)', f.dur), field('Preço (R$)', f.price), field('Status', f.active)), err), (close) => [
    h('button', { class: 'btn ghost', onClick: close }, 'Cancelar'),
    h('button', { class: 'btn', onClick: async () => {
      try {
        const body = { name: f.name.value, description: f.description.value, durationMin: +f.dur.value, priceCents: Math.round(+f.price.value * 100), active: f.active.value === '1' };
        await api(s.id ? `/admin/services/${s.id}` : '/admin/services', { method: s.id ? 'PUT' : 'POST', body });
        close(); toast('Serviço salvo'); route();
      } catch (e) { showErr(err, e); }
    } }, 'Salvar')]);
}

// ---------- Profissionais ----------
async function prosView(c) {
  [S.pros, S.services] = await Promise.all([api('/admin/professionals'), api('/admin/services')]);
  c.append(h('div', { class: 'toolbar' }, h('h2', { class: 'title', style: { margin: 0 } }, 'Profissionais'), h('span', { class: 'sp' }), h('button', { class: 'btn sm', onClick: () => editPro() }, '+ Novo profissional')),
    h('div', { class: 'panel table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Profissional', 'Dias de atendimento', 'Status', ''].map((x) => h('th', {}, x)))),
      h('tbody', {}, S.pros.map((p) => h('tr', {}, h('td', {}, h('span', { style: { color: p.color } }, '● '), p.name), h('td', {}, p.workingHours.map((w) => `${WD[w.weekday].slice(0, 3)} ${w.start}-${w.end}`).join(' · ') || '—'),
        h('td', {}, h('span', { class: 'tag' + (p.active ? '' : ' off') }, p.active ? 'Ativo' : 'Inativo')), h('td', {}, h('button', { class: 'btn ghost sm', onClick: () => editPro(p) }, 'Editar'))))))));
}
function editPro(p = { name: '', color: '#f5a623', active: true, serviceIds: S.services.filter((s) => s.active).map((s) => s.id), workingHours: [1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start: '09:00', end: weekday === 6 ? '17:00' : '19:00' })) }) {
  const name = h('input', { value: p.name }), color = h('input', { type: 'color', value: p.color }), active = h('select', {}, h('option', { value: '1', selected: p.active }, 'Ativo'), h('option', { value: '0', selected: !p.active }, 'Inativo'));
  const svcs = S.services.filter((s) => s.active).map((s) => ({ s, cb: h('input', { type: 'checkbox', checked: p.serviceIds.includes(s.id) }) }));
  const hrs = [1, 2, 3, 4, 5, 6, 7].map((wd) => { const w = p.workingHours.find((x) => x.weekday === wd); const closed = S.biz.closedWeekdays.includes(wd);
    return { wd, closed, cb: h('input', { type: 'checkbox', checked: !!w && !closed, disabled: closed }), s: h('input', { type: 'time', value: w?.start || '09:00', disabled: closed }), e: h('input', { type: 'time', value: w?.end || '19:00', disabled: closed }) }; });
  const err = errBox();
  modal(p.id ? 'Editar profissional' : 'Novo profissional', h('div', {}, h('div', { class: 'row' }, field('Nome', name), field('Cor na agenda', color), field('Status', active)),
    h('div', { class: 'field' }, h('label', {}, 'Serviços realizados'), h('div', { class: 'chips' }, svcs.map(({ s, cb }) => h('label', {}, cb, s.name)))),
    h('div', { class: 'field' }, h('label', {}, `Expediente (almoço ${S.biz.lunchStart}–${S.biz.lunchEnd} é bloqueado automaticamente)`),
      h('div', { class: 'hours-edit' }, hrs.flatMap((r) => [h('label', {}, r.cb, WD[r.wd] + (r.closed ? ' 🔒' : '')), r.s, r.e]))), err), (close) => [
    h('button', { class: 'btn ghost', onClick: close }, 'Cancelar'),
    h('button', { class: 'btn', onClick: async () => {
      try {
        const body = { name: name.value, color: color.value, active: active.value === '1', serviceIds: svcs.filter((x) => x.cb.checked).map((x) => x.s.id),
          workingHours: hrs.filter((r) => r.cb.checked).map((r) => ({ weekday: r.wd, start: r.s.value, end: r.e.value })) };
        await api(p.id ? `/admin/professionals/${p.id}` : '/admin/professionals', { method: p.id ? 'PUT' : 'POST', body });
        close(); toast('Profissional salvo'); route();
      } catch (e) { showErr(err, e); }
    } }, 'Salvar')]);
}

// ---------- Feriados / folgas ----------
async function timeoffView(c) {
  const rows = await api('/admin/time-off');
  const tz = S.biz.timezone;
  const fmt = (iso) => fmtDate(iso, tz, { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' + fmtTime(iso, tz);
  c.append(h('div', { class: 'toolbar' }, h('h2', { class: 'title', style: { margin: 0 } }, 'Feriados e folgas'), h('span', { class: 'sp' }), h('button', { class: 'btn sm', onClick: addTimeOff }, '+ Novo bloqueio')),
    h('div', { class: 'panel table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Quem', 'Início', 'Fim', 'Motivo', ''].map((x) => h('th', {}, x)))),
      h('tbody', {}, rows.map((r) => h('tr', {}, h('td', {}, r.professionalId ? S.pros.find((p) => p.id === r.professionalId)?.name : 'Todos'), h('td', {}, fmt(r.startsAt)), h('td', {}, fmt(r.endsAt)), h('td', {}, r.reason || '—'),
        h('td', {}, h('button', { class: 'btn ghost sm', onClick: async () => { await api(`/admin/time-off/${r.id}`, { method: 'DELETE' }); route(); } }, 'Remover'))))))), rows.length ? null : h('p', { class: 'muted' }, 'Nenhum bloqueio cadastrado.'));
}
function addTimeOff() {
  const who = h('select', {}, h('option', { value: '' }, 'Todo o estabelecimento (feriado)'), S.pros.map((p) => h('option', { value: p.id }, p.name)));
  const from = h('input', { type: 'date', value: dateInTz(new Date(), S.biz.timezone) }), to = h('input', { type: 'date', value: dateInTz(new Date(), S.biz.timezone) }), reason = h('input', { placeholder: 'Ex.: Feriado, férias…' }), err = errBox();
  modal('Novo bloqueio', h('div', {}, field('Quem', who), h('div', { class: 'row' }, field('De', from), field('Até (inclusive)', to)), field('Motivo', reason), err), (close) => [
    h('button', { class: 'btn ghost', onClick: close }, 'Cancelar'),
    h('button', { class: 'btn', onClick: async () => {
      try {
        await api('/admin/time-off', { method: 'POST', body: { professionalId: who.value ? +who.value : null, startsAt: zonedToUtcISO(from.value, '00:00', S.biz.timezone),
          endsAt: zonedToUtcISO(shiftDate(to.value, 1), '00:00', S.biz.timezone), reason: reason.value || undefined } });
        close(); route();
      } catch (e) { showErr(err, e); }
    } }, 'Salvar')]);
}

// ---------- Configurações ----------
async function settingsView(c) {
  const b = await api('/admin/business'); const t = b.theme || {};
  const f = { name: h('input', { value: b.name }), timezone: h('input', { value: b.timezone, list: 'tzs' }), step: h('input', { type: 'number', min: 5, step: 5, value: b.stepMin }),
    notice: h('input', { type: 'number', min: 0, value: b.minNoticeMin }), ahead: h('input', { type: 'number', min: 1, value: b.maxDaysAhead }),
    ls: h('input', { type: 'time', value: b.lunchStart }), le: h('input', { type: 'time', value: b.lunchEnd }),
    primary: h('input', { type: 'color', value: t.primary || '#c62828' }), accent: h('input', { type: 'color', value: t.accent || '#f5a623' }), dark: h('input', { type: 'color', value: t.dark || '#0b2a3c' }),
    logoText: h('input', { value: t.logoText || '' }), heroTitle: h('input', { value: t.heroTitle || '' }), heroText: h('textarea', { rows: 3 }, t.heroText || ''), ctaText: h('input', { value: t.ctaText || '' }), heroImage: h('input', { value: t.heroImage || '', placeholder: 'https://… (imagem de fundo do site)' }) };
  const closed = [1, 2, 3, 4, 5, 6, 7].map((d) => ({ d, cb: h('input', { type: 'checkbox', checked: b.closedWeekdays.includes(d) }) }));
  const err = errBox();
  c.append(h('h2', { class: 'title' }, 'Configurações'), h('datalist', { id: 'tzs' }, ['America/Sao_Paulo', 'America/Manaus', 'America/Fortaleza', 'America/Cuiaba', 'America/Rio_Branco', 'America/New_York', 'Europe/Lisbon'].map((z) => h('option', { value: z }))),
    h('form', { onSubmit: async (e) => {
      e.preventDefault(); clear(err);
      try {
        const theme = Object.fromEntries(Object.entries({ primary: f.primary.value, accent: f.accent.value, dark: f.dark.value, logoText: f.logoText.value, heroTitle: f.heroTitle.value, heroText: f.heroText.value, ctaText: f.ctaText.value, heroImage: f.heroImage.value }).filter(([, v]) => v));
        await api('/admin/business', { method: 'PUT', body: { name: f.name.value, timezone: f.timezone.value, stepMin: +f.step.value, minNoticeMin: +f.notice.value, maxDaysAhead: +f.ahead.value,
          lunchStart: f.ls.value, lunchEnd: f.le.value, closedWeekdays: closed.filter((x) => x.cb.checked).map((x) => x.d), theme } });
        S.biz = await loadBiz(); toast('Configurações salvas');
      } catch (x) { showErr(err, x); }
    } }, h('div', { class: 'panel' }, h('h3', {}, 'Funcionamento e fuso horário'), h('div', { class: 'row' }, field('Nome do estabelecimento', f.name), field('Fuso horário (IANA)', f.timezone), field('Intervalo entre horários (min)', f.step)),
      h('div', { class: 'row' }, field('Início do almoço', f.ls), field('Fim do almoço', f.le), field('Antecedência mínima (min)', f.notice), field('Agendar até (dias à frente)', f.ahead)),
      h('div', { class: 'field' }, h('label', {}, 'Dias fechados'), h('div', { class: 'chips' }, closed.map(({ d, cb }) => h('label', {}, cb, WD[d]))))),
    h('div', { class: 'panel' }, h('h3', {}, 'Aparência do site (personalização)'), h('div', { class: 'row' }, field('Cor principal / botões', f.primary), field('Cor de destaque', f.accent), field('Cor do topo/fundo escuro', f.dark)),
      h('div', { class: 'row' }, field('Texto do logo', f.logoText), field('Título principal', f.heroTitle), field('Texto do botão', f.ctaText)), field('Descrição do topo', f.heroText), field('Imagem de fundo (URL)', f.heroImage)),
    err, h('button', { class: 'btn' }, 'Salvar configurações')));
}

// ---------- Boot ----------
async function loadBiz() { const b = await api('/admin/business'); applyTheme(b.theme); return b; }
async function boot() {
  if (!S.token) return loginView();
  try {
    S.user = JSON.parse(atob(S.token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    [S.biz, S.pros, S.services] = await Promise.all([loadBiz(), api('/admin/professionals'), api('/admin/services')]);
    route();
  } catch (e) { if (e.status !== 401) clear(root).append(h('div', { class: 'content' }, h('div', { class: 'msg err' }, e.message))); }
}
window.addEventListener('hashchange', () => S.token && S.biz && route());
boot();
