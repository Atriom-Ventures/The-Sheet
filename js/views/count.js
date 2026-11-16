// Inventory count: count stock, flag what to order, keep history.
// The data and math (places, what's on hand, flags, order records, unit math) live in ../stock.js.

import { app } from '../app.js';
import { S, I, C, save, edit, hasInv, signName, whoAmI } from '../state.js';
import { UNITS, unitWord, fmtQty, perCaseOf, smallUnit, r6, factor, partsOf, fromParts, splitParts, fromSplit, fmtSplit, fmtHave, prefProduct, byName, PLACES, placeName, placeOf, FREQS, freqOf, freqName, roomNow, setRoom, inProgress, allInProgress, freshCount, forgetProduct, isOrder, savedVal, totals, flagOf, setFlag, setFlagAmount, orderList, placeOrder, saveCount, stampLine, setFreq } from '../stock.js';
import { autoSync, canWrite, perm, connOf } from '../sync.js';
import { setAtPath, markGone } from '../merge.js';
import { esc, fmtNum, parseQty, round2, fmtShort, dateOf, uid, slug, copyText, shareText, todayKey, $, cssEsc, debounce, ago, daysSince, clone } from '../util.js';
import { ICON, seg, chip, empty, toast, armed, opts, field, openSheet, closeSheet, setSheetBody, setSheetTitle, isSheetOpen, announce } from '../ui.js';

const STATES = [['active', 'On the order sheet'], ['disc', 'Crossed off the sheet'], ['ask', 'Not on the sheet: ask first'], ['useup', 'Not on the sheet: use up'], ['remove', 'Not on the sheet: remove']];
const STATE_SHORT = { disc: 'Crossed off', ask: 'Ask first', useup: 'Use up', remove: 'Remove' };
// The shared files can be edited by anyone with access, even by hand on github.com, so every value
// from them is shown as text. A status the app doesn't know gets a plain tag.
const stateTag = (s) => '<span class="tag t-' + (STATE_SHORT[s] ? s : 'other') + '">' + esc(STATE_SHORT[s] || '') + '</span>';
const STATUS_LABEL = { todo: 'Not counted', partial: 'Partly', ok: 'Counted' };
const SUBS = [['count', 'Count'], ['order', 'Order'], ['history', 'History'], ['items', 'Items']];

let filter = 'all', q = '', confirmNew = false;
let typedIn = null; // { id, n }: the order box being typed in, and the amount it had before

const lines = () => I().lines;
const findLineOfProduct = (pid) => lines().find((l) => l.products.some((p) => p.id === pid));
const productOf = (pid) => { const l = findLineOfProduct(pid); return l ? l.products.find((p) => p.id === pid) : null; };

/* ---------- order on screen ----------
   Sections and lines show A to Z (numbers in order, so 8 oz comes before 12 oz). The file's own order
   doesn't matter. A line whose section is missing (deleted, or a hand edit) shows under "No section". */
const sortLines = (ls) => ls.slice().sort(byName);
export function sections() {
  const cats = I().cats.slice().sort(byName), ids = new Set(cats.map((c) => c.id));
  if (lines().some((l) => !ids.has(l.cat))) cats.push({ id: '', name: 'No section', missing: true });
  return cats;
}
const inSection = (l, c) => (c.missing ? !I().cats.some((x) => x.id === l.cat) : l.cat === c.id);

const hist = () => (C().history || []).slice().sort((a, b) => String(b.savedAt || b.date).localeCompare(String(a.savedAt || a.date)));

/* How far a line is counted in a count. Minimums stay in the file but nothing here reads them: what
   to order is flagged by hand (see flags in stock.js). */
export function lineStat(line, counts) {
  let total = 0, n = 0;
  for (const p of line.products) { const v = counts[p.id]; if (v != null) { total += v; n++; } }
  total = r6(total); // not rounded to cents: 1 case + 14 of 15 must add back up to 14 loose
  const counted = line.products.length > 0 && n === line.products.length;
  return { total, n, counted, status: counted ? 'ok' : (n ? 'partial' : 'todo') };
}
/* The last saved count of a product in the place on screen, in the line's unit today (see savedVal).
   null when there isn't one, or it can't be read in today's unit: then it isn't offered. */
function lastFor(pid) {
  const l = findLineOfProduct(pid), p = productOf(pid), place = roomNow();
  if (!l) return null;
  for (const h of hist()) {
    if (isOrder(h) || placeOf(h) !== place) continue;
    const v = savedVal(h, l, p);
    if (v === undefined) continue;
    return v == null ? null : { val: v, date: h.date };
  }
  return null;
}
/* What a count was made of when it was entered: the per-case number then, and the cases and loose
   units it came to. `at` is the per-case number the stored count is worked out with right now. */
function snapOf(line, p, v) {
  const n = perCaseOf(p);
  return n ? Object.assign({ n, at: n }, partsOf(line.unit === 'case', n, v)) : { n: 0, at: 0 };
}
/* A line's unit can change while a count is in progress, on this phone or synced from another phone.
   Each counted product remembers the unit it was counted in; numbers in an older unit are converted
   with the per-case number, or cleared when that can't be done (so they're never misread).
   The per-case number can change mid-count too (someone corrects it). A count made as full cases plus
   loose units is stored as one number, so a new per-case number would silently turn "1 case + 6" into
   "1 case + 3.6". Each count remembers the cases and loose units it was entered as, and is worked out
   again from those. */
export function reconcileUnits() {
  let changed = false; const cleared = [];
  // Both places' counts in progress: the one waiting must not come back in a unit it wasn't counted in.
  for (const cnt of allInProgress()) {
    if (!cnt.counts) continue;
    const u = cnt.units || (cnt.units = {}), per = cnt.per || (cnt.per = {});
    for (const pid of Object.keys(cnt.counts)) {
      const l = findLineOfProduct(pid);
      if (!l) continue;
      const p = productOf(pid), n = perCaseOf(p);
      if (!u[pid]) { u[pid] = l.unit; changed = true; }
      else if (u[pid] !== l.unit) {
        const f = factor(u[pid], l.unit, smallUnit(l), n);
        if (f == null) { delete cnt.counts[pid]; delete u[pid]; delete per[pid]; if (cleared.indexOf(l.name) < 0) cleared.push(l.name); changed = true; continue; }
        cnt.counts[pid] = r6(cnt.counts[pid] * f); u[pid] = l.unit; changed = true;
      }
      const rec = per[pid];
      if (!rec || typeof rec !== 'object') { per[pid] = snapOf(l, p, cnt.counts[pid]); changed = true; }
      else if (rec.at !== n) {
        if (n > 0 && rec.n > 0) cnt.counts[pid] = fromParts(l.unit === 'case', n, rec);
        rec.at = n; changed = true;
      }
    }
    for (const pid of Object.keys(u)) if (cnt.counts[pid] == null) { delete u[pid]; changed = true; }
    for (const pid of Object.keys(per)) if (cnt.counts[pid] == null) { delete per[pid]; changed = true; }
  }
  if (changed) save('count');
  if (cleared.length) setTimeout(() => toast(cleared.length === 1 ? 'How ' + cleared[0] + ' is counted changed, so its count was cleared. Count it again.' : cleared.length + ' lines changed how they’re counted, so their counts were cleared. Count them again.', 4000), 0);
}
function seenFor(pid) { const s = I().seen; return s && s.items && s.items[pid] ? { text: s.items[pid], date: s.date } : null; }
const activeLines = () => lines().filter((l) => l.state === 'active');
function progress() {
  let counted = 0, flagged = 0; const act = activeLines();
  for (const l of act) { if (lineStat(l, S.count.counts).counted) counted++; if (flagOf(l)) flagged++; }
  return { counted, total: act.length, flagged, todo: act.length - counted };
}
/* What a saved count says in History: where, who, and each line that was counted. */
function countText() {
  const out = []; let counted = 0;
  for (const l of sortLines(lines())) {
    const st = lineStat(l, S.count.counts);
    if (!st.n) continue;
    if (l.state === 'active' && st.counted) counted++;
    out.push('• ' + l.name + ': ' + fmtHave(l, st.total));
  }
  const by = signName() || whoAmI();
  return [(I().title || 'Inventory') + ' count · ' + placeName(roomNow()) + ' · ' + new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
    (by ? 'Counted by ' + by + ' · ' : '') + counted + ' of ' + activeLines().length + ' items counted', ''].concat(out).join('\n');
}

/* The order as a message for team chat. */
function orderText(list) {
  const t = totals({ live: true }), by = signName() || whoAmI();
  const out = [(I().title || 'Inventory') + ' order · ' + new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })];
  if (by) out.push('From ' + by);
  out.push('', 'ORDER');
  if (!list.length) out.push('Nothing is flagged to order.');
  for (const o of list) {
    const p = prefProduct(o.l), pd = p ? [p.brand, p.code].filter(Boolean).join(' ') : '', have = t.lines[o.l.id] && t.lines[o.l.id].sum.v;
    out.push('• ' + o.l.name + ': ' + fmtQty(o.n, o.unit) + (pd ? ' (' + pd + ')' : '') + (have != null ? ' · have ' + fmtHave(o.l, have) : ''));
  }
  return out.join('\n');
}

/* For the Now screen. */
export function countSummary() {
  if (!hasInv()) return '';
  reconcileUnits();
  const p = progress();
  if (!p.counted && !p.flagged) return '<button class="glance-b" data-act="go" data-id="#count"><span class="g-k">' + ICON.count + ' Count</span><span class="g-v">Not started</span></button>';
  return '<button class="glance-b" data-act="go" data-id="#count/order"><span class="g-k">' + ICON.count + ' Count</span><span class="g-v">' + p.counted + '/' + p.total + (p.flagged ? ' · <b>' + p.flagged + ' to order</b>' : '') + '</span></button>';
}

/* ---------- access ----------
   What this phone may do with the shared inventory comes from GitHub (see sync.js). View only:
   counting and copying the order still work, but nothing is saved to the shared copy. */
const ro = () => !canWrite('counts');
function accessNote() {
  const w = connOf('counts'); if (!w) return '';
  const p = perm(w) || {};
  if (p.lost) return '<p class="note warn-t">This phone can’t reach the shared inventory anymore: the key stopped working or access was removed. What you see is from the last sync. <button class="link inline" data-act="tab" data-id="more">Check the connection</button></p>';
  if (p.push === false) return '<p class="note">View only. You can count and copy the order, but saving counts, marking orders and changing items need write access. Whoever runs the GitHub organization can give it.</p>';
  return '';
}

/* ---------- order status ----------
   An order is a record in History with an order on it: placed → received. "Order placed" files one
   (placeOrder in stock.js). Saved counts from before flags could carry an order too, starting as not
   placed yet; those still show and can still be marked. An unplaced order is replaced as soon as
   there's a newer order. */
// Timestamps are UTC (…Z); show them in the phone's own day, or an evening order reads as tomorrow.
const localDate = (v) => (/T/.test(String(v || '')) ? new Date(v) : dateOf(v));
const dayName = (iso) => localDate(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' });
export function orderState(e, H) {
  if (!e.orderCount) return 'none';
  const st = (e.order && e.order.status) || 'saved';
  if (st !== 'saved') return st;
  const list = H || hist();
  const newer = list.some((x) => x.orderCount > 0 && String(x.savedAt || x.date) > String(e.savedAt || e.date));
  return newer ? 'replaced' : 'saved';
}
function orderLine(e, st) {
  const o = e.order || {};
  if (st === 'saved') return 'Not placed yet';
  if (st === 'placed') return 'Placed ' + dayName(o.placedAt) + (o.placedBy ? ' by ' + o.placedBy : '');
  if (st === 'received') return 'Received ' + dayName(o.receivedAt) + (o.receivedBy ? ' by ' + o.receivedBy : '');
  if (st === 'replaced') return 'Replaced by a newer order';
  return '';
}
const ORDER_CLASS = { saved: 'warn', placed: 'go', received: 'ok', replaced: 'muted' };
function orderButtons(e, st, small) {
  if (ro()) return '';
  const c = small ? 'btn small' : 'btn';
  if (st === 'saved') return '<button class="' + c + ' primary" data-act="ord-placed" data-id="' + esc(e.id) + '">' + ICON.check + ' Mark placed</button>';
  if (st === 'placed') return '<button class="' + c + ' primary" data-act="ord-received" data-id="' + esc(e.id) + '">' + ICON.check + ' Mark received</button><button class="' + c + ' ghost" data-act="ord-unplace" data-id="' + esc(e.id) + '">Not placed after all</button>';
  if (st === 'received') return '<button class="' + c + ' ghost" data-act="ord-unreceive" data-id="' + esc(e.id) + '">Not received after all</button>';
  return '';
}
/* Orders anyone has saved or placed in the last two weeks that haven't arrived yet. */
function openOrders() {
  const H = hist();
  return H.filter((e) => { const st = orderState(e, H); return (st === 'saved' || st === 'placed') && daysSince(e.date || String(e.savedAt).slice(0, 10)) <= 14; });
}
function openOrdersHTML() {
  const open = openOrders();
  if (!open.length) return '';
  return open.slice(0, 2).map((e) => {
    const st = orderState(e);
    return '<div class="ord-open s-' + st + '"><div class="ord-open-h"><b>' + esc(st === 'placed' ? 'An order is on its way' : 'A saved order hasn’t been placed') + '</b><span>' + esc(dayName(e.savedAt || e.date)) + (e.by && !isOrder(e) ? ' · counted by ' + esc(e.by) : '') + ' · ' + esc(e.orderCount) + ' item' + (e.orderCount === 1 ? '' : 's') + '</span><span class="ord-st">' + esc(orderLine(e, st)) + '</span></div><div class="row-actions">' + orderButtons(e, st, true) + '<button class="btn small ghost" data-act="go" data-id="#count/history">See it</button></div></div>';
  }).join('');
}
function setOrder(id, fn) {
  if (ro()) { toast('View only: marking orders needs write access.'); return; }
  edit('counts', (c) => { const e = (c.history || []).find((x) => x.id === id); if (e) { e.order = Object.assign({ status: 'saved' }, e.order || {}); fn(e.order); e.updated = todayKey(); } });
  autoSync('save', 800);
}

/* ---------- clashes: both phones changed the same thing between syncs ---------- */
const FIELD = { n: 'order amount', flag: 'order list', freq: 'how often', name: 'name', par: 'minimum', unit: 'counted in', inner: 'loose unit', step: 'step', cat: 'section', state: 'status on the sheet', note: 'note', brand: 'brand', code: 'item #', perCase: 'per case', pref: '“order this one”', status: 'order status', placedBy: 'placed by', receivedBy: 'received by', placedAt: 'placed date', receivedAt: 'received date' };
const reviewList = () => (S.conflicts || []).filter((c) => c.review);
function clashLabel(c) {
  const doc = S[c.key] && S[c.key].local;
  const ids = (c.path.match(/\[([^\]]+)\]/g) || []).map((x) => x.slice(1, -1));
  const field = (c.path.match(/\.([^.[\]]+)$/) || [])[1];
  let where = '';
  if (c.key === 'inv' && doc) {
    const l = doc.lines.find((x) => x.id === ids[0]);
    if (l) { where = l.name; if (ids[1]) { const p = l.products.find((x) => x.id === ids[1]); if (p && p.name) where += ', ' + p.name; } }
  } else if (c.key === 'counts' && doc) {
    const e = (doc.history || []).find((x) => x.id === ids[0]);
    if (e) where = (isOrder(e) ? 'Order from ' : 'Count from ') + dayName(e.savedAt || e.date);
  }
  return (where || 'An item') + (field && FIELD[field] ? ': ' + FIELD[field] : '');
}
const showVal = (v) => (v == null || v === '' ? 'blank' : typeof v === 'object' ? 'a different version' : v === true ? 'yes' : String(v));
/* A clash's value in words: how often shows as its name, not the id the file keeps. */
const clashVal = (c, v) => (/\.freq$/.test(c.path) && typeof v === 'string' ? freqName(v) : showVal(v));
function reviewHTML() {
  const list = reviewList();
  if (!list.length) return '';
  return '<section class="clash"><h2 class="clash-h">' + ICON.sync + ' ' + list.length + ' change' + (list.length === 1 ? '' : 's') + ' clashed</h2><p class="hint">You and someone else changed the same thing before syncing. Your version is in for now.</p>' +
    list.map((c) => {
      const who = c.who || 'Them';
      if (c.note) return '<div class="clash-i"><div class="clash-t">' + esc(clashLabel(c)) + '</div><div class="clash-v">' + esc(c.note) + '.</div><div class="row-actions"><button class="btn small" data-act="clash-mine" data-id="' + esc(c.id) + '">OK</button></div></div>';
      return '<div class="clash-i"><div class="clash-t">' + esc(clashLabel(c)) + '</div><div class="clash-v">Yours: <b>' + esc(clashVal(c, c.ours)) + '</b> · ' + esc(who) + '’s: <b>' + esc(clashVal(c, c.theirs)) + '</b></div>' +
        '<div class="row-actions"><button class="btn small" data-act="clash-mine" data-id="' + esc(c.id) + '">Keep mine</button><button class="btn small ghost" data-act="clash-theirs" data-id="' + esc(c.id) + '">Use ' + esc(who) + '’s</button></div></div>';
    }).join('') + '</section>';
}
function dropClash(id) { S.conflicts = (S.conflicts || []).filter((c) => c.id !== id); save('conflicts'); }

/* ---------- count tab ---------- */
function pill(st) { return '<span class="pill p-' + st.status + '">' + STATUS_LABEL[st.status] + '</span>'; }
function productDesc(line, p, withName) {
  const bits = [];
  if (withName && p.name) bits.push(esc(p.name));
  const bc = [p.brand, p.code].filter(Boolean).join(' '); if (bc) bits.push(esc(bc));
  if (perCaseOf(p)) bits.push(esc(perCaseOf(p) + ' ' + unitWord(smallUnit(line), 2) + '/case'));
  else if (p.perCase) bits.push(esc(p.perCase + '/case'));
  if (p.note) bits.push('<em>' + esc(p.note) + '</em>');
  return bits.join(' · ');
}
/* A line's name and details. `st` is how far it's counted in the room on screen (null on Totals, which
   has no count in progress). `lv` is the name's heading level: 4 under a how-often group and a section. */
function lineHead(line, st, lv) {
  const multi = line.products.length > 1, bits = [], side = [], h = 'h' + (lv === 3 ? 3 : 4);
  if (line.note) bits.push(esc(line.note));
  if (!multi) { const d = productDesc(line, line.products[0], true); if (d) bits.push(d); }
  if (line.state !== 'active') side.push(stateTag(line.state));
  if (st && multi && st.n) side.push('<span class="ltotal">' + esc(fmtQty(st.total, line.unit)) + '</span>');
  if (st && line.state === 'active') side.push(pill(st));
  const dup = multi ? '<div class="lmeta dup">' + line.products.length + ' products add up here' + (line.state === 'active' && !prefProduct(line) ? '. Pick one to keep ordering.' : '') + '</div>' : '';
  return '<div class="lh-main"><' + h + ' class="lname">' + esc(line.name) + '</' + h + '>' + (bits.length ? '<div class="lmeta">' + bits.join(' · ') + '</div>' : '') + dup + '</div><div class="lh-side">' + side.join('') + '</div>';
}
function quick(line, p) {
  const v = S.count.counts[p.id]; let h = '';
  if (v == null) { const last = lastFor(p.id); if (last) h += '<button class="mini" data-act="inv-same" data-pid="' + esc(p.id) + '" data-val="' + esc(last.val) + '">Same as ' + esc(fmtShort(last.date)) + ': <b>' + esc(perCaseOf(p) ? fmtSplit(line, p, last.val) : fmtNum(last.val)) + '</b></button>'; }
  else h += '<button class="mini ghost" data-act="inv-clear" data-pid="' + esc(p.id) + '">Clear</button>';
  return h;
}
/* The unit beside a stepper. Tapping it opens how this line is counted (unit, step, per case). */
function unitTag(line, word) {
  if (ro()) return '<span class="unit">' + esc(word) + '</span>';
  return '<button class="unit unit-b" data-act="inv-how" data-line="' + esc(line.id) + '" aria-label="' + esc(word + ': change how ' + line.name + ' is counted') + '"><span>' + esc(word) + '</span>' + ICON.down + '</button>';
}
function stepper(act, pid, part, val, label, word, inputmode, inputAttr) {
  const ids = 'data-act="' + act + '" data-pid="' + esc(pid) + '"' + (part ? ' data-part="' + part + '"' : '');
  return '<div class="stepper"><button class="step" ' + ids + ' data-d="-1" aria-label="' + esc('Minus one ' + word + ', ' + label) + '">−</button>' +
    '<input class="qty" ' + inputAttr + ' inputmode="' + inputmode + '" enterkeyhint="done" autocomplete="off" value="' + (val == null ? '' : esc(fmtNum(val))) + '" placeholder="–" aria-label="' + esc(label) + '">' +
    '<button class="step" ' + ids + ' data-d="1" aria-label="' + esc('Plus one ' + word + ', ' + label) + '">+</button></div>';
}
function countCtl(line, p, label) {
  const v = S.count.counts[p.id], pid = p.id;
  if (!perCaseOf(p)) return '<div class="pctl">' + stepper('inv-step', pid, '', v, label + ' on hand', unitWord(line.unit, 1), 'decimal', 'id="q-' + esc(pid) + '" data-qty="' + esc(pid) + '"') + unitTag(line, unitWord(line.unit, 2)) + '</div>';
  const s = v == null ? null : splitParts(line, p, v), small = smallUnit(line);
  return '<div class="pctl split">' +
    '<div class="spl">' + unitTag(line, 'full cases') + stepper('inv-split', pid, 'c', s && s.cases, 'Full cases, ' + label, 'case', 'numeric', 'id="qc-' + esc(pid) + '" data-split="c" data-pid="' + esc(pid) + '"') + '</div>' +
    '<div class="spl">' + unitTag(line, 'loose ' + unitWord(small, 2)) + stepper('inv-split', pid, 'l', s && s.loose, 'Loose ' + unitWord(small, 2) + ', ' + label, unitWord(small, 1), 'decimal', 'id="ql-' + esc(pid) + '" data-split="l" data-pid="' + esc(pid) + '"') + '</div></div>';
}
function productRow(line, p, multi) {
  const v = S.count.counts[p.id], seen = seenFor(p.id), label = p.name || line.name;
  return '<div class="prod' + (v != null ? ' done' : '') + '" id="P-' + esc(p.id) + '">' +
    (multi ? '<div class="pinfo"><div class="pname">' + esc(label) + (p.pref ? ' <span class="star">★ Order this</span>' : '') + '</div><div class="pmeta">' + productDesc(line, p, false) + '</div></div>' : '') +
    countCtl(line, p, label) +
    '<div class="quick" id="QK-' + esc(p.id) + '">' + quick(line, p) + '</div>' +
    (seen && !lastFor(p.id) && v == null ? '<div class="seen">In the ' + fmtShort(seen.date) + ' photos: ' + esc(seen.text) + '</div>' : '') + '</div>';
}
/* ---------- rooms ----------
   Count has a tab per room and a Totals tab. A room tab counts that room (its own count in progress,
   see setRoom); under each line it shows what's counted here, the other room's last saved count, and
   both added up. Totals shows each room's newest saved count and the sum. All amounts come from
   totals() in stock.js; nothing here adds numbers up. */
let shown = 'room'; // which kind of Count tab was drawn last: 'room' or 'totals'
const ROOM_DESC = { servery: 'Backup stock', kitchen: 'Open, working stock' };
const otherRoom = (pl) => (PLACES.find((p) => p[0] !== pl) || PLACES[0])[0];
const curView = () => (shown === 'totals' ? 'totals' : roomNow());
const totalsFor = (view) => (view === 'totals' ? totals() : totals({ live: view }));
const longDay = (r) => localDate(r.savedAt || r.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
function roomTabs(view) {
  return '<div class="seg-c rooms" role="group" aria-label="Room">' + PLACES.concat([['totals', 'Totals']]).map(([id, label]) => '<button data-act="count-room" data-id="' + esc(id) + '" aria-pressed="' + (id === view ? 'true' : 'false') + '">' + esc(label) + '</button>').join('') + '</div>';
}
function roomNote(view) {
  if (view === 'totals') return '<p class="hint room-note">Each room’s newest saved count, added up line by line.</p>';
  const other = placeName(otherRoom(view)), c = inProgress(otherRoom(view));
  const waiting = c && c.counts && Object.keys(c.counts).length ? ' This phone’s ' + other + ' count isn’t saved yet, so it isn’t in those numbers.' : '';
  return '<p class="hint room-note">' + esc(ROOM_DESC[view] + '. Count what’s here. Each line also shows the ' + other + '’s last saved count and both added up.' + waiting) + '</p>';
}
/* Totals: which saved count each room's numbers come from, and a reminder about counts not saved yet. */
function totalsHead(t) {
  const rows = PLACES.map(([id, name]) => { const r = t.rooms[id]; return '<div><dt>' + esc(name) + '</dt><dd>' + esc(r ? 'Counted ' + longDay(r) + (r.by ? ' by ' + r.by : '') : 'Not counted yet') + '</dd></div>'; }).join('');
  const waiting = PLACES.filter(([id]) => { const c = inProgress(id); return c && c.counts && Object.keys(c.counts).length; }).map((p) => p[1]);
  return '<dl class="troom">' + rows + '</dl>' + (waiting.length ? '<p class="note">' + esc('This phone has a ' + waiting.join(' and a ') + ' count in progress. It joins these totals once it’s saved.') + '</p>' : '');
}
/* One room's amount of a line, in words. r is that room's entry from totals(). */
function amtWords(line, r) {
  if (!r || r.v == null) return r && r.stale ? 'count again (it was counted in another unit)' : 'not counted';
  let s = fmtHave(line, r.v);
  if (r.of > 1 && r.n < r.of) s += ' (' + r.n + ' of ' + r.of + ' products)';
  if (r.stale) s += ', count the rest again';
  return s;
}
const sumWords = (line, row) => 'In all: ' + (row.sum.v != null ? fmtHave(line, row.sum.v) : 'nothing counted yet');
/* Under a line on a room tab: this room, the other room, and both. When this room's count in progress
   hasn't reached the line yet, its last saved count still adds in, so it says so. */
function amountsHTML(line, t, room) {
  const row = t.lines[line.id]; if (!row) return '';
  const here = row[room], oth = otherRoom(room), there = row[oth], mine = t.rooms[room], theirs = t.rooms[oth], name = placeName(room);
  let a = name + ': ';
  if (here.live) a += amtWords(line, here);
  else if (here.v != null) a += 'not counted yet. Last saved ' + amtWords(line, here) + (mine ? ' on ' + fmtShort(mine.date) : '');
  else a += here.stale ? 'not counted yet. The last count was in another unit.' : 'not counted yet';
  const b = placeName(oth) + ': ' + amtWords(line, there) + (there.v != null && theirs ? ', counted ' + fmtShort(theirs.date) : '');
  return '<span' + (here.live ? ' class="la-here"' : '') + '>' + esc(a) + '</span><span>' + esc(b) + '</span><span class="la-sum">' + esc(sumWords(line, row)) + '</span>';
}
/* On Totals: each room's amount and the sum. */
function totalsRows(line, t) {
  const row = t.lines[line.id]; if (!row) return '';
  return '<dl class="tot">' + PLACES.map(([id, name]) => '<div><dt>' + esc(name) + '</dt><dd>' + esc(amtWords(line, row[id])) + '</dd></div>').join('') +
    '<div class="tsum"><dt>In all</dt><dd>' + esc(row.sum.v != null ? fmtHave(line, row.sum.v) : 'nothing counted yet') + '</dd></div></dl>';
}

/* The Order button on a line: on means it's on the shared order list. When it's on, the amount to
   order shows beside it, with its own stepper (the same actions the Order tab uses). */
function orderStepper(line, f) {
  const id = esc(line.id);
  return '<div class="pctl oqty"><span class="olabel" aria-hidden="true">To order</span><div class="stepper"><button class="step" data-act="ord-dec" data-line="' + id + '" aria-label="Order minus one, ' + esc(line.name) + '">−</button>' +
    '<input class="qty" id="oq-' + id + '" data-oline="' + id + '" inputmode="numeric" enterkeyhint="done" autocomplete="off" value="' + esc(fmtNum(f.n)) + '" aria-label="Order amount for ' + esc(line.name) + '">' +
    '<button class="step" data-act="ord-inc" data-line="' + id + '" aria-label="Order plus one, ' + esc(line.name) + '">+</button></div><span class="unit" id="OU-' + id + '">' + esc(unitWord(f.unit, f.n)) + '</span></div>';
}
function flagRow(line) {
  if (line.state !== 'active') return '';
  const f = flagOf(line), id = esc(line.id);
  if (ro()) return f ? '<div class="lflag"><span class="lflag-n">' + esc('To order: ' + fmtQty(f.n, f.unit)) + '</span></div>' : '';
  return '<div class="lflag" id="LF-' + id + '"><button class="chip ordb" data-act="inv-flag" data-line="' + id + '" aria-pressed="' + (f ? 'true' : 'false') + '" aria-label="' + esc('Order ' + line.name) + '">' + ICON.check + '<span>Order</span></button>' +
    '<div class="lflag-q" id="LQ-' + id + '">' + (f ? orderStepper(line, f) : '') + '</div></div>';
}
const cardClass = (line, st) => 'line s-' + (line.state === 'active' ? st.status : 'extra') + (line.products.length > 1 ? ' multi' : '') + (flagOf(line) ? ' flagged' : '');
function lineCard(line, t, view, lv) {
  const id = esc(line.id);
  if (view === 'totals') return '<article class="line tline' + (flagOf(line) ? ' flagged' : '') + '" id="L-' + id + '"><div class="lh">' + lineHead(line, null, lv) + '</div>' + totalsRows(line, t) + flagRow(line) + '</article>';
  const st = lineStat(line, S.count.counts), multi = line.products.length > 1;
  return '<article class="' + cardClass(line, st) + '" id="L-' + id + '"><div class="lh" id="LH-' + id + '" data-lv="' + lv + '">' + lineHead(line, st, lv) + '</div>' + line.products.map((p) => productRow(line, p, multi)).join('') +
    '<div class="lamt" id="LA-' + id + '">' + amountsHTML(line, t, view) + '</div>' + flagRow(line) + '</article>';
}
function matches(line, view, t) {
  const n = q.trim().toLowerCase();
  if (n && ![line.name, line.note].concat(line.products.flatMap((p) => [p.name, p.brand, p.code])).join(' ').toLowerCase().includes(n)) return false;
  if (filter === 'all') return true;
  if (filter === 'todo') {
    if (line.state !== 'active') return false;
    // On Totals: not yet counted in every room.
    if (view === 'totals') { const r = t.lines[line.id]; return !r || PLACES.some(([id]) => !r[id].counted); }
    return !lineStat(line, S.count.counts).counted;
  }
  if (filter === 'flag') return !!flagOf(line);
  if (filter === 'multi') return line.products.length > 1;
  return true;
}
function progressHTML() {
  const p = progress();
  return '<div class="prog" id="prog"><div class="prog-row"><span class="prog-big">' + p.counted + '</span><span class="prog-of">of ' + p.total + ' counted in ' + esc(placeName(roomNow())) + '</span><span class="prog-stats">' + (p.flagged ? '<b>' + p.flagged + '</b> to order · ' : '') + p.todo + ' to go</span></div><div class="prog-bar"><i style="width:' + (p.total ? p.counted / p.total * 100 : 0).toFixed(1) + '%"></i></div></div>';
}
/* The lines on the order sheet, grouped by how often they're ordered (FREQS, in order), then by
   section, A to Z. Lines off the sheet follow, as before. */
function countList(view, t) {
  view = view || curView(); t = t || totalsFor(view);
  const ok = (l) => matches(l, view, t);
  let h = '';
  for (const [fid, fname] of FREQS) {
    let g = '', n = 0;
    sections().forEach((c) => {
      const ls = sortLines(lines().filter((l) => inSection(l, c) && l.state === 'active' && freqOf(l) === fid && ok(l)));
      if (!ls.length) return;
      n += ls.length;
      g += '<section class="inv-cat"><h3 class="band">' + esc(c.name) + '</h3><div class="sheet-l">' + ls.map((l) => lineCard(l, t, view, 4)).join('') + '</div></section>';
    });
    if (n) h += '<section class="fgroup" aria-labelledby="FG-' + fid + '"><h2 class="fg-h" id="FG-' + fid + '">' + esc(fname) + ' <span class="fg-n">' + n + (n === 1 ? ' line' : ' lines') + '</span></h2>' + g + '</section>';
  }
  const extra = sortLines(lines().filter((l) => ['ask', 'useup', 'remove'].includes(l.state) && ok(l)));
  if (extra.length) h += '<details class="more"><summary class="band">Not on the order sheet <span class="n">' + extra.length + '</span></summary><p class="hint">Count these if you like. They never go on an order.</p><div class="sheet-l">' + extra.map((l) => lineCard(l, t, view, 3)).join('') + '</div></details>';
  const disc = sortLines(lines().filter((l) => l.state === 'disc' && ok(l)));
  if (disc.length) h += '<details class="more"><summary class="band">Crossed off the sheet <span class="n">' + disc.length + '</span></summary><p class="hint">No longer used. Count what’s left so it gets used up.</p><div class="sheet-l">' + disc.map((l) => lineCard(l, t, view, 3)).join('') + '</div></details>';
  return h || empty('No lines match.');
}
/* Save the room's count, from the bottom of its tab. */
function saveBlock(room) {
  const p = progress(), name = placeName(room), other = placeName(otherRoom(room));
  const todo = sortLines(activeLines().filter((l) => !lineStat(l, S.count.counts).counted));
  let h = '<section class="csave" aria-labelledby="csave-h"><h2 class="sub-title" id="csave-h">' + esc(name + ' count') + '</h2><p class="hint"><span id="csave-n">' + p.counted + ' of ' + p.total + '</span> items counted so far.' +
    (ro() ? '' : esc(' Saving files it in History as the newest ' + name + ' count, for everyone, and starts a fresh one. A line left blank reads as not counted in the ' + name + ' until it’s counted and saved again.')) + '</p>';
  if (!ro()) h += '<div class="row-actions"><button class="btn primary" data-act="count-save">' + ICON.check + ' ' + esc('Save ' + name + ' count') + '</button></div>';
  if (todo.length) h += '<details class="todo-list"><summary>Not counted yet (' + todo.length + ')</summary><p>' + todo.map((l) => esc(l.name)).join(' · ') + '</p></details>';
  h += confirmNew ? '<div class="confirm"><p>' + esc('Clear the ' + name + ' count in progress and start over? Saved counts stay in History, and the ' + other + ' count isn’t touched.') + '</p><div class="row-actions"><button class="btn" data-act="count-new-no">Keep counting</button><button class="btn danger solid" data-act="count-new-yes">Clear and start over</button></div></div>'
    : '<p><button class="link" data-act="count-new">' + esc('Start the ' + name + ' count over') + '</button></p>';
  return h + '</section>';
}
function countTab(view) {
  const t = totalsFor(view);
  return roomTabs(view) + roomNote(view) + (view === 'totals' ? totalsHead(t) : progressHTML()) +
    '<div class="tools"><label class="sr" for="inv-q">Search</label><input id="inv-q" class="search-in" type="search" data-search="inv" placeholder="Search items" value="' + esc(q) + '" autocomplete="off">' +
    '<div class="chips">' + [['all', 'All'], ['todo', 'To count'], ['flag', 'To order'], ['multi', 'Several products']].map(([k, l]) => chip('inv-filter', k, l, filter === k)).join('') + '</div></div>' +
    '<div class="inv-list" id="inv-list">' + countList(view, t) + '</div>' + (view === 'totals' ? '' : saveBlock(view));
}
/* One count, in the line's unit. Remembers that unit so a later unit change can convert it. */
function putCount(pid, val) {
  const l = findLineOfProduct(pid);
  S.count.units = S.count.units || {}; S.count.per = S.count.per || {};
  if (val == null) { delete S.count.counts[pid]; delete S.count.units[pid]; delete S.count.per[pid]; }
  else { S.count.counts[pid] = Math.max(0, val); if (l) { S.count.units[pid] = l.unit; S.count.per[pid] = snapOf(l, productOf(pid), S.count.counts[pid]); } }
  save('count');
}
function setCount(pid, val, precise) {
  putCount(pid, val == null ? null : (precise ? r6(val) : round2(val)));
  refreshProduct(pid);
}
function showIn(inp, val) {
  if (!inp) return;
  if (document.activeElement !== inp) inp.value = val == null ? '' : fmtNum(val);
  inp.classList.remove('bad'); inp.removeAttribute('aria-invalid');
}
function refreshProduct(pid) {
  const line = findLineOfProduct(pid); if (!line) return;
  const cardEl = document.getElementById('L-' + line.id);
  if (cardEl) {
    const st = lineStat(line, S.count.counts);
    cardEl.className = cardClass(line, st);
    const head = document.getElementById('LH-' + line.id); if (head) head.innerHTML = lineHead(line, st, +head.dataset.lv || 4);
    const amt = document.getElementById('LA-' + line.id); if (amt) amt.innerHTML = amountsHTML(line, totals({ live: roomNow() }), roomNow());
    const v = S.count.counts[pid], p = line.products.find((x) => x.id === pid);
    if (p && perCaseOf(p)) { const s = v == null ? null : splitParts(line, p, v); showIn(document.getElementById('qc-' + pid), s && s.cases); showIn(document.getElementById('ql-' + pid), s && s.loose); }
    else showIn(document.getElementById('q-' + pid), v);
    const row = document.getElementById('P-' + pid); if (row) { row.classList.toggle('done', v != null); const s = row.querySelector('.seen'); if (s && v != null) s.remove(); }
    const qk = document.getElementById('QK-' + pid); if (qk && p) qk.innerHTML = quick(line, p);
  }
  refreshTally();
}
/* The numbers at the top and bottom of a room tab, and the Order tab's count. */
function refreshTally() {
  const prog = document.getElementById('prog'); if (prog) prog.outerHTML = progressHTML();
  const cs = document.getElementById('csave-n'); if (cs) { const p = progress(); cs.textContent = p.counted + ' of ' + p.total; }
  const ob = $('[data-act="go-csub"][data-id="order"]'); if (ob) ob.textContent = orderLabel();
  const it = document.getElementById('istats-n'); if (it) it.textContent = orderList().length;
}
const orderLabel = () => { const n = orderList().length; return 'Order' + (n ? ' (' + n + ')' : ''); };
/* After a line goes on or off the order list, or its amount changes: its button, its stepper, the tallies.
   The button is updated, not redrawn, so focus stays on it. */
function refreshFlag(lineId, focusBtn) {
  const l = lines().find((x) => x.id === lineId); if (!l) return;
  const f = flagOf(l), row = document.getElementById('LF-' + lineId);
  const btn = row && row.querySelector('[data-act="inv-flag"]');
  if (btn) btn.setAttribute('aria-pressed', f ? 'true' : 'false');
  const q2 = document.getElementById('LQ-' + lineId); if (q2) q2.innerHTML = f ? orderStepper(l, f) : '';
  const card = document.getElementById('L-' + lineId); if (card) card.classList.toggle('flagged', !!f);
  if (focusBtn && btn) try { btn.focus(); } catch (e) { /* ignore */ }
  refreshRow(lineId);
  refreshTally();
}

/* ---------- order tab ----------
   The list is the flagged lines, shared by everyone who orders. Nothing lands here on its own. */
function orderRow(o, have) {
  const p = prefProduct(o.l), pd = p ? [p.brand, p.code].filter(Boolean).join(' ') : '', id = esc(o.l.id);
  const meta = [have != null ? esc('have ' + fmtHave(o.l, have)) : '', pd ? esc(pd) : (o.l.products.length > 1 ? '<em>pick which product</em>' : '')].filter(Boolean).join(' · ');
  const qty = ro() ? '<span class="ltotal">' + esc(fmtQty(o.n, o.unit)) + '</span>'
    : '<div class="pctl oqty"><div class="stepper"><button class="step" data-act="ord-dec" data-line="' + id + '" aria-label="Order minus one, ' + esc(o.l.name) + '">−</button><input class="qty" id="oq-' + id + '" data-oline="' + id + '" inputmode="numeric" enterkeyhint="done" autocomplete="off" value="' + esc(fmtNum(o.n)) + '" aria-label="Order amount for ' + esc(o.l.name) + '"><button class="step" data-act="ord-inc" data-line="' + id + '" aria-label="Order plus one, ' + esc(o.l.name) + '">+</button></div><span class="unit">' + esc(unitWord(o.unit, 2)) + '</span></div>';
  return '<div class="orow" id="O-' + id + '"><span class="otick" aria-hidden="true"></span><div class="oinfo"><div class="lname">' + esc(o.l.name) + '</div>' + (meta ? '<div class="lmeta">' + meta + '</div>' : '') + '</div>' + qty + '</div>';
}
function orderTab() {
  const list = orderList(), have = totals({ live: true }).lines;
  let h = openOrdersHTML() + '<p class="hint">' + (ro() ? 'Lines flagged to order show here.' : 'Tap Order on a line in Count to put it on this list. Nothing is added on its own.') + '</p>';
  h += '<h2 class="sub-title go">To order <span class="n">' + list.length + '</span></h2>';
  h += list.length ? '<div class="olist">' + list.map((o) => orderRow(o, have[o.l.id] ? have[o.l.id].sum.v : null)).join('') + '</div>' : empty('Nothing is flagged to order.');
  h += '<h2 class="sub-title">Message for ' + esc(I().messaging || 'team chat') + '</h2><pre class="chit" id="order-text">' + esc(orderText(list)) + '</pre>';
  h += '<div class="row-actions"><button class="btn primary" data-act="ord-copy">' + ICON.copy + ' Copy</button><button class="btn ghost" data-act="ord-share">' + ICON.share + ' Share</button>' + (ro() || !list.length ? '' : '<button class="btn" data-act="order-place">' + ICON.check + ' Order placed</button>') + '</div>';
  if (!ro()) h += '<p class="hint">Order placed files the order in History, where everyone who orders can see it and mark it received, and clears this list.</p>';
  h += '<p class="hint">Counts are saved on Count, one room at a time.</p>';
  return h;
}
/* Show a line's order amount again (after a change), and the message with it. */
function showOrderQty(lineId, force) {
  const l = lines().find((x) => x.id === lineId), f = l ? flagOf(l) : null;
  const inp = document.getElementById('oq-' + lineId); if (inp && f && (force || document.activeElement !== inp)) inp.value = fmtNum(f.n);
  const u = document.getElementById('OU-' + lineId); if (u && f) u.textContent = unitWord(f.unit, f.n);
  const t = $('#order-text'); if (t) t.textContent = orderText(orderList());
  refreshRow(lineId);
}
const NO_FLAG = 'View only: changing the order list needs write access.';
/* Off the list. On Count the line stays, so only its order row changes and focus goes back to its
   Order button; on the Order tab the row goes, so the tab is drawn again. */
function unflag(lineId) {
  setFlag(lineId, false);
  if (document.getElementById('LQ-' + lineId)) refreshFlag(lineId, true); else app.renderView();
  toast('Taken off the order list.');
}
/* Plus or minus one on a flagged line. Minus at 1 takes it off the list. */
function stepFlag(lineId, d) {
  if (ro()) { toast(NO_FLAG); return; }
  const l = lines().find((x) => x.id === lineId), f = l ? flagOf(l) : null;
  if (!f) return;
  if (f.n + d < 1) { unflag(lineId); return; }
  setFlagAmount(lineId, f.n + d); showOrderQty(lineId);
}

/* ---------- history ---------- */
function historyTab() {
  const H = hist();
  if (!H.length) return empty('No saved counts or orders yet. Save a count or place an order from the Order tab and it shows up here.');
  return '<p class="hint">Saved counts and orders from everyone, newest first.</p>' + H.map((e) => {
    const n = Object.keys(e.counts || {}).length, st = orderState(e, H);
    const tag = st !== 'none' ? '<span class="otag o-' + ORDER_CLASS[st] + '">' + esc(orderLine(e, st)) + '</span>' : '';
    return '<details class="hist"><summary><span class="hdate">' + esc(dateOf(e.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })) + '</span><span class="hby">' + esc(e.by || '') + '</span><span class="hsum">' + (isOrder(e) ? 'Order · ' + esc(e.orderCount) + ' item' + (e.orderCount === 1 ? '' : 's') : n + ' products counted' + (e.orderCount ? ' · ' + esc(e.orderCount) + ' to order' : '')) + '</span>' + tag + '</summary>' +
      '<div class="hbody"><pre class="chit">' + esc(e.text || '') + '</pre>' + (st !== 'none' && st !== 'replaced' ? '<div class="row-actions">' + orderButtons(e, st, true) + '</div>' : '') + '<div class="row-actions"><button class="btn small" data-act="hist-copy" data-id="' + esc(e.id) + '">' + ICON.copy + ' Copy</button>' + (ro() ? '' : '<button class="btn small danger" data-act="hist-del" data-id="' + esc(e.id) + '">' + ICON.trash + ' Delete</button>') + '</div></div></details>';
  }).join('');
}

/* ---------- items: the quick-edit ledger ----------
   One dense list: an Order tick, the line, its size and how often it's ordered. Tapping how often
   steps to the next group (setFreq). Tapping the size opens "How it's counted", the same sheet the
   unit on Count opens: stepping through units one tap at a time would pass through units a count
   can't be converted to, and clear it. Tapping a name opens the line's panel: on hand, case size, the
   order amount, and every other field behind More. Rows stay where they are while they're tapped, so
   a how-often can be stepped past a group; they regroup the next time the list is drawn. */
const SORTS = [['often', 'How often'], ['az', 'A to Z'], ['order', 'To order']];
const FREQ_SHORT = { few: 'Few days', week: 'Weekly', month: 'Monthly', none: 'Not regular' };
let isort = 'often', panelLine = null;
const activeOf = (ls) => ls.filter((l) => l.state === 'active');
const pickCount = () => lines().filter((l) => l.state === 'active' && l.products.length > 1 && !prefProduct(l)).length;
/* What the Size cell says: the unit counted in, and the case size. */
function sizeBits(l) {
  const pcs = l.products.map(perCaseOf), n = pcs[0], small = smallUnit(l);
  const bot = !pcs.some(Boolean) ? 'no case size' : !pcs.every((x) => x === n) ? 'sizes vary' : l.unit === 'case' ? fmtNum(n) + ' ' + unitWord(small, n) : fmtNum(n) + ' per case';
  return { top: unitWord(l.unit, 1), bot };
}
/* The line under a name: what's on hand in all, what's on the order, products to pick. */
function subLine(l, row) {
  const bits = [], f = flagOf(l);
  if (row && row.sum.v != null) bits.push('have ' + fmtHave(l, row.sum.v));
  else bits.push(row && PLACES.some(([id]) => row[id].stale) ? 'count again' : 'not counted');
  if (f) bits.push('order ' + fmtQty(f.n, f.unit));
  if (l.products.length > 1) bits.push(l.products.length + ' products' + (l.state === 'active' && !prefProduct(l) ? ', pick one to order' : ''));
  return esc(bits.join(' · '));
}
function freqInner(l) { const f = freqOf(l); return '<span>' + esc(FREQ_SHORT[f]) + '</span><span class="sr">' + esc(': how often ' + l.name + ' is ordered. Tap for the next.') + '</span>'; }
const freqClass = (l) => 'lg-freq' + (freqOf(l) === 'none' ? '' : ' reg');
function ledgerRow(l, t) {
  const id = esc(l.id), on = l.state === 'active', f = on ? flagOf(l) : null, z = sizeBits(l), row = t.lines[l.id];
  const box = '<span class="box">' + ICON.check + '</span>';
  const tick = !on ? '<span class="lg-tick" aria-hidden="true"></span>'
    : ro() ? '<span class="lg-tick" aria-hidden="true">' + (f ? '<span class="box on">' + ICON.check + '</span>' : '') + '</span>'
    : '<button class="lg-tick" id="IT-' + id + '" data-act="inv-flag" data-line="' + id + '" aria-pressed="' + (f ? 'true' : 'false') + '" aria-label="' + esc('Order ' + l.name) + '">' + box + '</button>';
  const name = '<button class="lg-name" id="IN-' + id + '" data-act="item-open" data-id="' + id + '" aria-haspopup="dialog"><span class="iname">' + esc(l.name) + '</span><span class="imeta">' + (on ? '' : stateTag(l.state) + ' ') + subLine(l, row) + '</span></button>';
  const sz = '<span class="sz-u">' + esc(z.top) + '</span><span class="sz-c">' + esc(z.bot) + '</span>';
  const size = ro() ? '<span class="lg-size ro">' + sz + '</span>'
    : '<button class="lg-size" id="IZ-' + id + '" data-act="inv-how" data-line="' + id + '">' + sz + '<span class="sr">' + esc(': how ' + l.name + ' is counted. Tap to change.') + '</span></button>';
  const freq = !on ? '<span class="lg-none" aria-hidden="true"></span>'
    : ro() ? '<span class="' + freqClass(l) + ' ro">' + esc(FREQ_SHORT[freqOf(l)]) + '</span>'
    : '<button class="' + freqClass(l) + '" id="IF-' + id + '" data-act="item-freq" data-line="' + id + '">' + freqInner(l) + '</button>';
  return '<li class="lrow' + (f ? ' flagged' : '') + (on ? '' : ' off') + '" id="I-' + id + '">' + tick + name + size + freq + '</li>';
}
/* The groups for the sort on screen, then the lines off the order sheet, as on Count. */
function ledgerGroups(t) {
  const act = sortLines(activeOf(lines())), rows = (ls) => '<ul class="lg-l">' + ls.map((l) => ledgerRow(l, t)).join('') + '</ul>';
  const group = (key, title, ls) => (ls.length ? '<section class="lg-g" aria-labelledby="LG-' + key + '"><h2 class="fg-h" id="LG-' + key + '">' + esc(title) + ' <span class="fg-n">' + ls.length + (ls.length === 1 ? ' line' : ' lines') + '</span></h2>' + rows(ls) + '</section>' : '');
  let h = '';
  if (isort === 'az') h += group('all', 'On the order sheet', act);
  else if (isort === 'order') h += group('flag', 'On the order list', act.filter((l) => flagOf(l))) + group('noflag', 'Not on the list', act.filter((l) => !flagOf(l)));
  else for (const [fid, fname] of FREQS) h += group(fid, fname, act.filter((l) => freqOf(l) === fid));
  // A status the app doesn't know (a hand edit) goes with the lines off the sheet, so it can still be changed.
  const extra = sortLines(lines().filter((l) => l.state !== 'active' && l.state !== 'disc'));
  if (extra.length) h += '<details class="more"><summary class="band">Not on the order sheet <span class="n">' + extra.length + '</span></summary>' + rows(extra) + '</details>';
  const off = sortLines(lines().filter((l) => l.state === 'disc'));
  if (off.length) h += '<details class="more"><summary class="band">Crossed off the sheet <span class="n">' + off.length + '</span></summary>' + rows(off) + '</details>';
  return h || empty('No lines yet. Add one to a section below.');
}
/* Sections: add, rename, delete when empty, and add a line to one. */
function sectionsHTML() {
  const rows = sections().map((c) => {
    const n = lines().filter((l) => inSection(l, c)).length;
    const acts = ro() || c.missing ? '' : '<span class="isect-a"><button class="btn small ghost" data-act="item-add" data-cat="' + esc(c.id) + '" aria-label="' + esc('Add a line to ' + c.name) + '">' + ICON.plus + ' Add a line</button>' +
      '<button class="icon-b" data-act="cat-rename" data-id="' + esc(c.id) + '" aria-label="' + esc('Rename ' + c.name) + '">' + ICON.pencil + '</button>' +
      (n ? '' : '<button class="icon-b" data-act="cat-del" data-id="' + esc(c.id) + '" aria-label="' + esc('Delete the empty section ' + c.name) + '">' + ICON.trash + '</button>') + '</span>';
    return '<li class="isect"><span class="isect-t"><span class="isect-n">' + esc(c.name) + '</span><span class="isect-c">' + (n ? n + (n === 1 ? ' line' : ' lines') : 'empty') + '</span></span>' + acts + '</li>';
  }).join('');
  return '<section class="isects" aria-labelledby="isects-h"><h2 class="sub-title" id="isects-h">Sections</h2><ul class="isect-l">' + rows + '</ul>' +
    (ro() ? '' : '<div class="row-actions"><button class="btn small" data-act="cat-new">' + ICON.plus + ' New section</button></div><p class="hint">To move a line to another section, tap its name and change it under More.</p>') + '</section>';
}
function itemsTab() {
  const ls = lines(), t = totals({ live: true });
  let h = '<div class="istats"><span><b>' + activeOf(ls).length + '</b> on the order sheet</span><span><b id="istats-n">' + orderList().length + '</b> ticked to order</span><span><b>' + pickCount() + '</b> need one product picked</span></div>';
  h += '<div class="seg-c isort" role="group" aria-label="Sort">' + SORTS.map(([id, label]) => '<button data-act="item-sort" data-id="' + id + '" aria-pressed="' + (id === isort ? 'true' : 'false') + '">' + esc(label) + '</button>').join('') + '</div>';
  h += '<p class="hint lg-hint">' + (ro() ? 'View only. Tap a name to see what’s on hand and what’s on the order.' : 'Tick to order. Tap a size or how often to change it; rows regroup when the sort changes. Tap a name for the rest.') + '</p>';
  h += '<div class="lg-cols" aria-hidden="true"><span>Order</span><span>Item</span><span>Size</span><span>How often</span></div>';
  return h + '<div class="ledger" id="ledger">' + ledgerGroups(t) + '</div>' + sectionsHTML();
}
/* Redraw a row in place (focus stays on whatever had it), and the panel when it's that line's. */
function keepFocus(fn) {
  const a = document.activeElement, id = a && a.id;
  fn();
  if (id && document.activeElement !== a) { const n = document.getElementById(id); if (n) try { n.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
}
function refreshRow(id) {
  const el = document.getElementById('I-' + id); if (!el) return;
  const l = lines().find((x) => x.id === id);
  keepFocus(() => { if (l) el.outerHTML = ledgerRow(l, totals({ live: true })); else el.remove(); });
}
function redrawPanel() {
  if (!panelLine || !isSheetOpen()) return;
  const m = $('#ip-more');
  keepFocus(() => setSheetBody(itemPanel(panelLine, !!(m && m.open))));
}

/* ---------- a line's panel ---------- */
/* What's on hand in each room and in all, from saved counts and this phone's counts in progress. */
function panelHave(l, t) {
  const row = t.lines[l.id]; if (!row) return '';
  return '<dl class="tot">' + PLACES.map(([id, name]) => {
    const r = row[id], room = t.rooms[id];
    return '<div><dt>' + esc(name) + '</dt><dd>' + esc(amtWords(l, r) + (r.live ? ' (counting now, not saved)' : r.v != null && room ? ', counted ' + fmtShort(room.date) : '')) + '</dd></div>';
  }).join('') + '<div class="tsum"><dt>In all</dt><dd>' + esc(row.sum.v != null ? fmtHave(l, row.sum.v) : 'nothing counted yet') + '</dd></div></dl>';
}
/* One case holds N: a stepper on the product's per-case number. Typing works too (saveField). */
function caseRow(l, p, named) {
  const pid = esc(p.id), n = perCaseOf(p), small = unitWord(smallUnit(l), 2), who = p.name || l.name, label = (named ? who + ': ' : '') + 'one case holds';
  if (ro()) return '<p class="ip-case">' + esc((named ? who + ': ' : '') + (n ? 'one case holds ' + fmtNum(n) + ' ' + small : 'no case size set')) + '</p>';
  return '<div class="ip-case"><label class="ip-l" for="ip-pc-' + pid + '">' + esc(label.charAt(0).toUpperCase() + label.slice(1)) + '</label><div class="pctl"><div class="stepper">' +
    '<button class="step" id="ip-pcm-' + pid + '" data-act="pc-step" data-pid="' + pid + '" data-d="-1" aria-label="' + esc('One less ' + unitWord(smallUnit(l), 1) + ' per case, ' + who) + '">−</button>' +
    '<input class="qty" id="ip-pc-' + pid + '" data-pe="perCase" data-pid="' + pid + '" inputmode="numeric" enterkeyhint="done" autocomplete="off" placeholder="–" value="' + (n ? esc(fmtNum(n)) : '') + '">' +
    '<button class="step" id="ip-pcp-' + pid + '" data-act="pc-step" data-pid="' + pid + '" data-d="1" aria-label="' + esc('One more ' + unitWord(smallUnit(l), 1) + ' per case, ' + who) + '">+</button></div><span class="unit">' + esc(small) + '</span></div></div>';
}
/* The whole panel. `more`: whether More starts open. Draws like a screen, so counts in progress are
   brought up to date first, as render() does. */
export function itemPanel(id, more) {
  const l = lines().find((x) => x.id === id);
  if (!l) return empty('That line isn’t there anymore.');
  reconcileUnits();
  const t = totals({ live: true }), on = l.state === 'active', f = on ? flagOf(l) : null;
  let h = '<div class="ipanel"><section aria-labelledby="ip-have-h"><h3 class="ed-h" id="ip-have-h">On hand</h3>' + panelHave(l, t) + '</section>';
  h += '<section aria-labelledby="ip-case-h"><h3 class="ed-h" id="ip-case-h">Case size</h3>' + l.products.map((p) => caseRow(l, p, l.products.length > 1)).join('') + '</section>';
  h += '<section aria-labelledby="ip-ord-h"><h3 class="ed-h" id="ip-ord-h">Order this time</h3>';
  if (!on) h += '<p class="hint">' + esc('Not on the order sheet, so it can’t go on an order.' + (ro() ? '' : ' Change its status under More.')) + '</p>';
  else h += flagRow(l) + (ro() && !f ? '<p class="hint">Not on the order list.</p>' : '');
  h += '</section>';
  if (!ro()) h += '<details class="ip-more" id="ip-more"' + (more ? ' open' : '') + '><summary>More: name, section, status, unit, minimum, products</summary>' + itemEditor(l) + '</details>';
  return h + '</div>';
}
function openPanel(id, more) {
  const l = lines().find((x) => x.id === id); if (!l) return;
  const c = I().cats.find((x) => x.id === l.cat);
  panelLine = id;
  openSheet({ eyebrow: c ? c.name : 'Item', title: l.name, body: itemPanel(id, more), foot: '<button class="btn primary" data-act="sheet-close">Done</button>',
    onClose: () => {
      saveItemField.flush(); panelLine = null; app.renderView();
      const b = document.getElementById('IN-' + id) || document.getElementById('screen-h'); if (b) try { b.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    } });
}
function catSheet(id) {
  const c = id ? I().cats.find((x) => x.id === id) : null;
  if (id && !c) return;
  openSheet({
    eyebrow: c ? 'Rename section' : 'New section', title: c ? c.name : 'New section',
    body: '<div class="form">' + field('cat-name', 'Section name', '<input id="cat-name" value="' + esc(c ? c.name : '') + '" autocomplete="off" enterkeyhint="done">', c ? 'Every line in it moves with it.' : 'Then add lines to it, or move lines into it.') + '</div>',
    foot: '<button class="btn ghost" data-act="sheet-close">Cancel</button><button class="btn primary" data-act="cat-save" data-id="' + esc(id || '') + '">Save</button>',
    onMount: () => { const x = $('#cat-name'); if (x) try { x.focus(); x.select(); } catch (e) { /* ignore */ } }
  });
}
/* Change the unit a line is counted in. Counts in progress and the minimum are converted with the
   per-case number when it says how (cases to their loose unit, or back); otherwise counts in
   progress are cleared rather than misread, and the minimum is flagged to check. */
export function changeUnit(id, to) {
  const l = lines().find((x) => x.id === id);
  if (!l || l.unit === to || UNITS.indexOf(to) < 0) return '';
  reconcileUnits();
  const from = l.unit, small = from === 'case' ? smallUnit(l) : from;
  const fp = (p) => factor(from, to, small, perCaseOf(p));
  const ref = prefProduct(l), pcs = l.products.map(perCaseOf);
  const parF = ref ? fp(ref) : (pcs.every((n) => n === pcs[0]) ? fp(l.products[0]) : null);
  let cleared = false, converted = false;
  l.products.forEach((p) => {
    const v = S.count.counts[p.id]; if (v == null) return;
    const f = fp(p);
    if (f == null) { putCount(p.id, null); cleared = true; } else { S.count.counts[p.id] = r6(v * f); S.count.units[p.id] = to; converted = converted || f !== 1; }
  });
  save('count');
  const oldPar = l.par;
  let newPar = oldPar;
  editLine(id, (x) => {
    x.unit = to;
    if (to === 'case') x.inner = small; else delete x.inner;
    if (x.par != null && parF != null) { x.par = round2(x.par * parF); newPar = x.par; }
  });
  let msg = 'Now counted in ' + unitWord(to, 2) + '.';
  if (oldPar != null) msg += parF != null ? ' Minimum ' + fmtQty(oldPar, from) + ' → ' + fmtQty(newPar, to) + '.' : ' Check the minimum: it reads ' + fmtQty(oldPar, to) + ' now.';
  if (cleared) msg += ' Its count so far was cleared; count it again.';
  else if (converted) msg += ' Counts so far were converted.';
  if (parF == null && pcs.some(Boolean)) msg += ' Check the per-case number too.';
  reconcileUnits(); // the other place's count in progress: converted or cleared the same way
  return msg;
}
/* Unit, loose unit and step: in an item's More and in the "how it's counted" sheet. */
const STEPS = [[0.25, '¼'], [0.5, '½'], [1, '1']];
function unitFields(l, pre) {
  const lid = esc(l.id), id = (k) => pre + '-' + k + '-' + lid;
  return '<div class="field"><label for="' + id('unit') + '">Counted in</label><select id="' + id('unit') + '" data-ie="unit" data-line="' + lid + '">' + opts(UNITS.map((u) => [u, unitWord(u, 2)]), l.unit) + '</select></div>' +
    (l.unit === 'case' ? '<div class="field"><label for="' + id('inner') + '">Loose units</label><select id="' + id('inner') + '" data-ie="inner" data-line="' + lid + '">' + opts(UNITS.filter((u) => u !== 'case').map((u) => [u, unitWord(u, 2)]), smallUnit(l)) + '</select></div>' : '') +
    '<div class="field"><label for="' + id('step') + '">Step</label><select id="' + id('step') + '" data-ie="step" data-line="' + lid + '">' + opts(STEPS, l.step || 1) + '</select></div>';
}
function perCaseField(l, p, pre, named) {
  const pid = esc(p.id), label = (named ? (p.name || l.name) + ': ' : '') + unitWord(smallUnit(l), 2) + ' per case';
  return '<div class="field' + (named ? ' wide' : '') + '"><label for="' + pre + '-pc-' + pid + '">' + esc(label) + '</label><input id="' + pre + '-pc-' + pid + '" data-pe="perCase" data-pid="' + pid + '" inputmode="numeric" placeholder="not set" value="' + esc(p.perCase || '') + '"></div>';
}
/* Every field of a line and its products, behind More in the line's panel. The per-case number is
   above it, under Case size. */
function itemEditor(l) {
  const lid = esc(l.id);
  const lineOpts = lines().map((x) => [x.id, x.name]);
  let h = '<div class="editor flat"><div class="grid2">' +
    '<div class="field wide"><label for="ie-name-' + lid + '">Line name</label><input id="ie-name-' + lid + '" data-ie="name" data-line="' + lid + '" value="' + esc(l.name) + '"></div>' +
    '<div class="field"><label for="ie-par-' + lid + '">Minimum</label><input id="ie-par-' + lid + '" data-ie="par" data-line="' + lid + '" inputmode="decimal" placeholder="none" value="' + (l.par == null ? '' : esc(fmtNum(l.par))) + '"></div>' +
    unitFields(l, 'ie') +
    '<div class="field"><label for="ie-cat-' + lid + '">Section</label><select id="ie-cat-' + lid + '" data-ie="cat" data-line="' + lid + '">' + opts(I().cats.slice().sort(byName).map((c) => [c.id, c.name]), l.cat) + '</select></div>' +
    '<div class="field wide"><label for="ie-state-' + lid + '">Status</label><select id="ie-state-' + lid + '" data-ie="state" data-line="' + lid + '">' + opts(STATES, l.state) + '</select></div>' +
    '<div class="field wide"><label for="ie-note-' + lid + '">Note</label><input id="ie-note-' + lid + '" data-ie="note" data-line="' + lid + '" value="' + esc(l.note || '') + '"></div></div>';
  h += '<h3 class="ed-h">Products <small>' + (l.products.length > 1 ? 'They add up to one amount on hand' : '') + '</small></h3>';
  l.products.forEach((p) => {
    const pid = esc(p.id);
    h += '<div class="pedit"><div class="grid2">' +
      '<div class="field wide"><label for="pe-name-' + pid + '">Product</label><input id="pe-name-' + pid + '" data-pe="name" data-pid="' + pid + '" value="' + esc(p.name || '') + '" placeholder="' + esc(l.name) + '"></div>' +
      '<div class="field"><label for="pe-brand-' + pid + '">Brand</label><input id="pe-brand-' + pid + '" data-pe="brand" data-pid="' + pid + '" value="' + esc(p.brand || '') + '"></div>' +
      '<div class="field"><label for="pe-code-' + pid + '">Item #</label><input id="pe-code-' + pid + '" data-pe="code" data-pid="' + pid + '" value="' + esc(p.code || '') + '" class="mono"></div>' +
      '<div class="field wide"><label for="pe-mv-' + pid + '">Move to line</label><select id="pe-mv-' + pid + '" data-pmove="' + pid + '">' + opts(lineOpts, l.id) + '</select></div>' +
      '<div class="field wide"><label for="pe-note-' + pid + '">Note</label><input id="pe-note-' + pid + '" data-pe="note" data-pid="' + pid + '" value="' + esc(p.note || '') + '"></div></div>' +
      '<div class="row-actions">' + (l.products.length > 1 ? '<label class="check"><input type="radio" name="pref-' + lid + '" data-pref="' + pid + '"' + (p.pref ? ' checked' : '') + '> Order this one</label>' : '') + '<button class="btn small danger" data-act="prod-del" data-pid="' + pid + '">' + ICON.trash + ' Remove product</button></div></div>';
  });
  h += '<div class="row-actions"><button class="btn small" data-act="prod-add" data-line="' + lid + '">' + ICON.plus + ' Add product</button><button class="btn small danger" data-act="item-del" data-id="' + lid + '">Delete line</button></div>';
  if (l.updated) h += '<p class="hint">Last changed ' + esc(fmtShort(l.updated)) + (l.by ? ' by ' + esc(l.by) : '') + '.</p>';
  h += '</div>';
  return h;
}
const stamp = stampLine;
const editLine = (id, fn) => edit('inv', (inv) => { const l = inv.lines.find((x) => x.id === id); if (l) { fn(l, inv); stamp(l); } });
const editProduct = (pid, fn) => edit('inv', (inv) => { for (const l of inv.lines) { const p = l.products.find((x) => x.id === pid); if (p) { fn(p, l, inv); stamp(l); return; } } });
function redrawItem(id) { refreshRow(id); if (panelLine === id) redrawPanel(); }

export function render(route) {
  if (!hasInv()) return empty('No inventory loaded yet. It comes from the inventory repo once you connect. <button class="link inline" data-act="tab" data-id="more">Set up</button>');
  reconcileUnits();
  const sub = route.sub || 'count';
  let h = accessNote() + reviewHTML() + '<div class="view-top">' + seg('go-csub', SUBS.map(([k, l]) => [k, k === 'order' ? orderLabel() : l]), sub === 'totals' ? 'count' : sub) + '<div class="view-acts"><button class="pill-b" data-act="print" data-kind="count">' + ICON.print + ' Sheet</button></div></div>';
  if (sub === 'order') h += orderTab();
  else if (sub === 'history') h += historyTab();
  else if (sub === 'items') h += itemsTab();
  else { shown = sub === 'totals' ? 'totals' : 'room'; h += countTab(curView()); }
  return h;
}

const stepOf = (pid) => { const l = findLineOfProduct(pid); const n = l ? Number(l.step) : 1; return n > 0 ? n : 1; };
function stepBy(pid, d) { const v = S.count.counts[pid]; if (v == null && d < 0) { setCount(pid, 0); return; } setCount(pid, Math.max(0, (v == null ? 0 : v) + d * stepOf(pid))); }
export const acts = {
  'go-csub': (el) => app.go('#count/' + el.dataset.id),
  // A room tab, or Totals. Each room keeps its own count in progress (setRoom in stock.js).
  'count-room': (el) => {
    const id = el.dataset.id; confirmNew = false;
    if (id === 'totals') { app.go('#count/totals'); return; }
    if (!PLACES.some((p) => p[0] === id)) return;
    setRoom(id);
    if (shown === 'totals') { app.go('#count'); return; }
    app.renderView();
    const b = $('[data-act="count-room"][data-id="' + cssEsc(id) + '"]'); if (b) try { b.focus(); } catch (e) { /* ignore */ }
  },
  'inv-filter': (el) => { filter = el.dataset.id; const list = $('#inv-list'); if (list) list.innerHTML = countList(); document.querySelectorAll('[data-act="inv-filter"]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.id === filter)); },
  'inv-step': (el) => stepBy(el.dataset.pid, +el.dataset.d < 0 ? -1 : 1),
  'inv-inc': (el) => stepBy(el.dataset.pid, 1),
  'inv-dec': (el) => stepBy(el.dataset.pid, -1),
  'inv-split': (el) => {
    const pid = el.dataset.pid, l = findLineOfProduct(pid), p = productOf(pid); if (!l || !perCaseOf(p)) return;
    const v = S.count.counts[pid], d = +el.dataset.d < 0 ? -1 : 1;
    if (v == null && d < 0) { setCount(pid, 0); return; }
    const s = v == null ? { cases: 0, loose: 0 } : splitParts(l, p, v);
    if (el.dataset.part === 'c') s.cases = Math.max(0, s.cases + d);
    else s.loose = Math.max(0, round2(s.loose + d * (l.unit === 'case' ? 1 : stepOf(pid))));
    setCount(pid, fromSplit(l, p, s.cases, s.loose), true);
  },
  'inv-how': (el) => { if (ro()) { toast('View only: changing how it’s counted needs write access.'); return; } openHow(el.dataset.line); },
  'cat-new': () => { if (!ro()) catSheet(null); },
  'cat-rename': (el) => { if (!ro()) catSheet(el.dataset.id); },
  'cat-save': (el) => {
    if (ro()) return;
    const inp = $('#cat-name'), name = inp ? inp.value.trim() : '', id = el.dataset.id;
    if (!name) { toast('Type a name first.'); if (inp) inp.focus(); return; }
    edit('inv', (inv) => { if (id) { const c = inv.cats.find((x) => x.id === id); if (c) c.name = name; } else inv.cats.push({ id: uid('cat'), name }); });
    closeSheet(); app.renderView(); toast(id ? 'Renamed.' : 'Section added. It shows on Count once it has a line.');
  },
  'cat-del': (el) => {
    if (ro()) return;
    const id = el.dataset.id;
    if (lines().some((l) => l.cat === id)) { toast('Move its lines to another section first.'); return; }
    if (!armed(el, 'Delete section?')) return;
    edit('inv', (inv) => { inv.cats = inv.cats.filter((c) => c.id !== id); });
    app.renderView(); toast('Section deleted.');
  },
  'inv-same': (el) => setCount(el.dataset.pid, +el.dataset.val, true),
  'inv-clear': (el) => setCount(el.dataset.pid, null),
  // Put a line on the shared order list, or take it off. The button itself is updated, so focus stays on it.
  'inv-flag': (el) => {
    if (ro()) { toast(NO_FLAG); return; }
    const id = el.dataset.line, l = lines().find((x) => x.id === id);
    if (!l || !setFlag(id, !flagOf(l))) return;
    el.setAttribute('aria-pressed', flagOf(l) ? 'true' : 'false');
    refreshFlag(id);
  },
  'ord-inc': (el) => stepFlag(el.dataset.line, 1),
  'ord-dec': (el) => stepFlag(el.dataset.line, -1),
  'ord-copy': async () => { if (await copyText(orderText(orderList()))) toast('Order copied.'); },
  'ord-share': async () => { const r = await shareText(orderText(orderList()), 'Order'); if (r === 'copied') toast('Order copied.'); },
  // Order placed: files the order in History for everyone and clears the flags. Two taps: it empties a shared list.
  'order-place': (el) => {
    if (ro()) { toast('View only: placing an order needs write access. Copy the order instead.'); return; }
    if (!orderList().length) { toast('Nothing is flagged to order.'); return; }
    if (!armed(el, 'Tap again: order placed')) return;
    placeOrder(orderText(orderList()));
    autoSync('save', 800);
    toast('Order filed. The list is clear.'); app.go('#count/history');
  },
  'count-save': () => {
    if (ro()) { toast('View only: saving counts needs write access. Copy the order instead.'); return; }
    reconcileUnits();
    const name = placeName(roomNow());
    if (!saveCount(countText())) { toast('Count something in the ' + name + ' first.'); return; }
    freshCount(); confirmNew = false;
    autoSync('save', 500);
    toast(name + ' count saved. A fresh one is ready.'); app.go('#count/history');
  },
  'count-new': () => { confirmNew = true; app.renderView(); },
  'count-new-no': () => { confirmNew = false; app.renderView(); },
  'count-new-yes': () => { freshCount(); confirmNew = false; toast('Started the ' + placeName(roomNow()) + ' count over.'); app.go('#count'); },
  'hist-copy': async (el) => { const e = hist().find((x) => x.id === el.dataset.id); if (e && await copyText(e.text || '')) toast('Copied.'); },
  'hist-del': (el) => { if (ro()) return; if (!armed(el, 'Delete this count?')) return; edit('counts', (c) => { c.history = (c.history || []).filter((x) => x.id !== el.dataset.id); markGone(c, el.dataset.id); }); autoSync('save', 800); app.renderView(); toast('Deleted.'); },
  'ord-placed': (el) => { setOrder(el.dataset.id, (o) => { o.status = 'placed'; o.placedAt = new Date().toISOString(); o.placedBy = whoAmI(); }); app.renderView(); toast('Marked placed.'); },
  'ord-received': (el) => { setOrder(el.dataset.id, (o) => { o.status = 'received'; o.receivedAt = new Date().toISOString(); o.receivedBy = whoAmI(); }); app.renderView(); toast('Marked received.'); },
  'ord-unplace': (el) => { if (!armed(el, 'Not placed?')) return; setOrder(el.dataset.id, (o) => { o.status = 'saved'; delete o.placedAt; delete o.placedBy; }); app.renderView(); },
  'ord-unreceive': (el) => { if (!armed(el, 'Not received?')) return; setOrder(el.dataset.id, (o) => { o.status = 'placed'; delete o.receivedAt; delete o.receivedBy; }); app.renderView(); },
  'clash-mine': (el) => { dropClash(el.dataset.id); app.renderView(); },
  'clash-theirs': (el) => {
    if (ro()) { toast('View only: nothing to change here.'); return; }
    const c = reviewList().find((x) => x.id === el.dataset.id);
    // Gone: a newer change settled it since this card was drawn (see sync.js). Don't undo that change.
    if (!c) { app.renderView(); toast('That clash is already settled, so nothing was switched.'); return; }
    let done = false;
    edit(c.key, (doc) => { done = setAtPath(doc, c.path, c.theirs); });
    dropClash(c.id); autoSync('save', 800); app.renderView();
    toast(done ? 'Switched to ' + (c.who || 'their') + (c.who ? '’s' : '') + ' version.' : 'That item isn’t there anymore.');
  },
  // Items: a line's panel (read only on a view-only phone), how often, the sort, and the case size.
  'item-open': (el) => openPanel(el.dataset.id),
  'item-freq': (el) => {
    if (ro()) { toast('View only: changing how often needs write access.'); return; }
    const id = el.dataset.line, l = lines().find((x) => x.id === id); if (!l || l.state !== 'active') return;
    const i = FREQS.findIndex((f) => f[0] === freqOf(l)), next = FREQS[(i + 1) % FREQS.length][0];
    if (!setFreq(id, next)) return;
    // The button is updated, not redrawn, so focus stays on it for the next tap.
    el.className = freqClass(l); el.innerHTML = freqInner(l);
    announce(freqName(next));
  },
  'item-sort': (el) => {
    if (!SORTS.some((x) => x[0] === el.dataset.id)) return;
    isort = el.dataset.id;
    const g = $('#ledger'); if (g) g.innerHTML = ledgerGroups(totals({ live: true }));
    document.querySelectorAll('[data-act="item-sort"]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.id === isort ? 'true' : 'false'));
  },
  'pc-step': (el) => {
    if (ro()) return;
    const pid = el.dataset.pid, p = productOf(pid), l = findLineOfProduct(pid); if (!p || !l) return;
    saveItemField.flush();
    const was = perCaseOf(p), n = Math.max(0, was + (+el.dataset.d < 0 ? -1 : 1));
    if (n === was) return;
    editProduct(pid, (x) => { if (n) x.perCase = n; else delete x.perCase; });
    afterUnitEdit(l.id);
  },
  'item-add': (el) => {
    if (ro()) return;
    const id = uid('ln');
    edit('inv', (inv) => { const l = { id, cat: el.dataset.cat, name: 'New item', unit: 'case', step: 1, par: null, state: 'active', note: '', products: [{ id: uid('p'), name: '', brand: '', code: '' }] }; stamp(l); inv.lines.push(l); });
    app.renderView(); openPanel(id, true);
    setTimeout(() => { const n = document.getElementById('ie-name-' + id); if (n) { n.focus(); n.select(); } }, 60);
  },
  'item-del': (el) => {
    if (ro() || !armed(el, 'Delete this line?')) return;
    const id = el.dataset.id; const l = lines().find((x) => x.id === id);
    edit('inv', (inv) => { inv.lines = inv.lines.filter((x) => x.id !== id); }); if (l) l.products.forEach((p) => forgetProduct(p.id));
    if (panelLine === id && isSheetOpen()) closeSheet(); else app.renderView();
    toast('Line deleted.');
  },
  'prod-add': (el) => { if (ro()) return; editLine(el.dataset.line, (l) => { l.products.push({ id: uid('p'), name: '', brand: '', code: '' }); }); redrawItem(el.dataset.line); },
  'prod-del': (el) => { if (ro() || !armed(el, 'Remove?')) return; const l = findLineOfProduct(el.dataset.pid); if (!l) return; if (l.products.length < 2) { toast('A line needs at least one product. Delete the line instead.'); return; } editLine(l.id, (x) => { x.products = x.products.filter((p) => p.id !== el.dataset.pid); }); forgetProduct(el.dataset.pid); redrawItem(l.id); }
};

// The number keypad has digits and a decimal point only, so the hint sticks to those.
const NUM_HELP = 'That isn’t a number this can read. Type a number like 2 or 2.5.';
function saveField(el) {
  if (el.dataset.ie) {
    const k = el.dataset.ie, id = el.dataset.line;
    let v = el.value;
    if (k === 'unit') { const msg = changeUnit(id, v); if (msg) toast(msg, 5000); afterUnitEdit(id); return; }
    if (k === 'par') { v = v.trim() === '' ? null : parseQty(v); if (Number.isNaN(v)) { el.classList.add('bad'); el.setAttribute('aria-invalid', 'true'); toast(NUM_HELP); return; } el.classList.remove('bad'); el.removeAttribute('aria-invalid'); }
    if (k === 'step') v = +v;
    if (k === 'inner' && UNITS.indexOf(v) < 0) return;
    if (k === 'name' && !v.trim()) return;
    editLine(id, (l) => { l[k] = v; });
    if (k === 'cat' || k === 'state') { app.renderView(); redrawPanel(); }
    else if (k === 'inner' || k === 'step') afterUnitEdit(id);
    else { refreshRow(id); if (k === 'name' && panelLine === id) setSheetTitle(v); }
  } else if (el.dataset.pe) {
    const k = el.dataset.pe; let v = el.value.trim();
    if (k === 'perCase') { v = v === '' ? undefined : Math.max(0, parseInt(v, 10) || 0) || undefined; }
    editProduct(el.dataset.pid, (p) => { if (v === undefined || v === '') delete p[k]; else p[k] = v; });
    if (k === 'perCase') { const l = findLineOfProduct(el.dataset.pid); if (l) afterUnitEdit(l.id, true); }
  }
}
const saveItemField = debounce(saveField, 350);
let lastField = null;

/* Redraw what shows how a line is counted: its sheet or its panel if open, and its Items row. A field
   being typed in isn't redrawn, so it keeps focus. */
function afterUnitEdit(id, typing) {
  if (howLine === id && isSheetOpen()) { if (!typing) setSheetBody(howBody(id)); else { const h = $('#how-sum'); const l = lines().find((x) => x.id === id); if (h && l) h.innerHTML = howSummary(l); } }
  else if (panelLine === id && isSheetOpen() && !typing) redrawPanel();
  refreshRow(id);
}

/* ---------- how a line is counted (the sheet behind the unit on the Count tab) ---------- */
let howLine = null;
function howSummary(l) {
  const small = smallUnit(l), withPc = l.products.filter(perCaseOf);
  let h = '<p class="hint">';
  if (withPc.length) h += esc(withPc.length === l.products.length ? 'You count full cases and loose ' + unitWord(small, 2) + ' separately; the app adds them up.' : 'Products with a per-case number are counted as full cases plus loose ' + unitWord(small, 2) + '.');
  else h += esc('Fill in how many ' + unitWord(small, 2) + ' come in a case to count full cases and loose ' + unitWord(small, 2) + ' separately.');
  return h + '</p>';
}
function howBody(id) {
  const l = lines().find((x) => x.id === id);
  if (!l) return empty('That line isn’t there anymore.');
  return '<div class="editor flat"><div class="grid2">' + unitFields(l, 'how') + '</div>' +
    '<h3 class="ed-h">Per case</h3><div class="grid2">' + l.products.map((p) => perCaseField(l, p, 'how', l.products.length > 1)).join('') + '</div>' +
    '<div id="how-sum">' + howSummary(l) + '</div>' +
    '<p class="hint">Changing “Counted in” between cases and the loose unit converts the minimum and anything already counted. Saved for everyone who counts.</p></div>';
}
function openHow(id) {
  const l = lines().find((x) => x.id === id); if (!l) return;
  howLine = id;
  // The screen is drawn again on close, so focus goes back to the same button by its id, if it has one.
  const from = document.activeElement && document.activeElement.id;
  openSheet({ eyebrow: 'How it’s counted', title: l.name, body: howBody(id), foot: '<button class="btn primary" data-act="sheet-close">Done</button>',
    onClose: () => { saveItemField.flush(); howLine = null; app.renderView(); const b = from && document.getElementById(from); if (b) try { b.focus({ preventScroll: true }); } catch (e) { /* ignore */ } } });
}

/* Finish an item edit that's still waiting to be saved (the app is going to the background). */
export function flushEdits() { saveItemField.flush(); }

export function onInput(el, ev) {
  if (el.dataset.search === 'inv') { q = el.value; const list = $('#inv-list'); if (list) list.innerHTML = countList(); return true; }
  if (el.dataset.qty) {
    if (ev.type !== 'change' && ev.type !== 'input') return true;
    const v = parseQty(el.value);
    if (Number.isNaN(v)) { el.classList.add('bad'); el.setAttribute('aria-invalid', 'true'); if (ev.type === 'change') toast(NUM_HELP); return true; }
    el.classList.remove('bad'); el.removeAttribute('aria-invalid');
    putCount(el.dataset.qty, v);
    if (ev.type === 'change') refreshProduct(el.dataset.qty);
    return true;
  }
  if (el.dataset.oline) {
    if (ro()) { toast(NO_FLAG); return true; }
    const id = el.dataset.oline, n = parseInt(el.value, 10), done = ev.type === 'change';
    const l = lines().find((x) => x.id === id), f = l ? flagOf(l) : null;
    if (!f) return true;
    // Each keystroke is saved, so remember what the box held before it was typed in: 12 typed and then
    // deleted must not leave its first digit behind as the amount.
    if (!typedIn || typedIn.id !== id) typedIn = { id, n: f.n };
    const before = typedIn.n;
    if (done) typedIn = null;
    if (n >= 1) setFlagAmount(id, n);
    else if (n === 0 && done) { unflag(id); return true; } // done typing with 0 in the box: off the list
    else setFlagAmount(id, before); // emptied, or unreadable: the amount it had comes back
    showOrderQty(id, done);
    return true;
  }
  if (el.dataset.ie || el.dataset.pe) {
    // Lists save on change, right away. Typing waits a moment; switching to another field saves the last one first.
    if (lastField && lastField !== el) saveItemField.flush();
    lastField = el;
    if (el.tagName === 'SELECT') { if (ev.type === 'change') { saveItemField.flush(); saveField(el); } }
    else saveItemField(el);
    return true;
  }
  if (el.dataset.split) {
    if (ev.type !== 'change' && ev.type !== 'input') return true;
    const pid = el.dataset.pid, l = findLineOfProduct(pid), p = productOf(pid); if (!l || !perCaseOf(p)) return true;
    const typed = parseQty(el.value);
    if (Number.isNaN(typed)) { el.classList.add('bad'); el.setAttribute('aria-invalid', 'true'); if (ev.type === 'change') toast(NUM_HELP); return true; }
    el.classList.remove('bad'); el.removeAttribute('aria-invalid');
    // The other box as it shows on screen (its count may have rolled over while this one is being typed).
    const part = el.dataset.split, v = S.count.counts[pid], cur = v == null ? null : splitParts(l, p, v);
    const otherEl = document.getElementById((part === 'c' ? 'ql-' : 'qc-') + pid);
    let other = otherEl ? parseQty(otherEl.value) : (cur ? (part === 'c' ? cur.loose : cur.cases) : null);
    if (Number.isNaN(other)) other = cur ? (part === 'c' ? cur.loose : cur.cases) : null;
    // Emptying a box never makes a count of zero: with nothing left in the other box either, it's not counted.
    if (typed == null && !other) putCount(pid, null);
    else putCount(pid, fromSplit(l, p, part === 'c' ? (typed || 0) : (other || 0), part === 'l' ? (typed || 0) : (other || 0)));
    if (ev.type === 'change') refreshProduct(pid);
    return true;
  }
  if (el.dataset.pref && ev.type === 'change') { const l = findLineOfProduct(el.dataset.pref); if (l) { editLine(l.id, (x) => { x.products.forEach((p) => { if (p.id === el.dataset.pref) p.pref = true; else delete p.pref; }); }); redrawItem(l.id); toast('Marked to order.'); } return true; }
  if (el.dataset.pmove && ev.type === 'change') {
    const pid = el.dataset.pmove, to = el.value, from = findLineOfProduct(pid);
    if (!from || from.id === to) return true;
    if (from.products.length < 2) { toast('That’s the only product on this line.'); el.value = from.id; return true; }
    edit('inv', (inv) => { const f = inv.lines.find((x) => x.id === from.id), t = inv.lines.find((x) => x.id === to); const i = f.products.findIndex((p) => p.id === pid); const [p] = f.products.splice(i, 1); delete p.pref; t.products.push(p); stamp(f); stamp(t); });
    redrawItem(from.id); redrawItem(to); toast('Moved.'); return true;
  }
  return false;
}
