// All app state, loaded from IndexedDB at start and saved back as it changes.
//
// Synced with the private repo (three files):
//   book   -> book.json       checklists, cards, assignment sheet, the day
//   inv    -> inventory.json  inventory lines and products
//   state  -> state.json      follow-ups, wins, printed copies, saved counts
// Phone only, never synced:
//   count (count in progress), day (today's ticks), shift (shift notes), floor (who's on, breaks),
//   trainees, priv (staffing plan and private cards), msgs (message drafts), settings (incl. GitHub key)

import * as db from './db.js';
import { clone, same, todayKey, toMin, nowMin, uid } from './util.js';

export const SYNCED = ['book', 'inv', 'state'];
const KEYS = ['book', 'inv', 'state', 'count', 'day', 'shift', 'floor', 'trainees', 'priv', 'msgs', 'settings', 'conflicts'];

const EMPTY_BOOK = { schema: 3, title: 'Floor Book', subtitle: '', updated: null, outlets: [], people: [], messaging: '', posName: '', day: { end: '21:00', pmStart: '13:00', blocks: [] }, roles: [], lists: [], cats: [], cards: [], tasks: [], assignments: [], training: [], links: [] };
const EMPTY_INV = { schema: 1, title: 'Inventory', updated: null, messaging: '', cats: [], lines: [], seen: null };
const EMPTY_STATE = { schema: 1, updated: null, follow: [], wins: [], printed: [], invHistory: [] };

const defaults = () => ({
  book: { base: null, local: null, sha: null, syncedAt: null },
  inv: { base: null, local: null, sha: null, syncedAt: null },
  state: { base: null, local: null, sha: null, syncedAt: null },
  count: newCount(),
  day: { date: todayKey(), ticks: [], mine: [] },
  shift: { key: null, notes: [], f: {}, sentAt: null },
  floor: { date: todayKey(), people: [] },
  trainees: [],
  priv: { staffPlan: null, cards: [] },
  msgs: {},
  settings: { owner: '', repo: '', branch: 'main', token: '', name: '', role: 'floor', theme: 'auto', quick: true, lastExport: null, lastSync: null, setupDone: false, created: new Date().toISOString() },
  conflicts: []
});

export function newCount() { return { id: uid('c'), started: new Date().toISOString(), counts: {}, orders: {} }; }

export const S = defaults();
let listeners = [];
export const onChange = (fn) => { listeners.push(fn); };
const emit = (key) => listeners.forEach((fn) => { try { fn(key); } catch (e) { console.error(e); } });

export async function load() {
  let all = {};
  try { all = await db.getAll(); } catch (e) { console.error(e); S.storageError = String(e && e.message || e); }
  const d = defaults();
  for (const k of KEYS) S[k] = all[k] !== undefined ? all[k] : d[k];
  S.settings = Object.assign(d.settings, S.settings || {});
  rollDay();
}

/* Daily things reset on a new day. Shift notes roll over only once the report has been copied. */
export function rollDay() {
  const t = todayKey();
  if (!S.day || S.day.date !== t) { S.day = { date: t, ticks: [], mine: [] }; save('day'); }
  if (!S.floor || S.floor.date !== t) { S.floor = { date: t, people: [] }; save('floor'); }
  const cur = curShiftKey();
  if (!S.shift || !S.shift.key) { S.shift = { key: cur, notes: [], f: {}, sentAt: null }; save('shift'); }
  else if (S.shift.key !== cur && (!S.shift.notes.length || S.shift.sentAt)) { S.shift = { key: cur, notes: [], f: {}, sentAt: null }; save('shift'); }
  // Message drafts marked daily expire overnight.
  let changed = false;
  for (const [k, v] of Object.entries(S.msgs || {})) { if (v && v.__daily && v.__day !== t) { delete S.msgs[k]; changed = true; } }
  if (changed) save('msgs');
}

const timers = {};
export function save(key) {
  clearTimeout(timers[key]);
  timers[key] = setTimeout(() => { db.put(key, S[key]).catch((e) => { S.storageError = String(e && e.message || e); emit('error'); }); }, 150);
  emit(key);
}
export async function flush() {
  const pending = Object.keys(timers);
  await Promise.all(pending.map((k) => { clearTimeout(timers[k]); delete timers[k]; return db.put(k, S[k]); }));
}
export async function eraseAll() { await db.clearAll(); Object.assign(S, defaults()); emit('all'); }

/* ---------- synced documents ---------- */
export const B = () => S.book.local || EMPTY_BOOK;
export const I = () => S.inv.local || EMPTY_INV;
export const L = () => S.state.local || EMPTY_STATE;
export const hasBook = () => !!S.book.local;
export const hasInv = () => !!S.inv.local;
const EMPTY = { book: EMPTY_BOOK, inv: EMPTY_INV, state: EMPTY_STATE };

export function edit(key, fn) {
  if (!S[key].local) S[key].local = clone(EMPTY[key]);
  fn(S[key].local);
  S[key].local.updated = todayKey();
  save(key);
}
export const dirty = (key) => !!S[key].local && !same(S[key].local, S[key].base);
export const anyDirty = () => SYNCED.some(dirty);

/* ---------- book helpers ---------- */
export const card = (id) => B().cards.find((c) => c.id === id) || (S.priv.cards || []).find((c) => c.id === id) || null;
export const allCards = () => B().cards.concat((S.priv.cards || []).map((c) => Object.assign({}, c, { private: true })));
export const list = (id) => B().lists.find((l) => l.id === id) || null;
export const tasksOf = (lid) => B().tasks.filter((t) => t.list === lid);
export const catName = (id) => { const c = B().cats.find((x) => x.id === id); return c ? c.name : (id || ''); };
export const roleName = (id) => { const r = B().roles.find((x) => x.id === id); return r ? r.name : (id || ''); };

export function blocks() {
  const d = B().day || {};
  const end = toMin(d.end);
  const bl = (d.blocks || []).map((b) => ({ id: b.id, name: b.name, start: b.start, focus: b.focus, s: toMin(b.start) }))
    .filter((b) => b.s != null).sort((a, b) => a.s - b.s);
  bl.forEach((b, i) => { b.e = i < bl.length - 1 ? bl[i + 1].s : (end != null && end > b.s ? end : 24 * 60); });
  return bl;
}
export function blockState() {
  const bl = blocks(), t = nowMin();
  if (!bl.length) return { bl, idx: -1, t };
  if (t < bl[0].s) return { bl, idx: -1, before: true, t };
  if (t >= bl[bl.length - 1].e) return { bl, idx: -1, after: true, t };
  let idx = 0; bl.forEach((b, i) => { if (b.s <= t) idx = i; });
  return { bl, idx, t };
}
export const pmStart = () => toMin((B().day || {}).pmStart) || 13 * 60;
export const shiftOfNow = () => (nowMin() < pmStart() ? 'AM' : 'PM');
export const curShiftKey = () => todayKey() + '|' + shiftOfNow();
export function listItemsFor(l, blockId) {
  if (l.byBlock) return tasksOf(l.id).filter((t) => t.block === blockId);
  return (l.blocks || []).indexOf(blockId) >= 0 ? tasksOf(l.id) : null;
}

/* ---------- today's ticks ---------- */
export const isTicked = (id) => S.day.ticks.indexOf(id) >= 0;
export function toggleTick(id) { const i = S.day.ticks.indexOf(id); if (i >= 0) S.day.ticks.splice(i, 1); else S.day.ticks.push(id); save('day'); return i < 0; }
export const isMine = (id) => S.day.mine.indexOf(id) >= 0;
export function toggleMine(id) { const i = S.day.mine.indexOf(id); if (i >= 0) S.day.mine.splice(i, 1); else S.day.mine.push(id); save('day'); }

export const signName = () => String(S.settings.name || '').trim();
export function sign(L2) { const n = signName(); if (n) L2.push('', '— ' + n); }

/* The newest "updated" date among a set of book items, used as the revision stamp on printouts. */
export function revOf(items) {
  let r = '';
  (items || []).forEach((x) => { if (x && x.updated && x.updated > r) r = x.updated; });
  return r || B().updated || todayKey();
}
