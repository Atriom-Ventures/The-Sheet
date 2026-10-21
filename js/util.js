// Small helpers shared by every screen. Nothing here knows about work content.

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
export const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const uid = (p = '') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
export const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'item';
export const cssEsc = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&'));

/* ---------- time ---------- */
export const pad = (n) => String(n).padStart(2, '0');
export const toMin = (s) => { const m = /^(\d{1,2}):(\d{2})/.exec(s || ''); return m ? (+m[1]) * 60 + (+m[2]) : null; };
export const fmt12 = (mins) => {
  if (mins == null) return '';
  const h = Math.floor(mins / 60) % 24, m = mins % 60;
  let hh = h % 12; if (hh === 0) hh = 12;
  return hh + ':' + pad(m) + (h < 12 ? 'a' : 'p');
};
export const hourLabel = (mins) => { const h = Math.floor(mins / 60) % 24; let hh = h % 12; if (hh === 0) hh = 12; return hh + (h < 12 ? 'a' : 'p'); };
export const keyOf = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
export const todayKey = () => keyOf(new Date());
export const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
export const hhmmNow = () => { const d = new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
export const dayLabel = (d) => (d || new Date()).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
export function dateOf(k) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(k || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : (k ? new Date(k) : new Date()); }
export function fmtDateKey(k) { return k ? dayLabel(dateOf(k)) : ''; }
export function fmtShort(k) { const d = dateOf(k); return (d.getMonth() + 1) + '/' + d.getDate(); }
export function fmtRev(k) { const d = dateOf(k); return (d.getMonth() + 1) + '/' + d.getDate() + '/' + String(d.getFullYear()).slice(2); }
export function daysSince(k) { if (!k) return 0; const a = dateOf(String(k).slice(0, 10)), b = dateOf(todayKey()); return Math.round((b - a) / 86400000); }
export function dur(m) { const h = Math.floor(m / 60), mm = m % 60; let s = ''; if (h) s += h + (h === 1 ? ' hr' : ' hrs'); if (h && mm) s += ' '; if (mm) s += mm + ' min'; return s || '0 min'; }
export function ago(iso) {
  if (!iso) return 'never';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' hr ago';
  const d = Math.round(s / 86400); return d + (d === 1 ? ' day ago' : ' days ago');
}
export function joinAnd(a) { return a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; }
export const lines = (s) => String(s || '').split('\n').map((x) => x.trim()).filter(Boolean);
export const bullets = (s) => lines(s).map((x) => '• ' + x.replace(/^[-•*]\s*/, ''));

/* ---------- blanks: "[...]" marks something nobody has filled in yet ---------- */
export const BLANK_RE = /\[([^\]]{1,120})\]/g;
export const hasBlank = (s) => { BLANK_RE.lastIndex = 0; return BLANK_RE.test(String(s || '')); };
export function blanksIn(s) { const out = []; String(s || '').replace(BLANK_RE, (_, b) => { out.push(b); return _; }); return out; }
export const withBlanks = (s) => esc(s).replace(/\[([^\]]{1,120})\]/g, '<mark class="blank">$1</mark>');

/* ---------- clipboard, share, files ---------- */
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* fall back */ }
  const ta = document.createElement('textarea');
  ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
  document.body.appendChild(ta); ta.select();
  let ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  ta.remove(); return ok;
}
export async function shareText(text, title) {
  if (navigator.share) { try { await navigator.share({ text, title }); return 'shared'; } catch (e) { if (e && e.name === 'AbortError') return 'cancelled'; } }
  return (await copyText(text)) ? 'copied' : 'failed';
}
export function downloadFile(name, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}
export async function shareFile(name, text, type = 'application/json') {
  try {
    const file = new File([text], name, { type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return 'shared'; }
  } catch (e) { if (e && e.name === 'AbortError') return 'cancelled'; }
  downloadFile(name, text, type); return 'downloaded';
}
export function pickFile(accept = '.json,application/json') {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = accept; inp.style.display = 'none';
    inp.onchange = () => { const f = inp.files && inp.files[0]; inp.remove(); if (!f) return resolve(null); const r = new FileReader(); r.onload = () => resolve({ name: f.name, text: String(r.result) }); r.onerror = () => resolve(null); r.readAsText(f); };
    document.body.appendChild(inp); inp.click();
  });
}

/* ---------- numbers ---------- */
const FR = { 25: '¼', 50: '½', 75: '¾' };
export const round2 = (n) => Math.round(n * 100) / 100;
export function fmtNum(n) {
  if (n == null || Number.isNaN(n)) return '–';
  n = round2(n);
  const w = Math.floor(n + 1e-9), f = Math.round((n - w) * 100);
  if (f === 0) return String(w);
  if (FR[f]) return (w ? String(w) : '') + FR[f];
  return String(n);
}
export function parseQty(str) {
  if (str == null) return null;
  let s = String(str).trim();
  if (!s || s === '–' || s === '-') return null;
  s = s.replace(/¼/g, ' 1/4').replace(/½/g, ' 1/2').replace(/¾/g, ' 3/4').replace(/,/g, '.').trim();
  let total = 0;
  for (const part of s.split(/\s+/)) {
    let m;
    if ((m = part.match(/^(\d+)\/(\d+)$/))) { if (+m[2] === 0) return NaN; total += +m[1] / +m[2]; }
    else if (/^\d*\.?\d+$/.test(part)) total += parseFloat(part);
    else return NaN;
  }
  return round2(total);
}

export function debounce(fn, ms) { let t = null; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
