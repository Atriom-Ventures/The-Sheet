// The allergen card: every page worked out from one set of menu rows, the kitchen's check clearing on
// any change, text from the shared file shown as text, and view-only access. Made-up data only.
// (Whether the pages fit on Letter paper needs a real browser: see tests/card-fit.py.)
import path from 'node:path';
import { makePhone, checker } from './lib/phone.mjs';
import { fullPhone, fixture } from './lib/fixtures.mjs';

const T = checker();
const check = T.check;

/* ---------- browser stubs ---------- */
const fields = {};
const el = (id) => ({ id, classList: { add() {}, remove() {}, toggle() {} }, dataset: {}, style: { setProperty() {} }, setAttribute() {}, removeAttribute() {}, remove() {}, focus() {}, querySelector: () => null, querySelectorAll: () => [], closest: () => null, appendChild() {}, innerHTML: '', textContent: '', get value() { return fields[id] != null ? fields[id] : ''; }, get checked() { return fields[id] === true; } });
const els = {};
const mk = (id) => (els[id] = els[id] || el(id));
let boxes = [];
globalThis.window = globalThis;
globalThis.document = { querySelector: (s) => (String(s).startsWith('#') && !String(s).includes(' ') ? ((s.slice(1) in fields) || ['sheet-root', 'sheet-b', 'toast', 'sr-live', 'app'].includes(s.slice(1)) ? mk(s.slice(1)) : null) : null), querySelectorAll: (s) => (/data-x|data-c/.test(s) ? boxes : []), getElementById: (id) => mk(id), createElement: () => el('x'), body: el('body'), activeElement: null, contains: () => false, addEventListener() {} };
globalThis.addEventListener = () => {};
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: 'test', platform: 'Linux', maxTouchPoints: 0, onLine: false, storage: null } });
globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
globalThis.requestAnimationFrame = (f) => setTimeout(f, 0);
globalThis.location = { hash: '' };
globalThis.history = { pushState() {}, replaceState() {}, back() {}, state: null };
globalThis.fetch = async () => { throw new TypeError('offline'); };

async function phone(name, mem) {
  const dir = makePhone(name);
  globalThis['__mem_' + name] = mem;
  const st = await import(path.join(dir, 'js/state.js'));
  const app = (await import(path.join(dir, 'js/app.js'))).app;
  const c3 = await import(path.join(dir, 'js/card3.js'));
  const pages = await import(path.join(dir, 'js/card3pages.js'));
  const card = await import(path.join(dir, 'js/views/card.js'));
  const merge = await import(path.join(dir, 'js/merge.js'));
  app.register(card);
  app.go = (h) => { const [tab, sub, ...rest] = h.replace(/^#/, '').split('/'); app.route = { tab, sub: sub || '', id: rest.join('/') }; };
  await st.load();
  app.route = { tab: 'book', sub: 'allergens', id: '' };
  const fake = (data) => ({ dataset: data, disabled: false, innerHTML: '', textContent: '', classList: { add() {}, remove() {} }, setAttribute() {}, removeAttribute() {}, getAttribute: () => null });
  return { st, S: st.S, app, c3, pages, card, merge, doc: () => st.S.menu.local, act: (a, data = {}) => app.acts[a](fake(data)), sure: (a, data = {}) => app.acts[a](fake(Object.assign({ armed: '1' }, data))) };
}
const clone = (o) => JSON.parse(JSON.stringify(o));
const withCard = (doc, extra) => Object.assign(fullPhone({ clash: false }), { menu: { base: null, local: doc, sha: null } }, extra || {});
const text = (html) => html.replace(/<svg.*?<\/svg>/g, '').replace(/<[^>]+>/g, '|').replace(/\|+/g, '|');
const A = await phone('CardA', withCard(fixture('card3.json')));
const { c3, pages } = A;
const back = (doc, id) => c3.backPage(doc).allergens.find((a) => a.id === id);
const labels = (doc, id) => back(doc, id).listed.map((l) => l.label + ' ' + l.meals.join(''));

console.log('\n1. The back page is worked out from the rows');
let d = clone(A.doc());
check(labels(d, 'egg').join(', ') === 'Burger (bun) LD, Eggs and omelets BL, Pancakes B', 'in it and can’t be left out → listed, A to Z, with the meals it’s on (' + labels(d, 'egg').join(', ') + ')');
check(labels(d, 'egg').includes('Eggs and omelets BL'), 'rows that share a “list as” name share one line, and its meals add up (an omelet at B and L, eggs at B)');
check(!labels(d, 'dairy').some((l) => /Omelet|Burger|Tacos/.test(l)) && back(d, 'dairy').off.join(', ') === 'butter, cheese, crema', 'can be made without → not listed; what to leave off is listed instead (' + back(d, 'dairy').off.join(', ') + ')');
check(back(d, 'dairy').ask.join() === 'porridge' && back(d, 'peanuts').ask.join() === 'the topping (label)' && back(d, 'egg').ask.join() === 'slaw dressing (label)', 'not confirmed → Ask, by row or by what it comes from, with (label) for packaged things');
check(labels(d, 'gluten').includes('Anything fried LD') && labels(d, 'fish').includes('Anything fried LD'), 'shared fryer → “Anything fried” under each allergen the fryer carries, for the meals with fried rows');
check(!labels(d, 'dairy').some((l) => /fried/i.test(l)), '…and not under allergens it doesn’t carry');
check(back(d, 'fish').listed.find((l) => l.label === 'Fish Tacos').sub === 'battered cod' && back(d, 'fish').ask.includes('is there a clean pan?'), 'small print and extra questions come through');
check(labels(d, 'soy').join() === 'Tofu D' && back(d, 'soy').ask.join() === 'marinade', 'a choice inside a dish is listed on its own (tofu), and an unsure one is an Ask');
check(back(d, 'peanuts').listed.length === 0 && back(d, 'peanuts').note === 'None on these menus.', 'an allergen with no rows says so');
check(c3.backPage(d).daily.join() === 'soups', 'rows that change daily are gathered');

console.log('\n2. One edit changes every page');
const bh0 = pages.pageHTML(d, 'back'), mh0 = pages.pageHTML(d, 'LD');
d.rows.find((r) => r.id === 'm-burger').allergens.find((e) => e.a === 'dairy').s = 'in';
check(labels(d, 'dairy').includes('House Burger LD') && /House Burger/.test(pages.pageHTML(d, 'back').split('EGG')[0]), 'a dish whose cheese can no longer be left off moves onto the back page’s list');
d.rows.push({ id: 'm-new', name: 'Almond Trout', kind: 'dish', meals: ['D'], allergens: [{ a: 'fish', s: 'in', from: 'trout' }, { a: 'nuts', s: 'in', from: 'almonds' }], cross: ['fryer'] });
const bh1 = pages.pageHTML(d, 'back'), mh1 = pages.pageHTML(d, 'LD'), fh1 = pages.pageHTML(d, 'front');
check(labels(d, 'fish').includes('Almond Trout D') && labels(d, 'nuts').includes('Almond Trout D'), 'a new dish shows under each of its allergens on the back page');
check(/Almond Trout/.test(bh1) && /Almond Trout/.test(mh1) && !/Almond Trout/.test(bh0 + mh0) && !/Almond Trout/.test(pages.pageHTML(d, 'B')), '…and on the dinner menu page, and not on breakfast, from the one new row');
check(/almonds/.test(fh1) && /trout/.test(fh1), '…and the front page’s “on our menu” picks up what it comes from');
d.rows = d.rows.filter((r) => r.id !== 'm-tacos' && r.id !== 'm-new' && r.id !== 's-fries');
check(!labels(d, 'gluten').includes('Anything fried LD') && labels(d, 'gluten').includes('Anything fried D'), 'take the fried dishes off lunch and “Anything fried” drops lunch too (tofu is still fried at dinner)');
d = clone(A.doc());
const ld = c3.menuPage(d, 'LD'), b = c3.menuPage(d, 'B');
check(ld.rows.map((r) => r.name).join() === 'Build a Bowl,Fish Tacos,Garden Omelet,House Burger,Soup of the Day,Walnut Pasta' && ld.sides.map((r) => r.name).join() === 'Fries,Mashed potatoes,Rice', 'lunch and dinner page: dishes A to Z, sides apart, sauces and parts not as lines');
check(b.rows.map((r) => r.name).join() === 'Fruit Bowl,Garden Omelet,Pancakes,Porridge,Two Eggs', 'breakfast page: breakfast rows only');
const tacos = ld.rows.find((r) => r.id === 'm-tacos'), bowl = ld.rows.find((r) => r.id === 'm-bowl'), burger = ld.rows.find((r) => r.id === 'm-burger');
check(tacos.al.map((c) => c.code + (c.dashed ? '?' : '')).join() === 'DAI,FSH,GLU' && tacos.cross[0].chip === 'FRYER', 'chips in A to Z order by allergen name, then the shared-equipment chip');
check(burger.al.find((c) => c.code === 'SES').dashed && !burger.al.find((c) => c.code === 'EGG').dashed, 'unsure is dashed; in it is solid');
check(tacos.with.map((w) => w.name + '/' + w.mark + '/' + w.al.map((c) => c.code + (c.dashed ? '?' : '')).join('+')).join() === 'Slaw/D/EGG?,Hot sauce//', 'goes-out-with pulls each sauce’s own chips, and says when it’s dinner only');
check(bowl.parts.map((p) => p.name + '/' + p.mark + '/' + p.al.map((c) => c.code + (c.dashed ? '?' : '')).join('') + '/' + p.cross.map((c) => c.chip).join('')).join() === 'Tofu/D/SOY/FRYER,Chicken//SOY?/', 'choices inside a dish show with their own chips');
check(bowl.df === 'L' && burger.veg === 'D' && c3.menuPage(d, 'B').rows.find((r) => r.id === 'm-omelet').gf === 'opt', 'menu marks carry through (lunch-only, dinner-only, option)');
d.rows.find((r) => r.id === 'm-tacos').with.push({ ref: 'x-gone' });
check(c3.issues(d).some((i) => /Fish Tacos points to a sauce or part that was deleted/.test(i.text)), 'a sauce that was deleted is flagged, not silently dropped');

console.log('\n3. Kitchen checked clears on any change');
d = clone(A.doc());
check(!c3.isChecked(d) && /Draft · kitchen to check/.test(pages.pageHTML(d, 'back')) && /Kitchen checked <i class="c3-rule/.test(pages.pageHTML(d, 'front')), 'never checked → every page says Draft, with a line to sign');
c3.setStamp(d, 'Pat', '2026-01-12', 'AA');
check(c3.isChecked(d) && ['front', 'back', 'B', 'LD'].every((p) => !/Draft/.test(pages.pageHTML(d, p)) && /Kitchen checked: Pat · 1\/12\/26/.test(pages.pageHTML(d, p))), 'checked → no Draft tag; every page says who and when');
const changes = {
  'an allergen’s status': (x) => { x.rows[0].allergens[0].s = 'opt'; },
  'an allergen added': (x) => { x.rows[4].allergens = [{ a: 'nuts', s: 'ask' }]; },
  'an allergen removed': (x) => { x.rows[0].allergens.pop(); },
  'what it comes from': (x) => { x.rows[0].allergens[0].from = 'milk'; },
  'a name': (x) => { x.rows[2].name = 'Three Eggs'; },
  'the meals it’s on': (x) => { x.rows[2].meals = ['B', 'L']; },
  'the fryer mark': (x) => { x.rows[9].cross = ['fryer']; },
  'packaged': (x) => { x.rows[0].packaged = true; },
  'goes out with': (x) => { x.rows[0].with.pop(); },
  'a menu mark': (x) => { x.rows[0].gf = 'yes'; },
  'a row added': (x) => { x.rows.push({ id: 'm-z', name: 'Toast', kind: 'dish', meals: ['B'] }); },
  'a row deleted': (x) => { x.rows.splice(3, 1); },
  'rows reordered': (x) => { x.rows.reverse(); },
  'what the shared fryer carries': (x) => { x.kitchen[0].carries = ['gluten']; },
  'a note': (x) => { x.notes.fish.ask = []; },
  'a word on the front': (x) => { x.guide.rule.steps[0].t = 'Guess.'; },
  'the title': (x) => { x.card.title = 'Other'; }
};
for (const [what, fn] of Object.entries(changes)) { const x = clone(d); fn(x); check(!c3.isChecked(x) && /Draft · kitchen to check/.test(pages.pageHTML(x, 'back')), 'change ' + what + ' → draft again'); }
{ const x = clone(d); x.rows[0].updated = '2026-02-01'; x.rows[0].by = 'ZZ'; x.updated = '2026-02-01'; check(c3.isChecked(x), 'the date and initials of an edit alone don’t clear it'); }
{ const x = clone(d); x.stamp.name = 'Sam'; check(c3.isChecked(x), 'the stamp’s own fields aren’t part of what it covers'); x.stamp.hash = 'ffffffffffffffff'; check(!c3.isChecked(x), 'a stamp typed into the file by hand, without the card’s fingerprint, doesn’t count'); delete x.stamp.hash; check(!c3.isChecked(x), '…nor one with no fingerprint'); }
// Through the app: stamp, then save a row.
fields['cs-name'] = 'Pat'; fields['cs-date'] = '2026-01-12';
A.act('c3-stamp-save'); check(!c3.isChecked(A.doc()), 'marking it checked takes a second tap');
A.sure('c3-stamp-save'); check(c3.isChecked(A.doc()) && A.doc().stamp.name === 'Pat', 'second tap → Kitchen checked');
check(/Kitchen checked<\/b>/.test(A.card.cardView()) && !/Draft: kitchen to check/.test(A.card.cardView()), 'the card screen says so');
A.app.ui.editing = true;
A.act('c3-row', { id: 'm-eggs' });
Object.assign(fields, { 'c3-name': 'Two Eggs', 'c3-kind': 'dish', 'c3-m-B': true, 'c3-e0-a': 'egg', 'c3-e0-s': 'in', 'c3-e0-list': 'Eggs and omelets', 'c3-desc': 'any style' });
A.act('c3-row-save');
check(!c3.isChecked(A.doc()) && !A.doc().stamp && A.doc().rows.find((r) => r.id === 'm-eggs').desc === 'any style', 'saving a changed row on the phone clears the check');
check(/Draft: kitchen to check/.test(A.card.cardView()) && /Changed since Pat checked it on 1\/12\/26/.test(A.card.cardView()), 'the card screen says it changed since Pat checked it');
A.act('c3-row', { id: 'm-eggs' }); fields['c3-desc'] = ''; A.act('c3-row-save');
check(!c3.isChecked(A.doc()), 'changing it back doesn’t bring the check back: the kitchen checks again');
// Two phones: one marks it checked while the other changes a row. After the merge it's a draft.
{
  const base = clone(fixture('card3.json')), mine = clone(base), theirs = clone(base);
  c3.setStamp(mine, 'Pat', '2026-01-12', 'AA');
  theirs.rows.find((r) => r.id === 'm-pasta').allergens.push({ a: 'egg', s: 'ask', from: 'fresh pasta' });
  const m = A.merge.mergeDoc(base, mine, theirs).doc;
  check(!!m.stamp && m.rows.find((r) => r.id === 'm-pasta').allergens.length === 4 && !c3.isChecked(m) && /Draft/.test(pages.pageHTML(m, 'LD')), 'checked on one phone, a row changed on another: merged, the card is a draft');
  const m2 = A.merge.mergeDoc(base, theirs, mine).doc;
  check(!c3.isChecked(m2), '…whichever phone syncs second');
}

// Two phones change the same row's allergens between syncs. Picking one side could drop an allergen.
{
  const join = (pth) => /^\.rows\[[^\]]*\]\.(allergens|cross|with|parts)$/.test(pth) || /^\.kitchen\[[^\]]*\]\.carries$/.test(pth);
  const base = clone(fixture('card3.json')), mine = clone(base), theirs = clone(base);
  const row = (x, id) => x.rows.find((r) => r.id === id);
  row(mine, 'm-pasta').allergens.push({ a: 'egg', s: 'in', from: 'fresh pasta' });
  row(theirs, 'm-pasta').allergens.push({ a: 'sesame', s: 'ask', from: 'the oil' });
  row(mine, 'm-eggs').cross = ['fryer']; row(theirs, 'm-eggs').cross = ['griddle'];
  const egg0 = row(base, 'm-eggs').allergens.length;
  row(mine, 'm-eggs').allergens = []; row(theirs, 'm-eggs').allergens.push({ a: 'dairy', s: 'opt', from: 'butter' });
  for (const [who, a, b] of [['this phone first', mine, theirs], ['the other phone first', theirs, mine]]) {
    const m = A.merge.mergeDoc(base, a, b, { join });
    const al = row(m.doc, 'm-pasta').allergens.map((e) => e.a);
    check(al.includes('egg') && al.includes('sesame') && al.length === row(base, 'm-pasta').allergens.length + 2, 'both phones add an allergen to one row: both are kept (' + who + ')');
    check(row(m.doc, 'm-eggs').cross.slice().sort().join() === 'fryer,griddle', '…and both shared-equipment marks');
    check(row(m.doc, 'm-eggs').allergens.length === egg0 + 1, 'one phone takes allergens off while the other adds one: nothing is dropped; a person decides');
    check(m.conflicts.filter((c) => c.kept === 'both').length === 3, '…and each is recorded as a clash');
    check(/EGG/.test(pages.pageHTML(m.doc, 'LD').split('Walnut Pasta')[1].split('c3-tr')[0]) && /SES\?/.test(pages.pageHTML(m.doc, 'LD').split('Walnut Pasta')[1].split('c3-tr')[0]), '…and both chips print on the menu page');
  }
  const plain = A.merge.mergeDoc(base, mine, theirs);
  check(!row(plain.doc, 'm-pasta').allergens.some((e) => e.a === 'sesame'), '(without the rule, the ordinary merge would have dropped one: this is what the rule is for)');
  // On the phone: the card says which rows to check, and won't take a kitchen check until someone has.
  const Cp = await phone('CardC', withCard(A.merge.mergeDoc(base, mine, theirs, { join }).doc, { conflicts: A.merge.mergeDoc(base, mine, theirs, { join }).conflicts.map((c, i) => Object.assign({ id: 'cf' + i, key: 'menu', file: 'card3.json', at: '2026-01-12T10:00:00Z' }, c)).concat([{ id: 'cfx', key: 'inv', path: '.lines[x].par', kept: 'phone' }]) }));
  let ch = Cp.card.cardView();
  check(/Check these before trusting the card/.test(ch) && /Walnut Pasta:<\/b> its allergens changed on two phones at once. Everything from both was kept/.test(ch) && /Two Eggs:<\/b> its shared equipment marks/.test(ch), 'the card screen names the rows to check');
  fields['cs-name'] = 'Pat'; fields['cs-date'] = '2026-01-12'; Cp.sure('c3-stamp-save');
  check(!Cp.c3.isChecked(Cp.doc()), 'it can’t be marked kitchen checked while a clash is waiting');
  Cp.act('c3-clash-clear'); ch = Cp.card.cardView();
  check(!/before trusting the card/.test(ch) && Cp.S.conflicts.length === 1 && Cp.S.conflicts[0].key === 'inv', '“Got it” clears the card’s notes and leaves other clashes alone');
  Cp.sure('c3-stamp-save'); check(Cp.c3.isChecked(Cp.doc()), '…and then it can be checked');
}

console.log('\n4. Text from the shared file is shown as text');
const bad = clone(fixture('card3.json'));
const X = '<img src=x onerror=alert(1)>', Y = '"><script>alert(2)</script>';
(function soak(o) { for (const k of Object.keys(o)) { if (typeof o[k] === 'string' && !['id', 'a', 's', 'kind', 'ref', 'veg', 'gf', 'df'].includes(k) && !/^\d{4}-/.test(o[k])) o[k] = X + o[k] + Y; else if (o[k] && typeof o[k] === 'object') soak(o[k]); } })(bad);
bad.kitchen[0].id = 'fryer'; bad.rows.forEach((r) => { if (r.cross) r.cross = ['fryer']; if (r.meals) r.meals = r.meals.filter((m) => 'BLD'.includes(m)); });
bad.kitchen[0].carries = ['fish', X, 'gluten']; bad.kitchen[0].chip = X;
bad.rows.push(null, 'junk', { id: 7 }, { id: X, name: X, kind: X, meals: [X, 'B'], allergens: [null, { a: X, s: 'in' }, { a: 'egg', s: X }, { a: 'egg', s: 'in', from: X, list: X, sub: X }], cross: [X], with: [X, { ref: X, t: Y }, null], parts: 'junk', veg: X, gf: 'D', df: 'L' });
bad.stamp = { name: X, date: '2026-01-12', hash: c3.fingerprint(bad) };
const Xp = await phone('CardX', withCard(bad));
Xp.app.ui.editing = true;
let html = ['front', 'back', 'B', 'LD'].map((p) => Xp.pages.pageHTML(Xp.doc(), p)).join('') + Xp.card.cardView() + Xp.card.previewView() + Xp.card.printNote();
Xp.act('c3-row', { id: X }); html += els['sheet-root'].innerHTML;
Xp.act('c3-kit', { id: 'fryer' }); html += els['sheet-root'].innerHTML;
Xp.act('c3-note', { id: 'fish' }); html += els['sheet-root'].innerHTML;
Xp.act('c3-stamp'); html += els['sheet-root'].innerHTML;
Xp.app.ui.editing = false; Xp.act('c3-row', { id: X }); html += els['sheet-root'].innerHTML;
check(html.length > 60000 && !/<img|<script/i.test(html), 'no markup from the file gets into the pages, the screens or the editors (' + Math.round(html.length / 1000) + ' KB checked)');
check(/&lt;img src=x onerror=alert\(1\)&gt;/.test(html) && /&quot;&gt;&lt;script&gt;/.test(html), 'names, notes and chips show as plain text');
check(!/undefined|NaN|\[object/.test(text(html)), 'junk rows and junk fields are skipped, not drawn');
check(c3.rowsOf(bad).length === fixture('card3.json').rows.length + 1 && c3.issues(bad).some((i) => /can’t read/.test(i.text)), 'a row with unreadable allergen lines is flagged');

console.log('\n5. View-only access, and no card yet');
const V = await phone('CardV', withCard(fixture('card3.json'), { settings: Object.assign(fullPhone().settings, { perm: { train: { push: false } } }) }));
const before = JSON.stringify(V.doc());
V.app.ui.editing = true;
for (const a of ['c3-row-new', 'c3-kit-new', 'c3-stamp', 'c3-start']) V.act(a);
V.act('c3-note', { id: 'fish' }); V.sure('c3-stamp-save'); V.sure('c3-stamp-clear'); V.sure('c3-row-del'); V.act('c3-row-save'); V.sure('c3-kit-del', { id: 'fryer' }); V.act('c3-note-save', { id: 'fish' });
check(JSON.stringify(V.doc()) === before, 'with view-only access nothing changes');
const vh = V.card.cardView();
check(/View only/.test(vh) && !/c3-row-new|c3-stamp"|c3-kit-new/.test(vh) && /data-kind="card3"/.test(vh) && /Look at the pages/.test(vh), 'the screen says view only, offers no editing, and still previews and prints');
const N = await phone('CardN', Object.assign(fullPhone({ clash: false }), { menu: { base: null, local: null, sha: null } }));
check(/No allergen card yet/.test(N.card.cardView()) && N.card.printTarget() === null && !N.card.hasCard(), 'no card: says how to bring one in, and there’s nothing to print');
N.act('c3-start'); check(Array.isArray(N.doc().rows) && N.doc().rows.length === 0, 'an empty card can be started');
{ const m = await import(path.join(makePhone('CardM'), 'js/card3.js')); check(m.isCard(Object.assign({ type: 'the-sheet-card3' }, fixture('card3.json'))) && m.isCard(fixture('card3.json')) && !m.isCard(fixture('floorplans.json')) && !m.isCard(fixture('inventory.json')) && !m.isCard(fixture('book.json')), 'import knows a card file from the other kinds of file'); }

T.done();
