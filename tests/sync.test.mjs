// Sync tests: several phones sync against a fake GitHub, in Node (no browser needed).
// Phone A: the book owner. It starts with data from version 1.0 (one repo), then connects a
// shared inventory repo. Phone B: a coworker on an iPhone who only counts and orders.
// All names and data are made up (tests/fixtures).
import path from 'node:path';
import crypto from 'node:crypto';
import { makePhone, outDir, checker } from './lib/phone.mjs';
import { fixtureText } from './lib/fixtures.mjs';

const OUT = outDir();
const T = checker();
const check = T.check;

/* ---------- browser stubs (shared by both phones) ---------- */
const el = () => ({ classList: { add() {}, remove() {}, toggle() {} }, dataset: {}, style: {}, setAttribute() {}, remove() {}, querySelector: () => null, appendChild() {}, innerHTML: '', textContent: '' });
globalThis.window = globalThis;
globalThis.document = { querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, createElement: el, body: el(), activeElement: null, contains: () => false, addEventListener() {} };
globalThis.addEventListener = () => {};
let ua = 'Mozilla/5.0 (Linux; Android 14; SM-F741U) Chrome/130 Mobile Safari/537.36';
let standalone = true;
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { get userAgent() { return ua; }, platform: 'Linux armv8l', maxTouchPoints: 5, onLine: true, get standalone() { return standalone; }, storage: null } });
globalThis.matchMedia = (q) => ({ matches: q.includes('standalone') ? standalone : false, addEventListener() {} });
globalThis.requestAnimationFrame = (f) => setTimeout(f, 0);
globalThis.location = { hash: '' };

/* ---------- fake GitHub ---------- */
const GH = { repos: {}, tokens: {}, calls: [] };
const sha = (s) => crypto.createHash('sha1').update(s).digest('hex');
let nextId = 1000;
function addRepo(full, priv = true) { GH.repos[full.toLowerCase()] = { full, priv, files: {}, id: nextId++ }; }
function renameRepo(from, to) { const r = GH.repos[from.toLowerCase()]; delete GH.repos[from.toLowerCase()]; r.full = to; GH.repos[to.toLowerCase()] = r; for (const t of Object.keys(GH.tokens)) GH.tokens[t] = GH.tokens[t].map((x) => (x === from.toLowerCase() ? to.toLowerCase() : x)); }
const readOnly = new Set();
function putRaw(full, p, text) { GH.repos[full.toLowerCase()].files[p] = { text, sha: sha(text + Math.random()) }; }
const readJSON = (full, p) => { const f = GH.repos[full.toLowerCase()].files[p]; return f ? JSON.parse(f.text) : null; };
globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(url);
  const m = /^\/repos\/([^/]+)\/([^/]+)(.*)$/.exec(decodeURIComponent(u.pathname));
  const res = (status, body) => ({ status, ok: status >= 200 && status < 300, headers: { get: () => null }, json: async () => body });
  if (!m) return res(404, {});
  const full = (m[1] + '/' + m[2]).toLowerCase(), rest = m[3];
  const tok = (opts.headers && opts.headers.Authorization || '').replace('Bearer ', '');
  GH.calls.push((opts.method || 'GET') + ' ' + full + rest);
  if (GH.offline) throw new TypeError('Failed to fetch');
  const repo = GH.repos[full];
  if (!repo || !(GH.tokens[tok] || []).includes(full)) return res(404, { message: 'Not Found' });
  const canPush = !readOnly.has(tok);
  if (rest === '') return res(200, { id: repo.id, full_name: repo.full, private: repo.priv, permissions: { push: canPush, pull: true }, default_branch: 'main' });
  if (opts.method === 'PUT' && !canPush) return res(403, { message: 'Resource not accessible by personal access token' });
  const cm = /^\/contents\/(.+)$/.exec(rest);
  if (!cm) return res(404, {});
  const p = cm[1];
  if ((opts.method || 'GET') === 'GET') {
    if (!Object.keys(repo.files).length) return res(404, { message: 'This repository is empty.' });
    const f = repo.files[p];
    if (!f) return res(404, { message: 'Not Found' });
    return res(200, { sha: f.sha, encoding: 'base64', content: Buffer.from(f.text).toString('base64') });
  }
  if (opts.method === 'PUT') {
    const body = JSON.parse(opts.body);
    const f = repo.files[p];
    if (f && !body.sha) return res(422, { message: 'sha wasn’t supplied' });
    if (f && body.sha !== f.sha) return res(409, { message: 'conflict' });
    if (!f && body.sha) return res(422, {});
    const text = Buffer.from(body.content, 'base64').toString('utf8');
    const ns = sha(text + Date.now() + Math.random());
    repo.files[p] = { text, sha: ns, message: body.message };
    return res(200, { content: { sha: ns } });
  }
  return res(405, {});
};

/* ---------- a phone ---------- */
async function boot(name, preload) {
  const dir = makePhone(name, OUT);
  globalThis['__mem_' + name] = preload || {};
  const st = await import(path.join(dir, 'js/state.js'));
  const sy = await import(path.join(dir, 'js/sync.js'));
  const app = (await import(path.join(dir, 'js/app.js'))).app;
  const count = await import(path.join(dir, 'js/views/count.js'));
  const more = await import(path.join(dir, 'js/views/more.js'));
  app.register(count); app.register(more);
  app.route = { tab: 'count', sub: '', id: '' };
  await st.load();
  return { name, st, sy, app, count, more, S: st.S, act: (a, data = {}) => app.acts[a]({ dataset: data, disabled: false, innerHTML: '', classList: { add() {}, remove() {} } }) };
}
const settle = () => new Promise((r) => setTimeout(r, 400));

/* ---------- the world before 1.1 ---------- */
addRepo('owner/book');
addRepo('team/inventory');
for (const f of ['book.json', 'inventory.json', 'state.json']) putRaw('owner/book', f, fixtureText(f));
GH.tokens['tok-a-book'] = ['owner/book'];
GH.tokens['tok-a-inv'] = ['team/inventory'];
GH.tokens['tok-b-inv'] = ['team/inventory'];

const mb = GH.repos['owner/book'].files;
const slot = (f) => ({ base: JSON.parse(mb[f].text), local: JSON.parse(mb[f].text), sha: mb[f].sha, syncedAt: '2026-10-21T19:00:00Z' });
const oldState = slot('state.json');
const inv0 = JSON.parse(mb['inventory.json'].text);
const L1 = inv0.lines.find((l) => l.state === 'active' && l.products.length === 1);
const L2 = inv0.lines.filter((l) => l.state === 'active' && l.products.length === 1)[1];
oldState.local.invHistory = [{ id: 'h-old-1', date: '2026-10-27', savedAt: '2026-10-27T15:00:00Z', by: 'Alex', counts: { [L1.products[0].id]: 2 }, orders: {}, orderCount: 0, text: 'old count', updated: '2026-10-27' }];
const preA = {
  book: slot('book.json'), inv: slot('inventory.json'), state: oldState,
  settings: { owner: 'owner', repo: 'book', branch: 'main', token: 'tok-a-book', name: 'Alex', role: 'floor', theme: 'auto', quick: true, setupDone: true, created: '2026-10-21T00:00:00Z', lastSync: '2026-10-21T19:00:00Z' }
};

console.log('\n1. Phone A updates from 1.0 (old data, book repo only)');
const A = await boot('A', preA);
check(A.sy.appMode() === 'full', 'full mode');
check(!('invHistory' in A.S.state.local), 'saved counts moved out of state.json data');
check(A.S.counts.local && A.S.counts.local.history.length === 1 && A.S.counts.local.history[0].id === 'h-old-1', 'old saved count now in counts');
let r = await A.sy.syncAll();
check(!r.errors.length, 'sync ok: ' + (r.errors.map((e) => e.message).join(' ') || 'no errors'));
check(readJSON('owner/book', 'counts.json').history.length === 1, 'without a shared repo, counts.json goes to the book repo');
check(!('invHistory' in readJSON('owner/book', 'state.json')), 'state.json on GitHub no longer has invHistory');
check(r.conflicts === 0, 'no merge notes (' + r.conflicts + ')');

console.log('\n2. Phone A connects the shared inventory repo (empty)');
Object.assign(A.S.settings, { invOwner: 'team', invRepo: 'inventory', invToken: 'tok-a-inv', invBranch: 'main', initials: 'AA' });
check((await A.sy.testConnection(A.sy.conn('inv'))).private, 'connection test passes');
r = await A.sy.syncAll();
check(!r.errors.length, 'sync ok: ' + (r.errors.map((e) => e.message).join(' ') || 'no errors'));
check(readJSON('team/inventory', 'inventory.json').lines.length === inv0.lines.length, 'inventory.json pushed to shared repo (' + inv0.lines.length + ' lines)');
check(readJSON('team/inventory', 'counts.json').history.length === 1, 'counts.json pushed to shared repo');
check(!GH.repos['team/inventory'].files['book.json'] && !GH.repos['team/inventory'].files['state.json'], 'book and follow-ups did NOT go to the shared repo');
check(/\(AA\)/.test(GH.repos['team/inventory'].files['counts.json'].message), 'commit message carries initials');

console.log('\n3. Phone B sets up on an iPhone');
ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 Version/18.1 Mobile/15E148 Safari/604.1'; standalone = false;
const B = await boot('B', {});
check(B.sy.iosBrowserTab() === true, 'Safari tab detected → warning shows');
check(/Add The Sheet to your Home Screen/.test(B.more.render()), 'More screen shows the Home Screen warning in Safari');
standalone = true;
check(B.sy.iosBrowserTab() === false, 'installed home-screen app → no warning');
check(B.sy.appMode() === 'none', 'fresh phone is not set up');
check(B.more.parseRepo('https://github.com/team/inventory.git').repo === 'inventory', 'pasted link parses');
B.more.prefill('team', 'inventory', 'inv');
const setupHtml = B.more.render();
check(/Counting and ordering/.test(setupHtml) && /Inventory repo/.test(setupHtml) && /team\/inventory/.test(setupHtml), 'setup screen offers inventory-only, prefilled');
check(/Resource owner/.test(setupHtml), 'key steps tell them to pick the organization');
Object.assign(B.S.settings, { invOwner: 'team', invRepo: 'inventory', invToken: 'tok-b-inv', invBranch: 'main', initials: 'BB' });
r = await B.sy.syncAll();
check(!r.errors.length, 'sync ok: ' + (r.errors.map((e) => e.message).join(' ') || 'no errors'));
check(B.sy.appMode() === 'inv', 'inventory-only mode');
check(B.S.inv.local.lines.length === inv0.lines.length && B.S.counts.local.history.length === 1, 'got inventory and saved counts');
check(!B.S.book.local && !B.S.state.local, 'got no book, follow-ups or logs');
const bMore = B.more.render();
check(!/>Book</.test(bMore) && /Inventory/.test(bMore), 'More shows only the inventory connection');

console.log('\n4. Both count offline, save, then sync');
GH.offline = true;
A.S.count.counts[L1.products[0].id] = 0; A.S.count.counts[L2.products[0].id] = 1;
A.act('count-save');
B.S.count.counts[L1.products[0].id] = L1.par != null ? L1.par : 1; // at its minimum: B's count has nothing to order
B.act('count-save');
await settle();
check(A.S.counts.local.history.some((h) => h.by === 'AA'), 'A’s count saved with AA');
check(B.S.counts.local.history.some((h) => h.by === 'BB'), 'B’s count saved with BB');
GH.offline = false;
r = await A.sy.syncAll(); check(!r.errors.length, 'A synced');
r = await B.sy.syncAll(); check(!r.errors.length && r.conflicts === 0, 'B synced, no clashes');
r = await A.sy.syncAll(); check(!r.errors.length, 'A synced again');
const ids = (P) => P.S.counts.local.history.map((h) => h.id).sort().join(',');
check(A.S.counts.local.history.length === 3 && ids(A) === ids(B), 'both phones have all 3 saved counts');

console.log('\n5. Order status');
const withOrder = A.S.counts.local.history.filter((h) => h.orderCount > 0).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
console.log('     (saved counts with something to order: ' + withOrder.length + ')');
const latest = withOrder[0];
check(A.S.counts.local.history.slice().sort((a, b) => b.savedAt.localeCompare(a.savedAt))[0].orderCount === 0, '(setup: the newest count has nothing to order, so it mustn’t replace the one that does)');
check(latest.orderCount > 0 && latest.order && latest.order.status === 'saved', 'newest count with an order starts “not placed”');
check(/A saved order hasn’t been placed/.test(B.count.render({ sub: 'order' })), 'B’s Order tab shows the unplaced order');
B.act('ord-placed', { id: latest.id });
await B.sy.syncAll(); await A.sy.syncAll();
const aLatest = A.S.counts.local.history.find((h) => h.id === latest.id);
check(aLatest.order.status === 'placed' && aLatest.order.placedBy === 'BB', 'A sees it placed by BB');
const aOrder = A.count.render({ sub: 'order' });
check(/An order is on its way/.test(aOrder) && /Placed .* by BB/.test(aOrder), 'A’s Order tab says it’s on its way, placed by BB');
A.act('ord-received', { id: latest.id });
await A.sy.syncAll(); await B.sy.syncAll();
check(B.S.counts.local.history.find((h) => h.id === latest.id).order.status === 'received', 'received syncs back to B');
check(!/A saved order|on its way/.test(B.count.render({ sub: 'order' })), 'no open-order banner once received');
// Two unplaced orders: the older one is replaced by the newer one.
A.S.count.counts[L1.products[0].id] = 0; A.act('count-save'); await settle();
const firstOpen = A.S.counts.local.history.slice().sort((a, b) => b.savedAt.localeCompare(a.savedAt))[0];
await new Promise((r) => setTimeout(r, 15));
A.S.count.counts[L1.products[0].id] = 0; A.act('count-save'); await settle();
check(A.count.orderState(firstOpen) === 'replaced', 'an older unplaced order shows as replaced by a newer one');
check((A.count.render({ sub: 'order' }).match(/A saved order hasn’t been placed/g) || []).length === 1, 'only the newest unplaced order is flagged');
await A.sy.syncAll(); await B.sy.syncAll();

console.log('\n6. Same line, different fields: no clash');
A.S.settings.initials = 'AA';
const editLine = (P, id, fn) => P.st.edit('inv', (inv) => { const l = inv.lines.find((x) => x.id === id); fn(l); l.updated = P.st.S.settings.initials === 'AA' ? '2026-10-29' : '2026-10-30'; l.by = P.st.whoAmI(); });
editLine(A, L1.id, (l) => { l.note = 'top shelf'; });
editLine(B, L1.id, (l) => { l.name = l.name + ' (16 oz)'; });
await A.sy.syncAll(); r = await B.sy.syncAll(); await A.sy.syncAll();
const aL1 = A.S.inv.local.lines.find((l) => l.id === L1.id), bL1 = B.S.inv.local.lines.find((l) => l.id === L1.id);
check(r.conflicts === 0, 'no clash from bookkeeping fields (updated/by)');
check(aL1.note === 'top shelf' && /\(16 oz\)$/.test(aL1.name) && JSON.stringify(aL1) === JSON.stringify(bL1), 'both edits kept on both phones');

console.log('\n7. Same field on both phones: clash, then “use theirs”');
editLine(A, L2.id, (l) => { l.par = 4; });
editLine(B, L2.id, (l) => { l.par = 6; });
await A.sy.syncAll(); r = await B.sy.syncAll();
check(r.review === 1, 'B gets one clash to review');
const clash = B.S.conflicts.find((c) => c.review);
check(clash && clash.ours === 6 && clash.theirs === 4 && clash.who === 'AA', 'clash shows yours 6, AA’s 4');
const bCount = B.count.render({ sub: 'count' });
check(/1 change clashed/.test(bCount) && new RegExp(L2.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ': minimum').test(bCount) && /Use AA’s/.test(bCount), 'Count tab shows the clash with the item name and buttons');
check(B.S.inv.local.lines.find((l) => l.id === L2.id).par === 6, 'B’s value kept until they choose');
B.act('clash-theirs', { id: clash.id });
check(B.S.inv.local.lines.find((l) => l.id === L2.id).par === 4, 'use theirs → 4');
check(!B.S.conflicts.some((c) => c.review), 'clash cleared');
await B.sy.syncAll(); await A.sy.syncAll();
check(A.S.inv.local.lines.find((l) => l.id === L2.id).par === 4 && readJSON('team/inventory', 'inventory.json').lines.find((l) => l.id === L2.id).par === 4, 'everyone ends at 4');
check(!A.S.conflicts.some((c) => c.review), 'A has no clash');

console.log('\n8. Errors stay contained');
B.S.settings.invToken = 'expired';
r = await B.sy.syncAll();
check(r.errors.length === 1 && /Can’t see team\/inventory|Repo not found/.test(r.errors[0].message), 'bad key → clear message: ' + (r.errors[0] && r.errors[0].message));
check(!!B.S.settings.lastSyncError, 'status chip will show a sync problem');
B.S.settings.invToken = 'tok-b-inv';
r = await B.sy.syncAll();
check(!r.errors.length && !B.S.settings.lastSyncError, 'fixed key → problem clears');
GH.tokens['tok-a-inv'] = [];
r = await A.sy.syncAll();
check(r.errors.length && readJSON('owner/book', 'book.json') !== null, 'inventory key failing doesn’t stop the book from syncing');
GH.tokens['tok-a-inv'] = ['team/inventory'];

console.log('\n9. Auto-sync');
const before = GH.calls.length;
B.sy.autoSync('save', 0); await settle();
check(GH.calls.length > before, 'autoSync runs when online');
navigator.onLine = false;
const before2 = GH.calls.length;
B.sy.autoSync('save', 0); await settle();
check(GH.calls.length === before2, 'autoSync skips when offline');
navigator.onLine = true;

console.log('\n10. Moving to a new address: restore a backup on an empty phone');
await A.st.flush();
const backup = JSON.parse(JSON.stringify(globalThis.__mem_A)); delete backup.settings.token; delete backup.settings.invToken; delete backup.conflicts;
const C = await boot('C', backup);
check(C.sy.appMode() === 'full' && !C.sy.configured(), 'restored phone has the book but no keys');
const cMore = C.more.render();
check(/Restored from a backup/.test(cMore) && (cMore.match(/needs its key/g) || []).length === 2 && !/Sync now/.test(cMore), 'More asks only for the two keys, no Sync button');
Object.assign(C.S.settings, { token: 'tok-a-book', invToken: 'tok-a-inv' });
r = await C.sy.syncAll();
check(!r.errors.length && r.conflicts === 0, 'keys pasted → syncs cleanly with no clashes');
check(C.S.counts.local.history.length === A.S.counts.local.history.length, 'saved counts match the old phone');

console.log('\n11. View-only access (someone who should only look)');
GH.tokens['tok-viewer'] = ['team/inventory']; readOnly.add('tok-viewer');
const L = await boot('L', {});
Object.assign(L.S.settings, { invOwner: 'team', invRepo: 'inventory', invToken: 'tok-viewer', invBranch: 'main', initials: 'VV' });
let putsBefore = GH.calls.filter((c) => c.startsWith('PUT')).length;
r = await L.sy.syncAll();
check(!r.errors.length && r.readOnly.includes('inv'), 'syncs, reported as view only');
check(L.S.inv.local && L.S.counts.local.history.length === A.S.counts.local.history.length, 'gets items and saved counts');
check(L.sy.canWrite('counts') === false && L.sy.canWrite('inv') === false, 'app knows it can’t write');
const lOrder = L.count.render({ sub: 'order' });
check(/View only/.test(lOrder) && !/data-act="count-save"/.test(lOrder) && !/Mark placed|Mark received/.test(lOrder), 'Order tab: view-only note, no Save count, no order buttons');
check(!/data-act="item-add"/.test(L.count.render({ sub: 'items' })) && !/hist-del/.test(L.count.render({ sub: 'history' })), 'no add-line or delete buttons');
L.S.count.counts[L1.products[0].id] = 3; L.act('count-save');
check(!L.S.counts.local.history.some((h) => h.by === 'VV'), 'Save count refuses');
L.st.edit('inv', (inv) => { inv.lines[0].note = 'viewer scribble'; });
r = await L.sy.syncAll();
check(GH.calls.filter((c) => c.startsWith('PUT')).length === putsBefore, 'never sends anything to GitHub');
readOnly.delete('tok-viewer');
r = await L.sy.syncAll();
check(L.sy.canWrite('counts') === true && !/View only/.test(L.count.render({ sub: 'order' })), 'given write access on GitHub → editable on next sync, no new key');

console.log('\n12. Access removed, then given back');
GH.tokens['tok-b-inv'] = [];
r = await B.sy.syncAll();
check(r.errors.length === 1 && /access was removed/.test(r.errors[0].message), 'clear message: ' + (r.errors[0] && r.errors[0].message.slice(0, 80)) + '…');
check(/can’t reach the shared inventory anymore/.test(B.count.render({ sub: 'count' })) && B.sy.canWrite('counts') === false, 'Count tab says access is gone and goes view only');
check(/no access/.test(B.more.render()), 'More shows “no access”');
GH.tokens['tok-b-inv'] = ['team/inventory'];
r = await B.sy.syncAll();
check(!r.errors.length && B.sy.canWrite('counts') && !/can’t reach/.test(B.count.render({ sub: 'count' })), 'access back → normal again');

console.log('\n13. Organization renamed (same repo id)');
renameRepo('team/inventory', 'renamed-team/inventory');
for (const P of [A, B]) P.S.settings.invOwner = 'renamed-team';
const cfBefore = A.S.conflicts.length + B.S.conflicts.length;
r = await A.sy.syncAll(); const r2 = await B.sy.syncAll();
check(!r.errors.length && !r2.errors.length && A.S.conflicts.length + B.S.conflicts.length === cfBefore, 'both sync after the rename with no clashes or resets');
check(String(A.S.inv.src).startsWith('id:'), 'files are tied to the repo id, not its name');

console.log('\n14. Old backup connected to a repo with newer data');
const staleInv = JSON.parse(JSON.stringify(A.S.inv.local)); staleInv.lines.find((l) => l.id === L2.id).par = 9;
const extra = { id: 'h-only-on-old-phone', date: '2026-10-28', savedAt: '2026-10-28T12:00:00Z', by: 'AA', counts: {}, orders: {}, orderCount: 0, text: 'x', updated: '2026-10-28' };
const staleCounts = JSON.parse(JSON.stringify(A.S.counts.local)); staleCounts.history.push(extra);
const D = await boot('D', { inv: { base: staleInv, local: staleInv, sha: 'old', src: 'owner/book' }, counts: { base: null, local: staleCounts, sha: null, src: 'owner/book' }, settings: { invOwner: 'renamed-team', invRepo: 'inventory', invToken: 'tok-a-inv', initials: 'AA' } });
r = await D.sy.syncAll();
check(!r.errors.length && r.review === 0, 'no clash prompts');
check(D.S.inv.local.lines.find((l) => l.id === L2.id).par === 4, 'shared value wins over the stale backup (4, not 9)');
check(D.S.counts.local.history.some((h) => h.id === 'h-only-on-old-phone') && readJSON('renamed-team/inventory', 'counts.json').history.some((h) => h.id === 'h-only-on-old-phone'), 'a saved count only the old phone had is kept and shared');

console.log('\n15. Shared inventory disconnected');
const mbInvBefore = GH.repos['owner/book'].files['inventory.json'].sha;
A.S.settings.invToken = ''; A.S.settings.invOwner = ''; A.S.settings.invRepo = '';
A.st.edit('inv', (inv) => { inv.lines[0].note = 'after disconnect'; });
r = await A.sy.syncAll();
check(GH.repos['owner/book'].files['inventory.json'].sha === mbInvBefore, 'inventory does not fall back to the old book repo');
check(/Not connected/.test(A.more.render()), 'More shows inventory as not connected');

T.done();
