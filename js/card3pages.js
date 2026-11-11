// The allergen card's four Letter pages, built from the rows (see card3.js). The same markup is used
// for the preview on the phone and for printing. Layout only: every word that's about a menu comes from
// the file, and every value from the file goes through esc().

import { esc } from './util.js';
import { ALLERGENS, PAGES, cardOf, guideOf, kitchenOf, backPage, frontLines, menuPage, stampOf, isChecked } from './card3.js';

const day = (k) => { const m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(k || ''); return m ? (+m[2]) + '/' + (+m[3]) + '/' + m[1].slice(2) : ''; };
const chip = (c) => '<span class="c3-chip' + (c.dashed ? ' c3-q' : '') + '">' + esc(c.code) + (c.dashed ? '?' : '') + '</span>';
const xchip = (c) => '<span class="c3-chip x">' + esc(c.chip) + '</span>';
const chips = (o) => o.al.map(chip).join('') + o.cross.map(xchip).join('');
const mealCols = (on, all) => '<span class="c3-meals">' + all.map((m) => '<span>' + (on.includes(m) ? m : '') + '</span>').join('') + '</span>';

function draftTag(doc) {
  return isChecked(doc) ? '<span class="c3-ok">Kitchen checked</span>' : '<span class="c3-draft">Draft · kitchen to check</span>';
}
function signLine(doc) {
  const s = stampOf(doc);
  if (isChecked(doc)) return '<div class="c3-sign">Kitchen checked: ' + esc(s.name) + ' · ' + esc(day(s.date)) + '</div>';
  return '<div class="c3-sign"><span>Kitchen checked <i class="c3-rule w84"></i></span><span>Date <i class="c3-rule w52"></i></span></div>';
}
function head(doc, eyebrow, title, right, big) {
  return '<header class="c3-head"><div class="c3-head-l"><div class="c3-eb">' + esc(eyebrow) + '</div><h2 class="c3-h1' + (big ? ' xl' : '') + '">' + esc(title) + '</h2></div>' +
    '<div class="c3-head-r">' + draftTag(doc) + right + '</div></header>';
}

/* ---------- front: what's in it ---------- */
function front(doc) {
  const c = cardOf(doc), g = guideOf(doc), lines = frontLines(doc), kitchen = kitchenOf(doc).filter((k) => k.chip);
  const sub = c.sub ? '<p class="c3-head-sub">' + esc(c.sub) + '</p>' : '';
  let h = head(doc, c.eyebrow, c.title, sub, true);
  h += '<div class="c3-two"><section class="c3-box strong"><h3 class="c3-h2 acc">' + esc(g.rule.title) + '</h3>' + (g.rule.sub ? '<p class="c3-p soft">' + esc(g.rule.sub) + '</p>' : '') +
    '<div class="c3-steps">' + g.rule.steps.map((s, i) => '<div class="c3-step"><span class="c3-num">' + (i + 1) + '</span><p><b>' + esc(s.b) + '</b> ' + esc(s.t) + '</p></div>').join('') + '</div></section>' +
    '<section class="c3-box"><h3 class="c3-h2">' + esc(g.react.title) + '</h3><p class="c3-p13"><b>' + esc(g.react.lead) + '</b> ' + esc(g.react.text) + '</p>' + (g.react.note ? '<p class="c3-p grey">' + esc(g.react.note) + '</p>' : '') + '</section></div>';
  h += '<div class="c3-nine">' + ALLERGENS.map((a) => {
    const v = g.allergens[a.id];
    return '<div class="c3-al"><div class="c3-al-h">' + chip(a) + '<h4 class="c3-h3">' + esc(a.name) + '</h4></div>' +
      (v.what ? '<p class="c3-p">' + esc(v.what) + '</p>' : '') + (v.hides ? '<p class="c3-s"><b>Hides in</b> ' + esc(v.hides) + '</p>' : '') +
      (lines[a.id] ? '<p class="c3-s soft"><b class="acc">On our menu</b> ' + esc(lines[a.id]) + '</p>' : '') + '</div>';
  }).join('') + '</div>';
  const leg = (mark, text) => '<div class="c3-leg"><span class="c3-leg-m">' + mark + '</span><span>' + text + '</span></div>';
  h += '<section class="c3-legend"><h3 class="c3-h2 acc sm">Reading the menu pages</h3><div class="c3-leg-grid">' +
    leg(chip({ code: 'DAI' }), 'In it as served.') + leg(chip({ code: 'EGG', dashed: true }), 'Unconfirmed: treat as in it.') + leg('<span class="c3-grey">label</span>', 'Packaged: ask the kitchen.') +
    kitchen.map((k) => leg(xchip(k), esc(k.legend))).join('') +
    leg('<span class="c3-mark yes">' + TICK + '</span>', 'Menu marks it veg, GF or DF.') + leg('<span class="c3-mark">OPT</span>', 'Can be made that way.') + leg('<span class="c3-mark"></span>', 'Kitchen to fill in.') +
    (g.withNote ? '<div class="c3-leg-t"><b>Goes out with:</b> ' + esc(g.withNote) + '</div>' : '') + '</div></section>';
  h += '<footer class="c3-foot row"><span>' + esc(c.footer) + '</span>' + signLine(doc) + '</footer>';
  return h;
}
const TICK = '<svg width="12" height="12" viewBox="0 0 12 12" role="img" aria-label="Yes"><polyline points="2.5,6.5 5,9 9.5,3" fill="none" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></polyline></svg>';

/* ---------- back: can't leave it out ---------- */
const COLS = [['dairy', 'egg'], ['fish', 'gluten', 'peanuts'], ['sesame', 'shellfish', 'soy', 'nuts']];
function note(text) {
  const m = /^([^:.]{1,14}:)\s*(.*)$/.exec(text);
  return m ? '<b class="ink">' + esc(m[1]) + '</b> ' + esc(m[2]) : esc(text);
}
function back(doc) {
  const c = cardOf(doc), b = backPage(doc);
  let h = head(doc, c.eyebrow + (c.eyebrow ? ' · ' : '') + 'Back', c.backTitle, c.backSub ? '<div class="c3-head-mono">' + esc(c.backSub) + '</div>' : '');
  h += '<section class="c3-rulebox"><div><div class="c3-h4 acc">Listed</div><p>The allergen is the dish, or holds it together.</p></div>' +
    '<div><div class="c3-h4">Not listed</div><p>The kitchen can make it without: toppings, sauces, GF or DF options. Never pick it off.</p></div>' +
    '<div><div class="c3-h4 amb">Ask</div><p>Might be in it. Check with the kitchen through expo or the PIC.</p></div></section>';
  if (b.kitchen.length) h += '<section class="c3-rulebox kit n' + Math.min(4, b.kitchen.length) + '">' + b.kitchen.map((k) => '<div><div class="c3-h4 amb">' + esc(k.title) + '</div><p>' + esc(k.text) + '</p></div>').join('') + '</section>';
  const box = (a) => '<div class="c3-ab"><div class="c3-ab-h">' + chip(a) + '<h3 class="c3-h3">' + esc(a.name) + '</h3></div>' +
    (a.listed.length ? '<div class="c3-list">' + a.listed.map((l) => '<div class="c3-li"><div class="c3-li-t"><div class="c3-li-n">' + esc(l.label) + '</div>' + (l.sub ? '<div class="c3-li-s">' + esc(l.sub) + '</div>' : '') + '</div>' + mealCols(l.meals, ['B', 'L', 'D']) + '</div>').join('') + '</div>' : '') +
    (a.note ? '<p class="' + (a.listed.length ? 'c3-s soft' : 'c3-p13') + '">' + (a.listed.length ? note(a.note) : esc(a.note)) + '</p>' : (a.listed.length ? '' : '<p class="c3-p13">None listed on the menus.</p>')) +
    (a.off.length ? '<p class="c3-s soft"><b class="acc">Leave off:</b> ' + esc(a.off.join(', ')) + (a.offNote ? ' ' + esc(a.offNote) : '') + '</p>' : '') +
    (a.ask.length ? '<p class="c3-s soft"><b class="amb">Ask:</b> ' + esc(a.ask.join(', ')) + '</p>' : '') + '</div>';
  const by = new Map(b.allergens.map((a) => [a.id, a]));
  h += '<div class="c3-cols">' + COLS.map((col) => '<div class="c3-col">' + col.map((id) => box(by.get(id))).join('') + '</div>').join('') + '</div>';
  if (b.daily.length || c.packaged) h += '<div class="c3-greybox">' + (b.daily.length ? '<p><b>Changes daily:</b> ' + esc(b.daily.join(', ')) + '. Ask expo.</p>' : '') + (c.packaged ? '<p><b>Packaged:</b> ' + esc(c.packaged) + '</p>' : '') + '</div>';
  h += '<footer class="c3-foot row"><span><b class="mono">B</b> breakfast · <b class="mono">L</b> lunch · <b class="mono">D</b> dinner</span>' + signLine(doc) + '</footer>';
  return h;
}

/* ---------- expo pages: the menus, A to Z ---------- */
const mark = (v, label) => '<div class="c3-mk"><span class="c3-mark' + (v === 'yes' ? ' yes' : '') + '"' + (v ? ' aria-label="' + label + (v === 'yes' ? ': yes' : v === 'opt' ? ': option' : ': ' + v + ' only') + '"' : '') + '>' + (v === 'yes' ? TICK : v === 'opt' ? 'OPT' : esc(v)) + '</span></div>';
const piece = (p) => '<span class="c3-piece"><span>' + esc(p.name || 'Missing row') + (p.mark ? ' <b class="mono">' + esc(p.mark) + '</b>' : '') + '</span>' + chips(p) + '</span>';
function alCell(r) {
  const inner = chips(r) + r.parts.map(piece).join('') + (r.packaged ? '<span class="c3-grey">label</span>' : '') + (r.tail ? '<span class="c3-grey">' + esc(r.tail) + '</span>' : '');
  return '<div class="c3-chips">' + (inner || '<span class="c3-grey">none listed</span>') + '</div>';
}
function menu(doc, which) {
  const c = cardOf(doc), p = menuPage(doc, which), two = p.meals.length > 1, kitchen = kitchenOf(doc);
  const title = which === 'B' ? 'Breakfast' : 'Lunch & dinner';
  let h = head(doc, c.expoEyebrow || c.eyebrow, title, '<div class="c3-head-mono">' + esc(c.hours[which]) + '</div>');
  h += '<div class="c3-table ' + (two ? 'ld' : 'b') + '"><div class="c3-tr c3-th"><div>Item</div><div>Allergens</div><div>Goes out with</div><div class="ctr">Veg</div><div class="ctr">GF</div><div class="ctr">DF</div></div>' +
    p.rows.map((r) => '<div class="c3-tr"><div class="c3-item"><div class="c3-item-h"><div class="c3-name">' + esc(r.name) + '</div>' + (two ? mealCols(r.meals, p.meals) : '') + '</div>' +
      (!two && r.desc ? '<div class="c3-desc">' + esc(r.desc) + '</div>' : '') + (r.check ? '<div class="c3-check"><b>Check:</b> ' + esc(r.check) + '</div>' : '') + '</div>' +
      alCell(r) + '<div class="c3-with">' + (r.with.length ? '<div class="c3-pieces">' + r.with.map(piece).join('') + '</div>' : '<div class="c3-dots"></div>') + '</div>' +
      mark(r.veg, 'Vegetarian') + mark(r.gf, 'Gluten-free') + mark(r.df, 'Dairy-free') + '</div>').join('') + '</div>';
  if (p.sides.length) {
    const half = Math.ceil(p.sides.length / 2);
    const col = (list) => '<div class="c3-sidecol">' + list.map((r) => '<div class="c3-side"><div class="c3-sname">' + esc(r.name) + '</div>' + mealCols(r.meals, p.meals) + alCell(r) + '</div>').join('') + '</div>';
    h += '<section class="c3-sides"><h3 class="c3-h2 acc sm">Sides</h3><div class="c3-side2">' + col(p.sides.slice(0, half)) + col(p.sides.slice(half)) + '</div></section>';
  }
  const legend = ['Dashed ? = treat as in it'].concat(kitchen.filter((k) => k.foot).map((k) => (k.chip ? '<b class="mono">' + esc(k.chip) + '</b> ' : '') + esc(k.foot))).concat(two ? ['L or D in a box: that menu only'] : []);
  h += '<footer class="c3-foot"><div>' + ALLERGENS.map((a) => '<b class="mono">' + a.code + '</b> ' + esc(a.name.toLowerCase())).join(' · ') + '</div><div class="c3-foot-row"><span>' + legend.join(' · ') + '</span>' + signLine(doc) + '</div></footer>';
  return h;
}

export function pageHTML(doc, id) {
  const inner = id === 'front' ? front(doc) : id === 'back' ? back(doc) : menu(doc, id);
  return '<section class="c3-page" data-page="' + esc(id) + '">' + inner + '</section>';
}
export const allPages = (doc) => PAGES.map((p) => pageHTML(doc, p.id)).join('');

/* The pages are measured and printed with the fonts that ship with the app. A font the screen hasn't
   needed yet isn't loaded yet, and measuring before it is gives the wrong answer, so ask for each one. */
const FACES = ['400 14px "Atkinson Hyperlegible"', '700 14px "Atkinson Hyperlegible"', '600 12px "IBM Plex Mono"', '800 44px "Sofia Sans Extra Condensed"'];
export function loadFonts() {
  if (typeof document === 'undefined' || !document.fonts || !document.fonts.load) return Promise.resolve();
  return Promise.all(FACES.map((f) => document.fonts.load(f).catch(() => null)));
}

/* How far past the bottom of the sheet each page runs, in page pixels (0 = it fits). Needs a real
   browser, with the pages laid out at full size inside `root`. */
export function measure(root) {
  const out = {};
  Array.from(root.querySelectorAll('.c3-page')).forEach((pg) => {
    const r = pg.getBoundingClientRect(), scale = r.width / 816 || 1;
    const last = pg.lastElementChild, inner = r.bottom - 40 * scale;
    let bottom = last ? last.getBoundingClientRect().bottom : r.top;
    // The footer is pushed to the bottom; if the content above it is too tall, it gets pushed past it.
    out[pg.dataset.page] = Math.max(0, Math.round((bottom - inner) / scale));
  });
  return out;
}
