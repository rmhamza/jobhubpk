const $ = (s, el = document) => el.querySelector(s), $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
async function api(path, { method = 'GET', body } = {}) {
  const r = await fetch('/api' + path, { method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  let j = {}; try { j = await r.json(); } catch { /* not json */ }
  if (!r.ok) {
    if (j.code === 'login' && !location.pathname.startsWith('/login')) location.href = '/login';
    else if (j.code === 'inactive') location.href = '/login?inactive=1';
    const e = new Error(j.error || 'Something went wrong. Please try again.'); e.status = r.status; e.code = j.code; throw e;
  }
  return j;
}
const readFile = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res({ name: f.name, data: String(r.result).split(',')[1] }); r.onerror = () => rej(new Error('Could not read the file.')); r.readAsDataURL(f); });
function toast(msg, bad) {
  let t = $('#toast'); if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.append(t); }
  const d = document.createElement('div'); d.className = 'toast' + (bad ? ' bad' : ''); d.textContent = msg; t.append(d); setTimeout(() => d.remove(), 4500);
}
const matchClass = (m) => (m >= 70 ? '' : m >= 40 ? 'm-mid' : 'm-lo');
