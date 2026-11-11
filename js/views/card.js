// The allergen card on the phone: the rows, the kitchen's check, a preview of the printed pages, and
// editing. Lives in the Training repo as card3.json, with the same rules as floor plans: a view-only
// key can look and print, and nothing here is sent anywhere else.
// The pages themselves are worked out in card3.js and drawn in card3pages.js.

import { app } from '../app.js';
import { M, S, edit, save, whoAmI, signName } from '../state.js';
import { esc, uid, todayKey, clone, fmtRev, $, $$ } from '../util.js';
import { ICON, empty, openSheet, closeSheet, toast, armed, field, input, textarea, opts, chip } from '../ui.js';
import { canWrite, connOf } from '../sync.js';
import { ALLERGENS, STATUS, MEALS, MEAL_NAME, KINDS, MARKS, PAGES, rowsOf, kitchenOf, notesOf, stampOf, isChecked, setStamp, dropStaleStamp, fingerprint, issues, openCount, emptyCard } from '../card3.js';
import { pageHTML, allPages, measure, loadFonts } from '../card3pages.js';

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (v == null || typeof v === 'object' ? '' : String(v));
const az = (a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base', numeric: true });
export const hasCard = () => !!S.menu.local && (rowsOf(M()).length > 0 || isObj(M().guide) && Object.keys(M().guide).length > 0);
const roNow = () => !canWrite('menu');
const ro = () => { if (!roNow()) return false; toast('View only: your access to the training repo can’t change the card.'); return true; };

/* Every change goes through here, so a kitchen check that no longer matches is cleared at once. */
function editCard(fn) {
  edit('menu', (d) => {
    const was = stampOf(d);
    fn(d);
    if (dropStaleStamp(d) && was) d.checkedBefore = { name: was.name, date: was.date };
  });
}
const rawRow = (id) => (Array.isArray(M().rows) ? M().rows.find((r) => isObj(r) && r.id === id) : null) || null;

/* ---------- does it fit on the paper? ----------
   Measured in the browser with the real fonts, a moment after the screen draws. */
let fit = { key: '', over: {} }, measuring = false;
const fitKey = () => fingerprint(M()) + '|' + (isChecked(M()) ? 1 : 0);
function checkFit() {
  if (measuring || fit.key === fitKey() || !hasCard() || typeof document === 'undefined' || !document.body || !document.body.appendChild || !document.createElement) return;
  measuring = true;
  const go = () => {
    try {
      const key = fitKey(), box = document.createElement('div');
      box.className = 'c3-measure'; box.setAttribute('aria-hidden', 'true'); box.innerHTML = allPages(M());
      document.body.appendChild(box);
      const over = measure(box); box.remove();
      const changed = JSON.stringify(over) !== JSON.stringify(fit.over) || fit.key === '';
      fit = { key, over };
      if (changed && app.route.tab === 'book' && app.route.sub === 'allergens' && !document.querySelector('#sheet-root .sheet')) app.renderView();
    } catch (e) { console.warn(e); } finally { measuring = false; }
  };
  loadFonts().then(() => requestAnimationFrame(go)).catch(() => { measuring = false; });
}
const pageName = (id) => (PAGES.find((p) => p.id === id) || {}).name || id;
export const overPages = () => (fit.key === fitKey() ? PAGES.filter((p) => fit.over[p.id] > 0).map((p) => ({ id: p.id, name: p.name, px: fit.over[p.id] })) : []);
function fitWarning() {
  const o = overPages();
  if (!o.length) return '';
  return '<div class="banner warn static" role="status"><strong>' + (o.length === 1 ? 'One page is' : o.length + ' pages are') + ' too long to print.</strong>' +
    o.map((p) => esc(p.name) + ' runs about ' + Math.max(1, Math.ceil(p.px / 20)) + (Math.ceil(p.px / 20) <= 1 ? ' line' : ' lines') + ' past the bottom of the sheet').join('; ') + '. The bottom would be cut off. Shorten a name or a note, or move an item, then look again.</div>';
}
export function printNote() {
  loadFonts(); checkFit(); // so the print uses the card's own fonts, and the fit is known
  const o = overPages(), d = M();
  return (o.length ? '<p class="note"><b class="warn-t">Won’t fit:</b> ' + esc(o.map((p) => p.name).join(', ')) + (o.length === 1 ? ' runs' : ' run') + ' past the bottom of the sheet, and the bottom would be cut off.</p>' : '') +
    (isChecked(d) ? '' : '<p class="note">This prints as a <b>draft</b>: the kitchen hasn’t checked the card as it is now.</p>') +
    '<p class="hint">In the print screen choose Letter paper, margins <b>None</b> and scale 100%.</p>';
}
export function printTarget() { return hasCard() ? { label: 'Allergen card' + (isChecked(M()) ? '' : ' (draft)'), rev: /^\d{4}-\d\d-\d\d/.test(str(M().updated)) ? str(M().updated).slice(0, 10) : todayKey() } : null; }
export const printHTML = () => allPages(M());

/* ---------- the card screen ---------- */
let filter = 'all';
const FILTERS = [['all', 'All'], ['B', 'Breakfast'], ['L', 'Lunch'], ['D', 'Dinner'], ['extra', 'Sauces and parts'], ['ask', 'Ask']];
function tags(r, kitchen) {
  let h = '';
  ALLERGENS.forEach((a) => {
    const es = r.entries.filter((e) => e.a === a.id);
    if (!es.length) return;
    const st = es.some((e) => e.s === 'in') ? 'in' : es.some((e) => e.s === 'opt') ? 'opt' : 'ask';
    h += '<span class="c3-tag c3-' + st + '">' + a.code + (st === 'ask' ? '?' : '') + '<span class="sr"> ' + esc(a.name) + (st === 'in' ? ', in it' : st === 'opt' ? ', can be made without' : ', ask') + '</span></span>';
  });
  kitchen.filter((k) => k.chip && r.cross.includes(k.id)).forEach((k) => { h += '<span class="c3-tag x">' + esc(k.chip) + '</span>'; });
  return h || '<span class="hint">None listed</span>';
}
function stateBox(d) {
  const s = stampOf(d), ok = isChecked(d), open = openCount(d), was = isObj(d.checkedBefore) ? d.checkedBefore : null;
  let line;
  if (ok) line = '<b>Kitchen checked</b><span>' + esc(s.name) + ', ' + esc(fmtRev(s.date)) + '. Any change to a row clears this.</span>';
  else line = '<b>Draft: kitchen to check</b><span>' + (was && str(was.name) ? 'Changed since ' + esc(str(was.name)) + ' checked it' + (/^\d{4}-\d\d-\d\d$/.test(str(was.date)) ? ' on ' + esc(fmtRev(str(was.date))) : '') + '. ' : '') + 'Every page prints with a Draft tag until the kitchen checks the card as it is now.</span>';
  return '<div class="c3-state' + (ok ? ' ok' : '') + '">' + line + (open ? '<span class="hint">' + open + (open === 1 ? ' allergen call still says' : ' allergen calls still say') + ' Ask. They print as dashed chips: treat as in it.</span>' : '') + '</div>';
}
/* Two phones changed the same row between syncs. Nothing was dropped from an allergen list, but a person
   should look: the notes stay here until someone taps Got it. */
const FIELD = { allergens: 'allergens', cross: 'shared equipment marks', with: 'goes-out-with list', parts: 'choices' };
const clashes = () => (S.conflicts || []).filter((c) => isObj(c) && c.key === 'menu');
function clashBox(rows) {
  const list = clashes();
  if (!list.length) return '';
  const byId = new Map(rows.map((r) => [r.id, r])), seen = new Set(), lines = [];
  list.forEach((c) => {
    const m = /^\.rows\[([^\]]*)\](?:\.([A-Za-z]+))?/.exec(str(c.path)), row = m ? byId.get(m[1]) : null;
    const what = m ? (row ? row.name || '(no name)' : 'A row that’s gone now') : 'The card’s other words or shared equipment';
    const text = c.kept === 'both' ? 'its ' + (FIELD[m && m[2]] || 'details') + ' changed on two phones at once. Everything from both was kept.'
      : 'changed on two phones at once. ' + (c.kept === 'github' ? 'The other phone’s' : 'This phone’s') + ' version' + (m && m[2] ? ' of its ' + (FIELD[m[2]] || 'details') : '') + ' was kept.';
    const k = what + '|' + text; if (seen.has(k)) return; seen.add(k);
    lines.push('<li><b>' + esc(what) + ':</b> ' + esc(text) + '</li>');
  });
  return '<div class="banner warn static" role="status"><strong>Check ' + (lines.length === 1 ? 'this' : 'these') + ' before trusting the card.</strong><ul class="c3-issues">' + lines.join('') + '</ul>' +
    '<button class="btn small ghost" data-act="c3-clash-clear">Got it, I’ve checked</button></div>';
}
export function cardView() {
  const d = M(), view = roNow(), ed = app.ui.editing && !view;
  let h = '';
  if (!connOf('menu')) h += '<p class="note">The allergen card is kept on this phone only for now. Connect the Training repo in <button class="link inline" data-act="tab" data-id="more">More → Sync</button> to share it and keep it safe.</p>';
  else if (view) h += '<p class="note">View only. Your access to the training repo can’t change the card, but you can look and print.</p>';
  if (!hasCard()) {
    return h + empty('No allergen card yet. If you were given a starting file, bring it in with More → Import a file.') +
      (view ? '' : '<div class="row-actions"><button class="btn" data-act="c3-start">' + ICON.plus + ' Start an empty card</button></div>');
  }
  checkFit();
  const rows = rowsOf(d), kitchen = kitchenOf(d);
  h += stateBox(d) + clashBox(rows) + fitWarning();
  h += '<div class="row-actions"><button class="btn small" data-act="go" data-id="#book/allergens/preview">Look at the pages</button><button class="btn small ghost" data-act="print" data-kind="card3">' + ICON.print + ' Print</button>' +
    (view ? '' : '<button class="btn small ghost" data-act="c3-stamp">' + ICON.check + (isChecked(d) ? ' Kitchen checked…' : ' Mark kitchen checked') + '</button>') + '</div>';
  const iss = issues(d).filter((i) => !i.soft);
  if (iss.length) h += '<h2 class="sec-h">Worth a look</h2><ul class="c3-issues">' + iss.map((i) => '<li>' + esc(i.text) + '</li>').join('') + '</ul>';
  h += '<div class="chips" role="group" aria-label="Show">' + FILTERS.map(([id, label]) => chip('c3-filter', id, label, filter === id)).join('') + '</div>';
  const show = rows.filter((r) => filter === 'all' ? true : filter === 'extra' ? r.kind === 'extra' : filter === 'ask' ? r.entries.some((e) => e.s === 'ask' || e.s === 'label') : r.kind !== 'extra' && r.meals.includes(filter)).sort(az);
  h += show.length ? '<ul class="c3-rowlist">' + show.map((r) => '<li><button class="c3-rowb" data-act="c3-row" data-id="' + esc(r.id) + '"><span class="cat">' + esc(KINDS[r.kind]) + (r.meals.length ? ' · ' + r.meals.join(' ') : '') + (r.packaged ? ' · packaged' : '') + (r.daily ? ' · changes daily' : '') + '</span><span class="c-title">' + esc(r.name || '(no name)') + '</span><span class="c3-tags">' + tags(r, kitchen) + '</span></button></li>').join('') + '</ul>' : empty('Nothing here.', true);
  if (ed) {
    h += '<div class="edit-row"><button class="btn small" data-act="c3-row-new">' + ICON.plus + ' Add a row</button></div>';
    h += '<h2 class="sec-h">Shared equipment</h2><p class="hint">A shared fryer or flat-top carries allergens onto everything cooked on it. Rows marked for one get its chip, and the back page lists it.</p><ul class="c3-rowlist">' +
      kitchen.map((k) => '<li><button class="c3-rowb" data-act="c3-kit" data-id="' + esc(k.id) + '"><span class="c-title">' + esc(k.title || k.chip || 'Untitled') + '</span><span class="hint">' + esc(k.text) + '</span></button></li>').join('') + '</ul>' +
      '<div class="edit-row"><button class="btn small" data-act="c3-kit-new">' + ICON.plus + ' Add shared equipment</button></div>';
    h += '<h2 class="sec-h">Notes by allergen</h2><p class="hint">A line for the back page, and questions to ask that aren’t about one row.</p><div class="chips">' + ALLERGENS.map((a) => '<button class="chip" data-act="c3-note" data-id="' + a.id + '">' + esc(a.name) + '</button>').join('') + '</div>';
  } else if (!view) h += '<p class="hint">Tap a row to see it. Turn on Edit to change rows, shared equipment and notes. The card’s other words (titles, the routine on the front) are changed in the file.</p>';
  h += '<p class="foot-note mono">' + rows.length + ' rows' + (str(d.updated) ? ' · changed ' + esc(fmtRev(str(d.updated).slice(0, 10))) : '') + '</p>';
  return h;
}

/* ---------- looking at the pages ---------- */
export function previewView() {
  if (!hasCard()) return empty('No allergen card yet. <button class="link inline" data-act="go" data-id="#book/allergens">Back</button>');
  checkFit();
  const d = M(), known = fit.key === fitKey();
  let h = '<button class="back" data-act="go" data-id="#book/allergens">' + ICON.chevL + ' Allergen card</button>' + fitWarning() +
    '<div class="row-actions"><button class="btn small" data-act="print" data-kind="card3">' + ICON.print + ' Print</button></div>';
  PAGES.forEach((p, i) => {
    const px = known ? fit.over[p.id] || 0 : 0;
    h += '<div class="c3-pg-h"><h2>Page ' + (i + 1) + ': ' + esc(p.name) + '</h2><span class="hint">' + (!known ? 'Checking the fit…' : px > 0 ? '<b class="warn-t">Too long for the sheet</b>' : 'Fits on Letter') + '</span></div>' +
      '<div class="c3-frame' + (px > 0 ? ' over' : '') + '" role="img" aria-label="' + esc(p.name) + ' page as it prints">' + pageHTML(d, p.id) + '</div>';
  });
  setTimeout(scaleFrames, 0);
  return h;
}
function scaleFrames() {
  try { $$('.c3-frame').forEach((f) => { const w = f.clientWidth; if (w) f.style.setProperty('--c3-s', String(w / 816)); }); } catch (e) { /* not in a browser */ }
}
if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('resize', scaleFrames);

/* ---------- one row ---------- */
let draft = null, isNew = false;
const val = (id) => { const el = $('#' + id); return el ? String(el.value || '').trim() : ''; };
const on = (id) => { const el = $('#' + id); return !!(el && el.checked); };
function refList(key, title, hint) {
  const rows = rowsOf(M()), byId = new Map(rows.map((r) => [r.id, r]));
  const list = Array.isArray(draft[key]) ? draft[key] : [];
  const pick = rows.filter((r) => r.id !== draft.id && (key === 'parts' ? r.kind === 'extra' : true) && !list.some((x) => isObj(x) && x.ref === r.id)).sort((a, b) => (a.kind === 'extra' ? 0 : 1) - (b.kind === 'extra' ? 0 : 1) || az(a, b));
  return '<h3 class="sub-h">' + title + '</h3><p class="hint" style="margin-top:0">' + hint + '</p>' +
    (list.length ? '<ul class="c3-refs">' + list.map((x, i) => {
      const o = isObj(x) ? x : { t: str(x) }, t = o.ref ? byId.get(o.ref) : null;
      return '<li><span>' + esc(str(o.t) || (t ? t.name : 'Deleted row')) + (o.ref && t && str(o.t) ? ' <span class="hint">(' + esc(t.name) + ')</span>' : '') + (o.ref && !t ? ' <b class="warn-t">deleted</b>' : '') + (Array.isArray(o.meals) && o.meals.length ? ' <span class="mono">' + esc(o.meals.join(' ')) + '</span>' : '') + (o.ref ? '' : ' <span class="hint">plain text, no allergens</span>') + '</span>' +
        '<button class="icon-b" data-act="c3-ref-del" data-key="' + key + '" data-id="' + i + '" aria-label="Remove ' + esc(str(o.t) || (t ? t.name : 'this')) + '">' + ICON.close + '</button></li>';
    }).join('') + '</ul>' : '') +
    '<div class="form">' + field('c3-' + key + '-pick', 'Add a row', '<select id="c3-' + key + '-pick"><option value="">Choose…</option>' + pick.map((r) => '<option value="' + esc(r.id) + '">' + esc(r.name) + '</option>').join('') + '</select>', 'Its allergens show beside it.', 'half') +
    field('c3-' + key + '-text', 'Or plain text', input('c3-' + key + '-text', '', 'autocomplete="off" maxlength="40"'), 'No allergens. Like a garnish.', 'half') +
    field('c3-' + key + '-meals', 'Only at', '<select id="c3-' + key + '-meals">' + opts([['', 'Every meal it’s on'], ['B', 'Breakfast'], ['L', 'Lunch'], ['D', 'Dinner']], '') + '</select>', '', 'half') + '</div>' +
    '<div class="edit-row"><button class="btn small" data-act="c3-ref-add" data-key="' + key + '">' + ICON.plus + ' Add</button></div>';
}
function rowBody() {
  const r = draft, kitchen = kitchenOf(M()), es = Array.isArray(r.allergens) ? r.allergens : [];
  let h = '<div class="form">' + field('c3-name', 'Name', input('c3-name', str(r.name), 'autocomplete="off" maxlength="60"'), 'As the menu says it') +
    field('c3-kind', 'What it is', '<select id="c3-kind">' + opts(Object.entries(KINDS), KINDS[r.kind] ? r.kind : 'dish') + '</select>', 'Sauces, toppings and parts don’t get their own line on the menu pages.', 'half') +
    field('c3-short', 'Short name', input('c3-short', str(r.short), 'autocomplete="off" maxlength="40"'), 'Optional. Used in lists.', 'half') + '</div>' +
    '<fieldset class="c3-checks"><legend class="l">On the menu at</legend>' + MEALS.map((m) => '<label class="checkline half"><input type="checkbox" id="c3-m-' + m + '"' + ((r.meals || []).includes(m) ? ' checked' : '') + '><span>' + MEAL_NAME[m] + '</span></label>').join('') + '</fieldset>' +
    '<div class="form">' + field('c3-desc', 'What comes on it', input('c3-desc', str(r.desc), 'autocomplete="off" maxlength="80"'), 'Optional. Shown on the breakfast page.') +
    field('c3-check', 'Still to check', input('c3-check', str(r.check), 'autocomplete="off" maxlength="60"'), 'Optional. Prints in amber as “Check: …”') + '</div>';
  h += '<h3 class="sub-h">Allergens</h3>' + (es.length ? '' : '<p class="hint" style="margin-top:0">None listed. Add one for each allergen in it, or that might be.</p>');
  es.forEach((e, i) => {
    const o = isObj(e) ? e : {};
    h += '<div class="c3-ent"><div class="c3-ent-h"><b>Allergen ' + (i + 1) + '</b><button class="icon-b" data-act="c3-ent-del" data-id="' + i + '" aria-label="Remove allergen ' + (i + 1) + '">' + ICON.trash + '</button></div><div class="form">' +
      field('c3-e' + i + '-a', 'Allergen', '<select id="c3-e' + i + '-a">' + opts(ALLERGENS.map((a) => [a.id, a.name]), o.a) + '</select>', '', 'half') +
      field('c3-e' + i + '-s', 'How sure', '<select id="c3-e' + i + '-s">' + opts(Object.entries(STATUS), STATUS[o.s] ? o.s : 'ask') + '</select>', '', 'half') +
      field('c3-e' + i + '-from', 'Comes from', input('c3-e' + i + '-from', str(o.from), 'autocomplete="off" maxlength="40"'), 'The ingredient, like cheese or the bun. It’s what the back page says to leave off or ask about.') +
      field('c3-e' + i + '-list', 'List on the back as', input('c3-e' + i + '-list', str(o.list), 'autocomplete="off" maxlength="40"'), 'Optional. Rows with the same words share a line.', 'half') +
      field('c3-e' + i + '-sub', 'Small print', input('c3-e' + i + '-sub', str(o.sub), 'autocomplete="off" maxlength="40"'), 'Optional', 'half') + '</div></div>';
  });
  h += '<div class="edit-row"><button class="btn small" data-act="c3-ent-add">' + ICON.plus + ' Add an allergen</button></div>';
  h += '<fieldset class="c3-checks"><legend class="l">Also</legend>' +
    kitchen.map((k) => '<label class="checkline half"><input type="checkbox" data-x="' + esc(k.id) + '"' + ((r.cross || []).includes(k.id) ? ' checked' : '') + '><span>' + esc(k.title || k.chip || 'Shared equipment') + '</span></label>').join('') +
    '<label class="checkline half"><input type="checkbox" id="c3-packaged"' + (r.packaged === true ? ' checked' : '') + '><span>Packaged (check the label)</span></label>' +
    '<label class="checkline half"><input type="checkbox" id="c3-daily"' + (r.daily === true ? ' checked' : '') + '><span>Changes daily</span></label></fieldset>' +
    '<div class="form">' + field('c3-tail', 'Note after the chips', input('c3-tail', str(r.tail), 'autocomplete="off" maxlength="50"'), 'Optional. Like “ask expo”.') + '</div>';
  h += refList('with', 'Goes out with', 'Sauces and sides that leave the kitchen with it.') + refList('parts', 'Choices inside it', 'For a build-your-own plate: each choice shows with its own allergens.');
  h += '<h3 class="sub-h">Menu marks</h3><div class="form">' + [['veg', 'Vegetarian'], ['gf', 'Gluten-free'], ['df', 'Dairy-free']].map(([k, label]) => field('c3-' + k, label, '<select id="c3-' + k + '">' + opts(Object.entries(MARKS), MARKS[r[k]] ? r[k] : '') + '</select>', '', 'half')).join('') + '</div>';
  if (!isNew) h += '<div class="row-actions"><button class="btn small danger" data-act="c3-row-del">' + ICON.trash + ' Delete this row</button></div>';
  return h;
}
/* Read the form back into the draft, so adding an allergen line doesn't lose what was typed. */
function pull() {
  if (!draft || !$('#c3-name')) return;
  const r = draft, put = (k, v) => { if (v === '' || v === false || (Array.isArray(v) && !v.length)) delete r[k]; else r[k] = v; };
  r.name = val('c3-name'); r.kind = KINDS[val('c3-kind')] ? val('c3-kind') : 'dish';
  put('short', val('c3-short')); r.meals = MEALS.filter((m) => on('c3-m-' + m));
  put('desc', val('c3-desc')); put('check', val('c3-check'));
  r.allergens = (Array.isArray(r.allergens) ? r.allergens : []).map((e, i) => {
    if (!$('#c3-e' + i + '-a')) return e;
    const o = { a: val('c3-e' + i + '-a'), s: val('c3-e' + i + '-s') };
    ['from', 'list', 'sub'].forEach((k) => { const v = val('c3-e' + i + '-' + k); if (v) o[k] = v; });
    return o;
  });
  put('cross', $$('#sheet-b input[data-x]').filter((el) => el.checked).map((el) => el.dataset.x));
  put('packaged', on('c3-packaged')); put('daily', on('c3-daily')); put('tail', val('c3-tail'));
  ['veg', 'gf', 'df'].forEach((k) => put(k, MARKS[val('c3-' + k)] ? val('c3-' + k) : ''));
}
function openRow(r, fresh) {
  draft = clone(r); isNew = !!fresh;
  const view = roNow() || !app.ui.editing;
  if (view) {
    const n = rowsOf({ rows: [r] })[0], kitchen = kitchenOf(M());
    openSheet({
      eyebrow: KINDS[n.kind] + (n.meals.length ? ' · ' + n.meals.map((m) => MEAL_NAME[m]).join(', ') : ''), title: n.name || 'Row',
      body: (n.desc ? '<p class="muted" style="margin-top:0">' + esc(n.desc) + '</p>' : '') + (n.check ? '<p class="note"><b>Check:</b> ' + esc(n.check) + '</p>' : '') +
        (n.entries.length ? '<ul class="plain-list">' + n.entries.map((e) => '<li><b>' + esc(ALLERGENS.find((a) => a.id === e.a).name) + ':</b> ' + esc(STATUS[e.s]) + (e.from ? ' (' + esc(e.from) + ')' : '') + '</li>').join('') + '</ul>' : '<p>No allergens listed.</p>') +
        '<p class="c3-tags" style="margin-top:12px">' + tags(n, kitchen) + '</p>' + (n.packaged ? '<p class="hint">Packaged: check the label.</p>' : '') +
        (roNow() ? '' : '<p class="hint">To change this row, close this and turn on Edit.</p>')
    });
    return;
  }
  openSheet({ eyebrow: fresh ? 'New row' : 'Row', title: str(r.name) || 'New row', wide: true, body: rowBody(), foot: '<button class="btn primary" data-act="c3-row-save">Save</button>', onClose: () => { draft = null; } });
}
const reSheet = () => { const b = $('#sheet-b'); if (b) b.innerHTML = rowBody(); };

/* ---------- shared equipment, notes, the kitchen's check ---------- */
function kitSheet(k, fresh) {
  openSheet({
    eyebrow: 'Shared equipment', title: str(k.title) || 'New', wide: true,
    body: '<div class="form">' + field('ck-title', 'Name', input('ck-title', str(k.title), 'autocomplete="off" maxlength="30"'), 'Like “Shared fryer”') +
      field('ck-text', 'What to know', textarea('ck-text', str(k.text), 2, 'maxlength="140"'), 'Prints in the amber box on the back page.') +
      field('ck-chip', 'Chip', input('ck-chip', str(k.chip), 'autocomplete="off" maxlength="10"'), 'Short, in capitals. Blank for none.', 'half') +
      field('ck-foot', 'Chip means', input('ck-foot', str(k.foot), 'autocomplete="off" maxlength="40"'), 'For the key at the foot of the menu pages.', 'half') +
      field('ck-legend', 'Longer meaning', input('ck-legend', str(k.legend), 'autocomplete="off" maxlength="50"'), 'For the key on the front page.') + '</div>' +
      '<fieldset class="c3-checks"><legend class="l">Carries</legend>' + ALLERGENS.map((a) => '<label class="checkline half"><input type="checkbox" data-c="' + a.id + '"' + ((k.carries || []).includes(a.id) ? ' checked' : '') + '><span>' + esc(a.name) + '</span></label>').join('') + '</fieldset>' +
      '<div class="form">' + field('ck-list', 'List on the back as', input('ck-list', str(k.listAs), 'autocomplete="off" maxlength="40"'), 'Like “Anything fried”. Blank to leave it off the lists.', 'half') +
      field('ck-sub', 'Small print', input('ck-sub', str(k.sub), 'autocomplete="off" maxlength="50"'), 'Optional', 'half') +
      field('ck-word', 'On the front as', input('ck-word', str(k.menuWord), 'autocomplete="off" maxlength="30"'), 'Like “fried food”. Optional.') + '</div>' +
      (fresh ? '' : '<div class="row-actions"><button class="btn small danger" data-act="c3-kit-del" data-id="' + esc(k.id) + '">' + ICON.trash + ' Delete</button></div>'),
    foot: '<button class="btn primary" data-act="c3-kit-save" data-id="' + esc(fresh ? '' : k.id) + '">Save</button>'
  });
}
function noteSheet(a) {
  const n = notesOf(M(), a.id);
  openSheet({
    eyebrow: 'Notes', title: a.name,
    body: '<div class="form">' + field('cn-back', 'A line for the back page', textarea('cn-back', n.back, 2, 'maxlength="140"'), 'Optional.') +
      field('cn-ask', 'More to ask', textarea('cn-ask', n.ask.join('\n'), 3, 'maxlength="300"'), 'One per line. Questions that aren’t about a single row.') +
      field('cn-off', 'After “Leave off”', input('cn-off', n.off, 'autocomplete="off" maxlength="40"'), 'Optional. Like “(GF versions exist)”.') +
      field('cn-menu', 'On the front, if no row names it', input('cn-menu', n.menu, 'autocomplete="off" maxlength="60"'), 'Optional.') + '</div>',
    foot: '<button class="btn primary" data-act="c3-note-save" data-id="' + a.id + '">Save</button>'
  });
}
function stampSheet() {
  const d = M(), ok = isChecked(d), s = stampOf(d), open = openCount(d), over = overPages();
  openSheet({
    eyebrow: 'Allergen card', title: 'Kitchen checked',
    body: (ok ? '<p class="note">Checked by <b>' + esc(s.name) + '</b> on ' + esc(fmtRev(s.date)) + '. It covers the card exactly as it is now.</p>' : '<p style="margin-top:0">Fill this in once someone in the kitchen has gone through the printed draft and agrees with every line. It covers the card exactly as it is now: change any row afterwards and the card goes back to a draft.</p>') +
      (open ? '<p class="note">' + open + (open === 1 ? ' allergen call still says' : ' allergen calls still say') + ' <b>Ask</b>. That’s fine if the kitchen agrees they’re unknown: they stay dashed and staff treat them as in it.</p>' : '') +
      (over.length ? '<p class="note"><b class="warn-t">' + esc(over.map((p) => p.name).join(', ')) + '</b> won’t fit on the sheet yet.</p>' : '') +
      '<div class="form">' + field('cs-name', 'Who checked it', input('cs-name', ok ? s.name : '', 'autocomplete="off" maxlength="40"'), 'Their name, as it should print') +
      field('cs-date', 'When', input('cs-date', ok ? s.date : todayKey(), 'type="date" max="' + todayKey() + '"')) + '</div>' +
      (ok ? '<div class="row-actions"><button class="btn small danger" data-act="c3-stamp-clear">Take the check off</button></div>' : ''),
    foot: '<button class="btn primary" data-act="c3-stamp-save">' + (ok ? 'Save' : 'Mark kitchen checked') + '</button>'
  });
}

export const acts = {
  'c3-filter': (el) => { filter = el.dataset.id; app.renderView(); },
  'c3-start': () => { if (ro()) return; edit('menu', (d) => { Object.assign(d, emptyCard(), { updated: d.updated }); }); app.ui.editing = true; app.renderView(); toast('Empty card started. Add a row.'); },
  'c3-row': (el) => { const r = rawRow(el.dataset.id); if (r) openRow(r, false); },
  'c3-row-new': () => { if (ro()) return; openRow({ id: uid('m'), name: '', kind: filter === 'extra' ? 'extra' : 'dish', meals: MEALS.includes(filter) ? [filter] : [], allergens: [] }, true); },
  'c3-ent-add': () => { if (ro() || !draft) return; pull(); (draft.allergens = draft.allergens || []).push({ a: 'dairy', s: 'ask' }); reSheet(); const el = $('#c3-e' + (draft.allergens.length - 1) + '-a'); if (el) el.focus(); },
  'c3-ent-del': (el) => { if (ro() || !draft) return; pull(); draft.allergens.splice(+el.dataset.id, 1); reSheet(); },
  'c3-ref-add': (el) => {
    if (ro() || !draft) return;
    const key = el.dataset.key === 'parts' ? 'parts' : 'with', ref = val('c3-' + key + '-pick'), t = val('c3-' + key + '-text'), m = val('c3-' + key + '-meals');
    if (!ref && !t) { toast('Choose a row, or type something.'); return; }
    pull();
    const o = {}; if (ref) o.ref = ref; if (t) o.t = t; if (MEALS.includes(m)) o.meals = [m];
    (draft[key] = Array.isArray(draft[key]) ? draft[key] : []).push(o); reSheet();
  },
  'c3-ref-del': (el) => { if (ro() || !draft) return; pull(); const key = el.dataset.key === 'parts' ? 'parts' : 'with'; if (Array.isArray(draft[key])) draft[key].splice(+el.dataset.id, 1); if (draft[key] && !draft[key].length) delete draft[key]; reSheet(); },
  'c3-row-save': () => {
    if (ro() || !draft) return;
    pull();
    if (!draft.name) { toast('Give the row a name.'); const n = $('#c3-name'); if (n) { n.setAttribute('aria-invalid', 'true'); n.focus(); } return; }
    const row = clone(draft); row.updated = todayKey(); const who = whoAmI(); if (who) row.by = who;
    const before = isChecked(M());
    editCard((d) => { d.rows = Array.isArray(d.rows) ? d.rows : []; const i = d.rows.findIndex((x) => isObj(x) && x.id === row.id); if (i >= 0) d.rows[i] = row; else d.rows.push(row); });
    closeSheet(); app.renderView();
    toast(before && !isChecked(M()) ? 'Saved. The card is a draft again until the kitchen checks it.' : 'Saved.');
  },
  'c3-row-del': (el) => {
    if (ro() || !draft || !armed(el, 'Delete this row?')) return;
    const id = draft.id;
    editCard((d) => { d.rows = (Array.isArray(d.rows) ? d.rows : []).filter((x) => !(isObj(x) && x.id === id)); });
    closeSheet(); app.renderView(); toast('Row deleted.');
  },
  'c3-kit': (el) => { if (ro()) return; const k = (Array.isArray(M().kitchen) ? M().kitchen : []).find((x) => isObj(x) && x.id === el.dataset.id); if (k) kitSheet(k, false); },
  'c3-kit-new': () => { if (ro()) return; kitSheet({ id: '', carries: [] }, true); },
  'c3-kit-save': (el) => {
    if (ro()) return;
    const k = { id: el.dataset.id || uid('k'), title: val('ck-title'), text: val('ck-text'), chip: val('ck-chip').toUpperCase(), foot: val('ck-foot'), legend: val('ck-legend'), carries: $$('#sheet-b input[data-c]').filter((x) => x.checked).map((x) => x.dataset.c), listAs: val('ck-list'), sub: val('ck-sub'), menuWord: val('ck-word') };
    if (!k.title) { toast('Give it a name.'); return; }
    Object.keys(k).forEach((key) => { if (k[key] === '') delete k[key]; });
    editCard((d) => { d.kitchen = Array.isArray(d.kitchen) ? d.kitchen : []; const i = d.kitchen.findIndex((x) => isObj(x) && x.id === k.id); if (i >= 0) d.kitchen[i] = k; else d.kitchen.push(k); });
    closeSheet(); app.renderView(); toast('Saved.');
  },
  'c3-kit-del': (el) => {
    if (ro() || !armed(el, 'Delete it?')) return;
    const id = el.dataset.id;
    editCard((d) => { d.kitchen = (Array.isArray(d.kitchen) ? d.kitchen : []).filter((x) => !(isObj(x) && x.id === id)); (Array.isArray(d.rows) ? d.rows : []).forEach((r) => { if (isObj(r) && Array.isArray(r.cross)) { r.cross = r.cross.filter((c) => c !== id); if (!r.cross.length) delete r.cross; } }); });
    closeSheet(); app.renderView(); toast('Deleted, and taken off every row.');
  },
  'c3-note': (el) => { if (ro()) return; const a = ALLERGENS.find((x) => x.id === el.dataset.id); if (a) noteSheet(a); },
  'c3-note-save': (el) => {
    if (ro()) return;
    const id = el.dataset.id; if (!ALLERGENS.some((a) => a.id === id)) return;
    const n = {}; const b = val('cn-back'), ask = val('cn-ask').split('\n').map((x) => x.trim()).filter(Boolean), off = val('cn-off'), menu = val('cn-menu');
    if (b) n.back = b; if (ask.length) n.ask = ask; if (off) n.off = off; if (menu) n.menu = menu;
    editCard((d) => { d.notes = isObj(d.notes) ? d.notes : {}; if (Object.keys(n).length) d.notes[id] = n; else delete d.notes[id]; });
    closeSheet(); app.renderView(); toast('Saved.');
  },
  'c3-clash-clear': () => { S.conflicts = (S.conflicts || []).filter((c) => !(isObj(c) && c.key === 'menu')); save('conflicts'); app.renderView(); },
  'c3-stamp': () => { if (ro()) return; stampSheet(); },
  'c3-stamp-save': (el) => {
    if (ro()) return;
    const name = val('cs-name'), date = val('cs-date');
    if (!name) { toast('Add the name of whoever checked it.'); const n = $('#cs-name'); if (n) n.focus(); return; }
    if (!/^\d{4}-\d\d-\d\d$/.test(date) || date > todayKey()) { toast('Pick the day it was checked.'); return; }
    if (clashes().length) { toast('First check the rows flagged at the top of the card, then tap Got it.'); return; }
    if (!armed(el, 'Tap again: the kitchen checked every line')) return;
    edit('menu', (d) => { delete d.checkedBefore; setStamp(d, name, date, whoAmI() || signName()); });
    closeSheet(); app.renderView(); toast('Kitchen checked. The Draft tag is off until something changes.');
  },
  'c3-stamp-clear': (el) => { if (ro() || !armed(el, 'Take the check off?')) return; edit('menu', (d) => { delete d.stamp; }); closeSheet(); app.renderView(); toast('The card is a draft again.'); }
};
