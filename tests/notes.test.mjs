// Shift notes: notes from an earlier shift never block a new one, and the app always says what's saved
// on the phone and whether the report has gone out. Uses made-up notes; no GitHub needed.
import path from 'node:path';
import { makePhone, checker } from './lib/phone.mjs';
import { fullPhone } from './lib/fixtures.mjs';

const T = checker();
const check = T.check;

/* ---------- a small fake page: elements by id, enough for the notes sheet ---------- */
const els = {};
const mk = (id) => (els[id] = els[id] || { id, value: '', innerHTML: '', textContent: '', dataset: {}, style: {}, classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {}, removeAttribute() {}, focus() {}, querySelector: () => ({ focus() {} }) });
globalThis.window = globalThis;
globalThis.document = {
  querySelector: (s) => (s.startsWith('#') ? mk(s.slice(1)) : null), querySelectorAll: () => [], getElementById: (id) => mk(id),
  createElement: () => mk('x' + Math.random()), body: mk('body'), documentElement: mk('html'), activeElement: null, contains: () => false, addEventListener() {}
};
globalThis.addEventListener = () => {};
globalThis.history = { state: null, pushState() {}, back() {}, replaceState() {} };
globalThis.location = { hash: '' };
globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
globalThis.requestAnimationFrame = (f) => setTimeout(f, 0);
let clip = '';
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: 'test', platform: 'Linux', maxTouchPoints: 0, onLine: false, storage: null, clipboard: { writeText: async (t) => { clip = t; } } } });
globalThis.fetch = async () => { throw new TypeError('offline'); };

const pad = (n) => String(n).padStart(2, '0');
const keyOf = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const yesterday = keyOf(new Date(Date.now() - 86400000)) + '|PM';
const twoDaysAgo = keyOf(new Date(Date.now() - 2 * 86400000)) + '|AM';

async function phone(name, shift, settings) {
  const dir = makePhone(name);
  const mem = fullPhone({ clash: false });
  mem.shift = shift;
  Object.assign(mem.settings, settings || {});
  globalThis['__mem_' + name] = mem;
  const st = await import(path.join(dir, 'js/state.js'));
  const app = (await import(path.join(dir, 'js/app.js'))).app;
  const shiftMod = await import(path.join(dir, 'js/shift.js'));
  const ui = await import(path.join(dir, 'js/ui.js'));
  app.register(shiftMod);
  await st.load();
  const btn = (data) => ({ dataset: data, innerHTML: '', textContent: '', classList: { add() {}, remove() {} }, setAttribute() {}, removeAttribute() {}, getAttribute: () => null });
  return { st, S: st.S, shift: shiftMod, ui, act: (a, data = {}) => app.acts[a](btn(data)) };
}
const note = (id, text, tag = 'next') => ({ id, t: '18:10', tag, text });

console.log('\n1. Notes from an earlier shift that were never sent don’t block a new one');
{
  const P = await phone('Held', { key: yesterday, notes: [note('n1', 'Ice machine slow', 'equip'), note('n2', 'Low on lids', '86')], f: {}, sentAt: null });
  check(P.S.shift.key !== yesterday && P.S.shift.notes.length === 0, 'a new shift starts with no notes');
  check((P.S.shift.held || []).length === 1 && P.S.shift.held[0].notes.length === 2, 'yesterday’s unsent notes are kept, under Earlier');
  P.shift.openNotes('notes');
  mk('note-text').value = 'Patio umbrellas up';
  P.act('note-add');
  check(P.S.shift.notes.length === 1 && P.S.shift.notes[0].text === 'Patio umbrellas up', 'and a new note goes in right away (it used to say “send or clear last shift’s notes first”)');
  const card = P.shift.notesCard();
  check(/1 earlier shift not sent/.test(card), 'the Now card says an earlier shift is waiting: ' + (/(\d+ earlier[^<]*)/.exec(card) || [])[1]);
  check(/Saved on this phone · report not sent yet/.test(card), 'and says this shift’s notes are saved on the phone and not sent');
  const r = P.shift.reportText(P.S.shift.held[0]);
  check(/Ice machine slow/.test(r) && /Low on lids/.test(r) && /^Shift report · PM/.test(r), 'the earlier shift has its own report with its own notes');
  check(!/Checklists:/.test(r), 'without today’s checklist status in it');
  P.act('notes-seg', { id: 'earlier' });
  await P.act('held-copy', { i: '0' });
  check(clip === r && !!P.S.shift.held[0].sentAt, 'copying it marks it sent');
  check(/Report copied at/.test(mk('notes-body').innerHTML), 'and the sheet says so');
  P.ui.closeSheet(true);
  // Next shift: the sent one clears; this shift's unsent note is held.
  P.S.shift.key = twoDaysAgo; P.st.rollDay();
  check(P.S.shift.held.length === 1 && P.S.shift.held[0].notes[0].text === 'Patio umbrellas up', 'at the next shift the sent report clears and the unsent shift is held');
  P.act('held-del', { i: '0', armed: '1' });
  check(P.S.shift.held.length === 0, 'an earlier shift can be deleted (two taps)');
}

console.log('\n2. Sent notes clear when the next shift starts');
{
  const P = await phone('Sent', { key: yesterday, notes: [note('n1', 'Smooth close')], f: {}, sentAt: '20:05', sentHow: 'copied' });
  check(P.S.shift.notes.length === 0 && (P.S.shift.held || []).length === 0, 'a sent report’s notes are gone at the next shift, not held');
}

console.log('\n3. A note added after the report went out counts as not sent');
{
  const P = await phone('After', null);
  P.shift.addNote('First thing', 'next');
  P.S.shift.sentAt = '12:00'; P.S.shift.sentHow = 'shared';
  check(/Report shared at 12:00p/.test(P.shift.notesCard()), 'the card says when the report was shared');
  P.shift.addNote('Second thing', 'order');
  check(P.S.shift.sentAt == null, 'adding a note afterwards marks the report not sent');
  P.S.shift.key = yesterday; P.st.rollDay();
  check(P.S.shift.held.length === 1 && P.S.shift.held[0].notes.length === 2, 'so at the next shift nothing new is dropped: both notes are held');
}

console.log('\n4. Typed but not added');
{
  const P = await phone('Draft', null);
  P.shift.openNotes('notes');
  const box = mk('note-text'); box.value = 'Half a thought';
  P.shift.onInput(box, { type: 'input' });
  check(P.S.shift.draft === 'Half a thought', 'what’s typed is kept on the phone as it’s typed');
  P.ui.closeSheet(true);
  check(P.S.shift.notes.some((n) => n.text === 'Half a thought') && !P.S.shift.draft, 'closing the sheet adds it as a note instead of losing it');
}

console.log('\n5. Picked jobs stay out of the report unless My jobs is on');
{
  const P = await phone('Jobs', null);
  P.S.day.mine = P.st.B().assignments.filter((a) => a.shift === 'am').slice(0, 2).map((a) => a.id);
  check(P.S.day.mine.length === 2, '(setup: two AM jobs picked)');
  P.S.shift.key = P.S.shift.key.replace(/\|PM$/, '|AM');
  const off = P.shift.reportText();
  P.S.settings.showJobs = true;
  const on = P.shift.reportText();
  check(!/My assignments/.test(off), 'off (the default): no “My assignments” line');
  check(/My assignments/.test(on), 'on: picked jobs are reported as before');
}

console.log('\n6. The sheet left open across a shift change');
{
  // The lead opens the report, the phone is locked, and the next shift has started when they come back.
  const P = await phone('Stale', null);
  P.shift.openNotes('notes');
  mk('note-text').value = 'Ice machine slow'; P.act('note-add');
  P.act('notes-seg', { id: 'report' });
  check(/Ice machine slow/.test(mk('rep-chit').textContent), '(setup: the report on screen has the note)');
  const mine0 = P.S.shift.key;
  // Move the AM/PM line so that "now" falls in the other shift, which is what the clock passing it does.
  P.st.B().day = Object.assign({}, P.st.B().day, { pmStart: /\|PM$/.test(mine0) ? '23:59' : '00:01' });
  P.st.rollDay();                        // the app notices when it comes back to the front, as main.js does
  clip = '';
  await P.act('notes-copy');
  check(!/Smooth shift/.test(clip), 'Copy report doesn’t copy the new shift’s empty report while the screen shows the earlier one (copied: ' + JSON.stringify(clip.slice(0, 40)) + ')');
  check(P.S.shift.key !== mine0 && !P.S.shift.sentAt && P.S.shift.notes.length === 0, '…and the new, empty shift isn’t marked as sent');
  check(P.S.shift.held.length === 1 && /Ice machine slow/.test(mk('notes-body').innerHTML) && /held-copy/.test(mk('notes-body').innerHTML), 'the sheet switches to Earlier, where those notes now are, still unsent');
  await P.act('held-copy', { i: '0' });
  check(/Ice machine slow/.test(clip) && !!(P.S.shift.held[0] || {}).sentAt, 'sending from there copies the notes and marks that shift sent');

  // Buttons under Earlier are for the shift they were drawn for, even if the list has changed since.
  const Q = await phone('Stale2', { key: yesterday, notes: [note('n3', 'Second thing')], f: {}, sentAt: null, held: [{ key: twoDaysAgo, notes: [note('n4', 'First thing')], f: {}, sentAt: '18:00', sentHow: 'copied' }] });
  check(Q.S.shift.held.length === 1 && Q.S.shift.held[0].notes[0].text === 'Second thing', '(setup: the sent shift cleared; one unsent shift is held)');
  Q.S.shift.held.unshift({ key: twoDaysAgo, notes: [note('n5', 'Older thing')], f: {}, sentAt: null });
  Q.shift.openNotes('earlier');
  const k = (/data-act="held-del"[^>]*data-k="([^"]*)"/.exec(mk('sheet-root').innerHTML.split('Second thing')[1] || '') || [])[1];
  check(k === yesterday, 'each Earlier button names its shift, not its place in the list');
  Q.S.shift.held.shift();                // the list changes underneath (a shift rolled over)
  await Q.act('held-del', { k, armed: '1' });
  check(Q.S.shift.held.length === 0, 'Delete removes the shift it was drawn for');
  Q.S.shift.held = [{ key: twoDaysAgo, notes: [note('n6', 'Keep me')], f: {}, sentAt: null }];
  await Q.act('held-del', { k, armed: '1' });
  check(Q.S.shift.held.length === 1, '…and never a different one');
}

T.done();
