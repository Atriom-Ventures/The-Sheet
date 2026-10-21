// Shift notes: jot things down during the shift, then send them as one report.
// Notes stay on this phone only, and roll over once the report has been copied or shared.

import { app } from './app.js';
import { S, B, save, curShiftKey, isTicked, tasksOf, blocks, pmStart, sign, signName, rollDay } from './state.js';
import { esc, fmt12, toMin, hhmmNow, nowMin, fmtDateKey, uid, $, copyText, shareText } from './util.js';
import { ICON, openSheet, closeSheet, toast, chip, seg, opts, armed } from './ui.js';

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
export const shiftStale = () => S.shift.key && S.shift.key !== curShiftKey();
const tempNum = (v) => { const n = parseFloat(v); return isNaN(n) ? null : Math.round(n * 10) / 10; };

let ui = null; // { seg, tag }

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

export function reportText() {
  const rec = S.shift, f = rec.f || {}, p = String(rec.key).split('|');
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
  if (f.incl !== false && !shiftStale()) {
    const cl = checklistStatus();
    const mine = B().assignments.filter((a) => S.day.mine.indexOf(a.id) >= 0 && a.shift === (p[1] || '').toLowerCase());
    if (cl.length || mine.length) {
      L.push('', 'Checklists:');
      cl.forEach((c) => L.push('• ' + c.name + ' ' + (c.total - c.left.length) + '/' + c.total + (c.left.length ? '. Not done: ' + leftList(c.left) : ' ✓')));
      if (mine.length) { const left = mine.filter((a) => !isTicked(a.id)); L.push('• My assignments ' + (mine.length - left.length) + '/' + mine.length + (left.length ? '. Not done: ' + leftList(left) : ' ✓')); }
    }
  }
  if (!lead) sign(L);
  return L.join('\n');
}

function noteRows() {
  if (!S.shift.notes.length) return '<li class="empty small">No notes yet this shift.</li>';
  return S.shift.notes.slice().reverse().map((n) =>
    '<li class="task"><span class="stdrow note-row"><span class="mono n-time">' + fmt12(toMin(n.t)) + '</span><span class="t-text"><span class="n-tag mono">' + esc(tagName(n.tag)) + '</span>' + esc(n.text) + '</span></span>' +
    '<button class="icon-b" data-act="note-del" data-id="' + esc(n.id) + '" aria-label="Delete this note">' + ICON.close + '</button></li>').join('');
}
function body() {
  const rec = S.shift, f = rec.f || {};
  let h = '';
  if (shiftStale()) h += '<p class="note"><b>These are from ' + esc(keyLabel(rec.key)) + '</b> and haven’t been sent yet. Copy the report, or clear them to start this shift fresh. <button class="link inline" data-act="notes-clear">Clear them</button></p>';
  h += seg('notes-seg', [['notes', 'Notes' + (rec.notes.length ? ' (' + rec.notes.length + ')' : '')], ['report', 'Report']], ui.seg);
  if (ui.seg === 'notes') {
    const tag = NOTE_TAGS.find((x) => x[0] === ui.tag) || NOTE_TAGS[0];
    h += '<div class="chips tag-chips" role="group" aria-label="Kind of note">' + NOTE_TAGS.map((t) => chip('note-tag', t[0], t[1], t[0] === ui.tag)).join('') + '</div>' +
      '<div class="note-add"><label class="sr" for="note-text">Note</label><textarea id="note-text" rows="2" placeholder="' + esc(tag[3]) + '" enterkeyhint="send"></textarea><button class="btn primary" data-act="note-add">Add</button></div>' +
      '<p class="hint" style="margin:8px 2px 14px">Phone only. Room or table, never resident names or health details.</p>' +
      '<ul class="tasks" id="notes-list">' + noteRows() + '</ul>';
  } else {
    const hot = (v) => { const n = tempNum(v); return n != null && n > 41 ? ' hot' : ''; };
    h += '<div class="form">' +
      '<div class="field half"><label for="rep-lead"><span class="l">Ran the floor</span></label><input id="rep-lead" data-rf="lead" value="' + esc(f.lead != null ? f.lead : signName()) + '" placeholder="Name"></div>' +
      '<div class="field half"><label for="rep-on"><span class="l">Who was on</span><span class="hint">Optional</span></label><input id="rep-on" data-rf="on" value="' + esc(f.on || '') + '"></div>' +
      '<div class="field half"><label for="rep-reach"><span class="l">Reach-in °F</span></label><input id="rep-reach" data-rf="reach" class="temp' + hot(f.reach) + '" type="number" inputmode="decimal" step="0.5" value="' + esc(f.reach || '') + '"></div>' +
      '<div class="field half"><label for="rep-milk"><span class="l">Milk fridge °F</span></label><input id="rep-milk" data-rf="milk" class="temp' + hot(f.milk) + '" type="number" inputmode="decimal" step="0.5" value="' + esc(f.milk || '') + '"></div>' +
      '<label class="checkline"><input type="checkbox" id="rep-incl" data-rf="incl"' + (f.incl !== false ? ' checked' : '') + '><span>Add checklist status from this phone. Only lists you ticked are included.</span></label>' +
    '</div><div class="preview"><span class="lbl">Preview</span><pre class="chit" id="rep-chit"></pre></div>' +
    (rec.sentAt ? '<p class="hint">Sent at ' + esc(fmt12(toMin(rec.sentAt))) + '. These notes clear when the next shift starts.</p>' : '<p class="hint">Once you copy or share the report, these notes clear when the next shift starts.</p>');
  }
  return h;
}
function redraw(focus) {
  const b = $('#notes-body'); if (!b) return;
  b.innerHTML = body();
  if (ui.seg === 'report') { const c = $('#rep-chit'); if (c) c.textContent = reportText(); }
  else if (focus) { const x = $('#note-text'); if (x) try { x.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
}
export function openNotes(segName) {
  rollDay();
  ui = { seg: segName || 'notes', tag: (S.settings.noteTag) || 'next' };
  openSheet({
    eyebrow: 'Shift notes', title: keyLabel(S.shift.key),
    body: '<div id="notes-body">' + body() + '</div>',
    foot: '<button class="btn ghost" data-act="notes-share">' + ICON.share + ' Share</button><button class="btn primary" data-act="notes-copy">' + ICON.copy + ' Copy report</button>',
    onMount: () => { if (ui.seg === 'report') { const c = $('#rep-chit'); if (c) c.textContent = reportText(); } else { const x = $('#note-text'); if (x) try { x.focus({ preventScroll: true }); } catch (e) { /* ignore */ } } },
    onClose: () => { ui = null; app.render(); }
  });
}
export function addNote(text, tag) {
  S.shift.notes.push({ id: uid('n'), t: hhmmNow(), tag: tag || 'next', text });
  save('shift');
}
function markSent() { S.shift.sentAt = hhmmNow(); save('shift'); }

export function notesCard() {
  const rec = S.shift, n = rec.notes.length, last = rec.notes[n - 1];
  let h = '<div class="row-h"><h2 class="sec-h">Shift notes</h2><div class="row-acts"><button class="btn small ghost" data-act="notes" data-seg="report">Report</button><button class="btn small" data-act="notes">' + ICON.plus + ' Note</button></div></div>';
  if (shiftStale() && n) h += '<button class="banner warn" data-act="notes" data-seg="report"><strong>Unsent notes from ' + esc(keyLabel(rec.key)) + '</strong>Send the report or clear them.</button>';
  else if (n) h += '<button class="nc-last" data-act="notes"><span class="mono">' + n + (n === 1 ? ' note' : ' notes') + ' · last at ' + fmt12(toMin(last.t)) + (rec.sentAt ? ' · sent' : '') + '</span><span class="nc-text"><span class="n-tag mono">' + esc(tagName(last.tag)) + '</span>' + esc(last.text) + '</span></button>';
  else h += '<p class="empty small">Jot things down as they happen: 86s, equipment, follow-ups, wins. They become your end-of-shift report.</p>';
  return h;
}

export const acts = {
  'notes': (el) => openNotes(el.dataset.seg),
  'notes-seg': (el) => { ui.seg = el.dataset.id; redraw(true); },
  'note-tag': (el) => { ui.tag = el.dataset.id; S.settings.noteTag = ui.tag; save('settings'); const ta = $('#note-text'); const keep = ta ? ta.value : ''; redraw(true); const t2 = $('#note-text'); if (t2) t2.value = keep; },
  'note-add': () => {
    const x = $('#note-text'); if (!x) return;
    const text = x.value.trim().replace(/\s*\n\s*/g, ' ');
    if (!text) { toast('Type the note first.'); x.focus(); return; }
    if (shiftStale()) { toast('Send or clear last shift’s notes first.'); return; }
    addNote(text, ui.tag); x.value = '';
    const list = $('#notes-list'); if (list) list.innerHTML = noteRows();
    const sb = $('#notes-body [data-act="notes-seg"][data-id="notes"]'); if (sb) sb.textContent = 'Notes (' + S.shift.notes.length + ')';
    x.focus(); toast('Note added.');
  },
  'note-del': (el) => { S.shift.notes = S.shift.notes.filter((n) => n.id !== el.dataset.id); save('shift'); const list = $('#notes-list'); if (list) list.innerHTML = noteRows(); },
  'notes-copy': async () => { if (await copyText(reportText())) { markSent(); toast('Report copied. Paste it into ' + (B().messaging || 'your team chat') + '.'); redraw(); } else toast('Couldn’t copy. Long-press the preview to copy it.'); },
  'notes-share': async () => { const r = await shareText(reportText(), 'Shift report'); if (r === 'shared' || r === 'copied') { markSent(); toast(r === 'copied' ? 'Report copied.' : 'Report shared.'); redraw(); } },
  'notes-clear': (el) => { if (!armed(el, 'Tap again to clear them')) return; S.shift = { key: curShiftKey(), notes: [], f: {}, sentAt: null }; save('shift'); redraw(true); toast('Cleared. This shift starts fresh.'); }
};

export function onInput(el) {
  if (!el.dataset.rf || !ui) return false;
  const k = el.dataset.rf;
  S.shift.f = S.shift.f || {};
  S.shift.f[k] = el.type === 'checkbox' ? el.checked : el.value;
  if (el.classList.contains('temp')) { const n = tempNum(el.value); el.classList.toggle('hot', n != null && n > 41); }
  save('shift');
  const c = $('#rep-chit'); if (c) c.textContent = reportText();
  return true;
}
