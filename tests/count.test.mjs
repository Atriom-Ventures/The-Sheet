// Order amounts, and how the Count screens show what's in the shared files. Uses the made-up sample
// data in tests/fixtures; no GitHub needed.
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
  app.register(count);
  app.route = { tab: 'count', sub: '', id: '' };
  await st.load();
  const fake = (data, value) => ({ dataset: data, value, disabled: false, innerHTML: '', textContent: '', classList: { add() {}, remove() {} }, setAttribute() {}, removeAttribute() {} });
  return {
    st, S: st.S, count,
    act: (a, data = {}) => app.acts[a](fake(data, '')),
    type: (data, value, type) => count.onInput(fake(data, value), { type })
  };
}
const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
/* The order message as it would be copied to team chat, and one item's line in it. */
const orderMsg = (P) => unesc((/<pre class="chit" id="order-text">([\s\S]*?)<\/pre>/.exec(P.count.render({ sub: 'order' })) || [])[1] || '');
const lineOf = (P, name) => orderMsg(P).split('\n').find((l) => l.startsWith('• ' + name)) || '(not on the order)';

console.log('\n1. An order amount changed by hand keeps its unit');
const P = await phone('Ord', invPhone()); // count in progress: cups 2, lids 0, napkins ½
check(/^• Cup lids: 3 sleeves /.test(lineOf(P, 'Cup lids')), '(setup: 0 lids on hand, minimum 3 → order 3 sleeves)');
P.act('ord-inc', { line: 'ln-lids' });
check(/^• Cup lids: 4 sleeves /.test(lineOf(P, 'Cup lids')), 'bumped by hand to 4 sleeves');
P.st.edit('inv', (inv) => { inv.lines.find((l) => l.id === 'ln-lids').products[0].perCase = 20; }); // e.g. synced from the other phone
const lidsNow = lineOf(P, 'Cup lids');
check(!/4 cases/.test(lidsNow) && /^• Cup lids: 1 case /.test(lidsNow), 'once lids are ordered by the case (20 a case), the 4 isn’t read as 4 cases: ' + lidsNow);
P.act('ord-inc', { line: 'ln-lids' });
P.S.count.counts['p-lids'] = 1; // recounted
check(/^• Cup lids: 2 cases /.test(lineOf(P, 'Cup lids')), 'a hand-set amount stays while its unit stays the same');

console.log('\n2. Clearing an order box');
P.S.count.counts['p-coffee'] = 0;
check(/^• Coffee, regular: 2 cases /.test(lineOf(P, 'Coffee, regular')), '(setup: suggested 2 cases)');
for (const v of ['1', '12', '1', '']) P.type({ oline: 'ln-coffee' }, v, 'input'); // typed 12, then deleted it
P.type({ oline: 'ln-coffee' }, '', 'change');
check(/^• Coffee, regular: 2 cases /.test(lineOf(P, 'Coffee, regular')), 'a box left empty goes back to the suggested amount, not a leftover digit: ' + lineOf(P, 'Coffee, regular'));
P.type({ oline: 'ln-coffee' }, '0', 'input');
check(!orderMsg(P).includes('• Coffee, regular'), '0 means don’t order it');

console.log('\n3. Text from the shared files is shown as text');
const MARK = '<u>MARK</u>';
const inv = fixture('inventory.json');
const line = (id) => inv.lines.find((l) => l.id === id);
line('ln-cups').products[0].perCase = '20' + MARK;
line('ln-lids').unit = 'sleeve' + MARK; line('ln-lids').products[0].perCase = 6;
line('ln-cocoa').state = 'useup' + MARK;
const nowIso = new Date().toISOString(), today = nowIso.slice(0, 10);
const counts = { schema: 1, updated: today, history: [{ id: 'h-odd', date: today, savedAt: nowIso, by: 'BB', counts: { 'p-lids': '1' + MARK }, orders: {}, orderCount: '2' + MARK, text: 'x', order: { status: 'saved' }, updated: today }] };
const slot = (doc) => ({ base: JSON.parse(JSON.stringify(doc)), local: JSON.parse(JSON.stringify(doc)), sha: 'x', src: 'id:1' });
const Q = await phone('Odd', Object.assign(invPhone(), { inv: slot(inv), counts: slot(counts), count: { id: 'c', started: nowIso, counts: {}, orders: {} } }));
const screens = { Count: Q.count.render({ sub: 'count' }), Order: Q.count.render({ sub: 'order' }), History: Q.count.render({ sub: 'history' }) };
Q.act('item-open', { id: 'ln-cups' });
screens['Items, with an item open'] = Q.count.render({ sub: 'items' });
for (const [name, h] of Object.entries(screens)) {
  const raw = h.split(MARK).length - 1;
  check(!raw && !/Something went wrong/.test(h), name + ': shown as text' + (raw ? ' (' + raw + ' place' + (raw === 1 ? '' : 's') + ' put it in as markup)' : ''));
}

/* ---------- 4 to 7: added in 1.6 ---------- */
const countHTML = (P) => P.count.render({ sub: 'count' });
const bands = (h) => Array.from(h.matchAll(/<h2 class="band">([^<]*)<\/h2>/g)).map((m) => m[1]);
const linesIn = (h) => Array.from(h.matchAll(/<h3 class="lname">([^<]*)<\/h3>/g)).map((m) => unesc(m[1]));
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
  const msgOrder = orderMsg(A); // nothing counted yet: the not-counted list is in the same order too
  check(msgOrder.indexOf('8 oz bowls') < msgOrder.indexOf('12 oz bowls'), 'the order message lists lines in the same order');
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
}

T.done();
