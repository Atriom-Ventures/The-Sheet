// Every screen and sheet, with markup in every value that comes from a shared file.
// The other tests check one screen each against a file someone edited by hand. This one soaks all six
// synced files at once and draws everything the app can show, so a new screen that forgets esc() is
// caught without anyone remembering to write a test for it. Two passes, each in its own process:
//   text: every word in the files carries markup (ids, units and dates left alone, so screens draw fully)
//   all:  ids, numbers, units and dates carry it too (screens draw less, but nothing may come out raw)
// Made-up data only.
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makePhone, outDir, checker } from './lib/phone.mjs';
import { fullPhone } from './lib/fixtures.mjs';

const MODE = process.argv[2];
const MARK = '<u>MARK</u>';

if (!MODE) {
  const T = checker();
  const me = fileURLToPath(import.meta.url);
  for (const [mode, what, least] of [['text', 'every word', 400], ['all', 'every id, number, unit and date too', 150]]) {
    const r = spawnSync(process.execPath, [me, mode], { encoding: 'utf8' });
    let out = null; try { out = JSON.parse(r.stdout.slice(r.stdout.indexOf('{"mode"'))); } catch (e) { /* reported below */ }
    console.log('\nMarkup in ' + what);
    T.check(!!out, 'the pass ran' + (out ? '' : ': ' + (r.stderr || r.stdout).slice(0, 400)));
    if (!out) continue;
    T.check(out.screens > 60 && out.seen >= least, 'drew ' + out.screens + ' screens, sheets and printouts; the markup showed up as plain text ' + out.seen + ' times');
    T.check(out.raw.length === 0, 'none of it reached the page as markup' + (out.raw.length ? ': ' + out.raw.slice(0, 5).map((x) => x.where + ' …' + x.near).join(' | ') : ''));
    T.check(out.broke.length === 0, 'no screen fell over' + (out.broke.length ? ': ' + out.broke.slice(0, 5).join(', ') : ''));
    if (mode === 'text') {
      T.check(out.links.web === 1 && out.links.script === 0 && out.links.shown, 'a book link opens only when it’s a web address; anything else shows as plain words');
      T.check(!/[\n\r"\\]/.test(out.stamp.inside) && /^@page\{@bottom-left\{content:"[^"]*";font:8pt monospace;color:#444\}\}$/.test(out.stamp.css), 'a name with quotes or a line break can’t break out of the printed footer’s style rule');
    }
  }
  T.done();
} else {
  const all = MODE === 'all';
  // Left alone in the "text" pass: values the app looks up or switches on, so the screens draw in full.
  const SKIP = new Set(['id', 'cat', 'list', 'block', 'role', 'kind', 'state', 'unit', 'inner', 'shape', 's', 'a', 'tag', 'status', 'ref', 'live', 'type', 'shift', 'veg', 'gf', 'df', 'cross', 'carries', 'meals', 'blocks', 'roles', 'key', 'file', 'path', 'kept', 'src', 'sha', 'theme', 'outlet', 'skill', 'card', 'cards', 'area', 'for', 'when', 'group', 'url']);
  const dateish = (v) => /^\d{4}-\d\d-\d\d/.test(v) || /^\d\d?:\d\d$/.test(v);
  const soak = (v, key) => {
    if (Array.isArray(v)) return (!all && SKIP.has(key)) ? v : v.map((x) => soak(x, key));
    if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = soak(v[k], k); return o; }
    if (typeof v === 'string') return (!all && (SKIP.has(key) || dateish(v))) ? v : v + MARK;
    if (typeof v === 'number' && all) return v + MARK;
    return v;
  };
  const mem = fullPhone();
  for (const k of ['book', 'state', 'inv', 'counts', 'plans', 'menu']) { mem[k].local = soak(mem[k].local, ''); mem[k].base = JSON.parse(JSON.stringify(mem[k].local)); }
  if (!all) mem.book.local.links = [{ label: 'Supplier site' + MARK, url: 'https://example.com/order' }, { label: 'Not a link' + MARK, url: 'javascript:alert(1)' }, { label: 'Nor this' + MARK, url: ' data:text/html,<b>x</b>' }];
  const at = new Date().toISOString();
  mem.conflicts = [
    { id: 'cf1', key: 'inv', file: 'inventory.json', at, review: true, who: 'BB' + MARK, path: '.lines[ln-lids' + (all ? MARK : '') + '].par', kept: 'phone', ours: '3' + MARK, theirs: '5' + MARK },
    { id: 'cf2', key: 'inv', file: 'inventory.json', at, review: true, who: 'BB' + MARK, path: '.lines[ln-cups].par', kept: 'phone', ours: 1, theirs: 2, note: 'note' + MARK },
    { id: 'cf3', key: 'menu', file: 'card3.json', at, review: false, who: 'BB' + MARK, path: '.rows[m-tacos' + MARK + '].allergens', kept: 'both', note: 'n' + MARK, ours: [], theirs: [] },
    { id: 'cf4', key: 'menu', file: 'card3.json', at, review: false, who: '', path: '.rows[m-pasta' + (all ? MARK : '') + '].gf', kept: 'neither', note: 'n' + MARK, ours: MARK, theirs: MARK },
    { id: 'cf5', key: 'book', file: 'book.json' + MARK, at, review: false, who: MARK, path: '.cards[x' + MARK + '].title', kept: 'phone', ours: MARK, theirs: MARK, note: MARK }
  ];
  // Typed on this phone, never synced, but drawn the same way.
  mem.shift.notes[0].text += MARK; mem.shift.f = { lead: 'A' + MARK, on: 'B' + MARK, reach: '4' + MARK }; mem.shift.draft = 'd' + MARK;
  mem.floor.people.forEach((p) => { p.name += MARK; p.station += MARK; });
  mem.trainees.forEach((p) => { p.name += MARK; });
  Object.assign(mem.settings, { name: mem.settings.name + MARK, initials: mem.settings.initials + MARK, owner: mem.settings.owner + MARK, repo: mem.settings.repo + MARK, lastSyncError: 'e' + MARK });

  const dir = makePhone('Soak', outDir());
  const els = {}, handlers = {};
  const mk = (id) => (els[id] = els[id] || { id, innerHTML: '', textContent: '', value: '', dataset: {}, style: { setProperty() {} }, classList: { toggle() {}, add() {}, remove() {}, contains: () => false }, setAttribute() {}, removeAttribute() {}, focus() {}, remove() {}, appendChild() {}, querySelector: () => null, querySelectorAll: () => [], closest: () => null, addEventListener() {} });
  globalThis.window = globalThis;
  globalThis.document = { querySelector: (s) => (s.startsWith('#') && !s.includes(' ') ? mk(s.slice(1)) : null), querySelectorAll: () => [], getElementById: (id) => mk(id), createElement: () => mk('x' + Math.random()), body: mk('body'), head: mk('head'), documentElement: mk('html'), activeElement: null, contains: () => false, visibilityState: 'visible', addEventListener: (t, f) => { (handlers['doc:' + t] = handlers['doc:' + t] || []).push(f); } };
  globalThis.addEventListener = (t, f) => { (handlers['win:' + t] = handlers['win:' + t] || []).push(f); };
  globalThis.scrollTo = () => {}; globalThis.print = () => {}; globalThis.requestAnimationFrame = (f) => setTimeout(f, 0);
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  let hash = '';
  globalThis.location = { get hash() { return hash; }, set hash(h) { hash = h.startsWith('#') ? h : '#' + h; (handlers['win:hashchange'] || []).forEach((f) => f()); }, replace(h) { hash = h; }, reload() {} };
  globalThis.history = { state: null, replaceState: (a, b, h) => { hash = h; }, pushState() {}, back() {} };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: 'test', platform: 'Linux', maxTouchPoints: 0, onLine: false, storage: null } });
  globalThis.fetch = async () => { throw new TypeError('offline'); };
  globalThis.__mem_Soak = mem;
  console.error = () => {};
  await import(path.join(dir, 'js/main.js'));
  await new Promise((r) => setTimeout(r, 200));
  const { app } = await import(path.join(dir, 'js/app.js'));
  const { S, B } = await import(path.join(dir, 'js/state.js'));

  const raw = [], broke = []; let seen = 0, screens = 0;
  const scan = (where, html) => {
    html = String(html || ''); screens++;
    seen += html.split('&lt;u&gt;MARK').length - 1;
    const i = html.indexOf(MARK);
    if (i >= 0) raw.push({ where, near: html.slice(Math.max(0, i - 90), i + 20) });
    if (/Something went wrong/.test(html)) broke.push(where);
  };
  const view = (where) => scan(where, mk('view').innerHTML + mk('top-in').innerHTML + mk('nav-in').innerHTML + mk('banner-root').innerHTML);
  const fake = (data) => ({ dataset: data, disabled: false, innerHTML: '', textContent: '', value: '', classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {}, removeAttribute() {}, getAttribute: () => null, focus() {} });
  const sheet = (a, data = {}) => { mk('sheet-root').innerHTML = ''; try { app.acts[a](fake(data)); } catch (e) { /* an id the soak broke: nothing to draw */ } scan('sheet ' + a, mk('sheet-root').innerHTML); };
  const go = async (h) => { location.hash = h; await new Promise((r) => setTimeout(r, 5)); };
  const P = S.plans.local, v0 = P.versions[0], M = S.menu.local, inv = S.inv.local;

  const routes = ['#now', '#book', '#book/cards', '#book/sheet', '#book/day', '#count', '#count/order', '#count/history', '#count/items', '#lead', '#lead/floor', '#lead/msgs', '#lead/train', '#lead/wins', '#lead/printed', '#more', '#quick', '#book/maps', '#book/map/' + v0.id + '/' + v0.rooms[0].id, '#book/allergens', '#book/allergens/preview'];
  (B().lists || []).forEach((l) => routes.push('#book/list/' + l.id));
  for (const h of routes) { await go(h); view(h); }
  for (const h of routes.filter((x) => x.startsWith('#book'))) { await go(h); app.ui.editing = true; app.renderView(); view(h + ' (editing)'); }
  await go('#book/map/' + v0.id + '/' + v0.rooms[0].id); app.ui.editing = true;
  try { app.acts['map-sel'](fake({ id: v0.rooms[0].items[0].id })); } catch (e) { /* soaked id */ } view('floor plan, a table picked');
  sheet('map-room-edit'); sheet('map-ver-edit', { id: v0.id });
  await go('#book/allergens'); app.ui.editing = true; app.renderView();
  M.rows.forEach((r) => sheet('c3-row', { id: r.id }));
  M.kitchen.forEach((k) => sheet('c3-kit', { id: k.id }));
  ['fish', 'dairy', 'gluten', 'nuts'].forEach((a) => sheet('c3-note', { id: a }));
  sheet('c3-stamp');
  app.ui.editing = false; app.renderView();
  M.rows.slice(0, 6).forEach((r) => sheet('c3-row', { id: r.id }));
  const pages = await import(path.join(dir, 'js/card3pages.js')), c3 = await import(path.join(dir, 'js/card3.js'));
  scan('card pages', pages.allPages(M));
  c3.setStamp(M, 'Chef' + MARK, '2026-01-10', 'AA' + MARK); app.renderView(); view('card, kitchen checked'); scan('card pages, checked', pages.allPages(M)); sheet('c3-stamp');
  M.rows[0].name += 'x'; M.checkedBefore = { name: 'Chef' + MARK, date: '2026-01-10' + MARK }; app.renderView(); view('card, changed since the check');
  await go('#count/items');
  inv.lines.forEach((l) => { try { app.acts['item-open'](fake({ id: l.id })); } catch (e) { /* soaked id */ } app.renderView(); view('items, a line open'); });
  await go('#count');
  inv.lines.forEach((l) => sheet('inv-how', { line: l.id })); inv.cats.forEach((c) => sheet('cat-rename', { id: c.id }));
  (B().cards || []).forEach((c) => { sheet('open-card', { id: c.id }); sheet('card-edit', { id: c.id }); });
  (S.state.local.follow || []).forEach((f) => { sheet('ask-edit', { id: f.id }); sheet('ask-answer', { id: f.id }); });
  (S.floor.people || []).forEach((p) => sheet('fp-edit', { id: p.id }));
  (S.trainees || []).forEach((t) => sheet('tr-open', { id: t.id }));
  (B().assignments || []).forEach((a) => sheet('asg-edit', { id: a.id }));
  (B().lists || []).forEach((l) => sheet('list-edit', { id: l.id }));
  (B().tasks || []).forEach((t) => sheet('task-edit', { id: t.id }));
  for (const a of ['card-new', 'asg-new', 'list-new', 'blocks-edit', 'skills-edit', 'fp-edit', 'print-menu']) sheet(a);
  await go('#lead/msgs');
  Array.from(mk('view').innerHTML.matchAll(/data-act="open-tmpl" data-id="([^"]+)"/g)).forEach((m) => sheet('open-tmpl', { id: m[1].replace(/&lt;u&gt;MARK&lt;\/u&gt;/g, MARK) }));
  S.shift.held = [{ key: '2026-01-14|PM' + MARK, notes: [{ id: 'nh1', t: '18:05', tag: 'equip' + MARK, text: 'Ice' + MARK }], f: {}, sentAt: null }];
  sheet('notes', { seg: 'earlier' }); sheet('notes', { seg: 'report' }); sheet('notes');
  await go('#lead'); await go('#now'); view('now, with earlier notes waiting');
  // Printouts: what goes into the print area for each kind.
  for (const kind of ['book', 'count', 'maps', 'card3', 'cards', 'sheet']) {
    for (const id of [v0.id, (B().cards[0] || {}).id]) {
      mk('print-root').innerHTML = '';
      try { app.acts['print'](fake({ kind, id })); scan('print sheet ' + kind, mk('sheet-root').innerHTML); app.acts['print-go'](fake({ kind, id })); } catch (e) { /* nothing of that kind to print */ }
      scan('printout ' + kind, mk('print-root').innerHTML);
    }
  }
  let links = {}, stamp = {};
  if (!all) {
    await go('#more'); const mh = mk('view').innerHTML;
    links = { web: mh.split('href="https://example.com/order"').length - 1, script: (mh.match(/href="\s*(javascript|data):/gi) || []).length, shown: /Not a link/.test(mh) && /Nor this/.test(mh) };
    const pr = await import(path.join(dir, 'js/print.js'));
    const css = pr.stampCSS('Book "one"\\ · Plans: Main\n}}body{display:none} · Rev 1');
    stamp = { css, inside: css.slice(css.indexOf('content:"') + 9, css.lastIndexOf('";font')) };
  }
  process.stdout.write(JSON.stringify({ mode: MODE, screens, seen, raw, broke, links, stamp }));
  process.exit(0);
}
