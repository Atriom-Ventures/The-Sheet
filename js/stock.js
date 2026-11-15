// The data and math behind Count. No screens here.
//
// Places: stock is kept in two places, and each is counted on its own. A phone holds one count in
//   progress per place; a saved count says which place it was. One saved before places existed has
//   none and reads as the first place. What's on hand is the newest saved count of each place, added
//   line by line.
// Flags: what to order is marked by hand, on the line, in the shared inventory file, so everyone who
//   orders sees one list. Nothing is worked out from minimums anymore (they stay in the file).
// Orders: placing an order files a record next to the saved counts and clears the flags.
//
// A flag that has been cleared must stay cleared, even when an old phone or an old backup that still
// has it syncs. So a line keeps the time its flag was last cleared, and a flag only counts if it was
// set after that. See flagLive and mergeFlags.

import { S, I, C, edit, save, newCount, whoAmI } from './state.js';
import { clone, same, round2, fmtNum, todayKey, uid } from './util.js';

/* ---------- places and how often ---------- */
export const PLACES = [['servery', 'Servery'], ['kitchen', 'Kitchen']];
const PLACE_IDS = PLACES.map((p) => p[0]);
export const placeName = (id) => (PLACES.find((p) => p[0] === id) || PLACES[0])[1];
/* The place of a saved count or a count in progress. No place, or one the app doesn't know: the first. */
export const placeOf = (e) => (e && PLACE_IDS.includes(e.place) ? e.place : PLACE_IDS[0]);

export const FREQS = [['few', 'Every few days'], ['week', 'Weekly'], ['month', 'Monthly'], ['none', 'Not regular']];
export const freqOf = (line) => (line && FREQS.some((f) => f[0] === line.freq) ? line.freq : 'none');
export const freqName = (id) => (FREQS.find((f) => f[0] === id) || FREQS[FREQS.length - 1])[1];

/* ---------- units ----------
   A product's per-case number says how many of the smaller unit come in a case. On a line counted in
   cases, the smaller unit is the line's loose unit (sleeves unless set); otherwise it's the line's own
   unit. With a per-case number, full cases and loose units are counted separately and added up. A
   count is still stored as one number in the line's unit. */
export const UNITS = ['case', 'sleeve', 'long sleeve', 'box', 'pack', 'bag', 'bottle', 'can', 'carton', 'roll', 'stack', 'each'];
const PLURAL = { case: 'cases', sleeve: 'sleeves', 'long sleeve': 'long sleeves', box: 'boxes', pack: 'packs', bag: 'bags', bottle: 'bottles', can: 'cans', carton: 'cartons', roll: 'rolls', stack: 'stacks', each: 'each' };
export function unitWord(u, n) { if (u === 'each') return 'each'; if (n != null && n > 0 && n <= 1) return u; return PLURAL[u] || (u + 's'); }
export const fmtQty = (n, u) => fmtNum(n) + ' ' + unitWord(u, n);
export const perCaseOf = (p) => { const n = Number(p && p.perCase); return Number.isFinite(n) && n > 0 ? n : 0; };
export const smallUnit = (line) => (line.unit === 'case' ? (UNITS.includes(line.inner) && line.inner !== 'case' ? line.inner : 'sleeve') : line.unit);
export const r6 = (n) => Math.round(n * 1e6) / 1e6;
/* How many `to` make one `from` for a product, or null when that can't be known. */
export function factor(from, to, small, n) {
  if (from === to) return 1;
  if (!n) return null;
  if (from === 'case' && to === small) return n;
  if (to === 'case' && from === small) return 1 / n;
  return null;
}
/* Full cases and loose units behind a number, and back, for a given per-case number. */
export function partsOf(inCases, n, v) {
  const small = inCases ? v * n : v, c = Math.floor(small / n + 1e-6);
  return { c, l: Math.max(0, round2(small - c * n)) };
}
export const fromParts = (inCases, n, s) => r6(inCases ? s.c + s.l / n : s.c * n + s.l);
export function splitParts(line, p, v) { const s = partsOf(line.unit === 'case', perCaseOf(p), v); return { cases: s.c, loose: s.l }; }
export const fromSplit = (line, p, cases, loose) => fromParts(line.unit === 'case', perCaseOf(p), { c: cases, l: loose });
export function fmtSplit(line, p, v) {
  const s = splitParts(line, p, v), small = smallUnit(line);
  if (!s.loose && !s.cases) return fmtQty(0, line.unit);
  if (!s.loose) return fmtQty(s.cases, 'case');
  return (s.cases ? fmtQty(s.cases, 'case') + ' + ' : '') + fmtNum(s.loose) + ' ' + unitWord(small, s.loose);
}
/* An amount of a line, in words: "2 cases + 7 sleeves" when it's one product with a per-case number. */
export const fmtHave = (line, total) => (line.products.length === 1 && perCaseOf(line.products[0]) ? fmtSplit(line, line.products[0], total) : fmtQty(total, line.unit));
export const prefProduct = (line) => line.products.find((p) => p.pref) || (line.products.length === 1 ? line.products[0] : null);
/* The unit a line is ordered in: by the case when the product to order has a case size, otherwise the line's unit. */
export const orderUnit = (line) => { const p = prefProduct(line); return p && perCaseOf(p) && line.unit !== 'case' ? 'case' : line.unit; };
export const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric: true, sensitivity: 'base' });

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v : '');
/* A time the app wrote (…T…Z). Anything else, say a hand edit, counts as no time at all. */
const stampOf = (v) => (typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v) ? v : '');
const later = (a, b) => (a >= b ? a : b);

/* ---------- counts in progress: one per place, on this phone only ----------
   S.count is the count for the place on screen. The other place's count waits in S.count.parked. */
export const roomNow = () => placeOf(S.count);
export function inProgress(place) {
  if (roomNow() === place) return S.count;
  const pk = S.count && S.count.parked;
  return (isObj(pk) && isObj(pk[place]) && pk[place]) || null;
}
export const allInProgress = () => PLACE_IDS.map(inProgress).filter(Boolean);
/* Switch the place being counted. The count that was on screen waits, untouched, until you come back. */
export function setRoom(place) {
  if (!PLACE_IDS.includes(place) || roomNow() === place) return false;
  const cur = S.count, from = roomNow(), rest = Object.assign({}, isObj(cur.parked) ? cur.parked : {});
  delete cur.parked; cur.place = from;
  const next = isObj(rest[place]) ? rest[place] : newCount(place);
  delete rest[place]; next.place = place; rest[from] = cur; next.parked = rest;
  S.count = next; save('count');
  return true;
}
/* A fresh count for the place on screen. The other place's count in progress is kept. */
export function freshCount() {
  const place = roomNow(), pk = S.count.parked;
  S.count = newCount(place);
  if (isObj(pk)) S.count.parked = pk;
  save('count');
}
/* Take a product out of every count in progress (its line or the product was deleted). */
export function forgetProduct(pid) {
  for (const cnt of allInProgress()) for (const k of ['counts', 'units', 'per']) if (cnt[k]) delete cnt[k][pid];
  save('count');
}

/* ---------- saved counts ---------- */
const isCount = (h) => isObj(h) && h.kind !== 'order' && isObj(h.counts);
export const isOrder = (h) => isObj(h) && h.kind === 'order';
const whenOf = (h) => String(h.savedAt || h.date || '');
/* The newest saved count of each place: { servery: entry, kitchen: entry }, a place left out if never counted. */
export function newestCounts() {
  const out = {};
  for (const h of (C().history || [])) {
    if (!isCount(h)) continue;
    const pl = placeOf(h);
    if (!out[pl] || whenOf(h) > whenOf(out[pl])) out[pl] = h;
  }
  return out;
}
/* One product's number in a saved count, in the line's unit today. Saved counts remember the unit and
   the per-case number they were counted with; one in another unit is converted with the per-case
   number. undefined: not counted in that count. null: counted, but it can't be read in today's unit. */
export function savedVal(h, line, p) {
  if (!isCount(h) || h.counts[p.id] == null) return undefined;
  const v = Number(h.counts[p.id]); if (!Number.isFinite(v)) return null;
  const from = h.units && h.units[p.id];
  // Saved before units were recorded: the number is in whatever unit the line had then. If the line
  // has been changed since (it may have moved from sleeves to cases), it can't be trusted.
  if (!from) return line.updated && String(line.updated).slice(0, 10) >= String(h.date || '').slice(0, 10) ? null : v;
  const n = perCaseOf(p), was = Number(h.per && h.per[p.id]);
  const f = factor(from, line.unit, smallUnit(line), n);
  if (f == null) return null;
  // Counted with a different per-case number: keep the cases and loose units that were counted.
  if (was > 0 && n > 0 && was !== n) return fromParts(line.unit === 'case', n, partsOf(from === 'case', was, v));
  return r6(v * f);
}
/* The same for a count in progress (its numbers are converted when a screen draws; this is for in between). */
function liveVal(cnt, line, p) {
  const v = Number(cnt.counts[p.id]); if (!Number.isFinite(v)) return null;
  const from = cnt.units && cnt.units[p.id];
  if (!from || from === line.unit) return v;
  const f = factor(from, line.unit, smallUnit(line), perCaseOf(p));
  return f == null ? null : r6(v * f);
}
const parts = (line, v) => { const n = line.products.length === 1 ? perCaseOf(line.products[0]) : 0; if (v == null || !n) return {}; const s = partsOf(line.unit === 'case', n, v); return { cases: s.c, loose: s.l }; };

/* What's on hand, place by place and added up.
   rooms[place]: { id, date, savedAt, by } of that place's newest saved count, or null.
   lines[lineId][place]: { v, n, of, counted, stale, cases, loose, live }
     v        the amount in the line's unit today; null if the line wasn't counted there (it adds nothing)
     n, of    products counted, out of how many the line has; counted is true when that's all of them
     stale    true when a number was there but couldn't be read in today's unit (count it again)
     cases, loose   v as full cases and loose units, when the line is one product with a per-case number
     live     true when the number came from this phone's count in progress
   lines[lineId].sum: { v, cases, loose } across both places; v is null when neither counted it.
   opts.live: a place id, or true for both. Lines counted in this phone's count in progress for that
   place use that number in place of the saved one. Left out: saved counts only. */
export function totals(opts) {
  const live = opts && opts.live, saved = newestCounts(), rooms = {}, lines = {};
  for (const pl of PLACE_IDS) { const h = saved[pl]; rooms[pl] = h ? { id: h.id, date: h.date, savedAt: h.savedAt, by: h.by || '' } : null; }
  for (const line of I().lines) {
    const row = {}; let sum = null;
    for (const pl of PLACE_IDS) {
      const h = saved[pl], cnt = live === true || live === pl ? inProgress(pl) : null;
      let v = 0, n = 0, stale = false, isLive = false;
      for (const p of line.products) {
        let x;
        if (cnt && cnt.counts && cnt.counts[p.id] != null) { x = liveVal(cnt, line, p); isLive = true; }
        else x = h ? savedVal(h, line, p) : undefined;
        if (x === undefined) continue;
        if (x === null) { stale = true; continue; }
        v += x; n++;
      }
      v = n ? r6(v) : null;
      row[pl] = Object.assign({ v, n, of: line.products.length, counted: n > 0 && n === line.products.length, stale }, parts(line, v));
      if (isLive) row[pl].live = true;
      if (v != null) sum = r6((sum || 0) + v);
    }
    row.sum = Object.assign({ v: sum }, parts(line, sum));
    lines[line.id] = row;
  }
  return { rooms, lines };
}

/* ---------- flags: what to order, marked by hand ----------
   line.flag = { n, unit, at, by }: the amount, the unit the amount is in, when it was flagged, who by.
   line.cleared = when the line's flag was last cleared, by an order or by hand.
   A flag counts only if it was set after the line was last cleared. */
export const flagLive = (flag, cleared) => isObj(flag) && stampOf(flag.at) > stampOf(cleared);
/* A flag's amount in the unit the line is ordered in today, a whole number of at least 1. An amount
   set in another unit (a case size was added since) is converted, or goes back to 1 when it can't be. */
function flagAmount(line, flag) {
  let n = Number(flag.n);
  if (!Number.isFinite(n) || n < 1) n = 1;
  const unit = orderUnit(line);
  if (flag.unit && flag.unit !== unit) {
    const f = factor(flag.unit, unit, smallUnit(line), perCaseOf(prefProduct(line)));
    n = f == null ? 1 : n * f;
  }
  return Math.min(999, Math.max(1, Math.ceil(n - 1e-9)));
}
/* What's flagged on a line right now: { n, unit, by }, or null. Only lines on the order sheet can be. */
export function flagOf(line) {
  if (!isObj(line) || line.state !== 'active' || !flagLive(line.flag, line.cleared)) return null;
  return { n: flagAmount(line, line.flag), unit: orderUnit(line), by: str(line.flag.by) };
}
const lineById = (id) => I().lines.find((x) => x.id === id);
/* A time after the line was last cleared, even if this phone's clock runs behind the one that cleared it. */
function timeAfter(cleared) {
  const now = new Date().toISOString(), c = stampOf(cleared);
  if (now > c) return now;
  const t = Date.parse(c);
  return Number.isFinite(t) ? new Date(t + 1).toISOString() : now;
}
const clearFlag = (l, when) => { l.cleared = later(when, stampOf(l.flag && l.flag.at)); delete l.flag; };
/* Put a line on the order list (amount 1), or take it off. False if nothing changed. */
export function setFlag(lineId, on) {
  const l = lineById(lineId);
  if (!l) return false;
  const live = !!flagOf(l);
  if (on ? (live || l.state !== 'active') : !isObj(l.flag)) return false;
  edit('inv', (inv) => {
    const x = inv.lines.find((y) => y.id === lineId);
    if (on) x.flag = { n: 1, unit: orderUnit(x), at: timeAfter(x.cleared), by: whoAmI() };
    else clearFlag(x, new Date().toISOString());
  });
  return true;
}
/* Change a flagged line's amount (whole numbers, 1 or more). False if the line isn't flagged. */
export function setFlagAmount(lineId, n) {
  const l = lineById(lineId);
  n = Math.round(Number(n));
  if (!l || !flagOf(l) || !Number.isFinite(n) || n < 1) return false;
  edit('inv', (inv) => { const x = inv.lines.find((y) => y.id === lineId); x.flag.n = Math.min(999, n); x.flag.unit = orderUnit(x); x.flag.by = whoAmI(); });
  return true;
}
export const stampLine = (l) => { l.updated = todayKey(); const w = whoAmI(); if (w) l.by = w; else delete l.by; };
/* Set how often a line is ordered: one of FREQS. */
export function setFreq(lineId, f) {
  const l = lineById(lineId);
  if (!l || !FREQS.some((x) => x[0] === f) || freqOf(l) === f) return false;
  edit('inv', (inv) => { const x = inv.lines.find((y) => y.id === lineId); x.freq = f; stampLine(x); });
  return true;
}
/* The order list: every flagged line, A to Z, as { l, n, unit, by }. */
export function orderList() {
  const out = [];
  for (const l of I().lines.slice().sort(byName)) { const f = flagOf(l); if (f) out.push({ l, n: f.n, unit: f.unit, by: f.by }); }
  return out;
}
/* Order placed: file the order next to the saved counts and clear the flags it used. Returns the
   record, or null when nothing is flagged. The record starts as placed; received comes later.
   `text` is what History shows and copies (the message that was sent). */
export function placeOrder(text) {
  const list = orderList();
  if (!list.length) return null;
  const now = new Date().toISOString(), who = whoAmI();
  const rec = { id: uid('o'), kind: 'order', date: todayKey(), savedAt: now, by: who, lines: list.map((o) => ({ line: o.l.id, name: o.l.name, n: o.n, unit: o.unit })), orderCount: list.length, text: text || '', order: { status: 'placed', placedAt: now, placedBy: who }, updated: todayKey() };
  edit('counts', (c) => { c.history = (c.history || []).concat([rec]); });
  const ids = new Set(list.map((o) => o.l.id));
  edit('inv', (inv) => { for (const l of inv.lines) if (ids.has(l.id) && isObj(l.flag)) clearFlag(l, now); });
  return rec;
}
/* Save the count in progress for the place on screen. Returns the saved entry, or null when nothing
   is counted. `text` is what History shows and copies. Starting a fresh count is the caller's job. */
export function saveCount(text) {
  const cnt = S.count;
  if (!Object.keys(cnt.counts || {}).length) return null;
  const units = {}, per = {};
  for (const l of I().lines) for (const p of l.products) if (cnt.counts[p.id] != null) { units[p.id] = l.unit; const n = perCaseOf(p); if (n) per[p.id] = n; }
  const entry = { id: uid('h'), date: todayKey(), savedAt: new Date().toISOString(), by: whoAmI(), place: roomNow(), counts: Object.assign({}, cnt.counts), units, per, orderCount: 0, text: text || '', updated: todayKey() };
  edit('counts', (c) => { c.history = (c.history || []).concat([entry]); });
  return entry;
}

/* What the newest order record says was ordered for a line: { when, n, unit }, or null. */
function lastOrdered(lineId) {
  let best = null;
  for (const h of (C().history || [])) {
    if (!isOrder(h) || !Array.isArray(h.lines)) continue;
    const x = h.lines.find((y) => isObj(y) && y.line === lineId);
    if (x && (!best || whenOf(h) > best.when)) best = { when: whenOf(h), n: x.n, unit: x.unit };
  }
  return best;
}

/* ---------- merging flags ----------
   Sync calls this after the ordinary three-way merge of inventory.json (see merge3 in sync.js). The
   ordinary merge goes field by field, which is wrong for a flag in three ways:
   - A cleared flag has no field left to merge, so an old backup's copy would look new and come back.
     Here the newest clearing time wins, and a flag from before it is dropped.
   - A flag set again after a clearing must win over that clearing, whichever phone syncs second.
   - The amount and its unit belong together: 3 from one phone must not meet "cases" from the other.
   Two phones flagging one line with different amounts is an ordinary clash: this phone's amount
   stays, and the Count tab asks "Keep mine / Use theirs". A flag this phone set that another phone's
   order cleared leaves a note, so nobody loses a flag without being told. */
export function mergeFlags(base, local, remote, m, o) {
  if (!m || !isObj(m.doc) || !Array.isArray(m.doc.lines)) return;
  const byId = (d) => new Map((isObj(d) && Array.isArray(d.lines) ? d.lines : []).filter((x) => isObj(x) && typeof x.id === 'string').map((x) => [x.id, x]));
  const B = byId(base), L = byId(local), R = byId(remote), github = !!(o && o.prefer === 'remote');
  const pair = (f) => [f.n, f.unit];
  for (const line of m.doc.lines) {
    const l = L.get(isObj(line) ? line.id : null), r = R.get(isObj(line) ? line.id : null);
    if (!l || !r) continue; // on one side only: nothing to combine
    if (!('flag' in l) && !('flag' in r) && !('cleared' in l) && !('cleared' in r)) continue;
    const b = B.get(line.id) || {}, at = '.lines[' + line.id + ']';
    m.conflicts = m.conflicts.filter((cf) => cf.path !== at + '.cleared' && cf.path !== at + '.flag' && !String(cf.path).startsWith(at + '.flag.'));
    const cleared = later(stampOf(l.cleared), stampOf(r.cleared));
    if (cleared) line.cleared = cleared; else delete line.cleared;
    const fl = flagLive(l.flag, cleared) ? l.flag : null, fr = flagLive(r.flag, cleared) ? r.flag : null;
    const mine = !same(l.flag, b.flag), theirs = !same(r.flag, b.flag); // set or changed since the last sync
    let flag = null;
    if (fl && fr && !mine) flag = clone(fr); // only they touched it
    else if (fl && fr && !theirs) flag = clone(fl);
    else if (fl && fr) {
      flag = Object.assign({}, github ? fl : fr, github ? fr : fl);
      flag.at = later(stampOf(fl.at), stampOf(fr.at));
      // Unchanged since the last sync: same flag, same amount, same unit.
      const still = (f) => isObj(b.flag) && same(pair(f), pair(b.flag)) && stampOf(f.at) === stampOf(b.flag.at);
      let src = null;
      if (same(pair(fl), pair(fr))) src = github ? fr : fl;
      else if (still(fl)) src = fr;
      else if (still(fr)) src = fl;
      if (src) { flag.n = src.n; flag.unit = src.unit; if ('by' in src) flag.by = src.by; }
      else {
        // Both set an amount. Read each in the unit the line is ordered in now, then compare.
        const a = flagAmount(line, fl), c = flagAmount(line, fr);
        if (a !== c) m.conflicts.push(Object.assign({ path: at + '.flag.n', kept: github ? 'github' : 'phone', ours: a, theirs: c, who: str(fr.by) }, github ? { note: (o && o.note) || 'First sync with this repo: GitHub’s version kept' } : {}));
        flag.n = github ? c : a; flag.unit = orderUnit(line); flag.by = str((github ? fr : fl).by);
      }
    } else if (fl) flag = !mine && theirs && !isObj(r.flag) ? null : clone(fl); // taken out by hand on GitHub, with no time: leave it out
    else if (fr) flag = !theirs && mine && !isObj(l.flag) ? null : clone(fr);
    if (flag) line.flag = flag; else delete line.flag;
    if (base == null) continue; // a first sync or an old backup: nothing here is news to anyone
    const words = (f) => fmtQty(flagAmount(line, f), orderUnit(line));
    if (isObj(l.flag) && !fl && mine && stampOf(r.cleared) >= stampOf(l.flag.at)) m.conflicts.push({ path: at + '.flag', kept: 'github', ours: clone(l.flag), note: 'You flagged this for ' + words(l.flag) + ', but it went on an order, or was taken off the list, on another phone since. Flag it again if it’s still needed' });
    if (isObj(r.flag) && !fr && theirs && stampOf(l.cleared) >= stampOf(r.flag.at) && !(isObj(b.flag) && same(pair(r.flag), pair(b.flag)))) {
      // The other phone set or changed an amount this phone never saw before clearing the line.
      const ord = lastOrdered(line.id), sent = ord && ord.when >= stampOf(r.flag.at);
      if (sent && ord.unit === orderUnit(line) && Number(ord.n) === flagAmount(line, r.flag)) continue; // the order had the same amount
      m.conflicts.push({ path: at + '.flag', kept: 'phone', theirs: clone(r.flag), who: str(r.flag.by), note: 'The other phone had this down for ' + words(r.flag) + (sent ? ', and the order went in with ' + fmtQty(Number(ord.n) || 0, str(ord.unit)) + '. Check that’s enough' : ' when it was taken off the list here. Flag it again if it’s still needed') });
    }
  }
}
