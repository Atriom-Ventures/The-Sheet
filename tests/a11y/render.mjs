// Draws every screen and the main sheets with a fake page, using the made-up sample data, and
// writes each one out as HTML for markup.py to check. Prints the folder it wrote to.
import fs from 'node:fs';
import path from 'node:path';
import { makePhone, outDir } from '../lib/phone.mjs';
import { fullPhone } from '../lib/fixtures.mjs';

const base = outDir();
const out = path.join(base, 'a11y-html');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const dir = makePhone('R', base);
const els = {};
const mk = (id) => (els[id] = els[id] || { id, innerHTML: '', textContent: '', value: '', dataset: {}, classList: { toggle() {}, add() {}, remove() {}, contains: () => false }, setAttribute() {}, removeAttribute() {}, focus() {}, querySelector: () => null, querySelectorAll: () => [], closest: () => null, addEventListener() {} });
const handlers = {};
globalThis.window = globalThis;
globalThis.document = {
  querySelector: (s) => (s.startsWith('#') ? mk(s.slice(1)) : null), querySelectorAll: () => [], getElementById: (id) => mk(id),
  createElement: () => mk('x' + Math.random()), body: mk('body'), documentElement: mk('html'), activeElement: null, contains: () => false,
  visibilityState: 'visible', addEventListener: (t, f) => { (handlers['doc:' + t] = handlers['doc:' + t] || []).push(f); }
};
globalThis.addEventListener = (t, f) => { (handlers['win:' + t] = handlers['win:' + t] || []).push(f); };
globalThis.scrollTo = () => {}; globalThis.requestAnimationFrame = (f) => setTimeout(f, 0);
globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
let hash = '';
globalThis.location = { get hash() { return hash; }, set hash(h) { hash = h.startsWith('#') ? h : '#' + h; (handlers['win:hashchange'] || []).forEach((f) => f()); }, replace(h) { hash = h; }, reload() {} };
globalThis.history = { replaceState: (a, b, h) => { hash = h; }, pushState() {}, back() {} };
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: 'test', platform: 'Linux', maxTouchPoints: 0, onLine: false, storage: null } });
globalThis.fetch = async () => { throw new TypeError('offline'); };
globalThis.__mem_R = fullPhone();

await import(path.join(dir, 'js/main.js'));
await new Promise((r) => setTimeout(r, 200));
const { app } = await import(path.join(dir, 'js/app.js'));
const { S, B } = await import(path.join(dir, 'js/state.js'));
const shell = () => mk('top-in').innerHTML + '\n' + mk('nav-in').innerHTML;
const save = (name, html) => fs.writeFileSync(path.join(out, name + '.html'), '<!doctype html><html lang="en"><body>' + html + '</body></html>');
save('_shell', shell());
const routes = ['#now', '#book', '#book/cards', '#book/sheet', '#book/day', '#count', '#count/order', '#count/history', '#count/items', '#lead', '#lead/floor', '#lead/msgs', '#lead/train', '#lead/wins', '#lead/printed', '#more', '#quick', '#book/maps', '#book/map/v-now/r-main', '#book/map/v-next/r-patio', '#book/allergens', '#book/allergens/preview'];
for (const h of routes) { location.hash = h; await new Promise((r) => setTimeout(r, 10)); save(h.slice(1).replace(/\//g, '-'), mk('view').innerHTML); }
// Edit mode in the book
location.hash = '#book'; app.ui.editing = true; app.renderView(); save('book-edit', mk('view').innerHTML); app.ui.editing = false;
// Floor plans in edit mode: the version list, a room with a table picked, and the walls with a corner picked.
location.hash = '#book/maps'; app.ui.editing = true; app.renderView(); save('maps-edit', mk('view').innerHTML);
location.hash = '#book/map/v-now/r-main'; app.ui.editing = true; app.acts['map-sel']({ dataset: { id: 't-7' } }); save('map-edit-table', mk('view').innerHTML);
app.acts['map-walls']({ dataset: {} }); app.acts['map-corner']({ dataset: { id: '2' } }); save('map-edit-walls', mk('view').innerHTML); app.acts['map-walls']({ dataset: {} }); app.ui.editing = false;
// The allergen card: edit mode, a row open to read and to edit, and its other sheets. The printed pages too.
location.hash = '#book/allergens'; app.ui.editing = true; app.renderView(); save('allergens-edit', mk('view').innerHTML);
{
  const sheet = (a, data = {}) => { mk('sheet-root').innerHTML = ''; app.acts[a]({ dataset: data, disabled: false, innerHTML: '', classList: { add() {}, remove() {} } }); return mk('sheet-root').innerHTML; };
  save('sheet-allergen-row-edit', sheet('c3-row', { id: 'm-tacos' }));
  save('sheet-allergen-row-new', sheet('c3-row-new'));
  save('sheet-allergen-kitchen', sheet('c3-kit', { id: 'fryer' }));
  save('sheet-allergen-note', sheet('c3-note', { id: 'fish' }));
  save('sheet-allergen-stamp', sheet('c3-stamp'));
  save('sheet-allergen-print', sheet('print', { kind: 'card3' }));
  app.ui.editing = false;
  save('sheet-allergen-row-view', sheet('c3-row', { id: 'm-burger' }));
  const pg = await import(path.join(dir, 'js/card3pages.js'));
  save('sheet-allergen-pages', pg.allPages(S.menu.local));
}
// Open an item editor on the Items tab
const firstLine = S.inv.local && S.inv.local.lines[0];
location.hash = '#count/items'; if (firstLine) { try { app.acts['item-open']({ dataset: { id: firstLine.id } }); } catch (e) {} app.renderView(); save('count-items-open', mk('view').innerHTML); }
// Sheets
const act = (a, data = {}) => { try { mk('sheet-root').innerHTML = ''; app.acts[a]({ dataset: data, disabled: false, innerHTML: '', classList: { add() {}, remove() {} } }); } catch (e) { console.error(a, e.message); } return mk('sheet-root').innerHTML; };
const card = (B().cards || [])[0];
if (card) save('sheet-card', act('open-card', { id: card.id }));
if (card) save('sheet-card-edit', act('card-edit', { id: card.id }));
save('sheet-notes', act('notes', {}));
const f = (S.state.local && S.state.local.follow || [])[0];
if (f) save('sheet-ask-edit', act('ask-edit', { id: f.id }));
save('sheet-floor-add', act('fp-edit', {}));
const fp = (S.floor.people || [])[0];
if (fp) save('sheet-floor-edit', act('fp-edit', { id: fp.id }));
const tr = (S.trainees || [])[0];
if (tr) save('sheet-trainee', act('tr-open', { id: tr.id }));
const asg = (B().assignments || [])[0];
if (asg) save('sheet-asg-edit', act('asg-edit', { id: asg.id }));
if (f) save('sheet-ask-answer', act('ask-answer', { id: f.id }));
const list = (B().lists || [])[0];
if (list) save('sheet-list-edit', act('list-edit', { id: list.id }));
const task = (B().tasks || [])[0];
if (task) save('sheet-task-edit', act('task-edit', { id: task.id }));
save('sheet-print', act('print', { kind: 'book' }));
const tm = /data-act="open-tmpl" data-id="([^"]+)"/.exec((location.hash = '#lead/msgs', mk('view').innerHTML));
if (tm) save('sheet-tmpl', act('open-tmpl', { id: tm[1] }));
// How a line is counted (one in sleeves with a per-case number, one in cases), and a section's name.
location.hash = '#count';
save('sheet-how-sleeves', act('inv-how', { line: 'ln-cups' }));
save('sheet-how-cases', act('inv-how', { line: 'ln-napkins' }));
save('sheet-section-rename', act('cat-rename', { id: 'paper' }));
save('sheet-section-new', act('cat-new', {}));
// Shift notes with an earlier shift waiting, on each of its three parts.
S.shift.held = [{ key: '2026-01-14|PM', notes: [{ id: 'nh1', t: '18:05', tag: 'equip', text: 'Ice machine slow' }], f: {}, sentAt: null }];
save('sheet-notes-report', act('notes', { seg: 'report' }));
save('sheet-notes-earlier', act('notes', { seg: 'earlier' }));
S.shift.sentAt = '12:30'; S.shift.sentHow = 'copied';
save('sheet-notes-sent', act('notes', {}));
// My jobs, for anyone who turns it back on.
S.settings.showJobs = true; location.hash = '#lead'; location.hash = '#now'; save('now-with-jobs', mk('view').innerHTML); S.settings.showJobs = false;
console.log(out);
process.exit(0);
