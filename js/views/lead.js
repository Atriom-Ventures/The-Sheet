// Lead tools: messages, follow-ups (incl. blanks in the book), the floor board with breaks,
// training sign-offs, a wins log and the printed-copies log.

import { app } from '../app.js';
import { S, B, L, save, edit, card, allCards, sign, signName, hasBook } from '../state.js';
import { esc, fmt12, toMin, nowMin, hhmmNow, todayKey, fmtShort, fmtRev, daysSince, uid, blanksIn, withBlanks, copyText, shareText, $, dayLabel } from '../util.js';
import { ICON, seg, empty, openSheet, closeSheet, toast, armed, field, input, textarea, opts } from '../ui.js';
import { tmplList } from '../msgs.js';
import { isStale } from '../print.js';

const SUBS = [['asks', 'Follow-ups'], ['floor', 'Floor'], ['msgs', 'Messages'], ['train', 'Training'], ['wins', 'Wins'], ['printed', 'Printed']];
const people = () => (B().people || []);

/* ---------- follow-ups ---------- */
export function bookBlanks() {
  const out = [];
  allCards().forEach((c) => {
    const bs = [c.why].concat(c.steps || [], c.watch || []).flatMap(blanksIn);
    if (bs.length) out.push({ kind: 'card', id: c.id, title: c.title, blanks: bs, draft: c.draft });
  });
  B().tasks.forEach((t) => { const bs = blanksIn(t.text); if (bs.length) { const l = B().lists.find((x) => x.id === t.list); out.push({ kind: 'task', id: t.id, list: t.list, title: (l ? l.short || l.name : 'Checklist') + ': ' + t.text.replace(/\[[^\]]*\]/g, '___'), blanks: bs }); } });
  B().assignments.forEach((a) => { const bs = blanksIn(a.text); if (bs.length) out.push({ kind: 'asg', id: a.id, title: 'Sheet: ' + a.text, blanks: bs }); });
  return out;
}
const openAsks = () => (L().follow || []).filter((f) => f.status !== 'done');
function askRow(f) {
  const age = daysSince(f.created);
  const ageCls = age >= 7 ? ' late' : age >= 3 ? ' soon' : '';
  return '<li class="ask' + (f.status === 'done' ? ' done' : '') + '"><div class="ask-main"><div class="ask-meta mono">' + (f.kind === 'flag' ? '<span class="pill late">Flag</span> ' : '') + 'To ' + esc(f.to || '—') + ' · ' + esc(fmtShort(f.created)) +
    (f.status !== 'done' ? ' · <span class="age' + ageCls + '">' + (age ? age + (age === 1 ? ' day' : ' days') : 'today') + '</span>' : '') + '</div>' +
    '<div class="ask-t">' + esc(f.text) + '</div>' + (f.answer ? '<div class="ask-a"><b>Answer' + (f.answered ? ' ' + esc(fmtShort(f.answered)) : '') + ':</b> ' + esc(f.answer) + '</div>' : '') + '</div>' +
    '<div class="ask-acts">' + (f.status !== 'done' ? '<button class="btn small" data-act="ask-answer" data-id="' + esc(f.id) + '" aria-label="Mark answered">' + ICON.check + '</button>' : '<button class="btn small ghost" data-act="ask-reopen" data-id="' + esc(f.id) + '">Reopen</button>') +
    '<button class="icon-b" data-act="ask-edit" data-id="' + esc(f.id) + '" aria-label="Edit">' + ICON.pencil + '</button></div></li>';
}
function asksView() {
  const open = openAsks(), done = (L().follow || []).filter((f) => f.status === 'done');
  const toList = Array.from(new Set(people().concat((L().follow || []).map((f) => f.to).filter(Boolean))));
  let h = '<div class="ask-add"><label class="sr" for="ask-text">New follow-up</label><textarea id="ask-text" rows="2" placeholder="Something you asked, flagged or need an answer on"></textarea>' +
    '<div class="ask-add-row"><label class="sr" for="ask-to">To</label><input id="ask-to" list="ask-people" placeholder="To whom" value="' + esc(people()[0] || '') + '" autocomplete="off"><datalist id="ask-people">' + toList.map((p) => '<option value="' + esc(p) + '">').join('') + '</datalist>' +
    '<label class="check small"><input type="checkbox" id="ask-flag"> Flag</label><button class="btn primary" data-act="ask-add">Add</button></div></div>';
  if (!open.length) h += empty('Nothing waiting on anyone.', true);
  else {
    const groups = {};
    open.forEach((f) => { (groups[f.to || 'Anyone'] = groups[f.to || 'Anyone'] || []).push(f); });
    Object.keys(groups).forEach((to) => {
      const g = groups[to].sort((a, b) => String(a.created).localeCompare(String(b.created)));
      h += '<div class="row-h"><h2 class="sec-h">' + esc(to) + ' <span class="mono small">' + g.length + '</span></h2><div class="row-acts"><button class="btn small ghost" data-act="ask-copy" data-to="' + esc(to) + '">' + ICON.copy + ' Ask again</button></div></div><ul class="asks">' + g.map(askRow).join('') + '</ul>';
    });
  }
  const blanks = bookBlanks();
  if (blanks.length) {
    h += '<div class="row-h"><h2 class="sec-h">Blanks in the book <span class="mono small">' + blanks.reduce((n, b) => n + b.blanks.length, 0) + '</span></h2><div class="row-acts"><button class="btn small ghost" data-act="blanks-copy" aria-label="Copy the list of blanks">' + ICON.copy + '</button></div></div>' +
      '<p class="hint">Anything in [brackets] in a card or checklist. Fill them in by editing the card.</p><ul class="card-list">' +
      blanks.map((b) => '<li><button class="card-row" data-act="' + (b.kind === 'card' ? 'open-card' : b.kind === 'task' ? 'task-edit' : 'asg-edit') + '" data-id="' + esc(b.id) + '"><span class="cat">' + (b.kind === 'card' ? 'Card' : b.kind === 'task' ? 'Checklist' : 'Assignment sheet') + (b.draft ? ' · Draft' : '') + '</span><span class="c-title">' + esc(b.title) + '</span><span class="c-why">' + b.blanks.map((x) => '<mark class="blank">' + esc(x) + '</mark>').join(' ') + '</span></button></li>').join('') + '</ul>';
  }
  if (done.length) h += '<details class="hist"><summary><span class="hdate">Answered</span><span class="hsum">' + done.length + ' done</span></summary><div class="hbody"><ul class="asks">' + done.slice().reverse().map(askRow).join('') + '</ul></div></details>';
  return h;
}
function askMessage(to) {
  const g = openAsks().filter((f) => (f.to || 'Anyone') === to);
  const out = ['Hi ' + (to === 'Anyone' ? 'all' : to) + ', a few things I’m still waiting on:'];
  g.forEach((f) => out.push('• ' + f.text + (daysSince(f.created) >= 2 ? ' (asked ' + fmtShort(f.created) + ')' : '')));
  out.push('', 'Thank you!'); sign(out); return out.join('\n');
}
function blanksMessage() {
  const out = ['Questions to finish the floor book:'];
  bookBlanks().forEach((b) => out.push('• ' + b.title.replace(/^Sheet: |^.*?: /, (m) => m) + ': ' + b.blanks.join('; ')));
  sign(out); return out.join('\n');
}
function editAsk(id) {
  const f = (L().follow || []).find((x) => x.id === id); if (!f) return;
  openSheet({ eyebrow: 'Follow-up', title: 'Edit', body: '<div class="form">' + field('ae2-text', 'What', textarea('ae2-text', f.text, 3)) + field('ae2-to', 'To', input('ae2-to', f.to, 'list="ask-people"'), '', 'half') + field('ae2-date', 'Asked on', '<input id="ae2-date" type="date" value="' + esc(f.created) + '">', '', 'half') + field('ae2-ans', 'Answer', textarea('ae2-ans', f.answer || '', 2), 'Optional') + '</div>',
    foot: '<button class="btn danger" data-act="ask-del" data-id="' + esc(id) + '" aria-label="Delete">' + ICON.trash + '</button><button class="btn primary" data-act="ask-save" data-id="' + esc(id) + '">Save</button>' });
}
function answerAsk(id) {
  const f = (L().follow || []).find((x) => x.id === id); if (!f) return;
  openSheet({ eyebrow: 'Answered', title: f.text, body: '<div class="form">' + field('ans-text', 'What was the answer?', textarea('ans-text', f.answer || '', 3), 'Optional. Handy when you need to point back to it.') + '</div>', foot: '<button class="btn primary" data-act="ask-done" data-id="' + esc(id) + '">' + ICON.check + ' Mark answered</button>' });
}
const editFollow = (id, fn) => edit('state', (s) => { const f = (s.follow || []).find((x) => x.id === id); if (f) { fn(f); f.updated = todayKey(); } });

/* ---------- floor board and breaks ---------- */
function stations() { return (B().outlets || []).concat(['Expo', 'Runner', 'Busser', 'Host', 'Break cover', 'Lead / PIC', 'Back']); }
function personStatus(p) {
  const t = nowMin(), inM = toMin(p.in), outM = toMin(p.out);
  const brk = p.breaks || [], onBreak = brk.find((b) => !b.end);
  if (onBreak) return { cls: 'on', text: (onBreak.type === 'meal' ? 'Meal' : 'Rest') + ' since ' + fmt12(toMin(onBreak.start)) + ' · ' + Math.max(0, t - toMin(onBreak.start)) + ' min', sort: -1, onBreak };
  if (inM == null) return { cls: '', text: 'Add a start time to see breaks', sort: 9999 };
  if (t < inM) return { cls: '', text: 'Starts ' + fmt12(inM), sort: 5000 + inM };
  if (outM != null && t >= outM) return { cls: 'off', text: 'Off at ' + fmt12(outM), sort: 9000 };
  const parts = []; let sort = 8000, cls = '';
  const lastEnd = brk.filter((b) => b.end).map((b) => toMin(b.end)).sort((a, b) => b - a)[0];
  const restDue = Math.max(inM, lastEnd || inM) + 180;
  if (outM == null || restDue < outM) {
    parts.push('Rest due by ' + fmt12(restDue)); sort = Math.min(sort, restDue);
    if (t > restDue) cls = 'late'; else if (restDue - t <= 20) cls = cls || 'soon';
  }
  const len = outM != null ? outM - inM : null, hadMeal = brk.some((b) => b.type === 'meal');
  if (len != null && len > 300 && !hadMeal) {
    const a = inM + 120, z = inM + 300;
    parts.push('Meal ' + fmt12(a) + '–' + fmt12(z)); sort = Math.min(sort, z);
    if (t > z) cls = 'late'; else if (t >= a && z - t <= 30 && cls !== 'late') cls = 'soon';
  }
  return { cls, text: parts.join(' · ') || 'No breaks due', sort };
}
function floorView() {
  const ppl = S.floor.people.slice().sort((a, b) => personStatus(a).sort - personStatus(b).sort);
  let h = '<p class="muted">Who’s on today, where, and when their breaks are due. Phone only, and it clears overnight.</p>';
  h += ppl.length ? '<ul class="floor">' + ppl.map((p) => {
    const st = personStatus(p);
    return '<li class="fp ' + st.cls + '"><div class="fp-main"><div class="fp-n">' + esc(p.name || 'Someone') + ' <span class="fp-s">' + esc(p.station || '') + '</span></div><div class="fp-t mono">' + (p.in ? fmt12(toMin(p.in)) : '?') + '–' + (p.out ? fmt12(toMin(p.out)) : '?') + ' · ' + esc(st.text) + '</div></div>' +
      '<div class="fp-acts">' + (st.onBreak ? '<button class="btn small primary" data-act="brk-end" data-id="' + esc(p.id) + '">Back</button>' : '<button class="btn small" data-act="brk-start" data-id="' + esc(p.id) + '" data-type="rest">Rest</button><button class="btn small" data-act="brk-start" data-id="' + esc(p.id) + '" data-type="meal">Meal</button>') +
      '<button class="icon-b" data-act="fp-edit" data-id="' + esc(p.id) + '" aria-label="Edit">' + ICON.pencil + '</button></div></li>';
  }).join('') + '</ul>' : empty('Add who’s on to keep track of stations and breaks.', true);
  h += '<div class="row-actions"><button class="btn" data-act="fp-new">' + ICON.plus + ' Add person</button>' + (ppl.length ? '<button class="btn ghost" data-act="floor-copy">' + ICON.copy + ' Copy status</button>' : '') + '</div>';
  const bc = card('breaks');
  h += '<p class="hint">Rest by the 3-hour mark, meal between the 2nd and 5th hour on shifts over 5 hours: the summary on the ' + (bc ? '<button class="link inline" data-act="open-card" data-id="breaks">Covering breaks</button>' : 'Covering breaks') + ' card. HR has the final word.</p>';
  return h;
}
export function floorSummary() {
  if (!hasBook()) return '';
  const ppl = S.floor.people;
  if (!ppl.length) return '<button class="glance-b" data-act="go" data-id="#lead/floor"><span class="g-k">' + ICON.people + ' Floor</span><span class="g-v">Add who’s on</span></button>';
  const st = ppl.map((p) => ({ p, s: personStatus(p) }));
  const onB = st.filter((x) => x.s.onBreak).length, late = st.filter((x) => x.s.cls === 'late'), soon = st.filter((x) => x.s.cls === 'soon');
  const working = st.filter((x) => x.s.cls !== 'off').length;
  let v = working + ' on' + (onB ? ' · ' + onB + ' on break' : '');
  if (late.length) v += ' · <b class="warn-t">' + esc(late[0].p.name) + ' break overdue</b>';
  else if (soon.length) v += ' · ' + esc(soon[0].p.name) + ' due soon';
  return '<button class="glance-b" data-act="go" data-id="#lead/floor"><span class="g-k">' + ICON.people + ' Floor</span><span class="g-v">' + v + '</span></button>';
}
function floorText() {
  const out = ['Floor · ' + fmt12(nowMin())];
  S.floor.people.slice().sort((a, b) => personStatus(a).sort - personStatus(b).sort).forEach((p) => { const s = personStatus(p); out.push('• ' + (p.name || 'Someone') + (p.station ? ' (' + p.station + ')' : '') + ': ' + s.text); });
  sign(out); return out.join('\n');
}
function editPerson(id) {
  const p = id ? S.floor.people.find((x) => x.id === id) : { id: '', name: '', station: '', in: '', out: '' };
  if (!p) return;
  const names = Array.from(new Set((S.settings.floorNames || []).concat(S.floor.people.map((x) => x.name)).filter(Boolean)));
  openSheet({ eyebrow: 'Floor', title: id ? p.name : 'Add person',
    body: '<div class="form">' + field('fp-name', 'Name', input('fp-name', p.name, 'list="fp-names" autocomplete="off"')) + '<datalist id="fp-names">' + names.map((n) => '<option value="' + esc(n) + '">').join('') + '</datalist>' +
      field('fp-station', 'Station', '<select id="fp-station"><option value="">—</option>' + opts(stations().map((s) => [s, s]), p.station) + '</select>') +
      field('fp-in', 'In', '<input id="fp-in" type="time" value="' + esc(p.in) + '">', '', 'half') + field('fp-out', 'Out', '<input id="fp-out" type="time" value="' + esc(p.out) + '">', '', 'half') +
      ((p.breaks || []).length ? '<div class="full"><span class="lbl">Breaks today</span><ul class="plain-list">' + p.breaks.map((b) => '<li>' + (b.type === 'meal' ? 'Meal' : 'Rest') + ' ' + fmt12(toMin(b.start)) + '–' + (b.end ? fmt12(toMin(b.end)) : 'now') + '</li>').join('') + '</ul></div>' : '') +
    '</div>',
    foot: (id ? '<button class="btn danger" data-act="fp-del" data-id="' + esc(id) + '" aria-label="Remove from the floor">' + ICON.trash + '</button>' : '') + '<button class="btn primary" data-act="fp-save" data-id="' + esc(id || '') + '">Save</button>' });
}

/* ---------- training (people are phone only; skills live in the book) ---------- */
function trProgress(p) { const sk = B().training || [], so = p.signoffs || {}; return [sk.filter((s) => so[s.id]).length, sk.length]; }
function trainView() {
  let h = '<p class="muted">Who you’ve trained on what. Names stay on this phone; the skills list is part of the book.</p>';
  h += '<div class="ask-add-row"><label class="sr" for="tr-name">Trainee name</label><input id="tr-name" placeholder="New trainee’s name" autocomplete="off"><button class="btn primary" data-act="tr-add">Add</button></div>';
  h += S.trainees.length ? '<ul class="tr-list">' + S.trainees.map((p) => { const [d, n] = trProgress(p); return '<li><button class="tr-row" data-act="tr-open" data-id="' + esc(p.id) + '"><span class="tr-name">' + esc(p.name) + '</span><span class="tr-meta">Started ' + esc(fmtShort(p.start)) + '</span><span class="tr-n mono">' + d + '/' + n + '</span><span class="tr-bar"><span style="width:' + (n ? d / n * 100 : 0).toFixed(1) + '%"></span></span></button></li>'; }).join('') + '</ul>' : empty('No trainees yet.', true);
  if (app.ui.editing || !(B().training || []).length) h += '<div class="edit-row"><button class="btn small" data-act="skills-edit">' + ICON.pencil + ' Edit the skills list</button></div>';
  else h += '<p><button class="link" data-act="skills-edit">Edit the skills list</button></p>';
  return h;
}
function trSkills(p) {
  const so = p.signoffs || {};
  return '<ul class="tasks">' + (B().training || []).map((s) => { const on = !!so[s.id]; return '<li class="task' + (on ? ' done' : '') + '"><button class="tick" data-act="tr-sign" data-id="' + esc(s.id) + '" data-p="' + esc(p.id) + '" aria-pressed="' + on + '"><span class="box"></span><span class="t-text">' + esc(s.text) + (on ? '<span class="t-date">Signed off ' + esc(fmtShort(so[s.id])) + '</span>' : '') + '</span></button>' + (s.card && card(s.card) ? '<button class="how" data-act="open-card" data-id="' + esc(s.card) + '">How</button>' : '') + '</li>'; }).join('') + '</ul>';
}
function openTrainee(id) {
  const p = S.trainees.find((x) => x.id === id); if (!p) return;
  const [d, n] = trProgress(p);
  openSheet({ eyebrow: 'Training · ' + d + '/' + n, title: p.name, body: '<div id="tr-skills">' + trSkills(p) + '</div><div class="form" style="margin-top:14px">' + field('tr-note', 'Notes', textarea('tr-note', p.note || '', 2, 'data-trnote="' + esc(p.id) + '"'), 'Phone only') + '</div>',
    foot: '<button class="btn danger" data-act="tr-del" data-id="' + esc(id) + '" aria-label="Delete trainee">' + ICON.trash + '</button><button class="btn ghost" data-act="tr-copy" data-id="' + esc(id) + '">' + ICON.copy + ' Progress</button><button class="btn primary" data-act="sheet-close">Done</button>', onClose: () => app.renderView() });
}
function trText(p) {
  const so = p.signoffs || {}, sk = B().training || [];
  const out = ['Training · ' + p.name + ' · ' + trProgress(p).join('/') + ' signed off'];
  const done = sk.filter((s) => so[s.id]), left = sk.filter((s) => !so[s.id]);
  if (done.length) { out.push('', 'Signed off:'); done.forEach((s) => out.push('✓ ' + s.text + ' (' + fmtShort(so[s.id]) + ')')); }
  if (left.length) { out.push('', 'Still to go:'); left.forEach((s) => out.push('• ' + s.text)); }
  sign(out); return out.join('\n');
}

/* ---------- wins ---------- */
function winsView() {
  const w = (L().wins || []).slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
  let h = '<p class="muted">Things you fixed, built or handled, and praise you got. Worth having on hand for any conversation about your role.</p>';
  h += '<div class="ask-add"><label class="sr" for="win-text">New win</label><textarea id="win-text" rows="2" placeholder="What happened, and why it mattered"></textarea><div class="ask-add-row"><input id="win-date" type="date" value="' + todayKey() + '" aria-label="Date"><button class="btn primary" data-act="win-add">Add</button></div></div>';
  h += w.length ? '<ul class="asks">' + w.map((x) => '<li class="ask"><div class="ask-main"><div class="ask-meta mono">' + esc(dayLabel(new Date(x.date + 'T12:00'))) + '</div><div class="ask-t">' + esc(x.text) + '</div></div><div class="ask-acts"><button class="icon-b" data-act="win-del" data-id="' + esc(x.id) + '" aria-label="Delete">' + ICON.trash + '</button></div></li>').join('') + '</ul><div class="row-actions"><button class="btn ghost" data-act="wins-copy">' + ICON.copy + ' Copy all</button></div>' : empty('Nothing logged yet.', true);
  return h;
}

/* ---------- printed copies ---------- */
export const staleCount = () => (L().printed || []).filter((p) => isStale(p).stale).length;
function printedView() {
  const P = (L().printed || []).slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
  let h = '<p class="muted">Every copy you’ve logged when printing, and whether the book has changed since. Out-of-date copies are worth swapping.</p>';
  h += P.length ? '<ul class="asks">' + P.map((p) => {
    const st = isStale(p);
    return '<li class="ask' + (st.stale ? ' stale' : '') + '"><div class="ask-main"><div class="ask-meta mono">' + (st.gone ? '<span class="pill">Gone</span> ' : st.stale ? '<span class="pill late">Out of date</span> ' : '<span class="pill ok">Current</span> ') + 'Printed ' + esc(fmtShort(p.date)) + ' · rev ' + esc(fmtRev(p.rev)) + (st.stale ? ' → now ' + esc(fmtRev(st.rev)) : '') + '</div><div class="ask-t">' + esc(p.label) + '</div><div class="ask-a">' + esc(p.where) + '</div></div>' +
      '<div class="ask-acts">' + (st.stale ? '<button class="btn small" data-act="printed-reprint" data-id="' + esc(p.id) + '" aria-label="Print a fresh copy">' + ICON.print + '</button>' : '') + '<button class="icon-b" data-act="printed-del" data-id="' + esc(p.id) + '" aria-label="Remove">' + ICON.trash + '</button></div></li>';
  }).join('') + '</ul>' : empty('Nothing logged yet. When you print, say where it’s going and it shows up here.', true);
  return h;
}

export function render(route) {
  const sub = route.sub || 'asks';
  const nStale = staleCount(), nOpen = openAsks().length;
  const labels = SUBS.map(([k, l]) => [k, k === 'asks' && nOpen ? l + ' (' + nOpen + ')' : k === 'printed' && nStale ? l + ' (' + nStale + ')' : l]);
  let h = '<div class="view-top scroll-seg">' + seg('go-lsub', labels, sub) + '</div>';
  if (sub === 'floor') h += floorView();
  else if (sub === 'msgs') h += tmplList() + '<p class="hint">Every message is plain text. Copy it, then paste it into any chat.</p>';
  else if (sub === 'train') h += trainView();
  else if (sub === 'wins') h += winsView();
  else if (sub === 'printed') h += printedView();
  else h += asksView();
  return h;
}

export const acts = {
  'go-lsub': (el) => app.go('#lead/' + el.dataset.id),
  'ask-add': () => {
    const t = $('#ask-text').value.trim(); if (!t) { toast('Type the follow-up first.'); $('#ask-text').focus(); return; }
    const to = $('#ask-to').value.trim(), flag = $('#ask-flag').checked;
    edit('state', (s) => { s.follow = (s.follow || []).concat([{ id: uid('f'), text: t, to, created: todayKey(), status: 'open', kind: flag ? 'flag' : 'ask', updated: todayKey() }]); });
    app.renderView(); toast('Added.');
  },
  'ask-answer': (el) => answerAsk(el.dataset.id),
  'ask-done': (el) => { const a = $('#ans-text').value.trim(); editFollow(el.dataset.id, (f) => { f.status = 'done'; f.answered = todayKey(); if (a) f.answer = a; }); closeSheet(); app.renderView(); toast('Marked answered.'); },
  'ask-reopen': (el) => { editFollow(el.dataset.id, (f) => { f.status = 'open'; }); app.renderView(); },
  'ask-edit': (el) => editAsk(el.dataset.id),
  'ask-save': (el) => { const t = $('#ae2-text').value.trim(); if (!t) return; editFollow(el.dataset.id, (f) => { f.text = t; f.to = $('#ae2-to').value.trim(); f.created = $('#ae2-date').value || f.created; const a = $('#ae2-ans').value.trim(); if (a) f.answer = a; else delete f.answer; }); closeSheet(); app.renderView(); },
  'ask-del': (el) => { if (!armed(el, 'Delete?')) return; edit('state', (s) => { s.follow = s.follow.filter((f) => f.id !== el.dataset.id); }); closeSheet(); app.renderView(); toast('Deleted.'); },
  'ask-copy': async (el) => { const r = await shareText(askMessage(el.dataset.to), 'Follow-ups'); if (r === 'copied') toast('Copied.'); },
  'blanks-copy': async () => { if (await copyText(blanksMessage())) toast('Questions copied.'); },
  'fp-new': () => editPerson(null),
  'fp-edit': (el) => editPerson(el.dataset.id),
  'fp-save': (el) => {
    const name = $('#fp-name').value.trim(); if (!name) { toast('Add a name.'); return; }
    const data = { name, station: $('#fp-station').value, in: $('#fp-in').value, out: $('#fp-out').value };
    if (el.dataset.id) Object.assign(S.floor.people.find((x) => x.id === el.dataset.id) || {}, data);
    else S.floor.people.push(Object.assign({ id: uid('p'), breaks: [] }, data));
    S.settings.floorNames = Array.from(new Set([name].concat(S.settings.floorNames || []))).slice(0, 40); save('settings');
    save('floor'); closeSheet(); app.renderView();
  },
  'fp-del': (el) => { if (!armed(el, 'Remove?')) return; S.floor.people = S.floor.people.filter((x) => x.id !== el.dataset.id); save('floor'); closeSheet(); app.renderView(); },
  'brk-start': (el) => { const p = S.floor.people.find((x) => x.id === el.dataset.id); if (!p) return; p.breaks = (p.breaks || []).concat([{ type: el.dataset.type, start: hhmmNow() }]); save('floor'); app.renderView(); toast(p.name + ' on ' + (el.dataset.type === 'meal' ? 'meal' : 'rest') + ' break.'); },
  'brk-end': (el) => { const p = S.floor.people.find((x) => x.id === el.dataset.id); if (!p) return; const b = (p.breaks || []).find((x) => !x.end); if (b) b.end = hhmmNow(); save('floor'); app.renderView(); toast(p.name + ' is back.'); },
  'floor-copy': async () => { if (await copyText(floorText())) toast('Floor status copied.'); },
  'tr-add': () => { const n = $('#tr-name').value.trim(); if (!n) { toast('Type a name.'); return; } S.trainees.push({ id: uid('tr'), name: n, start: todayKey(), signoffs: {} }); save('trainees'); app.renderView(); },
  'tr-open': (el) => openTrainee(el.dataset.id),
  'tr-sign': (el) => { const p = S.trainees.find((x) => x.id === el.dataset.p); if (!p) return; p.signoffs = p.signoffs || {}; if (p.signoffs[el.dataset.id]) delete p.signoffs[el.dataset.id]; else p.signoffs[el.dataset.id] = todayKey(); save('trainees'); $('#tr-skills').innerHTML = trSkills(p); },
  'tr-copy': async (el) => { const p = S.trainees.find((x) => x.id === el.dataset.id); if (p && await copyText(trText(p))) toast('Copied.'); },
  'tr-del': (el) => { if (!armed(el, 'Delete trainee?')) return; S.trainees = S.trainees.filter((x) => x.id !== el.dataset.id); save('trainees'); closeSheet(); app.renderView(); },
  'win-add': () => { const t = $('#win-text').value.trim(); if (!t) { toast('Type the win first.'); return; } const d = $('#win-date').value || todayKey(); edit('state', (s) => { s.wins = (s.wins || []).concat([{ id: uid('w'), text: t, date: d, updated: todayKey() }]); }); app.renderView(); toast('Logged.'); },
  'win-del': (el) => { if (!armed(el, 'Delete?')) return; edit('state', (s) => { s.wins = s.wins.filter((w) => w.id !== el.dataset.id); }); app.renderView(); },
  'wins-copy': async () => { const w = (L().wins || []).slice().sort((a, b) => String(a.date).localeCompare(String(b.date))); if (await copyText(['Wins'].concat(w.map((x) => '• ' + fmtShort(x.date) + ': ' + x.text)).join('\n'))) toast('Copied.'); }
};
export function onInput(el) {
  if (el.dataset.trnote) { const p = S.trainees.find((x) => x.id === el.dataset.trnote); if (p) { p.note = el.value; save('trainees'); } return true; }
  return false;
}
