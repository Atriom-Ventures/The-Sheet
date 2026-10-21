// Card detail and every editor for book content (cards, checklist items, lists, jobs, the day, training).

import { app } from './app.js';
import { S, B, edit, save, card, catName, roleName, blocks } from './state.js';
import { esc, withBlanks, uid, slug, todayKey, lines, copyText, fmt12, toMin, $, $$, clone } from './util.js';
import { ICON, openSheet, closeSheet, toast, armed, field, input, textarea, opts } from './ui.js';
import { printWhat } from './print.js';

/* ---------- card detail ---------- */
export function cardBody(c) {
  let h = '';
  if (c.draft) h += '<p class="draft-note"><b>Draft.</b> Not on staff printouts until it’s finished. Anything highlighted still needs an answer.</p>';
  if (c.private) h += '<p class="draft-note"><b>Phone only.</b> This card never leaves this phone.</p>';
  if (c.why) h += '<div class="why"><span class="lbl">Why it matters</span>' + withBlanks(c.why) + '</div>';
  if ((c.steps || []).length) h += '<ol class="steps' + (c.numbered ? ' num' : '') + '">' + c.steps.map((s) => '<li>' + withBlanks(s) + '</li>').join('') + '</ol>';
  if ((c.watch || []).length) h += '<div class="watch"><span class="lbl">Watch for</span><ul>' + c.watch.map((s) => '<li>' + withBlanks(s) + '</li>').join('') + '</ul></div>';
  const used = usedBy(c.id);
  if (used.length) h += '<p class="used">Linked from ' + used.map((u) => esc(u)).join(' · ') + '</p>';
  if (c.updated) h += '<p class="hint mono">Updated ' + esc(c.updated) + '</p>';
  return h;
}
function usedBy(id) {
  const out = new Set();
  B().tasks.filter((t) => t.card === id).forEach((t) => { const l = B().lists.find((x) => x.id === t.list); if (l) out.add(l.short || l.name); });
  if (B().assignments.some((a) => a.card === id)) out.add('Assignment sheet');
  if (B().training.some((a) => a.card === id)) out.add('Training');
  return Array.from(out);
}
export function cardText(c) {
  const L = [c.title.toUpperCase()];
  if (c.why) L.push(c.why);
  if ((c.steps || []).length) { L.push(''); c.steps.forEach((s, i) => L.push((c.numbered ? (i + 1) + '. ' : '• ') + s)); }
  if ((c.watch || []).length) { L.push('', 'Watch for:'); c.watch.forEach((s) => L.push('• ' + s)); }
  return L.join('\n');
}
export function openCard(id) {
  const c = card(id);
  if (!c) { toast('That card isn’t in the book anymore.'); return; }
  openSheet({
    eyebrow: (c.private ? 'Phone only · ' : '') + catName(c.cat) + (c.draft ? ' · Draft' : ''),
    title: c.title,
    body: cardBody(c),
    foot: '<button class="btn ghost" data-act="card-copy" data-id="' + esc(c.id) + '">' + ICON.copy + ' Copy</button>' +
      (c.private ? '' : '<button class="btn ghost" data-act="print-card" data-id="' + esc(c.id) + '">' + ICON.print + ' Print</button>') +
      '<button class="btn" data-act="card-edit" data-id="' + esc(c.id) + '">' + ICON.pencil + ' Edit</button>'
  });
}

/* ---------- card editor ---------- */
function editCard(id, presetCat) {
  const c = id ? card(id) : { id: '', cat: presetCat || (B().cats[0] || {}).id || '', title: '', why: '', steps: [], watch: [], numbered: false, draft: true };
  if (!c) return;
  const catOpts = B().cats.map((x) => [x.id, x.name]);
  openSheet({
    eyebrow: id ? 'Edit card' : 'New card', title: id ? c.title : 'New card',
    body: '<div class="form">' +
      field('ce-title', 'Title', input('ce-title', c.title, 'autocomplete="off"')) +
      (c.private ? '' : field('ce-cat', 'Category', '<select id="ce-cat">' + opts(catOpts, c.cat) + '</select>', '', 'half')) +
      '<label class="checkline half"><input type="checkbox" id="ce-num"' + (c.numbered ? ' checked' : '') + '><span>Numbered steps</span></label>' +
      field('ce-why', 'Why it matters', textarea('ce-why', c.why, 2)) +
      field('ce-steps', 'Steps', textarea('ce-steps', (c.steps || []).join('\n'), 7), 'One per line. Put anything still unknown in [brackets].') +
      field('ce-watch', 'Watch for', textarea('ce-watch', (c.watch || []).join('\n'), 3), 'One per line') +
      '<label class="checkline"><input type="checkbox" id="ce-draft"' + (c.draft ? ' checked' : '') + '><span>Draft (left off staff printouts)</span></label>' +
    '</div>',
    foot: (id ? '<button class="btn danger" data-act="card-del" data-id="' + esc(id) + '">' + ICON.trash + ' Delete</button>' : '') +
      '<button class="btn primary" data-act="card-save" data-id="' + esc(id || '') + '">Save</button>'
  });
}
function saveCard(id) {
  const title = $('#ce-title').value.trim();
  if (!title) { toast('Give it a title.'); $('#ce-title').focus(); return; }
  const data = {
    title, why: $('#ce-why').value.trim(), steps: lines($('#ce-steps').value), watch: lines($('#ce-watch').value),
    numbered: $('#ce-num').checked, draft: $('#ce-draft').checked, updated: todayKey()
  };
  const pc = (S.priv.cards || []).find((x) => x.id === id);
  if (pc) { Object.assign(pc, data); save('priv'); toast('Saved on this phone.'); app.renderView(); openCard(id); return; }
  data.cat = $('#ce-cat') ? $('#ce-cat').value : '';
  let newId = id;
  edit('book', (b) => {
    if (id) { const c = b.cards.find((x) => x.id === id); if (c) Object.assign(c, data); }
    else { newId = uniq(slug(title), b.cards); b.cards.push(Object.assign({ id: newId }, data)); }
  });
  toast(id ? 'Card saved.' : 'Card added.'); app.renderView();
  openCard(newId); // replaces the editor with the card itself
}
function uniq(base, list) { let id = base, n = 2; while (list.some((x) => x.id === id)) id = base + '-' + (n++); return id; }

/* ---------- checklist item editor ---------- */
function editTask(id, listId, blockId) {
  const t = id ? B().tasks.find((x) => x.id === id) : { id: '', list: listId, block: blockId || '', text: '', card: '' };
  if (!t) return;
  const l = B().lists.find((x) => x.id === t.list);
  const cardOpts = [['', 'None']].concat(B().cards.map((c) => [c.id, c.title]));
  const blockOpts = blocks().map((b) => [b.id, b.name + ' (' + fmt12(b.s) + ')']);
  openSheet({
    eyebrow: (l ? (l.short || l.name) : 'Checklist') + (id ? ' · Edit item' : ' · New item'), title: id ? 'Edit item' : 'New item',
    body: '<div class="form">' +
      field('te-text', 'What to do', textarea('te-text', t.text, 3)) +
      (l && l.byBlock ? field('te-block', 'When', '<select id="te-block">' + opts(blockOpts, t.block) + '</select>') : '') +
      field('te-card', 'How-to card', '<select id="te-card">' + opts(cardOpts, t.card || '') + '</select>', 'Optional. Adds a “How” button.') +
    '</div>',
    foot: (id ? '<button class="btn danger" data-act="task-del" data-id="' + esc(id) + '">' + ICON.trash + '</button><button class="btn ghost" data-act="task-move" data-id="' + esc(id) + '" data-dir="-1" aria-label="Move up">' + ICON.up + '</button><button class="btn ghost" data-act="task-move" data-id="' + esc(id) + '" data-dir="1" aria-label="Move down">' + ICON.down + '</button>' : '') +
      '<button class="btn primary" data-act="task-save" data-id="' + esc(id || '') + '" data-list="' + esc(t.list) + '">Save</button>'
  });
}
function saveTask(id, listId) {
  const text = $('#te-text').value.trim().replace(/\s*\n\s*/g, ' ');
  if (!text) { toast('Type what to do.'); return; }
  const data = { text, card: $('#te-card').value || null, updated: todayKey() };
  if ($('#te-block')) data.block = $('#te-block').value;
  edit('book', (b) => {
    if (id) { const t = b.tasks.find((x) => x.id === id); if (t) Object.assign(t, data); return; }
    const item = Object.assign({ id: uid('t'), list: listId }, data);
    let at = -1; b.tasks.forEach((x, i) => { if (x.list === listId && (!data.block || x.block === data.block)) at = i; });
    if (at < 0) b.tasks.forEach((x, i) => { if (x.list === listId) at = i; });
    if (at < 0) b.tasks.push(item); else b.tasks.splice(at + 1, 0, item);
  });
  closeSheet(); toast(id ? 'Item saved.' : 'Item added.'); app.render();
}
function moveTask(id, dir) {
  edit('book', (b) => {
    const i = b.tasks.findIndex((x) => x.id === id); if (i < 0) return;
    const t = b.tasks[i];
    let j = i + dir;
    while (j >= 0 && j < b.tasks.length && (b.tasks[j].list !== t.list || (t.block && b.tasks[j].block !== t.block))) j += dir;
    if (j < 0 || j >= b.tasks.length) return;
    b.tasks.splice(i, 1); b.tasks.splice(j, 0, t); t.updated = todayKey();
  });
  app.render(); toast(dir < 0 ? 'Moved up.' : 'Moved down.');
}

/* ---------- list editor ---------- */
function editList(id) {
  const l = id ? B().lists.find((x) => x.id === id) : { id: '', name: '', short: '', role: (B().roles[0] || {}).id || '', blocks: [], note: '', draft: false };
  if (!l) return;
  const roleOpts = B().roles.map((r) => [r.id, r.name]);
  openSheet({
    eyebrow: id ? 'Edit checklist' : 'New checklist', title: id ? l.name : 'New checklist',
    body: '<div class="form">' +
      field('le-name', 'Name', input('le-name', l.name)) +
      field('le-short', 'Short name', input('le-short', l.short), 'Shown on buttons', 'half') +
      field('le-role', 'For', '<select id="le-role">' + opts(roleOpts, l.role) + '</select>', '', 'half') +
      (l.byBlock ? '<p class="hint full">Items on this list each have their own time.</p>' :
        '<fieldset class="cb-set full"><legend class="l">Shows up during</legend><div class="cb-chips">' +
        blocks().map((b) => '<label class="cb-chip"><input type="checkbox" class="le-blk" value="' + esc(b.id) + '"' + ((l.blocks || []).indexOf(b.id) >= 0 ? ' checked' : '') + '>' + esc(b.name) + '</label>').join('') + '</div></fieldset>') +
      field('le-note', 'Note', textarea('le-note', l.note, 2), 'Optional') +
      '<label class="checkline"><input type="checkbox" id="le-std"' + (l.standards ? ' checked' : '') + '><span>Standards, not a checklist (no tick boxes)</span></label>' +
      '<label class="checkline"><input type="checkbox" id="le-draft"' + (l.draft ? ' checked' : '') + '><span>Draft (left off staff printouts)</span></label>' +
    '</div>',
    foot: (id ? '<button class="btn danger" data-act="list-del" data-id="' + esc(id) + '">' + ICON.trash + ' Delete</button>' : '') + '<button class="btn primary" data-act="list-save" data-id="' + esc(id || '') + '">Save</button>'
  });
}
function saveList(id) {
  const name = $('#le-name').value.trim();
  if (!name) { toast('Give it a name.'); return; }
  const data = { name, short: $('#le-short').value.trim() || name, role: $('#le-role').value, note: $('#le-note').value.trim(), standards: $('#le-std').checked, draft: $('#le-draft').checked, updated: todayKey() };
  const boxes = $$('.le-blk'); if (boxes.length || !id) data.blocks = boxes.filter((b) => b.checked).map((b) => b.value);
  let nid = id;
  edit('book', (b) => {
    if (id) { const l = b.lists.find((x) => x.id === id); if (l) Object.assign(l, data); }
    else { nid = uniq(slug(name), b.lists); b.lists.push(Object.assign({ id: nid }, data)); }
  });
  toast('Checklist saved.');
  closeSheet().then(() => { if (!id) app.go('#book/list/' + nid); else app.render(); });
}

/* ---------- assignment sheet job editor ---------- */
function editAsg(id, shift) {
  const a = id ? B().assignments.find((x) => x.id === id) : { id: '', shift: shift || 'am', text: '', time: '', by: false, card: '' };
  if (!a) return;
  const cardOpts = [['', 'None']].concat(B().cards.map((c) => [c.id, c.title]));
  openSheet({
    eyebrow: 'Assignment sheet', title: id ? 'Edit job' : 'New job',
    body: '<div class="form">' +
      field('ae-text', 'Job', input('ae-text', a.text)) +
      field('ae-shift', 'Shift', '<select id="ae-shift">' + opts([['am', 'AM'], ['pm', 'PM'], ['all', 'Everyone, all day']], a.shift) + '</select>', '', 'half') +
      field('ae-time', 'Time', '<input id="ae-time" type="time" value="' + esc(a.time || '') + '">', 'Optional', 'half') +
      '<label class="checkline"><input type="checkbox" id="ae-by"' + (a.by ? ' checked' : '') + '><span>The time is a deadline (“by 3:30”), not a start time</span></label>' +
      field('ae-card', 'How-to card', '<select id="ae-card">' + opts(cardOpts, a.card || '') + '</select>') +
    '</div>',
    foot: (id ? '<button class="btn danger" data-act="asg-del" data-id="' + esc(id) + '">' + ICON.trash + ' Delete</button>' : '') + '<button class="btn primary" data-act="asg-save" data-id="' + esc(id || '') + '">Save</button>'
  });
}
function saveAsg(id) {
  const text = $('#ae-text').value.trim();
  if (!text) { toast('Name the job.'); return; }
  const data = { text, shift: $('#ae-shift').value, time: $('#ae-time').value || undefined, by: $('#ae-by').checked || undefined, card: $('#ae-card').value || null, updated: todayKey() };
  Object.keys(data).forEach((k) => data[k] === undefined && delete data[k]);
  edit('book', (b) => {
    if (id) { const a = b.assignments.find((x) => x.id === id); if (a) { delete a.time; delete a.by; Object.assign(a, data); } }
    else b.assignments.push(Object.assign({ id: uid('a') }, data));
  });
  closeSheet(); toast('Job saved.'); app.render();
}

/* ---------- the day (time blocks) ---------- */
let blkRows = null;
function editBlocks() {
  blkRows = clone((B().day || {}).blocks || []);
  const d = B().day || {};
  openSheet({
    eyebrow: 'The day', title: 'Time blocks', wide: true,
    body: '<div class="form" style="margin-bottom:12px">' +
      field('be-pm', 'PM shift starts', '<input id="be-pm" type="time" value="' + esc(d.pmStart || '13:00') + '">', 'Splits AM and PM', 'half') +
      field('be-end', 'Day ends', '<input id="be-end" type="time" value="' + esc(d.end || '21:00') + '">', '', 'half') +
    '</div><div id="blk-rows">' + blkRowsHTML() + '</div><button class="btn small" data-act="blk-add">' + ICON.plus + ' Add block</button>',
    foot: '<button class="btn primary" data-act="blk-save">Save</button>'
  });
}
function blkRowsHTML() {
  return blkRows.map((b, i) => '<div class="blk-row"><div class="blk-top">' +
    '<input id="bn' + i + '" aria-label="Name" placeholder="Name" value="' + esc(b.name) + '">' +
    '<input id="bs' + i + '" type="time" aria-label="Starts" value="' + esc(b.start) + '">' +
    '<button class="icon-b" data-act="blk-del" data-i="' + i + '" aria-label="Remove">' + ICON.close + '</button></div>' +
    '<textarea id="bf' + i + '" rows="2" aria-label="What matters now" placeholder="What matters during this block">' + esc(b.focus || '') + '</textarea></div>').join('');
}
function syncBlk() { blkRows.forEach((b, i) => { const n = $('#bn' + i); if (n) { b.name = n.value; b.start = $('#bs' + i).value; b.focus = $('#bf' + i).value; } }); }
function saveBlocks() {
  syncBlk();
  const rows = blkRows.filter((b) => String(b.name || '').trim() && toMin(b.start) != null).map((b) => ({ id: b.id || uniq(slug(b.name), blkRows), name: b.name.trim(), start: b.start, focus: String(b.focus || '').trim() }));
  edit('book', (bk) => { bk.day = Object.assign({}, bk.day, { pmStart: $('#be-pm').value || '13:00', end: $('#be-end').value || '21:00', blocks: rows, updated: todayKey() }); });
  closeSheet(); toast('The day is saved.'); app.render();
}

/* ---------- training skills ---------- */
let skRows = null;
function editSkills() {
  skRows = clone(B().training || []);
  openSheet({ eyebrow: 'Training', title: 'Skills to sign off', wide: true, body: '<div id="sk-rows">' + skRowsHTML() + '</div><button class="btn small" data-act="sk-add">' + ICON.plus + ' Add skill</button>', foot: '<button class="btn primary" data-act="sk-save">Save</button>' });
}
function skRowsHTML() {
  const cardOpts = [['', 'No card']].concat(B().cards.map((c) => [c.id, c.title]));
  return skRows.map((s, i) => '<div class="sk-row"><input id="sk' + i + '" aria-label="Skill" value="' + esc(s.text) + '"><button class="icon-b" data-act="sk-del" data-i="' + i + '" aria-label="Remove">' + ICON.close + '</button><select id="skc' + i + '" aria-label="Card">' + opts(cardOpts, s.card || '') + '</select></div>').join('');
}
function syncSk() { skRows.forEach((s, i) => { const t = $('#sk' + i); if (t) { s.text = t.value; s.card = $('#skc' + i).value || null; } }); }

export const acts = {
  'open-card': (el) => openCard(el.dataset.id),
  'card-copy': async (el) => { const c = card(el.dataset.id); if (c && await copyText(cardText(c))) toast('Card copied.'); },
  'print-card': (el) => printWhat({ kind: 'card', id: el.dataset.id }),
  'card-edit': (el) => editCard(el.dataset.id),
  'card-new': (el) => editCard(null, el.dataset.cat),
  'card-save': (el) => saveCard(el.dataset.id),
  'card-del': (el) => {
    if (!armed(el, 'Tap again to delete')) return;
    const id = el.dataset.id;
    if ((S.priv.cards || []).some((c) => c.id === id)) { S.priv.cards = S.priv.cards.filter((c) => c.id !== id); save('priv'); }
    else edit('book', (b) => { b.cards = b.cards.filter((c) => c.id !== id); b.tasks.forEach((t) => { if (t.card === id) t.card = null; }); b.assignments.forEach((a) => { if (a.card === id) a.card = null; }); });
    closeSheet(); toast('Card deleted.'); app.render();
  },
  'task-edit': (el) => editTask(el.dataset.id),
  'task-add': (el) => editTask(null, el.dataset.list, el.dataset.block),
  'task-save': (el) => saveTask(el.dataset.id, el.dataset.list),
  'task-move': (el) => moveTask(el.dataset.id, +el.dataset.dir),
  'task-del': (el) => { if (!armed(el, 'Delete?')) return; edit('book', (b) => { b.tasks = b.tasks.filter((t) => t.id !== el.dataset.id); }); closeSheet(); toast('Item deleted.'); app.render(); },
  'list-edit': (el) => editList(el.dataset.id),
  'list-new': () => editList(null),
  'list-save': (el) => saveList(el.dataset.id),
  'list-del': (el) => { if (!armed(el, 'Delete list and its items?')) return; const id = el.dataset.id; edit('book', (b) => { b.lists = b.lists.filter((l) => l.id !== id); b.tasks = b.tasks.filter((t) => t.list !== id); }); toast('Checklist deleted.'); closeSheet().then(() => app.go('#book/lists')); },
  'asg-edit': (el) => editAsg(el.dataset.id),
  'asg-new': (el) => editAsg(null, el.dataset.shift),
  'asg-save': (el) => saveAsg(el.dataset.id),
  'asg-del': (el) => { if (!armed(el, 'Tap again to delete')) return; edit('book', (b) => { b.assignments = b.assignments.filter((a) => a.id !== el.dataset.id); }); closeSheet(); toast('Job deleted.'); app.render(); },
  'blocks-edit': () => editBlocks(),
  'blk-add': () => { syncBlk(); blkRows.push({ id: '', name: '', start: '', focus: '' }); $('#blk-rows').innerHTML = blkRowsHTML(); },
  'blk-del': (el) => { syncBlk(); blkRows.splice(+el.dataset.i, 1); $('#blk-rows').innerHTML = blkRowsHTML(); },
  'blk-save': () => saveBlocks(),
  'skills-edit': () => editSkills(),
  'sk-add': () => { syncSk(); skRows.push({ id: uid('k'), text: '', card: null }); $('#sk-rows').innerHTML = skRowsHTML(); },
  'sk-del': (el) => { syncSk(); skRows.splice(+el.dataset.i, 1); $('#sk-rows').innerHTML = skRowsHTML(); },
  'sk-save': () => { syncSk(); const rows = skRows.filter((s) => String(s.text || '').trim()).map((s) => ({ id: s.id || uid('k'), text: s.text.trim(), card: s.card || null })); edit('book', (b) => { b.training = rows; }); closeSheet(); toast('Skills saved.'); app.render(); }
};
export { roleName };
