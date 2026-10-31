// When the app goes to the background (switching apps, locking the phone), anything waiting to be
// saved is saved right away. iOS can close a backgrounded app without warning, and saves normally
// wait a moment (150 ms; item edits 350 ms) so typing doesn't write on every key.
import path from 'node:path';
import { makePhone, outDir, checker } from './lib/phone.mjs';
import { fullPhone } from './lib/fixtures.mjs';

const T = checker();
const els = {};
const mk = (id) => (els[id] = els[id] || { id, innerHTML: '', textContent: '', classList: { toggle() {}, add() {}, remove() {} }, setAttribute() {}, removeAttribute() {}, focus() {}, querySelector: () => null });
const handlers = {};
const fire = (key, ev = {}) => (handlers[key] || []).forEach((f) => f(ev));
globalThis.window = globalThis;
globalThis.document = {
  querySelector: (s) => (s.startsWith('#') ? mk(s.slice(1)) : null), querySelectorAll: () => [], getElementById: (id) => mk(id),
  createElement: () => mk('x' + Math.random()), body: mk('body'), documentElement: mk('html'), activeElement: null, contains: () => false,
  visibilityState: 'visible', title: '', addEventListener: (t, f) => { (handlers['doc:' + t] = handlers['doc:' + t] || []).push(f); }
};
globalThis.addEventListener = (t, f) => { (handlers['win:' + t] = handlers['win:' + t] || []).push(f); };
globalThis.scrollTo = () => {};
globalThis.requestAnimationFrame = (f) => setTimeout(f, 0);
globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
let hash = '#count';
globalThis.location = { get hash() { return hash; }, set hash(h) { hash = h; }, replace(h) { hash = h; }, reload() {} };
globalThis.history = { replaceState: (a, b, h) => { hash = h; }, pushState() {}, back() {} };
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: 'test', platform: 'Linux', maxTouchPoints: 0, onLine: false, storage: null } });
globalThis.fetch = async () => { throw new TypeError('offline'); };

const dir = makePhone('Bg', outDir());
globalThis.__mem_Bg = fullPhone();
await import(path.join(dir, 'js/main.js'));
await new Promise((r) => setTimeout(r, 300));
const { S, save } = await import(path.join(dir, 'js/state.js'));
const count = await import(path.join(dir, 'js/views/count.js'));
const stored = () => globalThis.__mem_Bg;
const soon = () => new Promise((r) => setTimeout(r, 20)); // well under the normal save delays
const hide = () => { document.visibilityState = 'hidden'; fire('doc:visibilitychange'); };
const show = () => { document.visibilityState = 'visible'; fire('doc:visibilitychange'); };

console.log('\n1. A count typed just before switching apps');
S.count.counts['p-cups'] = 7; save('count');
hide(); await soon();
T.check(stored().count.counts['p-cups'] === 7, 'saved to the phone right away (7 cups)');
show();

console.log('\n2. A count typed just before the app is closed');
S.count.counts['p-cups'] = 8; save('count');
fire('win:pagehide'); await soon();
T.check(stored().count.counts['p-cups'] === 8, 'saved on page hide (8 cups)');

console.log('\n3. An item edit typed just before switching apps');
const field = { dataset: { ie: 'par', line: 'ln-cups' }, value: '9', classList: { add() {}, remove() {} }, setAttribute() {}, removeAttribute() {} };
count.onInput(field, { type: 'input' });
hide(); await soon();
const line = stored().inv.local.lines.find((l) => l.id === 'ln-cups');
T.check(line && line.par === 9, 'the new minimum (9) is in the saved inventory');
show();

console.log('\n4. Coming back still works');
T.check(document.title.endsWith('The Sheet'), 'the app draws again when it comes back');
T.done();
