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

T.done();
