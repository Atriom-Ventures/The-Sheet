// The Now screen: what's happening, what's next, and the checklists that go with it.

import { app } from '../app.js';
import { S, B, save, blockState, listItemsFor, isTicked, toggleTick, isMine, toggleMine, card, roleName, hasBook, pmStart, sign } from '../state.js';
import { esc, fmt12, toMin, dur, nowMin, dayLabel, daysSince, withBlanks, copyText, $, cssEsc } from '../util.js';
import { ICON, chip, empty, openSheet, closeSheet, seg, toast } from '../ui.js';
import { notesCard } from '../shift.js';
import { floorSummary } from './lead.js';
import { countSummary } from './count.js';

let nowIdx = null; // set when browsing other blocks; null = live

export function howBtn(cardId) {
  if (!cardId || !card(cardId)) return '';
  return '<button class="how" data-act="open-card" data-id="' + esc(cardId) + '" aria-label="How to do this">How</button>';
}
export function taskRow(t) {
  const done = isTicked(t.id);
  return '<li class="task' + (done ? ' done' : '') + '" data-tid="' + esc(t.id) + '"><button class="tick" data-act="tick" data-id="' + esc(t.id) + '" aria-pressed="' + done + '"><span class="box" aria-hidden="true"></span><span class="t-text">' + withBlanks(t.text) + '</span></button>' + howBtn(t.card) +
    (app.ui.editing ? '<button class="icon-b" data-act="task-edit" data-id="' + esc(t.id) + '" aria-label="Edit">' + ICON.pencil + '</button>' : '') + '</li>';
}
export function stdRow(t) {
  return '<li class="task"><span class="stdrow"><span class="std-mark" aria-hidden="true"></span><span class="t-text">' + withBlanks(t.text) + '</span></span>' + howBtn(t.card) +
    (app.ui.editing ? '<button class="icon-b" data-act="task-edit" data-id="' + esc(t.id) + '" aria-label="Edit">' + ICON.pencil + '</button>' : '') + '</li>';
}
export function countText(items) { const done = items.filter((t) => isTicked(t.id)).length; return done + '/' + items.length; }

function hero(st, idx) {
  const bl = st.bl, b = bl[idx], live = nowIdx == null;
  let eyebrow, meta, extra = '';
  if (live && st.idx >= 0) {
    eyebrow = 'Now · ' + fmt12(st.t);
    meta = fmt12(b.s) + '–' + fmt12(b.e) + ' · ' + dur(Math.max(0, b.e - st.t)) + ' left';
    const pct = Math.max(0, Math.min(100, (st.t - b.s) / Math.max(1, b.e - b.s) * 100));
    const nx = bl[idx + 1];
    extra = '<div class="lamp" role="img" aria-label="' + Math.round(pct) + ' percent of this block has passed"><span style="width:' + pct.toFixed(1) + '%"></span></div><div class="next mono">Next: ' + (nx ? esc(nx.name) + ' at ' + fmt12(nx.s) : 'day ends at ' + fmt12(b.e)) + '</div>';
  } else if (live && st.before) { eyebrow = 'Before opening · ' + fmt12(st.t); meta = 'Starts at ' + fmt12(b.s); }
  else if (live && st.after) { eyebrow = 'Done for today'; meta = 'Tomorrow starts at ' + fmt12(b.s); }
  else { eyebrow = 'Looking ahead'; meta = fmt12(b.s) + '–' + fmt12(b.e); }
  const prev = bl[idx - 1], next = bl[idx + 1];
  return '<div class="eyebrow">' + esc(eyebrow) + '</div><h2 class="block-name">' + esc(b.name) + '</h2><div class="block-meta mono">' + esc(meta) + '</div>' + extra + (b.focus ? '<p class="focus">' + esc(b.focus) + '</p>' : '') +
    '<div class="blk-nav">' + (prev ? '<button data-act="blk" data-id="' + (idx - 1) + '">' + ICON.chevL + '<span>' + esc(prev.name) + '</span></button>' : '<span></span>') +
    (live ? '' : '<button class="now-b" data-act="blk-now">Back to now</button>') +
    (next ? '<button data-act="blk" data-id="' + (idx + 1) + '"><span>' + esc(next.name) + '</span>' + ICON.chevR + '</button>' : '<span></span>') + '</div>';
}

/* ---------- my assignments ---------- */
function asgSort(list) {
  return list.map((a, i) => [a, i]).sort((x, y) => {
    const tx = x[0].time ? toMin(x[0].time) : null, ty = y[0].time ? toMin(y[0].time) : null;
    if (tx != null && ty != null) return tx - ty || x[1] - y[1];
    if (tx != null) return -1; if (ty != null) return 1; return x[1] - y[1];
  }).map((x) => x[0]);
}
function asgState(a, t) {
  if (!a.time || isTicked(a.id)) return '';
  const tm = toMin(a.time); if (tm == null) return '';
  if (t > tm + (a.by ? 0 : 10)) return 'late';
  if (!a.by && t >= tm) return 'due';
  if (tm - t <= 30) return 'soon';
  return '';
}
const myAsg = () => asgSort(B().assignments.filter((a) => a.shift !== 'all' && isMine(a.id)));
function asgRow(a, t, nextId, showShift, picker) {
  const on = picker ? isMine(a.id) : isTicked(a.id), s = picker ? '' : asgState(a, t);
  const when = a.time ? '<span class="when mono' + (s ? ' ' + (s === 'due' ? 'soon' : s) : '') + '">' + (a.by ? 'by ' : '') + fmt12(toMin(a.time)) + '</span>' : '';
  const pill = s === 'late' ? '<span class="pill late">Late</span>' : s === 'due' ? '<span class="pill soon">Now</span>' : s === 'soon' ? '<span class="pill soon">Soon</span>' : (a.id === nextId ? '<span class="pill next">Next</span>' : '');
  const sh = showShift && a.shift !== 'all' ? '<span class="when mono">' + a.shift.toUpperCase() + '</span>' : '';
  const meta = (when || pill || sh) ? '<span class="t-meta">' + sh + when + pill + '</span>' : '';
  return '<li class="task' + (on ? (picker ? ' on' : ' done') : '') + '"><button class="tick" data-act="' + (picker ? 'pick-toggle' : 'tick') + '" data-id="' + esc(a.id) + '" aria-pressed="' + on + '"><span class="box" aria-hidden="true"></span><span class="t-text">' + withBlanks(a.text) + meta + '</span></button>' + (picker ? '' : howBtn(a.card)) + '</li>';
}
function mineHTML() {
  const t = nowMin(), mine = myAsg(), everyone = B().assignments.filter((a) => a.shift === 'all');
  const mixed = mine.some((a) => a.shift === 'am') && mine.some((a) => a.shift === 'pm');
  const next = mine.find((a) => a.time && !isTicked(a.id) && toMin(a.time) >= t - 10);
  let h = '<div class="row-h"><h2 class="sec-h">My jobs today</h2><div class="row-acts">' + (mine.length ? '<button class="btn small ghost" data-act="copy-mine" aria-label="Copy my jobs">' + ICON.copy + '</button>' : '') + '<button class="btn small" data-act="pick">' + (mine.length ? 'Change' : 'Pick my jobs') + '</button></div></div>';
  if (!mine.length) h += empty('Tap <b>Pick my jobs</b> and choose the ones with your name on today’s assignment sheet. They show up here with their times.', true);
  else h += '<ul class="tasks">' + mine.map((a) => asgRow(a, t, next && next.id, mixed, false)).join('') + '</ul>';
  if (everyone.length) h += '<span class="lbl ev">Everyone, all day</span><ul class="tasks">' + everyone.map((a) => asgRow(a, t, null, false, false)).join('') + '</ul>';
  return h;
}
let pickShift = 'am';
function pickerHTML() {
  const items = B().assignments.filter((a) => a.shift === pickShift);
  return seg('pick-shift', [['am', 'AM'], ['pm', 'PM']], pickShift) + (items.length ? '<ul class="tasks">' + items.map((a) => asgRow(a, 0, null, false, true)).join('') + '</ul>' : empty('No jobs on this part of the sheet.', true));
}
function mineText() {
  const mine = myAsg(), everyone = B().assignments.filter((a) => a.shift === 'all');
  const shifts = Array.from(new Set(mine.map((a) => a.shift.toUpperCase())));
  const lbl = (a) => a.text + (a.time ? ' (' + (a.by ? 'by ' : '') + fmt12(toMin(a.time)) + ')' : '');
  const done = mine.filter((a) => isTicked(a.id)), left = mine.filter((a) => !isTicked(a.id));
  const L = [(shifts.length === 1 ? shifts[0] + ' jobs' : 'My jobs') + ' · ' + dayLabel()];
  if (done.length) { L.push('', 'Done:'); done.forEach((a) => L.push('✓ ' + lbl(a))); }
  if (left.length) { L.push('', 'Not done yet:'); left.forEach((a) => L.push('• ' + lbl(a))); }
  const eLeft = everyone.filter((a) => !isTicked(a.id));
  if (everyone.length) L.push('', eLeft.length ? 'All-day jobs left: ' + eLeft.map((a) => a.text.toLowerCase()).join('; ') : 'All-day jobs done.');
  sign(L); return L.join('\n');
}

function weekendBanner(st) {
  const day = new Date().getDay();
  if (nowIdx != null || (day !== 0 && day !== 6) || st.t >= 11 * 60) return '';
  const c = card('opening-solo'); if (!c || c.draft) return '';
  return '<button class="banner" data-act="open-card" data-id="opening-solo"><strong>Weekend morning.</strong>No lead on yet? Here’s the plan for opening without one.</button>';
}
function backupBanner() {
  const last = [S.settings.lastSync, S.settings.lastExport].filter(Boolean).sort().pop();
  const age = last ? daysSince(last.slice(0, 10)) : daysSince((S.settings.created || '').slice(0, 10));
  if (age < 7) return '';
  return '<button class="banner warn" data-act="tab" data-id="more"><strong>' + (last ? 'Last backup ' + age + ' days ago.' : 'Nothing’s backed up yet.') + '</strong>Sync or export a backup so a lost phone doesn’t take your edits with it.</button>';
}

export function render() {
  if (!hasBook()) return '<section class="hero"><div class="eyebrow">Welcome</div><h2 class="block-name">The Sheet</h2><p class="focus">Nothing is loaded yet. Connect your book or import a backup to get started.</p><div class="blk-nav"><button class="now-b" data-act="tab" data-id="more">Set up</button></div></section>';
  const st = blockState(), bl = st.bl;
  let h = '';
  if (bl.length) {
    const idx = nowIdx == null ? (st.idx >= 0 ? st.idx : (st.after ? 0 : 0)) : Math.min(Math.max(nowIdx, 0), bl.length - 1);
    h += '<section class="hero" id="hero" aria-live="polite">' + hero(st, idx) + '</section>';
    h += weekendBanner(st) + backupBanner();
    h += '<div class="glance">' + floorSummary() + countSummary() + '</div>';
    h += '<section class="block" id="notes-card">' + notesCard() + '</section>';
    h += '<section class="block" id="mine">' + mineHTML() + '</section>';
    const b = bl[idx];
    const roles = B().roles.filter((r) => B().lists.some((l) => l.role === r.id && !l.draft));
    if (roles.length && !roles.some((r) => r.id === S.settings.role)) S.settings.role = roles[0].id;
    if (roles.length > 1) h += '<div class="chips" role="group" aria-label="Working as">' + roles.map((r) => chip('role', r.id, r.name, S.settings.role === r.id)).join('') + '</div>';
    let any = false;
    B().lists.filter((l) => l.role === S.settings.role && !l.draft).forEach((l) => {
      const its = listItemsFor(l, b.id);
      if (its == null || (!its.length && !app.ui.editing)) return;
      any = true;
      h += '<div class="row-h"><h3 class="sec-h"><button class="sec-link" data-act="go" data-id="#book/list/' + esc(l.id) + '">' + esc(l.name) + '</button></h3><span class="mono cnt" data-cnt="' + esc(l.id) + '">' + (l.standards ? 'Every meal' : countText(its)) + '</span></div>';
      if (its.length) h += '<ul class="tasks">' + its.map(l.standards ? stdRow : taskRow).join('') + '</ul>';
    });
    if (!any) h += empty('Nothing on the ' + esc(roleName(S.settings.role)) + ' list during ' + esc(String(b.name).toLowerCase()) + '.');
    h += '<button class="link" data-act="go" data-id="#book/lists">All checklists</button>';
  } else {
    h += empty('The book has no time blocks yet. Add them in Book → Day.');
  }
  return h;
}

/* Update one tick in place so the list doesn't jump. */
export function tickInPlace(id) {
  const on = isTicked(id);
  document.querySelectorAll('.task [data-act="tick"][data-id="' + cssEsc(id) + '"]').forEach((b) => { b.setAttribute('aria-pressed', on); b.closest('.task').classList.toggle('done', on); });
  document.querySelectorAll('[data-cnt]').forEach((el) => {
    const l = B().lists.find((x) => x.id === el.dataset.cnt); if (!l || l.standards) return;
    const ul = el.closest('.row-h') && el.closest('.row-h').nextElementSibling; if (!ul) return;
    const ids = Array.from(ul.querySelectorAll('[data-act="tick"]')).map((b) => b.dataset.id);
    el.textContent = ids.filter(isTicked).length + '/' + ids.length;
  });
}

export const acts = {
  'blk': (el) => { nowIdx = +el.dataset.id; app.renderView(); },
  'blk-now': () => { nowIdx = null; app.renderView(); },
  'role': (el) => { S.settings.role = el.dataset.id; save('settings'); app.renderView(); },
  'tick': (el) => { toggleTick(el.dataset.id); tickInPlace(el.dataset.id); if (navigator.vibrate) try { navigator.vibrate(8); } catch (e) { /* ignore */ } },
  'pick': () => { pickShift = nowMin() < pmStart() ? 'am' : 'pm'; openSheet({ eyebrow: 'Today’s assignment sheet', title: 'Pick your jobs', body: '<p class="muted" style="margin-top:0">Tap every job with your name on it. Kept for today only.</p><div id="pick-body">' + pickerHTML() + '</div>', foot: '<button class="btn primary" data-act="sheet-close">Done</button>', onClose: () => app.renderView() }); },
  'pick-shift': (el) => { pickShift = el.dataset.id; $('#pick-body').innerHTML = pickerHTML(); },
  'pick-toggle': (el) => { toggleMine(el.dataset.id); $('#pick-body').innerHTML = pickerHTML(); },
  'copy-mine': async () => { if (await copyText(mineText())) toast('Copied.'); }
};
export const resetNow = () => { nowIdx = null; };
