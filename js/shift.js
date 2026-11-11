// Shift notes: jot things down during the shift, then send them as one report.
// Notes stay on this phone only, and roll over once the report has been copied or shared.

import { app } from './app.js';
import { S, B, save, curShiftKey, isTicked, tasksOf, blocks, pmStart, sign, signName, rollDay } from './state.js';
import { esc, fmt12, toMin, hhmmNow, nowMin, fmtDateKey, uid, $, copyText, shareText } from './util.js';
import { ICON, openSheet, closeSheet, setSheetTitle, toast, chip, seg, opts, armed } from './ui.js';

export const NOTE_TAGS = [
  ['next', 'Next shift', 'Next shift needs to know', 'What the next shift needs to know'],
  ['86', '86 / low', '86’d or running low', 'What ran out or is running low'],
  ['order', 'Order', 'Needs ordering', 'What needs ordering'],
  ['equip', 'Equipment', 'Equipment problems', 'What’s broken or acting up, and who you told'],
  ['resident', 'Resident', 'Resident feedback', 'Feedback or a concern. Room or table only, never names.'],
  ['team', 'Team', 'Team notes', 'Who stepped up, or what the team needs'],
  ['win', 'Win', 'Wins', 'What went well'],
  ['other', 'Other', 'Other notes', 'Anything else']
];
const tagName = (k) => (NOTE_TAGS.find((x) => x[0] === k) || [k, k])[1];
export const keyLabel = (key) => { const p = String(key || '').split('|'); return (p[1] || '') + ' · ' + fmtDateKey(p[0]); };
const held = () => (S.shift.held || []);
const unsentHeld = () => held().filter((h) => !h.sentAt);
const sentLine = (rec) => (rec.sentHow === 'shared' ? 'Report shared at ' : 'Report copied at ') + fmt12(toMin(rec.sentAt));
const tempNum = (v) => { const n = parseFloat(v); return isNaN(n) ? null : Math.round(n * 10) / 10; };

let ui = null; // { seg, tag, key }: key is the shift the sheet was drawn for

function checklistStatus() {
  const sh = String(S.shift.key || '').split('|')[1] || 'AM', pm = pmStart(), t = nowMin();
  const ids = blocks().filter((b) => (sh === 'AM' ? b.s < pm : b.s >= pm) && b.s <= t).map((b) => b.id);
  const out = [];
  B().lists.filter((l) => !l.standards && !l.draft).forEach((l) => {
    let its;
    if (l.byBlock) its = tasksOf(l.id).filter((x) => ids.indexOf(x.block) >= 0);
    else if ((l.blocks || []).some((b) => ids.indexOf(b) >= 0)) its = tasksOf(l.id);
    else return;
    if (!its.length || !its.some((x) => isTicked(x.id))) return;
    out.push({ name: l.name, total: its.length, left: its.filter((x) => !isTicked(x.id)) });
  });
  return out;
}
function leftList(left) {
  const names = left.map((t) => { let s = t.text.split(/[:.]/)[0].trim().replace(/^./, (c) => c.toLowerCase()); return s.length > 60 ? s.slice(0, 57).replace(/\s+\S*$/, '') + '…' : s; });
  return names.slice(0, 4).join('; ') + (names.length > 4 ? '; and ' + (names.length - 4) + ' more' : '') + '.';
}

export function reportText(rec) {
  rec = rec || S.shift;
  const cur = rec === S.shift, f = rec.f || {}, p = String(rec.key).split('|');
  const L = ['Shift report · ' + p[1] + ' · ' + fmtDateKey(p[0])];
  const lead = String(f.lead != null ? f.lead : signName()).trim();
  if (lead) L.push('Floor: ' + lead);
  if (String(f.on || '').trim()) L.push('On: ' + f.on.trim());
  const r = tempNum(f.reach), m = tempNum(f.milk);
  if (r != null || m != null) {
    L.push('Fridge temps: ' + [r != null ? 'reach-in ' + r + '°F' : '', m != null ? 'milk fridge ' + m + '°F' : ''].filter(Boolean).join(', '));
    const hot = [r != null && r > 41 ? 'reach-in' : '', m != null && m > 41 ? 'milk fridge' : ''].filter(Boolean);
    if (hot.length) L.push('Above 41°F: ' + hot.join(' and ') + '. Needs a check.');
  }
  NOTE_TAGS.forEach(([k, , label]) => {
    const ns = rec.notes.filter((n) => n.tag === k);
    if (ns.length) { L.push('', label + ':'); ns.forEach((n) => L.push('• ' + n.text + ' (' + fmt12(toMin(n.t)) + ')')); }
  });
  if (!rec.notes.length) L.push('', 'Smooth shift. Nothing to hand off.');
  if (f.incl !== false && cur) {
    const cl = checklistStatus();
    const mine = S.settings.showJobs ? B().assignments.filter((a) => S.day.mine.indexOf(a.id) >= 0 && a.shift === (p[1] || '').toLowerCase()) : [];
    if (cl.length || mine.length) {
      L.push('', 'Checklists:');
      cl.forEach((c) => L.push('• ' + c.name + ' ' + (c.total - c.left.length) + '/' + c.total + (c.left.length ? '. Not done: ' + leftList(c.left) : ' ✓')));
      if (mine.length) { const left = mine.filter((a) => !isTicked(a.id)); L.push('• My assignments ' + (mine.length - left.length) + '/' + mine.length + (left.length ? '. Not done: ' + leftList(left) : ' ✓')); }
    }
  }
  if (!lead) sign(L);
  return L.join('\n');
}

function noteRows(rec, del) {
  if (!rec.notes.length) return '<li class="empty small">No notes yet this shift.</li>';
  return rec.notes.slice().reverse().map((n) =>
    '<li class="task"><span class="stdrow note-row"><span class="mono n-time">' + fmt12(toMin(n.t)) + '</span><span class="t-text"><span class="n-tag mono">' + esc(tagName(n.tag)) + '</span>' + esc(n.text) + '</span></span>' +
    (del ? '<button class="icon-b" data-act="note-del" data-id="' + esc(n.id) + '" aria-label="Delete this note">' + ICON.close + '</button>' : '') + '</li>').join('');
}
/* One line that says where these notes are: on this phone, and whether the report has gone out. */
function saveState(rec) {
  const n = rec.notes.length;
  if (rec.sentAt) return '<p class="save-state sent">' + ICON.check + '<span><b>' + esc(sentLine(rec)) + '.</b> ' + (n ? 'These notes stay on this phone until the next shift starts, then clear.' : '') + '</span></p>';
  if (!n) return '<p class="save-state">' + ICON.note + '<span>Notes save on this phone when you tap <b>Add</b>. Only this phone has them: they aren’t synced or backed up.</span></p>';
  return '<p class="save-state unsent">' + ICON.note + '<span><b>' + n + (n === 1 ? ' note' : ' notes') + ' saved on this phone. Report not sent yet.</b> Copy or share it when the shift ends.</span></p>';
}
function heldHTML() {
  const list = held().slice().reverse();
  if (!list.length) return '<p class="empty small">Nothing waiting from earlier shifts.</p>';
  return '<p class="hint" style="margin:0 2px 12px">Notes from earlier shifts whose report was never copied or shared. They stay on this phone until you send or delete them.</p>' + list.map((h) => {
    const i = held().indexOf(h);
    return '<section class="held"><div class="row-h"><h3 class="sec-h">' + esc(keyLabel(h.key)) + '</h3><span class="mono cnt">' + h.notes.length + (h.notes.length === 1 ? ' note' : ' notes') + '</span></div>' +
      (h.sentAt ? '<p class="save-state sent">' + ICON.check + '<span><b>' + esc(sentLine(h)) + '.</b> Clears when the next shift starts.</span></p>' : '') +
      '<ul class="tasks">' + noteRows(h, false) + '</ul>' +
      '<div class="row-actions"><button class="btn small primary" data-act="held-copy" data-i="' + i + '" data-k="' + esc(h.key) + '">' + ICON.copy + ' Copy report</button><button class="btn small ghost" data-act="held-share" data-i="' + i + '" data-k="' + esc(h.key) + '">' + ICON.share + ' Share</button><button class="btn small danger" data-act="held-del" data-i="' + i + '" data-k="' + esc(h.key) + '">' + ICON.trash + ' Delete</button></div></section>';
  }).join('');
}
function body() {
  const rec = S.shift, f = rec.f || {}, k = unsentHeld().length || held().length;
  let h = saveState(rec);
  const segs = [['notes', 'Notes' + (rec.notes.length ? ' (' + rec.notes.length + ')' : '')], ['report', 'Report']];
  if (k) segs.push(['earlier', 'Earlier (' + k + ')']);
  if (ui.seg === 'earlier' && !k) ui.seg = 'notes';
  h += seg('notes-seg', segs, ui.seg);
  if (ui.seg === 'notes') {
    const tag = NOTE_TAGS.find((x) => x[0] === ui.tag) || NOTE_TAGS[0];
    h += '<div class="chips tag-chips" role="group" aria-label="Kind of note">' + NOTE_TAGS.map((t) => chip('note-tag', t[0], t[1], t[0] === ui.tag)).join('') + '</div>' +
      '<div class="note-add"><label class="sr" for="note-text">Note</label><textarea id="note-text" rows="2" placeholder="' + esc(tag[3]) + '" enterkeyhint="send">' + esc(rec.draft || '') + '</textarea><button class="btn primary" data-act="note-add">Add</button></div>' +
      '<p class="hint" style="margin:8px 2px 14px">Room or table, never resident names or health details. Anything left in the box is added when you close this.</p>' +
      '<ul class="tasks" id="notes-list">' + noteRows(rec, true) + '</ul>';
  } else if (ui.seg === 'report') {
    const hot = (v) => { const n = tempNum(v); return n != null && n > 41 ? ' hot' : ''; };
    h += '<div class="form">' +
      '<div class="field half"><label for="rep-lead"><span class="l">Ran the floor</span></label><input id="rep-lead" data-rf="lead" value="' + esc(f.lead != null ? f.lead : signName()) + '" placeholder="Name"></div>' +
      '<div class="field half"><label for="rep-on"><span class="l">Who was on</span><span class="hint">Optional</span></label><input id="rep-on" data-rf="on" value="' + esc(f.on || '') + '"></div>' +
      '<div class="field half"><label for="rep-reach"><span class="l">Reach-in °F</span></label><input id="rep-reach" data-rf="reach" class="temp' + hot(f.reach) + '" type="number" inputmode="decimal" step="0.5" value="' + esc(f.reach || '') + '"></div>' +
      '<div class="field half"><label for="rep-milk"><span class="l">Milk fridge °F</span></label><input id="rep-milk" data-rf="milk" class="temp' + hot(f.milk) + '" type="number" inputmode="decimal" step="0.5" value="' + esc(f.milk || '') + '"></div>' +
      '<label class="checkline"><input type="checkbox" id="rep-incl" data-rf="incl"' + (f.incl !== false ? ' checked' : '') + '><span>Add checklist status from this phone. Only lists you ticked are included.</span></label>' +
    '</div><p class="hint" style="margin:0 2px 12px">These boxes save on this phone as you type.</p><div class="preview"><span class="lbl">Preview</span><pre class="chit" id="rep-chit"></pre></div>' +
    '<p class="hint">' + (rec.sentAt ? 'Add a note after this and the report counts as not sent again, so nothing new gets dropped.' : 'Copy or share it to send it. Sent notes clear when the next shift starts; unsent ones are kept under Earlier.') + '</p>';
  } else {
    h += heldHTML();
  }
  return h;
}
function redraw(focus) {
  const b = $('#notes-body'); if (!b || !ui) return;
  b.innerHTML = body();
  if (ui.seg === 'report') { const c = $('#rep-chit'); if (c) c.textContent = reportText(); }
  else if (ui.seg === 'notes' && focus) { const x = $('#note-text'); if (x) try { x.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
}
const foot = () => (ui && ui.seg === 'earlier') ? '<button class="btn primary" data-act="sheet-close">Done</button>' : '<button class="btn ghost" data-act="notes-share">' + ICON.share + ' Share</button><button class="btn primary" data-act="notes-copy">' + ICON.copy + ' Copy report</button>';
function redrawFoot() { const f = $('#sheet-f'); if (f && ui) f.innerHTML = foot(); }
export function openNotes(segName) {
  rollDay();
  ui = { seg: segName || 'notes', tag: (S.settings.noteTag) || 'next', key: S.shift.key };
  openSheet({
    eyebrow: 'Shift notes', title: keyLabel(S.shift.key),
    body: '<div id="notes-body">' + body() + '</div>',
    foot: foot(),
    onMount: () => { if (ui.seg === 'report') { const c = $('#rep-chit'); if (c) c.textContent = reportText(); } else if (ui.seg === 'notes') { const x = $('#note-text'); if (x) try { x.focus({ preventScroll: true }); } catch (e) { /* ignore */ } } },
    onClose: () => { const kept = keepDraft(); ui = null; app.render(); if (kept) toast('Your unfinished note was added. Saved on this phone.'); }
  });
}
/* The sheet shows the shift it was opened on. If the shift changes while it's open (the phone was locked
   across the change, or left open past midnight), the notes on screen have moved under Earlier and the
   buttons would act on the new, empty shift: Copy report would copy "nothing to hand off" and mark it
   sent. So every tap checks first. If the shift has moved on, the sheet is redrawn for the new one,
   says so, and that tap does nothing else. */
function movedOn() {
  rollDay();
  if (!ui || ui.key === S.shift.key) return false;
  ui.key = S.shift.key;
  const k = unsentHeld().length;
  if (k) ui.seg = 'earlier';
  setSheetTitle(keyLabel(S.shift.key));
  redraw(); redrawFoot();
  toast(k ? 'A new shift has started. The earlier notes are here, not sent yet.' : 'A new shift has started.');
  return true;
}
/* The held shift a button was drawn for: by its shift, not its place in a list that may have changed. */
function heldFor(el) {
  const list = held(), at = list[+el.dataset.i], k = el.dataset.k;
  if (k == null) return at || null;
  return at && at.key === k ? at : (list.find((h) => h.key === k && !h.sentAt) || list.find((h) => h.key === k) || null);
}
/* Text typed but not added yet is added as a note when the sheet closes, so nothing typed is lost. */
function keepDraft() {
  const text = String(S.shift.draft || '').trim().replace(/\s*\n\s*/g, ' ');
  if (!text) return false;
  addNote(text, (ui && ui.tag) || S.settings.noteTag || 'next');
  return true;
}
export function addNote(text, tag) {
  S.shift.notes.push({ id: uid('n'), t: hhmmNow(), tag: tag || 'next', text });
  S.shift.draft = '';
  if (S.shift.sentAt) { S.shift.sentAt = null; S.shift.sentHow = null; } // something new to send
  save('shift');
}
function markSent(rec, how) { rec.sentAt = hhmmNow(); rec.sentHow = how; save('shift'); }

export function notesCard() {
  const rec = S.shift, n = rec.notes.length, last = rec.notes[n - 1], k = unsentHeld().length;
  let h = '<div class="row-h"><h2 class="sec-h">Shift notes</h2><div class="row-acts"><button class="btn small ghost" data-act="notes" data-seg="report">Report</button><button class="btn small" data-act="notes">' + ICON.plus + ' Note</button></div></div>';
  if (n) h += '<button class="nc-last" data-act="notes"><span class="mono">' + n + (n === 1 ? ' note' : ' notes') + ' · last at ' + fmt12(toMin(last.t)) + '</span><span class="nc-text"><span class="n-tag mono">' + esc(tagName(last.tag)) + '</span>' + esc(last.text) + '</span>' +
    '<span class="nc-state' + (rec.sentAt ? ' sent' : '') + '">' + (rec.sentAt ? ICON.check + esc(sentLine(rec)) : ICON.note + 'Saved on this phone · report not sent yet') + '</span></button>';
  else h += '<p class="empty small">Jot things down as they happen: 86s, equipment, follow-ups, wins. They save on this phone and become your end-of-shift report.</p>';
  if (k) h += '<button class="nc-held" data-act="notes" data-seg="earlier">' + k + ' earlier ' + (k === 1 ? 'shift' : 'shifts') + ' not sent (' + esc(keyLabel(unsentHeld()[k - 1].key)) + (k > 1 ? ' and more' : '') + '). Send or delete.</button>';
  return h;
}

async function sendHeld(el, how) {
  const h = heldFor(el); if (!h) { redraw(); redrawFoot(); toast('Those notes aren’t here anymore.'); return; }
  const text = reportText(h);
  let r;
  if (how === 'share') r = await shareText(text, 'Shift report'); else r = (await copyText(text)) ? 'copied' : 'failed';
  if (r === 'shared' || r === 'copied') { markSent(h, r); toast(r === 'shared' ? 'Report shared. It clears when the next shift starts.' : 'Report copied. Paste it into ' + (B().messaging || 'your team chat') + '. It clears when the next shift starts.'); redraw(); }
  else if (r === 'failed') toast('Couldn’t copy. Try Share instead.');
}

export const acts = {
  'notes': (el) => openNotes(el.dataset.seg),
  'notes-seg': (el) => { if (movedOn()) return; ui.seg = el.dataset.id; redraw(true); redrawFoot(); },
  'note-tag': (el) => { ui.tag = el.dataset.id; S.settings.noteTag = ui.tag; save('settings'); redraw(true); },
  'note-add': () => {
    const x = $('#note-text'); if (!x) return;
    const moved = movedOn(); // a note typed across a shift change goes into the shift that's on now
    const text = x.value.trim().replace(/\s*\n\s*/g, ' ');
    if (!text) { toast('Type the note first.'); x.focus(); return; }
    addNote(text, ui.tag); x.value = '';
    if (moved) { ui.seg = 'notes'; redrawFoot(); }
    redraw(true);
    toast(moved ? 'A new shift has started: the note was saved to it. Earlier notes are under Earlier.' : 'Note saved on this phone.');
  },
  'note-del': (el) => { if (movedOn()) return; S.shift.notes = S.shift.notes.filter((n) => n.id !== el.dataset.id); save('shift'); redraw(); },
  'notes-copy': async () => { if (movedOn()) return; if (await copyText(reportText())) { markSent(S.shift, 'copied'); toast('Report copied. Paste it into ' + (B().messaging || 'your team chat') + '.'); redraw(); } else toast('Couldn’t copy. Long-press the preview to copy it.'); },
  'notes-share': async () => { if (movedOn()) return; const r = await shareText(reportText(), 'Shift report'); if (r === 'shared' || r === 'copied') { markSent(S.shift, r); toast(r === 'copied' ? 'Report copied.' : 'Report shared.'); redraw(); } },
  'held-copy': (el) => sendHeld(el, 'copy'),
  'held-share': (el) => sendHeld(el, 'share'),
  'held-del': (el) => {
    if (!armed(el, 'Delete these notes?')) return;
    const h = heldFor(el); if (!h) return;
    S.shift.held = held().filter((x) => x !== h); save('shift');
    redraw(); redrawFoot(); toast('Deleted from this phone.');
  }
};

export function onInput(el) {
  if (el.id === 'note-text' && ui) { S.shift.draft = el.value; save('shift'); return true; }
  if (!el.dataset.rf || !ui) return false;
  const k = el.dataset.rf;
  S.shift.f = S.shift.f || {};
  S.shift.f[k] = el.type === 'checkbox' ? el.checked : el.value;
  if (el.classList.contains('temp')) { const n = tempNum(el.value); el.classList.toggle('hot', n != null && n > 41); }
  save('shift');
  const c = $('#rep-chit'); if (c) c.textContent = reportText();
  return true;
}
