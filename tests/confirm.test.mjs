// The tap-twice confirm for deletes: no time limit, announced to screen readers, cancelled by
// tapping anywhere else (WCAG 2.2.1, 4.1.3).
import path from 'node:path';
import { makePhone, checker } from './lib/phone.mjs';

const T = checker();
const listeners = [];
const live = { textContent: '' };
globalThis.window = globalThis; globalThis.addEventListener = () => {};
globalThis.document = { addEventListener: (t, f) => listeners.push(f), querySelector: (s) => (s === '#sr-live' ? live : null), contains: () => true };
const mkBtn = () => { const a = { 'aria-label': 'Delete' }; return { dataset: {}, innerHTML: '<svg/>', textContent: '', classList: { add() {}, remove() {} }, getAttribute: (k) => a[k] ?? null, setAttribute: (k, v) => { a[k] = v; }, removeAttribute: (k) => { delete a[k]; }, contains: (t) => t === 'self', attrs: a }; };

const dir = makePhone('Confirm');
const { armed } = await import(path.join(dir, 'js/ui.js'));
const b = mkBtn();
const first = armed(b, 'Delete this count?');
await new Promise((r) => setTimeout(r, 4000));
T.check(first === false && b.dataset.armed === '1', 'still armed after 4 seconds (no time limit)');
T.check(/Tap again/.test(live.textContent), 'announced to screen readers');
listeners.forEach((f) => f({ target: 'self' }));
T.check(armed(b) === true, 'second tap confirms');
const c = mkBtn(); armed(c, 'Remove?');
listeners.forEach((f) => f({ target: 'elsewhere' }));
T.check(c.dataset.armed === '' && c.innerHTML === '<svg/>' && c.attrs['aria-label'] === 'Delete', 'tapping elsewhere cancels and puts the label back');
T.done();
