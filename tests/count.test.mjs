// The order list and its amounts, the two places and what's on hand across them, and how the Count
// screens show what's in the shared files. Uses the made-up sample data in tests/fixtures; no GitHub needed.
import path from 'node:path';
import { makePhone, checker } from './lib/phone.mjs';
import { invPhone, fixture } from './lib/fixtures.mjs';

const T = checker();
const check = T.check;

/* ---------- browser stubs ---------- */
const el = () => ({ classList: { add() {}, remove() {}, toggle() {} }, dataset: {}, style: {}, setAttribute() {}, removeAttribute() {}, remove() {}, querySelector: () => null, closest: () => null, appendChild() {}, innerHTML: '', textContent: '', value: '' });
globalThis.window = globalThis;
globalThis.document = { querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, createElement: el, body: el(), activeElement: null, contains: () => false, addEventListener() {} };
globalThis.addEventListener = () => {};
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: 'test', platform: 'Linux', maxTouchPoints: 0, onLine: false, storage: null } });
globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
globalThis.requestAnimationFrame = (f) => setTimeout(f, 0);
globalThis.location = { hash: '' };
globalThis.fetch = async () => { throw new TypeError('offline'); };

async function phone(name, mem) {
  const dir = makePhone(name);
  globalThis['__mem_' + name] = mem;
  const st = await import(path.join(dir, 'js/state.js'));
  const app = (await import(path.join(dir, 'js/app.js'))).app;
  const count = await import(path.join(dir, 'js/views/count.js'));
  const stock = await import(path.join(dir, 'js/stock.js'));
  app.register(count);
  app.route = { tab: 'count', sub: '', id: '' };
  await st.load();
  const fake = (data, value) => ({ dataset: data, value, disabled: false, innerHTML: '', textContent: '', classList: { add() {}, remove() {} }, setAttribute() {}, removeAttribute() {} });
  return {
    st, S: st.S, count, stock,
    act: (a, data = {}) => app.acts[a](fake(data, '')),
    type: (data, value, type) => count.onInput(fake(data, value), { type })
  };
}
const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
/* The order message as it would be copied to team chat, and one item's line in it. */
const orderMsg = (P) => unesc((/<pre class="chit" id="order-text">([\s\S]*?)<\/pre>/.exec(P.count.render({ sub: 'order' })) || [])[1] || '');
const lineOf = (P, name) => orderMsg(P).split('\n').find((l) => l.startsWith('• ' + name)) || '(not on the order)';

console.log('\n1. Orders are flagged by hand, and an amount keeps its unit');
const P = await phone('Ord', invPhone()); // count in progress: cups 2, lids 0, napkins ½; tea is flagged
check(lineOf(P, 'Cup lids') === '(not on the order)' && /^• Tea, assorted: 2 boxes/.test(lineOf(P, 'Tea, assorted')), 'nothing goes on the order by itself: 0 lids on hand under a minimum of 3 isn’t ordered, the flagged tea is');
check(!/min \d|no min set|>Low<|>Plenty<|>No min</.test(P.count.render({ sub: 'count' }) + P.count.render({ sub: 'order' })), 'Count and Order show no minimums');
P.act('inv-flag', { line: 'ln-lids' });
check(/^• Cup lids: 1 sleeve .*have 0 sleeves/.test(lineOf(P, 'Cup lids')), 'Order on a line puts it on the list, for 1: ' + lineOf(P, 'Cup lids'));
for (let i = 0; i < 3; i++) P.act('ord-inc', { line: 'ln-lids' });
check(/^• Cup lids: 4 sleeves /.test(lineOf(P, 'Cup lids')), 'bumped by hand to 4 sleeves');
P.st.edit('inv', (inv) => { inv.lines.find((l) => l.id === 'ln-lids').products[0].perCase = 20; }); // e.g. synced from the other phone
const lidsNow = lineOf(P, 'Cup lids');
check(!/4 cases/.test(lidsNow) && /^• Cup lids: 1 case /.test(lidsNow), 'once lids are ordered by the case (20 a case), the 4 isn’t read as 4 cases: ' + lidsNow);
P.act('ord-inc', { line: 'ln-lids' });
P.S.count.counts['p-lids'] = 1; // recounted
check(/^• Cup lids: 2 cases /.test(lineOf(P, 'Cup lids')), 'a hand-set amount stays while its unit stays the same');
P.act('inv-flag', { line: 'ln-cocoa' });
check(lineOf(P, 'Hot cocoa') === '(not on the order)', 'a line that’s off the order sheet can’t be flagged');
P.act('inv-flag', { line: 'ln-lids' });
check(lineOf(P, 'Cup lids') === '(not on the order)', 'Order again takes it off the list');

console.log('\n2. Typing in an order box');
P.act('inv-flag', { line: 'ln-coffee' }); P.act('ord-inc', { line: 'ln-coffee' });
check(/^• Coffee, regular: 2 cases /.test(lineOf(P, 'Coffee, regular')), '(setup: coffee flagged for 2 cases)');
for (const v of ['1', '12', '1', '']) P.type({ oline: 'ln-coffee' }, v, 'input'); // typed 12, then deleted it
P.type({ oline: 'ln-coffee' }, '', 'change');
check(/^• Coffee, regular: 2 cases /.test(lineOf(P, 'Coffee, regular')), 'a box left empty goes back to the amount it had, not a leftover digit: ' + lineOf(P, 'Coffee, regular'));
P.type({ oline: 'ln-coffee' }, '5', 'input'); P.type({ oline: 'ln-coffee' }, '5', 'change');
check(/^• Coffee, regular: 5 cases /.test(lineOf(P, 'Coffee, regular')), 'a typed amount is kept');
P.type({ oline: 'ln-coffee' }, '0', 'change');
check(!orderMsg(P).includes('• Coffee, regular'), '0 means don’t order it');

console.log('\n3. Text from the shared files is shown as text');
const MARK = '<u>MARK</u>';
const inv = fixture('inventory.json');
const line = (id) => inv.lines.find((l) => l.id === id);
line('ln-cups').products[0].perCase = '20' + MARK;
line('ln-lids').unit = 'sleeve' + MARK; line('ln-lids').products[0].perCase = 6;
line('ln-cocoa').state = 'useup' + MARK;
line('ln-coffee').flag = { n: '2' + MARK, unit: 'case' + MARK, at: new Date().toISOString(), by: 'B' + MARK }; line('ln-coffee').freq = 'week' + MARK;
line('ln-tea').unit = 'box' + MARK; line('ln-tea').flag = { n: 3, unit: 'box' + MARK, at: new Date().toISOString() + MARK, by: MARK }; // ordered in a unit with markup in it
const nowIso = new Date().toISOString(), today = nowIso.slice(0, 10);
const counts = { schema: 1, updated: today, history: [{ id: 'h-odd', date: today, savedAt: nowIso, by: 'BB', counts: { 'p-lids': '1' + MARK }, orders: {}, orderCount: '2' + MARK, text: 'x', order: { status: 'saved' }, updated: today },
  { id: 'h-odd-k', date: today, savedAt: nowIso, by: 'B' + MARK, place: 'kitchen', counts: { 'p-coffee': '1' + MARK, 'p-tea': 2 }, units: { 'p-coffee': 'case' + MARK, 'p-tea': 'box' }, per: { 'p-tea': '6' + MARK }, orderCount: 0, text: 'x' + MARK, updated: today },
  { id: 'o-odd', kind: 'order', date: today, savedAt: nowIso, by: 'B' + MARK, lines: [{ line: 'ln-tea' + MARK, name: 'Tea' + MARK, n: '2' + MARK, unit: 'box' + MARK }], orderCount: '1' + MARK, text: 'x' + MARK, order: { status: 'placed', placedAt: nowIso, placedBy: 'B' + MARK }, updated: today }] };
const slot = (doc) => ({ base: JSON.parse(JSON.stringify(doc)), local: JSON.parse(JSON.stringify(doc)), sha: 'x', src: 'id:1' });
const Q = await phone('Odd', Object.assign(invPhone(), { inv: slot(inv), counts: slot(counts), count: { id: 'c', started: nowIso, counts: {}, orders: {} } }));
check(Q.stock.orderList().length === 2, '(setup: two lines flagged, with markup in the amount, unit and name)');
const screens = { Count: Q.count.render({ sub: 'count' }), Totals: Q.count.render({ sub: 'totals' }), Order: Q.count.render({ sub: 'order' }), History: Q.count.render({ sub: 'history' }) };
Q.stock.setRoom('kitchen'); screens['Count, second room'] = Q.count.render({ sub: 'count' }); Q.stock.setRoom('servery');
check(/Counted [^<]*by B&lt;u&gt;/.test(screens.Totals) && /id="oq-ln-coffee"/.test(screens.Count), '(setup: Totals shows who counted, and a flagged line’s stepper is on Count)');
Q.act('item-open', { id: 'ln-cups' });
screens['Items, with an item open'] = Q.count.render({ sub: 'items' });
for (const [name, h] of Object.entries(screens)) {
  const raw = h.split(MARK).length - 1;
  check(!raw && !/Something went wrong/.test(h), name + ': shown as text' + (raw ? ' (' + raw + ' place' + (raw === 1 ? '' : 's') + ' put it in as markup)' : ''));
}

/* ---------- 4 to 7: added in 1.6 ---------- */
const countHTML = (P) => P.count.render({ sub: 'count' });
// Section bands are h2 on Items and h3 on Count (under a how-often group); line names h3 or h4.
const bands = (h) => Array.from(h.matchAll(/<h([23]) class="band">([^<]*)<\/h\1>/g)).map((m) => m[2]);
const linesIn = (h) => Array.from(h.matchAll(/<h([34]) class="lname">([^<]*)<\/h\1>/g)).map((m) => unesc(m[2]));
const fresh = async (name, change) => {
  const inv = fixture('inventory.json'); if (change) change(inv);
  const st = invPhone();
  return phone(name, Object.assign(st, { inv: slot(inv), count: { id: 'c', started: nowIso, counts: {}, orders: {} } }));
};

console.log('\n4. Sections and lines show A to Z');
{
  const A = await fresh('Az', (inv) => {
    // The file has Paper goods, Coffee and tea, Cleaning, in that order.
    inv.lines.push({ id: 'ln-z8', cat: 'paper', name: '8 oz bowls', unit: 'sleeve', step: 1, par: 1, state: 'active', products: [{ id: 'p-z8', name: '' }] });
    inv.lines.push({ id: 'ln-z12', cat: 'paper', name: '12 oz bowls', unit: 'sleeve', step: 1, par: 1, state: 'active', products: [{ id: 'p-z12', name: '' }] });
    inv.lines.push({ id: 'ln-lost', cat: 'gone-section', name: 'Stray item', unit: 'each', step: 1, par: 1, state: 'active', products: [{ id: 'p-lost', name: '' }] });
  });
  const h = countHTML(A), b = bands(h);
  check(JSON.stringify(b.slice(0, 3)) === JSON.stringify(['Cleaning', 'Coffee and tea', 'Paper goods']), 'sections A to Z, whatever order the file has: ' + b.join(', '));
  check(b[b.length - 1] === 'No section' && linesIn(h).includes('Stray item'), 'a line whose section is gone still shows, under "No section"');
  const paper = linesIn(h.slice(h.indexOf('>Paper goods<'), h.indexOf('>No section<')));
  check(paper.indexOf('8 oz bowls') < paper.indexOf('12 oz bowls') && paper.indexOf('12 oz bowls') < paper.indexOf('Cup lids'), 'lines A to Z, numbers in order (8 oz before 12 oz): ' + paper.join(', '));
  const items = A.count.render({ sub: 'items' });
  check(bands(items).join(',').startsWith('Cleaning,Coffee and tea,Paper goods'), 'Items uses the same order');
  A.act('inv-flag', { line: 'ln-z12' }); A.act('inv-flag', { line: 'ln-z8' }); // flagged in the other order
  const msgOrder = orderMsg(A);
  check(msgOrder.indexOf('• 8 oz bowls') > 0 && msgOrder.indexOf('• 8 oz bowls') < msgOrder.indexOf('• 12 oz bowls'), 'the order message lists lines in the same order');
}

console.log('\n5. Full cases and loose units, counted separately');
{
  const C5 = await fresh('Split', (inv) => { const n = inv.lines.find((l) => l.id === 'ln-napkins'); n.unit = 'case'; n.step = 1; n.par = 3; n.products[0].perCase = 20; });
  const h = countHTML(C5);
  check(/id="qc-p-napkins"/.test(h) && /id="ql-p-napkins"/.test(h) && /loose sleeves/.test(h), 'a line counted in cases with 20 a case gets a cases box and a loose-sleeves box');
  check(!/\+1 case/.test(h), 'no "+1 case" button (on a line counted in cases it used to add 20 cases)');
  for (let i = 0; i < 2; i++) C5.act('inv-split', { pid: 'p-napkins', part: 'c', d: '1' });
  for (let i = 0; i < 7; i++) C5.act('inv-split', { pid: 'p-napkins', part: 'l', d: '1' });
  check(Math.abs(C5.S.count.counts['p-napkins'] - 2.35) < 1e-9, '2 cases + 7 sleeves is stored as 2.35 cases: ' + C5.S.count.counts['p-napkins']);
  C5.act('inv-flag', { line: 'ln-napkins' });
  check(/have 2 cases \+ 7 sleeves/.test(lineOf(C5, 'Napkins')), 'the order shows what’s on hand as "2 cases + 7 sleeves": ' + lineOf(C5, 'Napkins'));
  C5.type({ split: 'l', pid: 'p-napkins' }, '19', 'change');
  check(Math.abs(C5.S.count.counts['p-napkins'] - 2.95) < 1e-9, 'typing 19 in the loose box keeps the 2 cases: ' + C5.S.count.counts['p-napkins']);
  C5.type({ split: 'c', pid: 'p-napkins' }, '', 'change');
  check(Math.abs(C5.S.count.counts['p-napkins'] - 0.95) < 1e-9, 'emptying the cases box leaves just the loose ones');
  C5.type({ split: 'l', pid: 'p-napkins' }, '', 'change');
  check(C5.S.count.counts['p-napkins'] == null, 'both boxes empty means not counted');
  // A line counted in sleeves with a per-case number: the cases box adds a whole case of sleeves.
  C5.act('inv-split', { pid: 'p-cups', part: 'c', d: '1' });
  C5.act('inv-split', { pid: 'p-cups', part: 'l', d: '1' });
  check(C5.S.count.counts['p-cups'] === 21, 'on a line counted in sleeves (20 a case), 1 case + 1 sleeve = 21 sleeves: ' + C5.S.count.counts['p-cups']);
  C5.act('inv-split', { pid: 'p-cups', part: 'l', d: '-1' }); C5.act('inv-split', { pid: 'p-cups', part: 'l', d: '-1' });
  check(C5.S.count.counts['p-cups'] === 20, 'minus never goes below zero in the loose box');
  // One that divides unevenly still adds back up exactly.
  C5.st.edit('inv', (inv) => { inv.lines.find((l) => l.id === 'ln-napkins').products[0].perCase = 15; });
  C5.act('inv-clear', { pid: 'p-napkins' });
  for (let i = 0; i < 14; i++) C5.act('inv-split', { pid: 'p-napkins', part: 'l', d: '1' });
  C5.act('inv-split', { pid: 'p-napkins', part: 'c', d: '1' });
  check(/1 case \+ 14 sleeves/.test(orderMsg(C5)), '15 a case: 1 case + 14 sleeves shows back as that, not 1 case + 13.99');
}

console.log('\n6. Changing the unit converts instead of misreading');
{
  const C6 = await fresh('Unit', (inv) => { const n = inv.lines.find((l) => l.id === 'ln-napkins'); n.unit = 'case'; n.step = 1; n.par = 2; n.products[0].perCase = 20; });
  C6.act('inv-split', { pid: 'p-napkins', part: 'c', d: '1' });
  for (let i = 0; i < 3; i++) C6.act('inv-split', { pid: 'p-napkins', part: 'l', d: '1' });
  const nap = () => C6.st.I().lines.find((l) => l.id === 'ln-napkins');
  let msg = C6.count.changeUnit('ln-napkins', 'sleeve');
  check(nap().unit === 'sleeve' && nap().par === 40 && C6.S.count.counts['p-napkins'] === 23, 'cases → sleeves: minimum 2 → 40, count 1.15 cases → 23 sleeves');
  check(/Minimum 2 cases → 40 sleeves/.test(msg), 'and says so: ' + msg);
  msg = C6.count.changeUnit('ln-napkins', 'case');
  check(nap().unit === 'case' && nap().inner === 'sleeve' && nap().par === 2 && Math.abs(C6.S.count.counts['p-napkins'] - 1.15) < 1e-9, 'and back: minimum 2 cases, count 1.15, loose unit remembered as sleeves');
  msg = C6.count.changeUnit('ln-napkins', 'box');
  check(nap().par === 2 && C6.S.count.counts['p-napkins'] == null, 'cases → boxes has no conversion: the count is cleared, not misread, and the minimum kept');
  check(/Check the minimum/.test(msg) && /count it again/.test(msg), 'and the message says to check the minimum and count again: ' + msg);
  // The unit changed on the other phone and arrived by sync: converted on the next draw.
  C6.st.edit('inv', (inv) => { const n = inv.lines.find((l) => l.id === 'ln-napkins'); n.unit = 'case'; n.inner = 'sleeve'; n.par = 2; });
  C6.act('inv-split', { pid: 'p-napkins', part: 'c', d: '1' });
  C6.st.edit('inv', (inv) => { const n = inv.lines.find((l) => l.id === 'ln-napkins'); n.unit = 'sleeve'; delete n.inner; n.par = 40; });
  countHTML(C6);
  check(C6.S.count.counts['p-napkins'] === 20, 'a unit change synced from another phone converts the count in progress (1 case → 20 sleeves)');
  // A saved count remembers its unit, so "Same as last time" converts.
  C6.act('count-save');
  const saved = C6.st.C().history.slice(-1)[0];
  check(saved.units && saved.units['p-napkins'] === 'sleeve', 'a saved count records the unit it was counted in');
  C6.count.changeUnit('ln-napkins', 'case');
  const h6 = countHTML(C6);
  check(/data-act="inv-same" data-pid="p-napkins" data-val="1"/.test(h6), '"Same as last time" offers 1 case, not 20 cases');
  // The Items list goes through the same path.
  const pick = { dataset: { ie: 'unit', line: 'ln-napkins' }, tagName: 'SELECT', value: 'sleeve', classList: { add() {}, remove() {} }, setAttribute() {}, removeAttribute() {} };
  C6.count.onInput(pick, { type: 'change' });
  check(nap().unit === 'sleeve' && nap().par === 40, 'changing "Counted in" in Items converts the minimum too');
}

console.log('\n7. Sections can be added, renamed and deleted');
{
  const C7 = await fresh('Cats');
  const realQ = document.querySelector;
  const typeName = (v) => { document.querySelector = (s) => (s === '#cat-name' ? { value: v, focus() {} } : null); };
  typeName('Frozen');
  C7.act('cat-save', { id: '' });
  const frozen = C7.st.I().cats.find((c) => c.name === 'Frozen');
  check(!!frozen, 'a new section is added');
  check(C7.count.render({ sub: 'items' }).includes('>Frozen<'), 'an empty section shows on Items, so lines can go in it');
  check(!bands(countHTML(C7)).includes('Frozen'), 'but not on Count until it has a line');
  typeName('Coffee, tea and cocoa');
  C7.act('cat-save', { id: 'coffee' });
  check(C7.st.I().cats.find((c) => c.id === 'coffee').name === 'Coffee, tea and cocoa' && C7.st.I().lines.filter((l) => l.cat === 'coffee').length === 4, 'renaming keeps every line in it');
  document.querySelector = realQ;
  const armedBtn = () => ({ dataset: { id: frozen.id, armed: '1' }, classList: { add() {}, remove() {} }, setAttribute() {}, removeAttribute() {}, getAttribute: () => null });
  C7.count.acts['cat-del'](Object.assign(armedBtn(), { dataset: { id: 'paper', armed: '1' } }));
  check(C7.st.I().cats.some((c) => c.id === 'paper'), 'a section with lines in it can’t be deleted');
  C7.count.acts['cat-del'](armedBtn());
  check(!C7.st.I().cats.some((c) => c.id === frozen.id), 'an empty one can');
}

console.log('\n8. A per-case number changed mid-count, and saved counts from before units were recorded');
{
  const C8 = await fresh('Per', (inv) => { const n = inv.lines.find((l) => l.id === 'ln-napkins'); n.unit = 'case'; n.step = 1; n.par = 3; n.products[0].perCase = 20; });
  const perCase = (pid, n) => C8.st.edit('inv', (inv) => { for (const l of inv.lines) for (const p of l.products) if (p.id === pid) { if (n) p.perCase = n; else delete p.perCase; } });
  const boxes = (pid) => { const h = countHTML(C8); return [(/id="qc-[^"]*"[^>]*value="([^"]*)"/.exec(h.split('id="P-' + pid + '"')[1]) || [])[1], (/id="ql-[^"]*"[^>]*value="([^"]*)"/.exec(h.split('id="P-' + pid + '"')[1]) || [])[1]].join(' + '); };
  // Counted in cases: 1 case and 6 loose sleeves, at 20 a case.
  C8.act('inv-split', { pid: 'p-napkins', part: 'c', d: '1' });
  for (let i = 0; i < 6; i++) C8.act('inv-split', { pid: 'p-napkins', part: 'l', d: '1' });
  check(boxes('p-napkins') === '1 + 6', '(setup: the boxes show 1 case + 6 sleeves)');
  perCase('p-napkins', 12); // someone fixes the per-case number, here or on the other phone
  check(boxes('p-napkins') === '1 + 6', 'the per-case number changes mid-count: the boxes still show the 1 case + 6 sleeves that were counted (they show ' + boxes('p-napkins') + ')');
  check(Math.abs(C8.S.count.counts['p-napkins'] - 1.5) < 1e-9, '…stored as 1.5 cases now, not 1.3: ' + C8.S.count.counts['p-napkins']);
  // Counted in sleeves with a per-case number: 2 cases and 3 loose, at 20 a case, is 43 sleeves.
  for (let i = 0; i < 2; i++) C8.act('inv-split', { pid: 'p-cups', part: 'c', d: '1' });
  for (let i = 0; i < 3; i++) C8.act('inv-split', { pid: 'p-cups', part: 'l', d: '1' });
  perCase('p-cups', 10);
  check(boxes('p-cups') === '2 + 3' && C8.S.count.counts['p-cups'] === 23, 'on a line counted in sleeves, 2 cases + 3 stays 2 cases + 3 (23 sleeves at 10 a case, not 43): ' + boxes('p-cups') + ', ' + C8.S.count.counts['p-cups']);
  perCase('p-cups', 0); countHTML(C8);
  check(C8.S.count.counts['p-cups'] === 23, 'taking the per-case number away leaves the count as it is, in sleeves');
  perCase('p-cups', 10); countHTML(C8);
  check(C8.S.count.counts['p-cups'] === 23, '…and putting one back doesn’t change it either');
  // A saved count remembers the per-case number too, so "Same as last time" offers what was counted.
  C8.act('count-save');
  const saved = C8.st.C().history.slice(-1)[0];
  check(saved.per && saved.per['p-cups'] === 10 && saved.per['p-napkins'] === 12, 'a saved count records each per-case number it was counted with');
  perCase('p-cups', 20);
  check(/data-act="inv-same" data-pid="p-cups" data-val="43"/.test(countHTML(C8)), '“Same as last time” after the per-case number changes offers the same 2 cases + 3 (43 sleeves at 20 a case)');

  // Saved before 1.6: no units recorded. If the line has been changed since, the number can't be trusted.
  const day = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const old = { schema: 1, updated: day(5), history: [{ id: 'h-old', date: day(5), savedAt: new Date(Date.now() - 5 * 864e5).toISOString(), by: 'AA', counts: { 'p-lids': 8, 'p-coffee': 2 }, orders: {}, orderCount: 0, text: 'x', updated: day(5) }] };
  const inv = fixture('inventory.json');
  inv.lines.find((l) => l.id === 'ln-lids').unit = 'case'; inv.lines.find((l) => l.id === 'ln-lids').updated = day(2);      // moved to cases after that count
  inv.lines.find((l) => l.id === 'ln-coffee').updated = day(9);                                                                // not touched since
  const G8 = await phone('Old', Object.assign(invPhone(), { inv: slot(inv), counts: slot(old), count: { id: 'c', started: nowIso, counts: {}, orders: {} } }));
  const h8 = countHTML(G8);
  check(!/data-act="inv-same" data-pid="p-lids"/.test(h8), 'a count saved before units were recorded isn’t offered as “Same as last time” on a line changed since (8 sleeves would read as 8 cases)');
  check(/data-act="inv-same" data-pid="p-coffee" data-val="2"/.test(h8), '…and still is on a line nobody has changed since');
  const t8 = G8.stock.totals().lines;
  check(t8['ln-lids'].servery.v == null && t8['ln-lids'].servery.stale === true && t8['ln-lids'].sum.v == null && t8['ln-coffee'].servery.v === 2, 'what’s on hand treats it the same way: the changed line is marked “count again” and adds nothing, the untouched line counts');
}

/* ---------- 9 and 10: places, flags and order records ---------- */
const bare = async (name, change) => { // the sample inventory, nothing saved yet, nothing counted
  const inv = fixture('inventory.json'); if (change) change(inv);
  return phone(name, Object.assign(invPhone(), { inv: slot(inv), counts: slot({ schema: 1, updated: today, history: [] }), count: { id: 'c', started: nowIso, counts: {}, orders: {} } }));
};
const tap = (P, pid, part, times) => { for (let i = 0; i < times; i++) P.act('inv-split', { pid, part, d: '1' }); };

console.log('\n9. Two places: a count in progress each, and what’s on hand across both');
{
  const R = await bare('Rooms', (inv) => { const n = inv.lines.find((l) => l.id === 'ln-napkins'); n.unit = 'case'; n.step = 1; n.par = 2; n.products[0].perCase = 20; });
  const K = R.stock, last = () => R.st.C().history.slice(-1)[0];
  check(K.roomNow() === 'servery' && !R.S.count.place, 'a count in progress from before places belongs to the first place');
  // First place: cups 2 cases + 3 sleeves (43 sleeves at 20 a case), napkins 2 cases + 7 sleeves.
  tap(R, 'p-cups', 'c', 2); tap(R, 'p-cups', 'l', 3); tap(R, 'p-napkins', 'c', 2); tap(R, 'p-napkins', 'l', 7);
  check(K.setRoom('kitchen') && K.roomNow() === 'kitchen' && Object.keys(R.S.count.counts).length === 0, 'switching place starts that place’s own count');
  tap(R, 'p-cups', 'l', 15);
  let t = K.totals({ live: true }).lines['ln-cups'];
  check(t.servery.v === 43 && t.kitchen.v === 15 && t.sum.v === 58 && t.servery.live && t.kitchen.live, 'both counts in progress are there: 43 sleeves in one place, 15 in the other');
  K.setRoom('servery');
  check(R.S.count.counts['p-cups'] === 43 && Math.abs(R.S.count.counts['p-napkins'] - 2.35) < 1e-9, 'switching back brings the first place’s count back untouched');
  check(K.totals().lines['ln-cups'].sum.v == null && K.totals().rooms.servery == null, 'nothing is saved yet, so the saved totals are empty');
  R.act('count-save');
  const s1 = last();
  check(s1.place === 'servery' && s1.counts['p-cups'] === 43 && s1.orderCount === 0 && !s1.order && /Servery/.test(s1.text), 'Save count files that place’s count, with its place on it and no order');
  check(K.roomNow() === 'servery' && Object.keys(R.S.count.counts).length === 0 && !!K.inProgress('kitchen') && K.inProgress('kitchen').counts['p-cups'] === 15, 'a fresh count starts for that place; the other place’s count in progress is kept');
  // A unit changes between the two places' counts: napkins go from cases to sleeves, then the second place is counted.
  K.setRoom('kitchen');
  R.count.changeUnit('ln-napkins', 'sleeve');
  tap(R, 'p-napkins', 'l', 15);
  R.act('count-save');
  const s2 = last();
  check(s2.place === 'kitchen' && s2.units['p-napkins'] === 'sleeve' && s1.units['p-napkins'] === 'case', '(setup: the two saved counts hold napkins in different units)');
  t = K.totals();
  const nap = t.lines['ln-napkins'], cups = t.lines['ln-cups'];
  check(nap.servery.v === 47 && nap.kitchen.v === 15 && nap.sum.v === 62, 'a unit changed between the two counts: 2 cases + 7 sleeves reads as 47 sleeves, and with 15 more is 62 (got ' + [nap.servery.v, nap.kitchen.v, nap.sum.v].join(', ') + ')');
  check(nap.servery.cases === 2 && nap.servery.loose === 7 && nap.sum.cases === 3 && nap.sum.loose === 2, 'each place’s amount and the sum also come as full cases and loose units (3 cases + 2 sleeves in all)');
  check(cups.servery.v === 43 && cups.kitchen.v === 15 && cups.sum.v === 58 && cups.sum.cases === 2 && cups.sum.loose === 18 && cups.servery.counted && !cups.servery.live, 'cups: 43 + 15 = 58 sleeves, from the saved counts');
  check(t.rooms.servery.id === s1.id && t.rooms.kitchen.id === s2.id && t.rooms.kitchen.by === 'BB' && t.rooms.servery.date === s1.date, 'the totals say which saved count each place’s numbers come from, its date and who counted');
  const lids = t.lines['ln-lids'];
  check(lids.servery.v == null && lids.kitchen.v == null && lids.sum.v == null && !lids.servery.counted, 'a line not counted in a place adds nothing');
  // The newest saved count of a place is the one that counts.
  K.setRoom('servery');
  R.act('inv-step', { pid: 'p-lids', d: '1' });
  check(K.totals({ live: 'servery' }).lines['ln-lids'].servery.v === 1 && K.totals({ live: 'servery' }).lines['ln-lids'].servery.live === true && K.totals().lines['ln-lids'].servery.v == null, 'asked for, the count in progress shows in the totals before it’s saved');
  R.act('count-save');
  t = K.totals();
  check(t.lines['ln-lids'].sum.v === 1 && t.lines['ln-cups'].servery.v == null && t.lines['ln-cups'].sum.v === 15, 'a newer count of a place replaces the older one whole: a line it leaves out reads as not counted there');
  // The count waiting in the other place is converted with the line, not left in its old unit.
  tap(R, 'p-napkins', 'c', 1); // 1 case, held as 20 sleeves
  K.setRoom('kitchen');
  R.count.changeUnit('ln-napkins', 'case');
  const parked = K.inProgress('servery');
  check(parked.counts['p-napkins'] === 1 && parked.units['p-napkins'] === 'case', 'a unit change while a place’s count waits converts that count too (20 sleeves → 1 case; it holds ' + parked.counts['p-napkins'] + ' ' + parked.units['p-napkins'] + ')');

  // Saved counts from before places have no place: they read as the first place.
  const O = await fresh('NoPlace'); // h1 to h3 have no place (newest: cups 1); h4 is the second place (cups 15)
  const to = O.stock.totals();
  check(!!to.rooms.servery && to.rooms.servery.id === 'h3' && to.rooms.kitchen.id === 'h4', 'a saved count with no place counts as the first place’s');
  check(to.lines['ln-cups'].servery.v === 1 && to.lines['ln-cups'].kitchen.v === 15 && to.lines['ln-cups'].sum.v === 16, '…and adds up with the second place’s count');
  check(/data-act="inv-same" data-pid="p-cups" data-val="1"/.test(countHTML(O)), '“Same as last time” in the first place offers it');
  O.stock.setRoom('kitchen');
  check(/data-act="inv-same" data-pid="p-cups" data-val="15"/.test(countHTML(O)), '…and in the second place offers that place’s own last count, not the other’s');
}

console.log('\n10. Flags, how often, and Order placed');
{
  const F = await bare('Flags');
  const K = F.stock, ln = (id) => F.st.I().lines.find((l) => l.id === id);
  F.act('inv-flag', { line: 'ln-cups' }); F.act('ord-inc', { line: 'ln-cups' });
  F.act('inv-flag', { line: 'ln-soap' });
  const fl = JSON.parse(JSON.stringify(ln('ln-cups').flag));
  check(fl.n === 2 && fl.unit === 'case' && fl.by === 'BB' && /^\d{4}-\d\d-\d\dT/.test(fl.at), 'a flag is saved on the line: the amount, its unit (cups come 20 a case, so by the case), when and who');
  check(K.setFreq('ln-cups', 'week') && K.freqOf(ln('ln-cups')) === 'week' && !K.setFreq('ln-cups', 'daily') && K.freqOf(ln('ln-cups')) === 'week' && K.freqOf(ln('ln-soap')) === 'none', 'how often is one of the four groups; a line with none set is “not regular”');
  F.count.acts['order-place']({ dataset: {}, classList: { add() {}, remove() {} }, setAttribute() {}, removeAttribute() {}, getAttribute: () => null, innerHTML: '', textContent: '' });
  check(!F.st.C().history.some((h) => h.kind === 'order') && K.orderList().length === 2, 'one tap on Order placed files nothing (it takes two)');
  F.act('order-place', { armed: '1' });
  const rec = F.st.C().history.slice(-1)[0];
  check(rec.kind === 'order' && rec.orderCount === 2 && rec.order.status === 'placed' && rec.order.placedBy === 'BB' && JSON.stringify(rec.lines.map((x) => [x.line, x.n, x.unit])) === JSON.stringify([['ln-soap', 1, 'each'], ['ln-cups', 2, 'case']]) && /• Dish soap: 1 each/.test(rec.text) && /• Paper cups, 12 oz: 2 cases/.test(rec.text), 'Order placed files an order record: what was ordered, the message, placed, and by whom');
  check(!ln('ln-cups').flag && !ln('ln-soap').flag && K.orderList().length === 0 && ln('ln-cups').cleared >= fl.at, '…and clears the flags, noting when');
  const hist = F.count.render({ sub: 'history' }), ord = F.count.render({ sub: 'order' });
  check(/Order · 2 items/.test(hist) && /An order is on its way/.test(ord) && /Mark received/.test(ord), 'History shows the order; the Order tab says it’s on its way and offers Mark received');
  F.act('ord-received', { id: rec.id });
  check(F.count.orderState(F.st.C().history.find((h) => h.id === rec.id)) === 'received' && !/on its way/.test(F.count.render({ sub: 'order' })), 'marking it received works as it did');
  // The line was cleared by a phone whose clock runs an hour ahead. Flagging it here must still stick.
  F.st.edit('inv', (inv) => { inv.lines.find((l) => l.id === 'ln-cups').cleared = new Date(Date.now() + 3600e3).toISOString(); });
  F.act('inv-flag', { line: 'ln-cups' });
  check(!!K.flagOf(ln('ln-cups')), 'a line cleared by a phone whose clock runs ahead can still be flagged again');
  F.st.edit('inv', (inv) => { const l = inv.lines.find((x) => x.id === 'ln-lids'); l.flag = { n: 4, unit: 'sleeve', at: '2026-01-01T00:00:00.000Z', by: 'AA' }; l.cleared = '2026-01-02T00:00:00.000Z'; });
  check(!K.flagOf(ln('ln-lids')) && !orderMsg(F).includes('Cup lids'), 'a flag from before its line was last cleared doesn’t count');
}

console.log('\n11. The Count screen: room tabs, what each line shows, the Order stepper, how-often groups');
{
  const V = await bare('Screen', (inv) => { inv.lines.find((l) => l.id === 'ln-coffee').freq = 'few'; inv.lines.find((l) => l.id === 'ln-cups').freq = 'week'; });
  const K = V.stock, room = () => countHTML(V), tot = () => V.count.render({ sub: 'totals' });
  const pressed = (h) => (/data-act="count-room" data-id="(\w+)" aria-pressed="true"/.exec(h) || [])[1];
  const card = (h, id) => { const i = h.indexOf('id="L-' + id + '"'); return i < 0 ? '' : h.slice(i, h.indexOf('</article>', i)); };
  const words = (h) => unesc(h.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  const md = ((d) => (d.getMonth() + 1) + '/' + d.getDate())(new Date());
  let h = room();
  check(pressed(h) === 'servery' && /data-act="count-room" data-id="kitchen"/.test(h) && /data-act="count-room" data-id="totals"/.test(h) && /data-act="count-save"[^>]*>.*Save Servery count</.test(h), 'Count opens on the first room, with Servery, Kitchen and Totals tabs and a Save Servery count button');
  check(/data-search="inv"/.test(h) && /data-act="inv-filter"/.test(h) && /data-act="inv-how" data-line="ln-cups"/.test(h), 'search, the filters and “How it’s counted” are still there');
  check(!/data-act="count-save"/.test(V.count.render({ sub: 'order' })), 'Save count is no longer on the Order tab');
  tap(V, 'p-cups', 'c', 2); tap(V, 'p-cups', 'l', 3);
  let c = words(card(room(), 'ln-cups'));
  check(c.includes('Servery: 2 cases + 3 sleeves') && c.includes('Kitchen: not counted') && c.includes('In all: 2 cases + 3 sleeves'), 'under the steppers: this room, the other room and both added up (' + c.slice(c.indexOf('Servery:')) + ')');
  check(/id="qc-p-cups"[^>]*value="2"/.test(card(room(), 'ln-cups')) && /id="ql-p-cups"[^>]*value="3"/.test(card(room(), 'ln-cups')) && /id="q-p-coffee"/.test(room()), 'full cases and loose side by side on a line with a case size, one box on a line without');

  // Tap Kitchen: its own count, the first room's waits.
  V.act('count-room', { id: 'kitchen' });
  h = room(); c = words(card(h, 'ln-cups'));
  check(K.roomNow() === 'kitchen' && pressed(h) === 'kitchen' && />[^<]*Save Kitchen count</.test(h) && !/id="qc-p-cups"[^>]*value="\d/.test(h), 'tapping Kitchen switches to the Kitchen’s own count: empty boxes, Save Kitchen count');
  check(K.inProgress('servery').counts['p-cups'] === 43 && c.includes('Kitchen: not counted yet') && c.includes('Servery: not counted') && /Servery count isn’t saved yet/.test(h), 'the Servery count waits untouched; it isn’t saved, so it isn’t shown as the Servery’s number, and the note says so');
  tap(V, 'p-cups', 'l', 15);
  V.act('count-save');
  const saved = V.st.C().history.slice(-1)[0];
  check(saved.place === 'kitchen' && saved.counts['p-cups'] === 15 && K.roomNow() === 'kitchen' && !Object.keys(V.S.count.counts).length, 'Save Kitchen count files a Kitchen count and starts a fresh Kitchen count');
  V.act('count-room', { id: 'servery' });
  c = words(card(room(), 'ln-cups'));
  check(K.roomNow() === 'servery' && c.includes('Servery: 2 cases + 3 sleeves') && c.includes('Kitchen: 15 sleeves, counted ' + md) && c.includes('In all: 2 cases + 18 sleeves'), 'back in the Servery: its count is back, and the Kitchen’s saved 15 shows with its date and adds in (' + c.slice(c.indexOf('Servery:')) + ')');

  // Totals: saved counts only.
  h = tot(); c = words(card(h, 'ln-cups'));
  check(pressed(h) === 'totals' && !/data-act="inv-split"|data-act="inv-step"|data-act="count-save"/.test(h), 'Totals has no steppers and no Save button');
  check(c.includes('Servery not counted') && c.includes('Kitchen 15 sleeves') && c.includes('In all 15 sleeves') && /Servery<\/dt><dd>Not counted yet/.test(h) && /Kitchen<\/dt><dd>Counted [^<]* by BB/.test(h) && /This phone has a Servery count in progress/.test(h), 'Totals before the Servery is saved: Kitchen only, each room’s date and counter at the top, and a note about the unsaved count');
  V.act('count-save');
  h = tot(); c = words(card(h, 'ln-cups'));
  check(c.includes('Servery 2 cases + 3 sleeves') && c.includes('Kitchen 15 sleeves') && c.includes('In all 2 cases + 18 sleeves') && /Servery<\/dt><dd>Counted [^<]* by BB/.test(h) && !/count in progress/.test(h), 'after Save Servery count, Totals adds both rooms: ' + c.slice(c.indexOf('Servery')));
  check(/data-act="inv-flag" data-line="ln-cups"/.test(h), 'lines on Totals have an Order button too');
  V.act('count-room', { id: 'kitchen' });
  check(K.roomNow() === 'kitchen', 'a room tab from Totals goes to that room');

  // The Order button shows an amount stepper.
  const cups = () => card(room(), 'ln-cups');
  check(!/id="oq-ln-cups"/.test(cups()) && /data-act="inv-flag" data-line="ln-cups" aria-pressed="false"/.test(cups()), '(setup: cups not on the order list, no stepper)');
  V.act('inv-flag', { line: 'ln-cups' });
  check(/aria-pressed="true"/.test(cups()) && /id="oq-ln-cups"[^>]*value="1"/.test(cups()) && />case</.test(cups()) && /class="line [^"]*flagged[^"]*" id="L-ln-cups"/.test(room()), 'tapping Order puts it on the list and shows a stepper at 1 case (cups come 20 a case)');
  V.act('ord-inc', { line: 'ln-cups' }); V.act('ord-inc', { line: 'ln-cups' });
  check(/id="oq-ln-cups"[^>]*value="3"/.test(cups()) && />cases</.test(cups()) && K.flagOf(V.st.I().lines.find((l) => l.id === 'ln-cups')).n === 3, 'plus twice: 3 cases, on the shared list');
  V.type({ oline: 'ln-cups' }, '6', 'change');
  check(/id="oq-ln-cups" data-oline="ln-cups"[^>]*value="6"/.test(cups()), 'an amount can be typed in the box on Count too');
  V.type({ oline: 'ln-cups' }, '1', 'change'); V.act('ord-dec', { line: 'ln-cups' });
  check(!/id="oq-ln-cups"/.test(cups()) && /aria-pressed="false"/.test(cups()) && !K.orderList().length, 'minus from 1 takes it off the list and the stepper goes');

  // How-often groups, in the four fixed groups' order, then sections A to Z inside each.
  h = room();
  const groups = Array.from(h.matchAll(/<h2 class="fg-h" id="FG-(\w+)">([^<]*)<span class="fg-n">([^<]*)</g)).map((m) => [m[1], m[2].trim(), m[3]]);
  check(JSON.stringify(groups.map((g) => g[1])) === JSON.stringify(['Every few days', 'Weekly', 'Not regular']), 'lines are grouped by how often they’re ordered, in order, empty groups left out: ' + groups.map((g) => g[1]).join(', '));
  const inGroup = (id) => { const i = h.indexOf('id="FG-' + id + '"'), j = h.indexOf('<h2 class="fg-h"', i + 1); return h.slice(i, j < 0 ? h.indexOf('<details', i) : j); };
  check(JSON.stringify(linesIn(inGroup('few'))) === JSON.stringify(['Coffee, regular']) && JSON.stringify(linesIn(inGroup('week'))) === JSON.stringify(['Paper cups, 12 oz']) && groups[0][2] === '1 line', 'each line sits in its own group, with the group’s line count');
  const rest = inGroup('none');
  check(!linesIn(rest).includes('Coffee, regular') && JSON.stringify(bands(rest)) === JSON.stringify(['Cleaning', 'Coffee and tea', 'Paper goods']) && linesIn(rest).includes('Cup lids'), 'lines with no group set are under Not regular, by section A to Z');
  K.setFreq('ln-soap', 'month'); h = room();
  check(linesIn(inGroup('month')).join() === 'Dish soap' && !linesIn(inGroup('none')).includes('Dish soap'), 'a line given a group moves to it');

  // Start over clears only the room on screen.
  V.act('inv-step', { pid: 'p-lids', d: '1' });
  V.act('count-room', { id: 'servery' }); V.act('inv-step', { pid: 'p-lids', d: '1' }); V.act('inv-step', { pid: 'p-lids', d: '1' });
  V.act('count-new');
  check(/Clear the Servery count in progress/.test(room()), 'Start the Servery count over asks first, naming the room');
  V.act('count-new-yes');
  check(!Object.keys(V.S.count.counts).length && ((K.inProgress('kitchen') || {}).counts || {})['p-lids'] === 1, '…and clears the Servery count only; the Kitchen count is kept');
}

T.done();
