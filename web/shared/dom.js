// Construtor de DOM seguro (sem innerHTML => sem XSS).
export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') { for (const [sk, sv] of Object.entries(v)) sk.startsWith('--') ? el.style.setProperty(sk, sv) : (el.style[sk] = sv); }
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}
export const $ = (s, r = document) => r.querySelector(s);
export const clear = (el) => { el.replaceChildren(); return el; };

export async function api(path, { method = 'GET', body, token, headers = {} } = {}) {
  const res = await fetch(`/api/v1${path}`, {
    method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data?.error?.message || 'Erro inesperado'), { status: res.status, data: data?.error });
  return data;
}

export function applyTheme(t = {}) {
  const r = document.documentElement.style;
  if (t.primary) r.setProperty('--primary', t.primary);
  if (t.accent) r.setProperty('--accent', t.accent);
  if (t.dark) r.setProperty('--dark', t.dark);
}
