// Message templates. Each one is a small form that writes a plain-text message for team chat.

import { app } from './app.js';
import { S, B, L, save, sign, signName } from './state.js';
import { esc, fmt12, toMin, todayKey, hhmmNow, fmtDateKey, dur, hourLabel, keyOf, slug, bullets, $, copyText, shareText } from './util.js';
import { ICON, openSheet, toast, opts } from './ui.js';
import { openNotes } from './shift.js';

const nextSaturdayKey = () => { const d = new Date(); const add = ((6 - d.getDay()) + 7) % 7 || 7; d.setDate(d.getDate() + add); return keyOf(d); };

/* Roles for the staffing check. Outlet names come from the book, so the app itself stays generic. */
function gapRoles() {
  const outlets = (B().outlets || []).map((o) => [slug(o), 'Server · ' + o]);
  return [['server', 'Server']].concat(outlets, [['pic', 'Lead server / PIC'], ['back', 'Back'], ['expo', 'Expo'], ['runner', 'Food runner'], ['busser', 'Busser'], ['host', 'Host / phones'], ['cover', 'Break cover'], ['lead', 'Manager'], ['other', 'Other']]);
}
const roleLabel = (k) => { const r = gapRoles().find((x) => x[0] === k); return r ? r[1] : k; };
function needs() {
  const outlets = (B().outlets || []).map(slug);
  return [
    { key: 'server', label: 'Server', msg: 'No server on the floor', roles: ['server', 'pic', 'cover'].concat(outlets) },
    { key: 'expo', label: 'Expo', msg: 'No expo', roles: ['expo'] },
    { key: 'point', label: 'Point person', msg: 'No lead, manager or PIC', roles: ['lead', 'pic'] }
  ];
}
const plan = () => (S.priv && S.priv.staffPlan) || null;
const AM_KEYS = [['total', 'Staff'], ['front', 'Front'], ['back', 'Back'], ['busser', 'Busser'], ['cover', 'Break cover']];
function pmKeys() {
  const p = plan(); if (!p || !p.pm) return [];
  const outs = B().outlets || [], names = { runner: 'Food runners', expo: 'Expo', busser: 'Busser', host: 'Host' };
  return Object.keys(p.pm).map((k) => { const o = outs.find((x) => slug(x) === k); return [k, o || names[k] || k]; });
}
const planLbl = (k) => { const x = AM_KEYS.concat(pmKeys()).find((y) => y[0] === k); return x ? x[1] : k; };
function planCheck(v) {
  const p = plan();
  if (!p || v.mode === 'off') return null;
  const outlets = (B().outlets || []).map(slug);
  const groups = { front: ['server', 'pic'].concat(outlets), back: ['back', 'expo', 'runner'], busser: ['busser'], cover: ['cover'] };
  const rows = (v.rows || []).map((r) => ({ role: r.role, s: toMin(r.start), e: toMin(r.end) })).filter((r) => r.s != null && r.e != null && r.e > r.s);
  const out = [];
  if (v.mode !== 'pm') (p.am || []).forEach((cp) => {
    const m = toMin(cp.time); if (m == null) return;
    const on = (roles) => rows.filter((r) => (roles ? roles.indexOf(r.role) >= 0 : r.role !== 'lead') && r.s <= m && r.e > m).length;
    const parts = [];
    AM_KEYS.forEach(([k]) => { const need = +cp[k] || 0; if (need > 0) parts.push({ k, have: on(k === 'total' ? null : groups[k]), need }); });
    if (parts.length) out.push({ label: fmt12(m), parts });
  });
  if (v.mode !== 'am' && p.pm) {
    const from = toMin(p.pmFrom); const f = from == null ? 12 * 60 : from;
    const pmRows = rows.filter((r) => r.s >= f);
    const parts = [];
    pmKeys().forEach(([k]) => { const need = +p.pm[k] || 0; if (need > 0) parts.push({ k, have: pmRows.filter((r) => r.role === k).length, need }); });
    if (parts.length) out.push({ label: 'PM shift', parts });
  }
  out.forEach((c) => { c.short = c.parts.reduce((n, x) => n + Math.max(0, x.need - x.have), 0); });
  return out;
}
const planLine = (c) => c.label + ': ' + c.parts.map((x) => planLbl(x.k) + ' ' + x.have + '/' + x.need).join(', ') + (c.short ? ' → short ' + c.short : ' ✓');
function merged(v, roles) {
  const iv = (v.rows || []).filter((r) => roles.indexOf(r.role) >= 0).map((r) => [toMin(r.start), toMin(r.end)]).filter((x) => x[0] != null && x[1] != null && x[1] > x[0]).sort((a, b) => a[0] - b[0]);
  const out = [];
  iv.forEach((x) => { const last = out[out.length - 1]; if (last && x[0] <= last[1]) last[1] = Math.max(last[1], x[1]); else out.push([x[0], x[1]]); });
  return out;
}
function computeGaps(v) {
  const o = toMin(v.open), c = toMin(v.close);
  if (o == null || c == null || c <= o) return null;
  return needs().map((n) => {
    const cov = merged(v, n.roles), holes = []; let cur = o;
    for (const iv of cov) { if (iv[1] <= cur) continue; if (iv[0] >= c) break; if (iv[0] > cur) holes.push([cur, iv[0]]); cur = Math.max(cur, iv[1]); if (cur >= c) break; }
    if (cur < c) holes.push([cur, c]);
    return Object.assign({}, n, { cov, holes });
  });
}
function gapBuild(v) {
  const pc = planCheck(v);
  const out = [(pc ? 'Staffing check' : 'Coverage check') + ' · ' + fmtDateKey(v.date)];
  if (pc && pc.length) { const short = pc.reduce((n, c) => n + c.short, 0); out.push('', short ? 'Against the staffing plan:' : 'Meets the staffing plan:'); pc.forEach((c) => out.push('• ' + planLine(c))); }
  const g = computeGaps(v);
  if (!g) { out.push('', 'Add opening and closing times to check coverage.'); sign(out); return out.join('\n'); }
  const holes = []; g.forEach((n) => n.holes.forEach((h) => holes.push({ s: h[0], e: h[1], msg: n.msg }))); holes.sort((a, b) => a.s - b.s);
  const win = fmt12(toMin(v.open)) + '–' + fmt12(toMin(v.close));
  if (holes.length) { out.push('', 'Gaps while dining is open (' + win + '):'); holes.forEach((h) => out.push('• ' + h.msg + ' ' + fmt12(h.s) + '–' + fmt12(h.e) + ' (' + dur(h.e - h.s) + ')')); }
  else out.push('', 'No gaps ' + win + '. Every stretch has a server, an expo and a point person.');
  const rows = (v.rows || []).filter((r) => toMin(r.start) != null && toMin(r.end) != null).slice().sort((a, b) => toMin(a.start) - toMin(b.start));
  if (rows.length) { out.push('', 'Scheduled:'); rows.forEach((r) => out.push('• ' + roleLabel(r.role) + (String(r.name || '').trim() ? ' (' + r.name.trim() + ')' : '') + ' ' + fmt12(toMin(r.start)) + '–' + fmt12(toMin(r.end)))); }
  if (String(v.ask || '').trim()) out.push('', v.ask.trim());
  sign(out); return out.join('\n');
}
function gapForm(v) {
  let h = '';
  if (v.example) h += '<p class="note">This is an example of a typical weekend gap. Change it to the real schedule, or <button class="link inline" data-act="gap-clear">start blank</button>.</p>';
  h += '<div class="form">' +
    '<div class="field"><label for="gp-date"><span class="l">Date</span></label><input id="gp-date" type="date" data-f="date" value="' + esc(v.date) + '"></div>' +
    '<div class="field half"><label for="gp-open"><span class="l">Dining opens</span></label><input id="gp-open" type="time" data-f="open" value="' + esc(v.open) + '"></div>' +
    '<div class="field half"><label for="gp-close"><span class="l">Dining closes</span></label><input id="gp-close" type="time" data-f="close" value="' + esc(v.close) + '"></div></div>';
  h += '<div class="sub-h">Who’s scheduled</div><div class="prows">' + (v.rows || []).map((r, i) =>
    '<div class="prow"><select class="pr-role" aria-label="Role" data-row="' + i + '" data-rf2="role">' + opts(gapRoles(), r.role) + '</select>' +
    '<input class="pr-name" aria-label="Name, optional" placeholder="Name (optional)" data-row="' + i + '" data-rf2="name" value="' + esc(r.name) + '">' +
    '<input class="pr-start" type="time" aria-label="Start" data-row="' + i + '" data-rf2="start" value="' + esc(r.start) + '">' +
    '<input class="pr-end" type="time" aria-label="End" data-row="' + i + '" data-rf2="end" value="' + esc(r.end) + '">' +
    '<button class="icon-b" data-act="row-del" data-i="' + i + '" aria-label="Remove this person">' + ICON.close + '</button></div>').join('') + '</div>' +
    '<button class="btn small" data-act="row-add">' + ICON.plus + ' Add person</button>';
  if (plan()) {
    h += '<div class="sub-h">Against the staffing plan</div><div class="form" style="margin-bottom:10px"><div class="field"><label for="gp-mode" class="sr">Which part of the plan</label><select id="gp-mode" data-f="mode">' +
      opts([['am', 'Check the AM plan'], ['pm', 'Check the PM plan'], ['both', 'Check AM and PM'], ['off', 'Don’t check the plan']], v.mode || 'am') + '</select></div></div><div id="plan-chk" class="tl"></div>' +
      '<p class="hint" style="margin:8px 2px 0">For the PM check, pick each server’s station.</p>';
  }
  h += '<div class="sub-h">Coverage</div><div id="gap-tl" class="tl"></div>';
  h += '<div class="form" style="margin-top:14px"><div class="field"><label for="gp-ask"><span class="l">Your ask</span><span class="hint">Optional. Say what would fix it.</span></label><textarea id="gp-ask" data-f="ask" rows="2">' + esc(v.ask) + '</textarea></div></div>';
  return h;
}
function gapAfter(v) {
  const pe = $('#plan-chk');
  if (pe) {
    const pc = planCheck(v);
    pe.innerHTML = !pc ? '<p class="hint" style="margin:0">Not checking against the plan.</p>' : !pc.length ? '<p class="hint" style="margin:0">The plan has no targets for this part of the day.</p>' :
      pc.map((c) => '<div class="pc-row"><span class="pc-l mono">' + esc(c.label) + '</span><span class="pc-parts">' + c.parts.map((x) => '<span class="pc-p' + (x.have < x.need ? ' bad' : '') + '">' + esc(planLbl(x.k)) + ' <b class="mono">' + x.have + '/' + x.need + '</b></span>').join('') + '</span><span class="pill ' + (c.short ? 'late' : 'ok') + '">' + (c.short ? 'Short ' + c.short : 'On plan') + '</span></div>').join('');
  }
  const el = $('#gap-tl'); if (!el) return;
  const g = computeGaps(v);
  if (!g) { el.innerHTML = '<p class="hint" style="margin:0">Set when dining opens and closes to check coverage.</p>'; return; }
  const o = toMin(v.open), c = toMin(v.close);
  let lo = o, hi = c;
  (v.rows || []).forEach((r) => { const s = toMin(r.start), e = toMin(r.end); if (s != null && e != null && e > s) { lo = Math.min(lo, s); hi = Math.max(hi, e); } });
  lo = Math.floor(lo / 60) * 60; hi = Math.ceil(hi / 60) * 60;
  const span = Math.max(60, hi - lo), X = (m) => ((m - lo) / span * 100).toFixed(2) + '%', W = (a, b) => ((b - a) / span * 100).toFixed(2) + '%';
  const holes = g.reduce((n, x) => n + x.holes.length, 0);
  let h = '<div class="tl-sum ' + (holes ? 'bad' : 'good') + '">' + (holes ? holes + (holes === 1 ? ' gap' : ' gaps') + ' while dining is open' : 'Fully covered while dining is open') + '</div>';
  g.forEach((n) => {
    h += '<div class="lane"><span class="lane-l">' + n.label + '</span><div class="track" role="img" aria-label="' + esc(n.label + ': ' + (n.holes.length ? n.holes.map((x) => 'gap ' + fmt12(x[0]) + ' to ' + fmt12(x[1])).join(', ') : 'covered')) + '">' +
      '<span class="seg win" style="left:' + X(o) + ';width:' + W(o, c) + '"></span>' + n.cov.map((x) => '<span class="seg ok" style="left:' + X(x[0]) + ';width:' + W(x[0], x[1]) + '"></span>').join('') +
      n.holes.map((x) => '<span class="seg gap" style="left:' + X(x[0]) + ';width:' + W(x[0], x[1]) + '"></span>').join('') + '</div></div>';
  });
  const step = span > 8 * 60 ? 120 : 60; let ax = '';
  for (let m = lo; m <= hi; m += step) ax += '<span class="' + (m === lo ? 'first' : (m + step > hi ? 'last' : '')) + '" style="left:' + X(m) + '">' + hourLabel(m) + '</span>';
  el.innerHTML = h + '<div class="axis" aria-hidden="true">' + ax + '</div><div class="legend"><span><i class="k-ok"></i>On shift</span><span><i class="k-gap"></i>Gap</span><span><i class="k-win"></i>Dining open</span></div>';
}

function shoutForm(v) {
  return '<div class="form"><div class="field"><label for="so-op"><span class="l">Opening line</span></label><input id="so-op" data-f="opener" value="' + esc(v.opener) + '"></div></div><div class="sub-h">Who and what</div>' +
    (v.rows || []).map((r, i) => '<div class="srow"><input class="so-name" aria-label="Name" placeholder="Name" data-row="' + i + '" data-rf2="name" value="' + esc(r.name) + '"><input class="so-did" aria-label="What they did" placeholder="Came in early and had the room set by 7" data-row="' + i + '" data-rf2="did" value="' + esc(r.did) + '"><button class="icon-b" data-act="row-del" data-i="' + i + '" aria-label="Remove">' + ICON.close + '</button></div>').join('') +
    '<button class="btn small" data-act="row-add">' + ICON.plus + ' Add person</button><div class="form" style="margin-top:14px"><div class="field"><label for="so-cl"><span class="l">Closing line</span></label><input id="so-cl" data-f="closing" value="' + esc(v.closing) + '"></div></div>';
}
function shoutBuild(v) {
  const rows = (v.rows || []).filter((r) => String(r.name || '').trim() || String(r.did || '').trim());
  const out = [String(v.opener || '').trim() || 'Shout-outs'];
  if (rows.length) rows.forEach((r) => out.push('• ' + (String(r.name || '').trim() || 'Someone') + (String(r.did || '').trim() ? ': ' + r.did.trim() : ''))); else out.push('• (Add a name and what they did)');
  if (String(v.closing || '').trim()) out.push('', v.closing.trim());
  sign(out); return out.join('\n');
}
function incidentBuild(v) {
  const t = toMin(v.time);
  const out = ['Incident note · ' + fmtDateKey(v.date) + (t != null ? ', ' + fmt12(t) : '') + (v.where ? ' · ' + v.where : '')];
  out.push('', 'What happened:', String(v.what || '').trim() || '(Describe what happened, in order.)');
  if (String(v.responded || '').trim()) out.push('', 'Responded: ' + v.responded.trim());
  const a = bullets(v.actions); if (a.length) { out.push('', 'What was done:'); a.forEach((x) => out.push(x)); }
  const f = bullets(v.follow); if (f.length) { out.push('', 'Follow-up needed:'); f.forEach((x) => out.push(x)); }
  if (String(v.told || '').trim()) out.push('', 'Already told: ' + v.told.trim());
  sign(out); return out.join('\n');
}
function equipBuild(v) {
  const out = ['Equipment problem: ' + (String(v.item || '').trim() || '(equipment)') + (String(v.where || '').trim() ? ' (' + v.where.trim() + ')' : ''), 'Urgency: ' + v.urgency];
  if (String(v.problem || '').trim()) out.push('', 'What’s wrong: ' + v.problem.trim());
  if (String(v.since || '').trim()) out.push('Since: ' + v.since.trim());
  if (String(v.impact || '').trim()) out.push('', 'Impact and workaround: ' + v.impact.trim());
  if (String(v.told || '').trim()) out.push('', 'Already told: ' + v.told.trim());
  sign(out); return out.join('\n');
}

export const TEMPLATES = [
  { id: 'report', kicker: 'During and after the shift', title: 'Shift notes and report', blurb: 'Jot notes as things happen. At the end of the shift they become one report with fridge temps and checklist status.', open: () => openNotes('report') },
  { id: 'gap', kicker: 'To leadership', title: 'Staffing check', blurb: 'Enter who’s scheduled. It finds every stretch with no server, expo or point person, checks the staffing plan if you’ve imported it, and writes the message with exact times.',
    defaults: () => ({ example: true, mode: 'am', date: nextSaturdayKey(), open: '07:00', close: '13:30', rows: [{ role: 'expo', name: '', start: '06:00', end: '14:00' }, { role: 'server', name: '', start: '08:00', end: '16:30' }, { role: 'server', name: '', start: '09:00', end: '13:00' }, { role: 'lead', name: '', start: '11:00', end: '19:30' }], ask: 'Can we get someone to open from 7:00a to 10:00a?' }),
    blank: (v) => ({ example: false, mode: v.mode || 'am', date: v.date || todayKey(), open: v.open || '07:00', close: v.close || '13:30', rows: [{ role: 'server', name: '', start: '', end: '' }], ask: '' }),
    newRow: () => ({ role: 'server', name: '', start: '', end: '' }), form: gapForm, build: gapBuild, after: gapAfter },
  { id: 'shout', kicker: 'To the team', title: 'Shout-outs', daily: true, blurb: 'Thank people by name for exactly what they did. Specific praise lands harder than “great job, team.”',
    defaults: () => ({ opener: 'Shout-outs from today’s shift', rows: [{ name: '', did: '' }, { name: '', did: '' }], closing: 'Thank you all.' }), newRow: () => ({ name: '', did: '' }), form: shoutForm, build: shoutBuild },
  { id: 'incident', kicker: 'Facts first', title: 'Incident note', daily: true, blurb: 'Write it down while it’s fresh: what happened, who helped, what was done and what’s next.',
    note: 'Room or table instead of resident names in group chats. Send health details to the care team or your manager directly. This draft is gone tomorrow.',
    fields: () => [
      { k: 'date', label: 'Date', type: 'date', half: true }, { k: 'time', label: 'Time', type: 'time', half: true },
      { k: 'where', label: 'Where', type: 'select', options: (B().outlets || []).concat(['Kitchen', 'Hallway', 'Other']) },
      { k: 'what', label: 'What happened', type: 'textarea', rows: 3, hint: 'Facts only, in order' },
      { k: 'responded', label: 'Who responded', ph: 'Staff names or roles' },
      { k: 'actions', label: 'What was done', type: 'textarea', hint: 'One per line' },
      { k: 'follow', label: 'Follow-up needed', type: 'textarea', hint: 'One per line' },
      { k: 'told', label: 'Already told', ph: 'Manager, the care team…' }],
    defaults: () => ({ date: todayKey(), time: hhmmNow(), where: (B().outlets || [])[0] || 'Other', what: '', responded: '', actions: '', follow: '', told: '' }), build: incidentBuild },
  { id: 'equip', kicker: 'Maintenance', title: 'Equipment problem', blurb: 'What’s broken, where, how urgent and the workaround, all in one message.',
    fields: () => [{ k: 'item', label: 'Equipment', ph: 'Glass washer' }, { k: 'where', label: 'Where', ph: 'Dish area' }, { k: 'problem', label: 'What’s wrong', type: 'textarea' }, { k: 'since', label: 'Since when', ph: 'This morning', half: true }, { k: 'urgency', label: 'Urgency', type: 'select', options: ['Fix today', 'This week', 'FYI'], half: true }, { k: 'impact', label: 'Impact and workaround', type: 'textarea' }, { k: 'told', label: 'Already told' }],
    defaults: () => ({ item: '', where: '', problem: '', since: '', urgency: 'Fix today', impact: '', told: '' }), build: equipBuild }
];
TEMPLATES.forEach((T) => { if (!T.form && T.fields) T.form = (v) => fieldsForm(T, v); });

function fieldsForm(T, v) {
  return '<div class="form">' + T.fields().map((f) => {
    const id = 'tf-' + T.id + '-' + f.k, val = v[f.k] == null ? '' : v[f.k];
    let ctl;
    if (f.type === 'textarea') ctl = '<textarea id="' + id + '" data-f="' + f.k + '" rows="' + (f.rows || 2) + '" placeholder="' + esc(f.ph || '') + '">' + esc(val) + '</textarea>';
    else if (f.type === 'select') ctl = '<select id="' + id + '" data-f="' + f.k + '">' + f.options.map((o) => '<option' + (o === val ? ' selected' : '') + '>' + esc(o) + '</option>').join('') + '</select>';
    else ctl = '<input id="' + id + '" data-f="' + f.k + '" type="' + (f.type || 'text') + '" value="' + esc(val) + '" placeholder="' + esc(f.ph || '') + '">';
    return '<div class="field' + (f.half ? ' half' : '') + '"><label for="' + id + '"><span class="l">' + esc(f.label) + '</span>' + (f.hint ? '<span class="hint">' + esc(f.hint) + '</span>' : '') + '</label>' + ctl + '</div>';
  }).join('') + '</div>';
}

let cur = null; // { T, v }
function loadVals(T) {
  const d = T.defaults(), s = S.msgs[T.id];
  if (!s || (T.daily && s.__day !== todayKey())) return d;
  return Object.assign(d, s);
}
function persist() { if (!cur) return; const v = cur.v; v.__day = todayKey(); v.__daily = !!cur.T.daily; S.msgs[cur.T.id] = v; save('msgs'); }
function update(store) { if (!cur) return; const c = $('#chit'); if (c) c.textContent = cur.T.build(cur.v); if (cur.T.after) cur.T.after(cur.v); if (store !== false) persist(); }
function redrawForm() { const f = $('#tmpl-form'); if (f && cur) f.innerHTML = cur.T.form(cur.v); update(); }

export function openTmpl(id) {
  const T = TEMPLATES.find((t) => t.id === id); if (!T) return;
  if (T.open) { T.open(); return; }
  cur = { T, v: loadVals(T) };
  openSheet({
    eyebrow: T.kicker, title: T.title,
    body: (T.note ? '<p class="note">' + esc(T.note) + '</p>' : '') + '<div id="tmpl-form">' + T.form(cur.v) + '</div><div class="preview"><span class="lbl">Preview</span><pre class="chit" id="chit"></pre></div>',
    foot: '<button class="btn ghost" data-act="tmpl-reset">Clear</button><button class="btn ghost" data-act="tmpl-share" aria-label="Share">' + ICON.share + '</button><button class="btn primary" data-act="tmpl-copy">' + ICON.copy + ' Copy' + (B().messaging ? ' for ' + esc(B().messaging) : '') + '</button>',
    onMount: () => update(false), onClose: () => { cur = null; }
  });
}
export function tmplList() {
  return '<ul class="tmpl-list">' + TEMPLATES.map((t) => '<li><button class="tmpl" data-act="open-tmpl" data-id="' + t.id + '"><span class="tmpl-k mono">' + esc(t.kicker) + '</span><span class="tmpl-t">' + esc(t.title) + '</span><span class="tmpl-b">' + esc(t.blurb) + '</span></button></li>').join('') + '</ul>';
}

export const acts = {
  'open-tmpl': (el) => openTmpl(el.dataset.id),
  'tmpl-copy': async () => { if (!cur) return; if (await copyText(cur.T.build(cur.v))) toast('Copied. Paste it into ' + (B().messaging || 'your team chat') + '.'); },
  'tmpl-share': async () => { if (!cur) return; const r = await shareText(cur.T.build(cur.v), cur.T.title); if (r === 'copied') toast('Copied.'); },
  'tmpl-reset': () => { if (!cur) return; cur.v = cur.T.blank ? cur.T.blank(cur.v) : cur.T.defaults(); redrawForm(); toast('Cleared.'); },
  'gap-clear': () => { if (!cur) return; cur.v = cur.T.blank(cur.v); redrawForm(); },
  'row-add': () => { if (!cur || !cur.T.newRow) return; cur.v.rows = (cur.v.rows || []).concat([cur.T.newRow()]); cur.v.example = false; redrawForm(); },
  'row-del': (el) => { if (!cur) return; cur.v.rows.splice(+el.dataset.i, 1); cur.v.example = false; redrawForm(); }
};
export function onInput(el) {
  if (!cur || !el.closest('#tmpl-form')) return false;
  if (el.dataset.f) cur.v[el.dataset.f] = el.value;
  else if (el.dataset.rf2 && el.dataset.row != null) { const r = cur.v.rows[+el.dataset.row]; if (r) r[el.dataset.rf2] = el.value; }
  else return false;
  if (cur.v.example) { cur.v.example = false; const n = $('#tmpl-form .note'); if (n) n.remove(); }
  update(); return true;
}
export { signName, L };
