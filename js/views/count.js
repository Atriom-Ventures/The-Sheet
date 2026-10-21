// Inventory count: count stock against the order sheet, see what to order, keep history.

import { app } from '../app.js';
import { S, I, L, save, edit, hasInv, newCount, signName } from '../state.js';
import { esc, fmtNum, parseQty, round2, fmtShort, dateOf, uid, slug, copyText, shareText, todayKey, $, cssEsc, debounce } from '../util.js';
import { ICON, seg, chip, empty, toast, armed, opts } from '../ui.js';

const UNITS = ['case', 'sleeve', 'long sleeve', 'box', 'can', 'carton', 'bag', 'roll', 'stack', 'each'];
const PLURAL = { case: 'cases', sleeve: 'sleeves', 'long sleeve': 'long sleeves', box: 'boxes', can: 'cans', carton: 'cartons', bag: 'bags', roll: 'rolls', stack: 'stacks', each: 'each' };
const STATES = [['active', 'On the order sheet'], ['disc', 'Crossed off the sheet'], ['ask', 'Not on the sheet: ask first'], ['useup', 'Not on the sheet: use up'], ['remove', 'Not on the sheet: remove']];
const STATE_SHORT = { disc: 'Crossed off', ask: 'Ask first', useup: 'Use up', remove: 'Remove' };
const STATUS_LABEL = { todo: 'Not counted', partial: 'Partly', nopar: 'No min', out: 'Out', low: 'Low', ok: 'OK', plenty: 'Plenty' };
const SUBS = [['count', 'Count'], ['order', 'Order'], ['history', 'History'], ['items', 'Items']];

let filter = 'all', q = '', openItem = null, confirmNew = false;

function unitWord(u, n) { if (u === 'each') return 'each'; if (n != null && n > 0 && n <= 1) return u; return PLURAL[u] || (u + 's'); }
const fmtQty = (n, u) => fmtNum(n) + ' ' + unitWord(u, n);
const lines = () => I().lines;
const catName = (id) => { const c = I().cats.find((x) => x.id === id); return c ? c.name : 'Other'; };
const findLineOfProduct = (pid) => lines().find((l) => l.products.some((p) => p.id === pid));
const hist = () => (L().invHistory || []).slice().sort((a, b) => String(b.savedAt || b.date).localeCompare(String(a.savedAt || a.date)));

export function lineStat(line, counts) {
  let total = 0, n = 0;
  for (const p of line.products) { const v = counts[p.id]; if (v != null) { total += v; n++; } }
  total = round2(total);
  const counted = line.products.length > 0 && n === line.products.length;
  let status;
  if (!counted) status = n ? 'partial' : 'todo';
  else if (line.par == null) status = 'nopar';
  else if (line.par > 0 && total <= 0) status = 'out';
  else if (total < line.par) status = 'low';
  else if (line.par > 0 && total >= line.par * 3) status = 'plenty';
  else status = 'ok';
  return { total, n, counted, status };
}
const prefProduct = (line) => line.products.find((p) => p.pref) || (line.products.length === 1 ? line.products[0] : null);
function suggestOrder(line, st) {
  const short = line.par - st.total, p = prefProduct(line);
  if (p && p.perCase > 0 && line.unit !== 'case') return { n: Math.max(1, Math.ceil(short / p.perCase - 1e-9)), unit: 'case' };
  return { n: Math.max(1, Math.ceil(short - 1e-9)), unit: line.unit };
}
function lastFor(pid) { for (const h of hist()) { if (h.counts && h.counts[pid] != null) return { val: h.counts[pid], date: h.date }; } return null; }
function seenFor(pid) { const s = I().seen; return s && s.items && s.items[pid] ? { text: s.items[pid], date: s.date } : null; }
const activeLines = () => lines().filter((l) => l.state === 'active');
function progress() {
  let counted = 0, low = 0, nopar = 0; const act = activeLines();
  for (const l of act) { const st = lineStat(l, S.count.counts); if (st.counted) counted++; if (st.status === 'low' || st.status === 'out') low++; if (l.par == null) nopar++; }
  return { counted, total: act.length, low, todo: act.length - counted, nopar };
}
function computeOrder() {
  const r = { order: [], plenty: [], nopar: [], pick: [], todo: [], ok: 0, counted: 0, total: 0 };
  for (const l of lines()) {
    if (l.state !== 'active') continue;
    r.total++;
    if (l.products.length > 1 && !l.products.some((p) => p.pref)) r.pick.push(l);
    const st = lineStat(l, S.count.counts);
    if (!st.counted) { r.todo.push(l); continue; }
    r.counted++;
    if (st.status === 'nopar') r.nopar.push({ l, st });
    else if (st.status === 'low' || st.status === 'out') { const sug = suggestOrder(l, st); const ov = S.count.orders[l.id]; r.order.push({ l, st, sug, qty: ov != null ? ov : sug.n }); }
    else if (st.status === 'plenty') r.plenty.push({ l, st });
    else r.ok++;
  }
  return r;
}
function orderText(r) {
  const out = [(I().title || 'Inventory') + ' order · ' + dateOf(S.count.started.slice(0, 10)).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })];
  const by = signName();
  out.push((by ? 'Counted by ' + by + ' · ' : '') + r.counted + ' of ' + r.total + ' items counted', '');
  const ord = r.order.filter((o) => o.qty > 0);
  out.push('ORDER');
  if (!ord.length) out.push(r.counted ? 'Nothing counted is below its minimum.' : 'Nothing counted yet.');
  for (const o of ord) { const p = prefProduct(o.l); const pd = p ? [p.brand, p.code].filter(Boolean).join(' ') : ''; out.push('• ' + o.l.name + ': ' + fmtQty(o.qty, o.sug.unit) + (pd ? ' (' + pd + ')' : '') + ' · have ' + fmtQty(o.st.total, o.l.unit) + ', min ' + fmtQty(o.l.par, o.l.unit)); }
  if (r.plenty.length) { out.push('', "PLENTY ON HAND, DON'T ORDER"); for (const o of r.plenty) out.push('• ' + o.l.name + ': ' + fmtQty(o.st.total, o.l.unit) + ' (min ' + fmtQty(o.l.par, o.l.unit) + ')'); }
  if (r.nopar.length) { out.push('', 'ON HAND, NO MINIMUM SET YET'); for (const o of r.nopar) out.push('• ' + o.l.name + ': ' + fmtQty(o.st.total, o.l.unit)); }
  if (r.todo.length) out.push('', 'NOT COUNTED (' + r.todo.length + ')', r.todo.map((l) => l.name).join(' · '));
  return out.join('\n');
}

/* For the Now screen. */
export function countSummary() {
  if (!hasInv()) return '';
  const p = progress();
  if (!p.counted) return '<button class="glance-b" data-act="go" data-id="#count"><span class="g-k">' + ICON.count + ' Count</span><span class="g-v">Not started</span></button>';
  return '<button class="glance-b" data-act="go" data-id="#count/order"><span class="g-k">' + ICON.count + ' Count</span><span class="g-v">' + p.counted + '/' + p.total + (p.low ? ' · <b class="warn-t">' + p.low + ' low</b>' : '') + '</span></button>';
}

/* ---------- count tab ---------- */
function pill(st) { return '<span class="pill p-' + st.status + '">' + STATUS_LABEL[st.status] + '</span>'; }
function productDesc(line, p, withName) {
  const bits = [];
  if (withName && p.name) bits.push(esc(p.name));
  const bc = [p.brand, p.code].filter(Boolean).join(' '); if (bc) bits.push(esc(bc));
  if (p.perCase) bits.push(p.perCase + ' ' + unitWord(line.unit, 2) + '/case');
  if (p.note) bits.push('<em>' + esc(p.note) + '</em>');
  return bits.join(' · ');
}
function lineHead(line, st) {
  const multi = line.products.length > 1, bits = [], side = [];
  if (line.state === 'active') bits.push(esc(line.par != null ? 'min ' + fmtQty(line.par, line.unit) : 'no min set'));
  if (line.note) bits.push(esc(line.note));
  if (!multi) { const d = productDesc(line, line.products[0], true); if (d) bits.push(d); }
  if (line.state !== 'active') side.push('<span class="tag t-' + line.state + '">' + (STATE_SHORT[line.state] || '') + '</span>');
  if (multi && st.n) side.push('<span class="ltotal">' + esc(fmtQty(st.total, line.unit)) + '</span>');
  if (line.state === 'active') side.push(pill(st));
  const dup = multi ? '<div class="lmeta dup">' + line.products.length + ' products add up here' + (line.state === 'active' && !prefProduct(line) ? '. Pick one to keep ordering.' : '') + '</div>' : '';
  return '<div class="lh-main"><h3 class="lname">' + esc(line.name) + '</h3>' + (bits.length ? '<div class="lmeta">' + bits.join(' · ') + '</div>' : '') + dup + '</div><div class="lh-side">' + side.join('') + '</div>';
}
function quick(line, p) {
  const v = S.count.counts[p.id]; let h = '';
  if (p.perCase) h += '<button class="mini" data-act="inv-case" data-pid="' + esc(p.id) + '">+1 case <b>' + p.perCase + '</b></button>';
  if (v == null) { const last = lastFor(p.id); if (last) h += '<button class="mini" data-act="inv-same" data-pid="' + esc(p.id) + '" data-val="' + last.val + '">Same as ' + fmtShort(last.date) + ': <b>' + esc(fmtNum(last.val)) + '</b></button>'; }
  else h += '<button class="mini ghost" data-act="inv-clear" data-pid="' + esc(p.id) + '">Clear</button>';
  return h;
}
function productRow(line, p, multi) {
  const v = S.count.counts[p.id], seen = seenFor(p.id), label = p.name || line.name;
  return '<div class="prod' + (v != null ? ' done' : '') + '">' +
    (multi ? '<div class="pinfo"><div class="pname">' + esc(label) + (p.pref ? ' <span class="star">★ Order this</span>' : '') + '</div><div class="pmeta">' + productDesc(line, p, false) + '</div></div>' : '') +
    '<div class="pctl"><div class="stepper"><button class="step" data-act="inv-dec" data-pid="' + esc(p.id) + '" aria-label="One less">−</button>' +
    '<input class="qty" id="q-' + esc(p.id) + '" data-qty="' + esc(p.id) + '" inputmode="decimal" enterkeyhint="done" autocomplete="off" value="' + (v == null ? '' : esc(fmtNum(v))) + '" placeholder="–" aria-label="' + esc(label) + ' on hand">' +
    '<button class="step" data-act="inv-inc" data-pid="' + esc(p.id) + '" aria-label="One more">+</button></div><span class="unit">' + esc(unitWord(line.unit, 2)) + '</span></div>' +
    '<div class="quick" id="QK-' + esc(p.id) + '">' + quick(line, p) + '</div>' +
    (seen && !lastFor(p.id) && v == null ? '<div class="seen">In the ' + fmtShort(seen.date) + ' photos: ' + esc(seen.text) + '</div>' : '') + '</div>';
}
function lineCard(line) {
  const st = lineStat(line, S.count.counts), multi = line.products.length > 1;
  return '<article class="line s-' + (line.state === 'active' ? st.status : 'extra') + (multi ? ' multi' : '') + '" id="L-' + esc(line.id) + '"><div class="lh" id="LH-' + esc(line.id) + '">' + lineHead(line, st) + '</div>' + line.products.map((p) => productRow(line, p, multi)).join('') + '</article>';
}
function matches(line) {
  const n = q.trim().toLowerCase();
  if (n && ![line.name, line.note].concat(line.products.flatMap((p) => [p.name, p.brand, p.code])).join(' ').toLowerCase().includes(n)) return false;
  if (filter === 'all') return true;
  const st = lineStat(line, S.count.counts);
  if (filter === 'todo') return line.state === 'active' && !st.counted;
  if (filter === 'low') return st.status === 'low' || st.status === 'out';
  if (filter === 'multi') return line.products.length > 1;
  return true;
}
function progressHTML() {
  const p = progress();
  return '<div class="prog" id="prog"><div class="prog-row"><span class="prog-big">' + p.counted + '</span><span class="prog-of">of ' + p.total + ' counted</span><span class="prog-stats">' + (p.low ? '<b>' + p.low + '</b> low · ' : '') + p.todo + ' to go</span></div><div class="prog-bar"><i style="width:' + (p.total ? p.counted / p.total * 100 : 0).toFixed(1) + '%"></i></div></div>';
}
function countList() {
  let h = '';
  I().cats.forEach((c) => {
    const ls = lines().filter((l) => l.cat === c.id && l.state === 'active' && matches(l));
    if (ls.length) h += '<section class="inv-cat"><h2 class="band">' + esc(c.name) + '</h2><div class="sheet-l">' + ls.map(lineCard).join('') + '</div></section>';
  });
  const extra = lines().filter((l) => ['ask', 'useup', 'remove'].includes(l.state) && matches(l));
  if (extra.length) h += '<details class="more"><summary class="band">Not on the order sheet <span class="n">' + extra.length + '</span></summary><p class="hint">Count these if you like. They never go on an order.</p><div class="sheet-l">' + extra.map(lineCard).join('') + '</div></details>';
  const disc = lines().filter((l) => l.state === 'disc' && matches(l));
  if (disc.length) h += '<details class="more"><summary class="band">Crossed off the sheet <span class="n">' + disc.length + '</span></summary><p class="hint">No longer used. Count what’s left so it gets used up.</p><div class="sheet-l">' + disc.map(lineCard).join('') + '</div></details>';
  return h || empty('No lines match.');
}
function countTab() {
  return progressHTML() + '<div class="tools"><label class="sr" for="inv-q">Search</label><input id="inv-q" class="search-in" type="search" data-search="inv" placeholder="Search items" value="' + esc(q) + '" autocomplete="off">' +
    '<div class="chips">' + [['all', 'All'], ['todo', 'To count'], ['low', 'Low'], ['multi', 'Several products']].map(([k, l]) => chip('inv-filter', k, l, filter === k)).join('') + '</div></div>' +
    '<div class="inv-list" id="inv-list">' + countList() + '</div>';
}
function setCount(pid, val) {
  if (val == null) delete S.count.counts[pid]; else S.count.counts[pid] = Math.max(0, round2(val));
  save('count'); refreshProduct(pid);
}
function refreshProduct(pid) {
  const line = findLineOfProduct(pid); if (!line) return;
  const cardEl = document.getElementById('L-' + line.id);
  if (cardEl) {
    const st = lineStat(line, S.count.counts);
    cardEl.className = 'line s-' + (line.state === 'active' ? st.status : 'extra') + (line.products.length > 1 ? ' multi' : '');
    const head = document.getElementById('LH-' + line.id); if (head) head.innerHTML = lineHead(line, st);
    const v = S.count.counts[pid], inp = document.getElementById('q-' + pid);
    if (inp && document.activeElement !== inp) { inp.value = v == null ? '' : fmtNum(v); }
    if (inp) inp.classList.remove('bad');
    const row = inp && inp.closest('.prod'); if (row) { row.classList.toggle('done', v != null); const s = row.querySelector('.seen'); if (s && v != null) s.remove(); }
    const qk = document.getElementById('QK-' + pid), p = line.products.find((x) => x.id === pid); if (qk && p) qk.innerHTML = quick(line, p);
  }
  const prog = document.getElementById('prog'); if (prog) prog.outerHTML = progressHTML();
  const ob = $('[data-act="go-csub"][data-id="order"]'); if (ob) ob.textContent = orderLabel();
}
const orderLabel = () => { const n = computeOrder().order.filter((o) => o.qty > 0).length; return 'Order' + (n ? ' (' + n + ')' : ''); };

/* ---------- order tab ---------- */
function orderRow(o) {
  const p = prefProduct(o.l), pd = p ? [p.brand, p.code].filter(Boolean).join(' ') : '';
  const extra = pd ? ' · ' + esc(pd) : (o.l.products.length > 1 ? ' · <em>pick which product</em>' : '');
  return '<div class="orow' + (o.qty > 0 ? '' : ' skip') + '" id="O-' + esc(o.l.id) + '"><span class="otick" aria-hidden="true"></span><div class="oinfo"><div class="lname">' + esc(o.l.name) + '</div><div class="lmeta">have ' + esc(fmtQty(o.st.total, o.l.unit)) + ' · min ' + esc(fmtQty(o.l.par, o.l.unit)) + extra + '</div></div>' +
    '<div class="pctl oqty"><div class="stepper"><button class="step" data-act="ord-dec" data-line="' + esc(o.l.id) + '" aria-label="Order one less">−</button><input class="qty" id="oq-' + esc(o.l.id) + '" data-oline="' + esc(o.l.id) + '" inputmode="numeric" enterkeyhint="done" autocomplete="off" value="' + esc(fmtNum(o.qty)) + '" aria-label="Order amount for ' + esc(o.l.name) + '"><button class="step" data-act="ord-inc" data-line="' + esc(o.l.id) + '" aria-label="Order one more">+</button></div><span class="unit">' + esc(unitWord(o.sug.unit, 2)) + '</span></div></div>';
}
const simpleRow = (name, value, small) => '<div class="srow2"><span>' + esc(name) + '</span><span class="v">' + esc(value) + (small ? '<small>' + esc(small) + '</small>' : '') + '</span></div>';
function orderTab() {
  const r = computeOrder();
  let h = '<p class="hint">' + r.counted + ' of ' + r.total + ' items counted. Anything below its minimum lands here with a suggested amount you can change.</p>';
  h += '<h3 class="sub-title go">To order <span class="n">' + r.order.length + '</span></h3>';
  if (!r.counted) h += empty('Nothing counted yet. Count on the Count tab and anything below its minimum shows up here.');
  else if (!r.order.length) h += empty('Nothing counted so far is below its minimum.');
  else h += '<div class="olist">' + r.order.map(orderRow).join('') + '</div>';
  if (r.plenty.length) h += '<h3 class="sub-title">Plenty on hand, don’t order <span class="n">' + r.plenty.length + '</span></h3><p class="hint">Three times the minimum or more.</p><div class="olist">' + r.plenty.map((o) => simpleRow(o.l.name, fmtQty(o.st.total, o.l.unit), 'min ' + fmtQty(o.l.par, o.l.unit))).join('') + '</div>';
  if (r.nopar.length) h += '<h3 class="sub-title">Counted, no minimum yet <span class="n">' + r.nopar.length + '</span></h3><p class="hint">Set a minimum in Items and they’ll be ordered automatically next time.</p><div class="olist">' + r.nopar.map((o) => simpleRow(o.l.name, fmtQty(o.st.total, o.l.unit))).join('') + '</div>';
  if (r.pick.length) h += '<h3 class="sub-title">Pick one product to reorder <span class="n">' + r.pick.length + '</span></h3><p class="hint">More than one product counts toward each of these. In Items, mark the one to keep buying with “Order this one”.</p><div class="olist">' + r.pick.map((l) => simpleRow(l.name, l.products.length + ' products')).join('') + '</div>';
  h += '<h3 class="sub-title">Message for ' + esc(I().messaging || 'team chat') + '</h3><pre class="chit" id="order-text">' + esc(orderText(r)) + '</pre>';
  h += '<div class="row-actions"><button class="btn primary" data-act="ord-copy">' + ICON.copy + ' Copy</button><button class="btn ghost" data-act="ord-share">' + ICON.share + ' Share</button><button class="btn" data-act="count-save">' + ICON.check + ' Save count</button></div>';
  h += '<p class="hint">Save count adds it to History (synced to your book) and starts a fresh count.</p>';
  if (r.todo.length) h += '<details class="todo-list"><summary>Not counted yet (' + r.todo.length + ')</summary><p>' + r.todo.map((l) => esc(l.name)).join(' · ') + '</p></details>';
  h += confirmNew ? '<div class="confirm"><p>Clear every count in progress and start over? Saved counts stay in History.</p><div class="row-actions"><button class="btn" data-act="count-new-no">Keep counting</button><button class="btn danger solid" data-act="count-new-yes">Clear and start over</button></div></div>' : '<p><button class="link" data-act="count-new">Start a new count</button></p>';
  return h;
}
function setOrderQty(lineId, n) {
  S.count.orders[lineId] = Math.max(0, Math.round(n)); save('count');
  const inp = document.getElementById('oq-' + lineId); if (inp && document.activeElement !== inp) inp.value = fmtNum(S.count.orders[lineId]);
  const row = document.getElementById('O-' + lineId); if (row) row.classList.toggle('skip', S.count.orders[lineId] === 0);
  const t = $('#order-text'); if (t) t.textContent = orderText(computeOrder());
}

/* ---------- history ---------- */
function historyTab() {
  const H = hist();
  if (!H.length) return empty('No saved counts yet. Save one from the Order tab and it shows up here.');
  return '<p class="hint">Saved counts, newest first. They sync to your book.</p>' + H.map((e) => {
    const n = Object.keys(e.counts || {}).length;
    return '<details class="hist"><summary><span class="hdate">' + esc(dateOf(e.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })) + '</span><span class="hby">' + esc(e.by || '') + '</span><span class="hsum">' + n + ' products counted' + (e.orderCount ? ' · ' + e.orderCount + ' to order' : '') + '</span></summary>' +
      '<div class="hbody"><pre class="chit">' + esc(e.text || '') + '</pre><div class="row-actions"><button class="btn small" data-act="hist-copy" data-id="' + esc(e.id) + '">' + ICON.copy + ' Copy</button><button class="btn small danger" data-act="hist-del" data-id="' + esc(e.id) + '">' + ICON.trash + ' Delete</button></div></div></details>';
  }).join('');
}

/* ---------- items (edit lines and products) ---------- */
function itemsTab() {
  const ls = lines();
  const nopar = ls.filter((l) => l.state === 'active' && l.par == null).length, pick = ls.filter((l) => l.state === 'active' && l.products.length > 1 && !l.products.some((p) => p.pref)).length;
  let h = '<div class="istats"><span><b>' + ls.filter((l) => l.state === 'active').length + '</b> active lines</span><span><b>' + nopar + '</b> without a minimum</span><span><b>' + pick + '</b> need one product picked</span></div>';
  I().cats.forEach((c) => {
    const cl = ls.filter((l) => l.cat === c.id); if (!cl.length) return;
    h += '<section class="inv-cat"><h2 class="band">' + esc(c.name) + '</h2><div class="sheet-l">' + cl.map((l) => itemRow(l)).join('') + '<button class="add-line" data-act="item-add" data-cat="' + esc(c.id) + '">' + ICON.plus + ' Add a line to ' + esc(c.name) + '</button></div></section>';
  });
  return h;
}
function itemRow(l) {
  const open = openItem === l.id;
  const meta = [l.par != null ? 'min ' + fmtQty(l.par, l.unit) : 'no min', l.products.length > 1 ? l.products.length + ' products' : ''].filter(Boolean).join(' · ');
  return '<div class="irow' + (open ? ' open' : '') + '" id="I-' + esc(l.id) + '"><button class="isum" data-act="item-open" data-id="' + esc(l.id) + '" aria-expanded="' + open + '"><span class="iname">' + esc(l.name) + '</span><span class="imeta">' + esc(meta) + '</span>' + (l.state !== 'active' ? '<span class="tag t-' + l.state + '">' + STATE_SHORT[l.state] + '</span>' : '') + '</button>' + (open ? itemEditor(l) : '') + '</div>';
}
function itemEditor(l) {
  const lid = esc(l.id);
  const lineOpts = lines().map((x) => [x.id, x.name]);
  let h = '<div class="editor"><div class="grid2">' +
    '<div class="field wide"><label for="ie-name-' + lid + '">Line name</label><input id="ie-name-' + lid + '" data-ie="name" data-line="' + lid + '" value="' + esc(l.name) + '"></div>' +
    '<div class="field"><label for="ie-par-' + lid + '">Minimum</label><input id="ie-par-' + lid + '" data-ie="par" data-line="' + lid + '" inputmode="decimal" placeholder="none" value="' + (l.par == null ? '' : esc(fmtNum(l.par))) + '"></div>' +
    '<div class="field"><label for="ie-unit-' + lid + '">Counted in</label><select id="ie-unit-' + lid + '" data-ie="unit" data-line="' + lid + '">' + opts(UNITS.map((u) => [u, unitWord(u, 2)]), l.unit) + '</select></div>' +
    '<div class="field"><label for="ie-step-' + lid + '">Step</label><select id="ie-step-' + lid + '" data-ie="step" data-line="' + lid + '">' + opts([[0.25, '¼'], [0.5, '½'], [1, '1']], l.step || 1) + '</select></div>' +
    '<div class="field"><label for="ie-cat-' + lid + '">Section</label><select id="ie-cat-' + lid + '" data-ie="cat" data-line="' + lid + '">' + opts(I().cats.map((c) => [c.id, c.name]), l.cat) + '</select></div>' +
    '<div class="field wide"><label for="ie-state-' + lid + '">Status</label><select id="ie-state-' + lid + '" data-ie="state" data-line="' + lid + '">' + opts(STATES, l.state) + '</select></div>' +
    '<div class="field wide"><label for="ie-note-' + lid + '">Note</label><input id="ie-note-' + lid + '" data-ie="note" data-line="' + lid + '" value="' + esc(l.note || '') + '"></div></div>';
  h += '<h4>Products <small>' + (l.products.length > 1 ? 'They add up toward one minimum' : '') + '</small></h4>';
  l.products.forEach((p) => {
    const pid = esc(p.id);
    h += '<div class="pedit"><div class="grid2">' +
      '<div class="field wide"><label for="pe-name-' + pid + '">Product</label><input id="pe-name-' + pid + '" data-pe="name" data-pid="' + pid + '" value="' + esc(p.name || '') + '" placeholder="' + esc(l.name) + '"></div>' +
      '<div class="field"><label for="pe-brand-' + pid + '">Brand</label><input id="pe-brand-' + pid + '" data-pe="brand" data-pid="' + pid + '" value="' + esc(p.brand || '') + '"></div>' +
      '<div class="field"><label for="pe-code-' + pid + '">Item #</label><input id="pe-code-' + pid + '" data-pe="code" data-pid="' + pid + '" value="' + esc(p.code || '') + '" class="mono"></div>' +
      '<div class="field"><label for="pe-pc-' + pid + '">' + esc(unitWord(l.unit, 2)) + ' per case</label><input id="pe-pc-' + pid + '" data-pe="perCase" data-pid="' + pid + '" inputmode="numeric" value="' + (p.perCase || '') + '"></div>' +
      '<div class="field"><label for="pe-mv-' + pid + '">Move to line</label><select id="pe-mv-' + pid + '" data-pmove="' + pid + '">' + opts(lineOpts, l.id) + '</select></div>' +
      '<div class="field wide"><label for="pe-note-' + pid + '">Note</label><input id="pe-note-' + pid + '" data-pe="note" data-pid="' + pid + '" value="' + esc(p.note || '') + '"></div></div>' +
      '<div class="row-actions">' + (l.products.length > 1 ? '<label class="check"><input type="radio" name="pref-' + lid + '" data-pref="' + pid + '"' + (p.pref ? ' checked' : '') + '> Order this one</label>' : '') + '<button class="btn small danger" data-act="prod-del" data-pid="' + pid + '">' + ICON.trash + ' Remove product</button></div></div>';
  });
  h += '<div class="row-actions"><button class="btn small" data-act="prod-add" data-line="' + lid + '">' + ICON.plus + ' Add product</button><button class="btn small danger" data-act="item-del" data-id="' + lid + '">Delete line</button></div></div>';
  return h;
}
const editLine = (id, fn) => edit('inv', (inv) => { const l = inv.lines.find((x) => x.id === id); if (l) fn(l, inv); });
const editProduct = (pid, fn) => edit('inv', (inv) => { for (const l of inv.lines) { const p = l.products.find((x) => x.id === pid); if (p) { fn(p, l, inv); return; } } });
function redrawItem(id) { const el = document.getElementById('I-' + id); const l = lines().find((x) => x.id === id); if (el && l) el.outerHTML = itemRow(l); }

export function render(route) {
  if (!hasInv()) return empty('No inventory loaded yet. It comes from your book repo. <button class="link inline" data-act="tab" data-id="more">Set up</button>');
  const sub = route.sub || 'count';
  let h = '<div class="view-top">' + seg('go-csub', SUBS.map(([k, l]) => [k, k === 'order' ? orderLabel() : l]), sub) + '<div class="view-acts"><button class="pill-b" data-act="print" data-kind="count">' + ICON.print + ' Sheet</button></div></div>';
  if (sub === 'order') h += orderTab();
  else if (sub === 'history') h += historyTab();
  else if (sub === 'items') h += itemsTab();
  else h += countTab();
  return h;
}

const stepOf = (pid) => { const l = findLineOfProduct(pid); return l && l.step ? l.step : 1; };
export const acts = {
  'go-csub': (el) => app.go('#count/' + el.dataset.id),
  'inv-filter': (el) => { filter = el.dataset.id; const list = $('#inv-list'); if (list) list.innerHTML = countList(); document.querySelectorAll('[data-act="inv-filter"]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.id === filter)); },
  'inv-inc': (el) => { const pid = el.dataset.pid, v = S.count.counts[pid]; setCount(pid, (v == null ? 0 : v) + stepOf(pid)); },
  'inv-dec': (el) => { const pid = el.dataset.pid, v = S.count.counts[pid]; if (v == null) { setCount(pid, 0); return; } setCount(pid, Math.max(0, v - stepOf(pid))); },
  'inv-case': (el) => { const pid = el.dataset.pid, l = findLineOfProduct(pid), p = l && l.products.find((x) => x.id === pid); if (!p) return; const v = S.count.counts[pid]; setCount(pid, (v == null ? 0 : v) + (+p.perCase || 0)); },
  'inv-same': (el) => setCount(el.dataset.pid, +el.dataset.val),
  'inv-clear': (el) => setCount(el.dataset.pid, null),
  'ord-inc': (el) => { const r = computeOrder().order.find((o) => o.l.id === el.dataset.line); if (r) setOrderQty(r.l.id, r.qty + 1); },
  'ord-dec': (el) => { const r = computeOrder().order.find((o) => o.l.id === el.dataset.line); if (r) setOrderQty(r.l.id, Math.max(0, r.qty - 1)); },
  'ord-copy': async () => { if (await copyText(orderText(computeOrder()))) toast('Order copied.'); },
  'ord-share': async () => { const r = await shareText(orderText(computeOrder()), 'Order'); if (r === 'copied') toast('Order copied.'); },
  'count-save': () => {
    const r = computeOrder();
    if (!Object.keys(S.count.counts).length) { toast('Count something first.'); return; }
    const entry = { id: uid('h'), date: todayKey(), savedAt: new Date().toISOString(), by: signName(), counts: Object.assign({}, S.count.counts), orders: Object.assign({}, S.count.orders), orderCount: r.order.filter((o) => o.qty > 0).length, text: orderText(r), updated: todayKey() };
    edit('state', (s) => { s.invHistory = (s.invHistory || []).concat([entry]); });
    S.count = newCount(); save('count'); confirmNew = false;
    toast('Count saved. A fresh count is ready.'); app.go('#count/history');
  },
  'count-new': () => { confirmNew = true; app.renderView(); },
  'count-new-no': () => { confirmNew = false; app.renderView(); },
  'count-new-yes': () => { S.count = newCount(); save('count'); confirmNew = false; toast('Started a new count.'); app.go('#count'); },
  'hist-copy': async (el) => { const e = hist().find((x) => x.id === el.dataset.id); if (e && await copyText(e.text || '')) toast('Copied.'); },
  'hist-del': (el) => { if (!armed(el, 'Delete this count?')) return; edit('state', (s) => { s.invHistory = s.invHistory.filter((x) => x.id !== el.dataset.id); }); app.renderView(); toast('Deleted.'); },
  'item-open': (el) => { const prev = openItem; openItem = openItem === el.dataset.id ? null : el.dataset.id; if (prev) redrawItem(prev); redrawItem(el.dataset.id); },
  'item-add': (el) => { const id = uid('ln'); edit('inv', (inv) => { inv.lines.push({ id, cat: el.dataset.cat, name: 'New item', unit: 'case', step: 1, par: null, state: 'active', note: '', products: [{ id: uid('p'), name: '', brand: '', code: '' }] }); }); openItem = id; app.renderView(); setTimeout(() => { const n = document.getElementById('ie-name-' + id); if (n) { n.focus(); n.select(); } }, 60); },
  'item-del': (el) => { if (!armed(el, 'Delete this line?')) return; const id = el.dataset.id; const l = lines().find((x) => x.id === id); edit('inv', (inv) => { inv.lines = inv.lines.filter((x) => x.id !== id); }); if (l) l.products.forEach((p) => delete S.count.counts[p.id]); save('count'); openItem = null; app.renderView(); toast('Line deleted.'); },
  'prod-add': (el) => { editLine(el.dataset.line, (l) => { l.products.push({ id: uid('p'), name: '', brand: '', code: '' }); }); redrawItem(el.dataset.line); },
  'prod-del': (el) => { if (!armed(el, 'Remove?')) return; const l = findLineOfProduct(el.dataset.pid); if (!l) return; if (l.products.length < 2) { toast('A line needs at least one product. Delete the line instead.'); return; } editLine(l.id, (x) => { x.products = x.products.filter((p) => p.id !== el.dataset.pid); }); delete S.count.counts[el.dataset.pid]; save('count'); redrawItem(l.id); }
};

const saveItemField = debounce((el) => {
  if (el.dataset.ie) {
    const k = el.dataset.ie, id = el.dataset.line;
    let v = el.value;
    if (k === 'par') { v = v.trim() === '' ? null : parseQty(v); if (Number.isNaN(v)) { el.classList.add('bad'); return; } el.classList.remove('bad'); }
    if (k === 'step') v = +v;
    if (k === 'name' && !v.trim()) return;
    editLine(id, (l) => { l[k] = v; });
    if (k === 'cat' || k === 'state') { app.renderView(); }
    else { const s = document.querySelector('#I-' + cssEsc(id) + ' .imeta'); const l = lines().find((x) => x.id === id); if (s && l) s.textContent = [l.par != null ? 'min ' + fmtQty(l.par, l.unit) : 'no min', l.products.length > 1 ? l.products.length + ' products' : ''].filter(Boolean).join(' · '); const nm = document.querySelector('#I-' + cssEsc(id) + ' .iname'); if (nm && k === 'name') nm.textContent = v; }
  } else if (el.dataset.pe) {
    const k = el.dataset.pe; let v = el.value.trim();
    if (k === 'perCase') { v = v === '' ? undefined : Math.max(0, parseInt(v, 10) || 0) || undefined; }
    editProduct(el.dataset.pid, (p) => { if (v === undefined || v === '') delete p[k]; else p[k] = v; });
  }
}, 350);

export function onInput(el, ev) {
  if (el.dataset.search === 'inv') { q = el.value; const list = $('#inv-list'); if (list) list.innerHTML = countList(); return true; }
  if (el.dataset.qty) {
    if (ev.type !== 'change' && ev.type !== 'input') return true;
    const v = parseQty(el.value);
    if (Number.isNaN(v)) { el.classList.add('bad'); return true; }
    el.classList.remove('bad');
    if (v == null) delete S.count.counts[el.dataset.qty]; else S.count.counts[el.dataset.qty] = Math.max(0, v);
    save('count');
    if (ev.type === 'change') refreshProduct(el.dataset.qty);
    return true;
  }
  if (el.dataset.oline) { const n = parseInt(el.value, 10); if (!Number.isNaN(n)) setOrderQty(el.dataset.oline, n); return true; }
  if (el.dataset.ie || el.dataset.pe) { saveItemField(el); return true; }
  if (el.dataset.pref && ev.type === 'change') { const l = findLineOfProduct(el.dataset.pref); if (l) { editLine(l.id, (x) => { x.products.forEach((p) => { if (p.id === el.dataset.pref) p.pref = true; else delete p.pref; }); }); toast('Marked to order.'); } return true; }
  if (el.dataset.pmove && ev.type === 'change') {
    const pid = el.dataset.pmove, to = el.value, from = findLineOfProduct(pid);
    if (!from || from.id === to) return true;
    if (from.products.length < 2) { toast('That’s the only product on this line.'); el.value = from.id; return true; }
    edit('inv', (inv) => { const f = inv.lines.find((x) => x.id === from.id), t = inv.lines.find((x) => x.id === to); const i = f.products.findIndex((p) => p.id === pid); const [p] = f.products.splice(i, 1); delete p.pref; t.products.push(p); });
    redrawItem(from.id); redrawItem(to); toast('Moved.'); return true;
  }
  return false;
}
