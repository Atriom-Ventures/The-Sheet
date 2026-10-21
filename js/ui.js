// Shared interface pieces: icons, the bottom sheet, toasts, two-tap confirms, small builders.

import { $, esc } from './util.js';

const sv = (p) => '<svg class="i" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + p + '</svg>';
export const ICON = {
  now: sv('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  book: sv('<path d="M5 4.5h10a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h10"/>'),
  count: sv('<rect x="4" y="4" width="16" height="16" rx="2.5"/><path d="M8 9h8M8 13h8M8 17h4"/>'),
  lead: sv('<path d="M4 20c.8-3.6 3.9-6 8-6s7.2 2.4 8 6"/><circle cx="12" cy="8" r="3.6"/>'),
  more: sv('<circle cx="5.5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18.5" cy="12" r="1.4"/>'),
  plus: sv('<path d="M12 5v14M5 12h14"/>'),
  minus: sv('<path d="M5 12h14"/>'),
  check: sv('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
  close: sv('<path d="M6 6l12 12M18 6 6 18"/>'),
  chevL: sv('<path d="m14.5 6-6 6 6 6"/>'),
  chevR: sv('<path d="m9.5 6 6 6-6 6"/>'),
  copy: sv('<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/>'),
  share: sv('<path d="M12 4v11M8 8l4-4 4 4"/><path d="M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/>'),
  print: sv('<path d="M7 9V4.5h10V9"/><rect x="4" y="9" width="16" height="7" rx="2"/><path d="M7 14h10v6H7z"/>'),
  pencil: sv('<path d="M4.5 19.5 5.6 15 15.8 4.8a2 2 0 0 1 2.8 0l.6.6a2 2 0 0 1 0 2.8L9 18.4z"/><path d="m14 6.6 3.4 3.4"/>'),
  note: sv('<path d="M5 4.5h14v11l-4.5 4H5z"/><path d="M14.5 19.5v-4h4.5M8.5 9h7M8.5 12.5h4"/>'),
  sync: sv('<path d="M19.5 11A7.5 7.5 0 0 0 6 6.7L4.5 8.5"/><path d="M4.5 4.5v4h4"/><path d="M4.5 13A7.5 7.5 0 0 0 18 17.3l1.5-1.8"/><path d="M19.5 19.5v-4h-4"/>'),
  trash: sv('<path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13"/>'),
  up: sv('<path d="m6 14.5 6-6 6 6"/>'),
  down: sv('<path d="m6 9.5 6 6 6-6"/>'),
  clock: sv('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12h4"/>'),
  coffee: sv('<path d="M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z"/><path d="M16 10.5h1.5a2.5 2.5 0 0 1 0 5H16M8.5 3.5v2.5M12 3.5v2.5"/>'),
  flag: sv('<path d="M6 21V4"/><path d="M6 4.5h11l-2.5 4 2.5 4H6"/>'),
  star: sv('<path d="m12 4 2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 16.4 7.2 18.9l.9-5.4-3.9-3.8 5.4-.8z"/>'),
  people: sv('<circle cx="9" cy="8.5" r="3"/><path d="M3.5 19c.6-3 2.8-5 5.5-5s4.9 2 5.5 5"/><path d="M15 5.8a3 3 0 0 1 0 5.4M17 14.3c1.8.6 3.1 2.3 3.5 4.7"/>'),
  link: sv('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
  download: sv('<path d="M12 4v11M8 11l4 4 4-4"/><path d="M5 19h14"/>'),
  upload: sv('<path d="M12 15V4M8 8l4-4 4 4"/><path d="M5 19h14"/>'),
  key: sv('<circle cx="8" cy="15" r="3.5"/><path d="m10.5 12.5 8-8M15.5 7.5l2.5 2.5M13.5 9.5l2 2"/>'),
  warn: sv('<path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4M12 17h.01"/>'),
  grid: sv('<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>')
};

/* ---------- toast ---------- */
let toastT = null;
export function toast(msg, ms = 2400) {
  const t = $('#toast'); if (!t) return;
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms);
}

/* ---------- bottom sheet ---------- */
let sheetOnClose = null, lastFocus = null, sheetOpen = false;
export function openSheet({ eyebrow = '', title = '', body = '', foot = '', onMount = null, onClose = null, wide = false }) {
  const replacing = sheetOpen;
  closeSheet(true);
  if (!replacing) lastFocus = document.activeElement;
  const wrap = $('#sheet-root');
  wrap.innerHTML = '<div class="sheet-wrap"><div class="backdrop" data-act="sheet-close"></div>' +
    '<div class="sheet' + (wide ? ' wide' : '') + '" role="dialog" aria-modal="true" aria-labelledby="sheet-title" tabindex="-1">' +
      '<div class="sheet-h"><div class="sheet-ht">' + (eyebrow ? '<div class="sheet-eb">' + esc(eyebrow) + '</div>' : '') + '<h2 class="sheet-title" id="sheet-title">' + esc(title) + '</h2></div>' +
      '<button class="icon-b" data-act="sheet-close" aria-label="Close">' + ICON.close + '</button></div>' +
      '<div class="sheet-b" id="sheet-b">' + body + '</div>' +
      (foot ? '<div class="sheet-f" id="sheet-f">' + foot + '</div>' : '') +
    '</div></div>';
  document.body.classList.add('locked');
  sheetOnClose = onClose; sheetOpen = true;
  const sh = wrap.querySelector('.sheet');
  try { sh.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
  if (onMount) onMount(sh);
  if (!replacing) history.pushState({ sheet: true }, '');
}
/* Returns a promise that settles once the browser history has caught up, so callers can navigate safely after it. */
let pendingBack = null;
export function closeSheet(silent) {
  if (!sheetOpen) return Promise.resolve();
  sheetOpen = false;
  $('#sheet-root').innerHTML = '';
  document.body.classList.remove('locked');
  const cb = sheetOnClose; sheetOnClose = null;
  let done = Promise.resolve();
  if (!silent && history.state && history.state.sheet) {
    done = new Promise((resolve) => { pendingBack = resolve; setTimeout(() => { if (pendingBack === resolve) { pendingBack = null; resolve(); } }, 400); });
    history.back();
  }
  if (cb) cb();
  if (lastFocus && document.contains(lastFocus)) { try { lastFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
  return done;
}
export const isSheetOpen = () => sheetOpen;
window.addEventListener('popstate', () => {
  if (pendingBack) { const r = pendingBack; pendingBack = null; r(); return; }
  if (sheetOpen) closeSheet(true);
});
export function setSheetBody(html) { const b = $('#sheet-b'); if (b) b.innerHTML = html; }
export function setSheetTitle(t) { const h = $('#sheet-title'); if (h) h.textContent = t; }

/* ---------- two-tap confirm for anything destructive ---------- */
export function armed(btn, label = 'Tap again to confirm') {
  if (btn.dataset.armed === '1') return true;
  const old = btn.innerHTML;
  btn.dataset.armed = '1'; btn.classList.add('armed'); btn.textContent = label;
  setTimeout(() => { if (document.contains(btn)) { btn.dataset.armed = ''; btn.classList.remove('armed'); btn.innerHTML = old; } }, 3500);
  return false;
}

/* ---------- small builders ---------- */
export const chip = (act, id, label, on, extra = '') => '<button class="chip" data-act="' + act + '" data-id="' + esc(id) + '" aria-pressed="' + (on ? 'true' : 'false') + '"' + extra + '>' + esc(label) + '</button>';
export const seg = (act, items, cur) => '<div class="seg-c" role="group">' + items.map(([id, label]) => '<button data-act="' + act + '" data-id="' + esc(id) + '" aria-pressed="' + (id === cur ? 'true' : 'false') + '">' + esc(label) + '</button>').join('') + '</div>';
export const opts = (pairs, val) => pairs.map((p) => '<option value="' + esc(p[0]) + '"' + (String(p[0]) === String(val) ? ' selected' : '') + '>' + esc(p[1]) + '</option>').join('');
export function field(id, label, ctl, hint, cls = '') {
  return '<div class="field ' + cls + '"><label for="' + id + '"><span class="l">' + esc(label) + '</span>' + (hint ? '<span class="hint">' + esc(hint) + '</span>' : '') + '</label>' + ctl + '</div>';
}
export const input = (id, val, attrs = '') => '<input id="' + id + '" value="' + esc(val == null ? '' : val) + '" ' + attrs + '>';
export const textarea = (id, val, rows = 3, attrs = '') => '<textarea id="' + id + '" rows="' + rows + '" ' + attrs + '>' + esc(val == null ? '' : val) + '</textarea>';
export const empty = (html, small) => '<p class="empty' + (small ? ' small' : '') + '">' + html + '</p>';
export const secH = (title, right = '') => '<div class="row-h"><h2 class="sec-h">' + esc(title) + '</h2>' + (right ? '<div class="row-acts">' + right + '</div>' : '') + '</div>';
export const btn = (act, label, cls = '', extra = '') => '<button class="btn ' + cls + '" data-act="' + act + '"' + extra + '>' + label + '</button>';
