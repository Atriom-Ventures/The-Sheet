// The allergen card, as data. One set of menu rows; every page of the card is worked out from them,
// so a menu change is one edit and no page can drift from another.
//
// The file (card3.json, in the Training repo) holds:
//   card     the card's own words: titles, hours, footers
//   guide    the front page's words: the routine, what each allergen is and where it hides
//   kitchen  shared equipment (a fryer, a flat-top): what it carries, and how the card says so
//   notes    per allergen: a line for the back page, extra questions, a fallback for the front
//   rows     the menu: dishes, sides, and the sauces, toppings and parts that go with them
//   stamp    who in the kitchen checked it and when, tied to exactly what they checked
//
// A row's allergens are a list of entries { a, s, from, list, sub }:
//   s 'in'    in it, and it can't be left out      -> listed on the back page
//   s 'opt'   in it as served, can be made without -> "Leave off" on the back page
//   s 'ask'   not confirmed: treat as in it        -> dashed chip, "Ask" on the back page
//   s 'label' not confirmed, it's on a package     -> the same, marked (label)
//
// Nothing here touches the page. Everything read from the file is treated as untrusted: it can be
// edited by hand, so shapes are checked here and the page builders escape every value.

export const ALLERGENS = [
  { id: 'dairy', code: 'DAI', name: 'Dairy' }, { id: 'egg', code: 'EGG', name: 'Egg' }, { id: 'fish', code: 'FSH', name: 'Fish' },
  { id: 'gluten', code: 'GLU', name: 'Gluten' }, { id: 'peanuts', code: 'PNT', name: 'Peanuts' }, { id: 'sesame', code: 'SES', name: 'Sesame' },
  { id: 'shellfish', code: 'SHL', name: 'Shellfish' }, { id: 'soy', code: 'SOY', name: 'Soy' }, { id: 'nuts', code: 'NUT', name: 'Tree nuts' }
];
const A_IDS = new Set(ALLERGENS.map((a) => a.id));
export const STATUS = { in: 'In it. Can’t be left out', opt: 'In it as served. Can be made without', ask: 'Ask. Not confirmed', label: 'Ask. Check the label' };
export const MEALS = ['B', 'L', 'D'];
export const MEAL_NAME = { B: 'Breakfast', L: 'Lunch', D: 'Dinner' };
export const KINDS = { dish: 'Dish', side: 'Side', extra: 'Sauce, topping or part' };
export const MARKS = { '': 'Blank (kitchen to fill in)', yes: 'Yes, as served', opt: 'Can be made that way', L: 'Lunch menu only', D: 'Dinner menu only' };
export const FILE_TYPE = 'the-sheet-card3';

/* How this file merges when two phones changed the same thing between syncs (see merge.js), and when a
   row is saved over a copy that changed while its sheet was open.
   join:  lists where dropping one side's entry could drop an allergen from the card. Every entry from
          both sides is kept, even one the other side took off. A person decides, not the merge.
   blank: the Veg, GF and DF marks. Each is a claim a guest may rely on, so when two phones disagree
          neither is kept: the box goes back to blank (kitchen to fill in). */
export const MERGE = {
  join: (path) => /^\.rows\[.*\]\.(allergens|cross|with|parts)$/.test(path) || /^\.kitchen\[.*\]\.carries$/.test(path) || /^\.notes\.[a-z]+\.ask$/.test(path),
  blank: (path) => /^\.rows\[.*\]\.(veg|gf|df)$/.test(path)
};

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (v == null || typeof v === 'object' ? '' : String(v)).trim();
const arr = (v) => (Array.isArray(v) ? v : []);
const meals = (v) => MEALS.filter((m) => arr(v).includes(m));
const lower = (s) => (/^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s).replace(/ ([A-Z])(?=[a-z])/g, (m, c) => ' ' + c.toLowerCase());
const az = (a, b) => a.localeCompare(b, 'en', { sensitivity: 'base', numeric: true });
const uniq = (list) => { const seen = new Set(), out = []; list.forEach((w) => { const k = w.toLowerCase(); if (w && !seen.has(k)) { seen.add(k); out.push(w); } }); return out; };

/* ---------- reading the file ---------- */
function refs(v) {
  return arr(v).map((x) => (isObj(x) ? { ref: str(x.ref), t: str(x.t), meals: meals(x.meals) } : { ref: '', t: str(x), meals: [] })).filter((x) => x.ref || x.t);
}
function normRow(r) {
  const kind = KINDS[r.kind] ? r.kind : 'dish';
  return {
    id: r.id, name: str(r.name), kind, meals: meals(r.meals), desc: str(r.desc), check: str(r.check), short: str(r.short),
    entries: arr(r.allergens).filter((e) => isObj(e) && A_IDS.has(e.a) && STATUS[e.s]).map((e) => ({ a: e.a, s: e.s, from: str(e.from), list: str(e.list), sub: str(e.sub) })),
    bad: arr(r.allergens).filter((e) => !(isObj(e) && A_IDS.has(e.a) && STATUS[e.s])).length,
    cross: uniq(arr(r.cross).map(str)), packaged: r.packaged === true, daily: r.daily === true, tail: str(r.tail),
    with: refs(r.with), parts: refs(r.parts),
    veg: MARKS[r.veg] ? r.veg : '', gf: MARKS[r.gf] ? r.gf : '', df: MARKS[r.df] ? r.df : '',
    updated: str(r.updated), by: str(r.by)
  };
}
export const rowsOf = (doc) => arr(doc && doc.rows).filter((r) => isObj(r) && typeof r.id === 'string' && r.id).map(normRow);
export function kitchenOf(doc) {
  return arr(doc && doc.kitchen).filter((k) => isObj(k) && typeof k.id === 'string' && k.id).map((k) => ({
    id: k.id, title: str(k.title), text: str(k.text), chip: str(k.chip), legend: str(k.legend), foot: str(k.foot),
    carries: uniq(arr(k.carries).filter((a) => A_IDS.has(a))), bad: arr(k.carries).filter((a) => !A_IDS.has(a)).length, listAs: str(k.listAs), sub: str(k.sub), menuWord: str(k.menuWord)
  }));
}
export function notesOf(doc, a) {
  const n = isObj(doc && doc.notes) && isObj(doc.notes[a]) ? doc.notes[a] : {};
  return { back: str(n.back), ask: arr(n.ask).map(str).filter(Boolean), menu: str(n.menu), off: str(n.off) };
}
export function cardOf(doc) {
  const c = isObj(doc && doc.card) ? doc.card : {}, h = isObj(c.hours) ? c.hours : {};
  return { eyebrow: str(c.eyebrow), expoEyebrow: str(c.expoEyebrow), title: str(c.title) || 'What’s in it', backTitle: str(c.backTitle) || 'Can’t leave it out', sub: str(c.sub), backSub: str(c.backSub), footer: str(c.footer), packaged: str(c.packaged), dailyTail: str(c.dailyTail) || 'changes daily, ask expo', hours: { B: str(h.B), LD: str(h.LD) } };
}
export function guideOf(doc) {
  const g = isObj(doc && doc.guide) ? doc.guide : {}, r = isObj(g.rule) ? g.rule : {}, x = isObj(g.react) ? g.react : {}, al = isObj(g.allergens) ? g.allergens : {};
  const out = { rule: { title: str(r.title), sub: str(r.sub), steps: arr(r.steps).filter(isObj).map((s) => ({ b: str(s.b), t: str(s.t) })) }, react: { title: str(x.title), lead: str(x.lead), text: str(x.text), note: str(x.note) }, allergens: {}, withNote: str(g.withNote) };
  ALLERGENS.forEach((a) => { const v = isObj(al[a.id]) ? al[a.id] : {}; out.allergens[a.id] = { what: str(v.what), hides: str(v.hides) }; });
  return out;
}
export const isCard = (j) => isObj(j) && Array.isArray(j.rows) && (j.type === FILE_TYPE || (isObj(j.guide) && Array.isArray(j.kitchen)));

/* ---------- the kitchen's check ----------
   The stamp carries a fingerprint of everything the kitchen looked at. Change any row, any shared
   equipment line or any word on the card and the fingerprint no longer matches, so the card is a draft
   again. That holds however the change arrives: an edit here, another phone, a merge, or the file
   edited by hand. Dates and initials of edits aren't part of it. */
const SKIP = new Set(['updated', 'by']);
function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (isObj(v)) return '{' + Object.keys(v).filter((k) => !SKIP.has(k)).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
}
function fnv(s, seed) {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return ('0000000' + h.toString(16)).slice(-8);
}
export function fingerprint(doc) {
  const d = isObj(doc) ? doc : {};
  const s = canon({ card: d.card || null, guide: d.guide || null, kitchen: d.kitchen || null, notes: d.notes || null, rows: d.rows || null });
  return fnv(s, 2166136261) + fnv(s, 3323198485);
}
const isDay = (k) => /^\d{4}-\d\d-\d\d$/.test(str(k));
export function stampOf(doc) {
  const s = isObj(doc && doc.stamp) ? doc.stamp : null;
  if (!s || !str(s.name) || !isDay(s.date)) return null;
  return { name: str(s.name), date: str(s.date), hash: str(s.hash), by: str(s.by) };
}
/* True only while the stamp matches the card as it is now. */
export function isChecked(doc) { const s = stampOf(doc); return !!s && !!s.hash && s.hash === fingerprint(doc); }
export function setStamp(doc, name, date, by) { doc.stamp = { name: str(name), date: str(date), by: str(by), hash: fingerprint(doc) }; }
/* Call after any edit: a stamp that no longer matches is removed, so it can't come back by undoing. */
export function dropStaleStamp(doc) { if (isObj(doc) && doc.stamp && !isChecked(doc)) { delete doc.stamp; return true; } return false; }

/* ---------- chips ---------- */
const RANK = { in: 3, opt: 3, ask: 1, label: 1 };
function chipsOf(row, kitchen) {
  const al = [];
  ALLERGENS.forEach((a) => {
    const es = row.entries.filter((e) => e.a === a.id);
    if (!es.length) return;
    al.push({ id: a.id, code: a.code, name: a.name, dashed: !es.some((e) => RANK[e.s] === 3) });
  });
  const cross = kitchen.filter((k) => k.chip && row.cross.includes(k.id)).map((k) => ({ id: k.id, chip: k.chip }));
  return { al, cross };
}
function mealMark(want, pageMeals) {
  // A part or a side that only comes with some of the page's meals says which.
  if (!want.length) return '';
  const on = pageMeals.filter((m) => want.includes(m));
  return on.length && on.length < pageMeals.length ? on.join(' ') : '';
}
function resolve(list, byId, kitchen, row, pageMeals) {
  const rowMeals = pageMeals.filter((m) => row.meals.includes(m));
  return list.filter((x) => !x.meals.length || x.meals.some((m) => pageMeals.includes(m))).map((x) => {
    const t = x.ref ? byId.get(x.ref) : null;
    const c = t ? chipsOf(t, kitchen) : { al: [], cross: [] };
    const want = x.meals.length ? x.meals : (t && t.meals.length ? t.meals : []);
    return { name: x.t || (t ? t.name : ''), missing: !!x.ref && !t, bad: !!t && t.bad > 0, mark: mealMark(want, rowMeals), al: c.al, cross: c.cross };
  }).filter((x) => x.name || x.missing);
}

/* ---------- the menu pages ---------- */
export const PAGES = [
  { id: 'front', name: 'Front' }, { id: 'back', name: 'Back' }, { id: 'B', name: 'Breakfast' }, { id: 'LD', name: 'Lunch and dinner' }
];
export function menuPage(doc, which) {
  const pageMeals = which === 'B' ? ['B'] : ['L', 'D'];
  const rows = rowsOf(doc), kitchen = kitchenOf(doc), card = cardOf(doc), byId = new Map(rows.map((r) => [r.id, r]));
  const line = (r) => {
    const c = chipsOf(r, kitchen);
    const mark = (v) => (v === 'L' || v === 'D' ? (pageMeals.includes(v) && pageMeals.length > 1 ? v : (pageMeals.includes(v) ? 'yes' : '')) : v);
    return {
      id: r.id, name: r.name, kind: r.kind, meals: pageMeals.filter((m) => r.meals.includes(m)), desc: r.desc, check: r.check,
      al: c.al, cross: c.cross, bad: r.bad > 0, parts: resolve(r.parts, byId, kitchen, r, pageMeals), with: resolve(r.with, byId, kitchen, r, pageMeals),
      packaged: r.packaged, tail: r.tail || (r.daily ? card.dailyTail : ''), veg: mark(r.veg), gf: mark(r.gf), df: mark(r.df)
    };
  };
  const on = rows.filter((r) => r.kind !== 'extra' && r.meals.some((m) => pageMeals.includes(m))).sort((a, b) => az(a.name, b.name));
  if (which === 'B') return { which, meals: pageMeals, rows: on.map(line), sides: [] };
  return { which, meals: pageMeals, rows: on.filter((r) => r.kind === 'dish').map(line), sides: on.filter((r) => r.kind === 'side').map(line) };
}

/* ---------- the back page: can't leave it out ----------
   Worked out from the rows and nothing else. For each allergen:
     listed  rows where it's in and can't be left out (grouped where rows share a "list as" name),
             plus one line for each piece of shared equipment that carries it and has rows using it
     off     what to leave off: the "comes from" word of each row where it can be made without
     ask     rows where it isn't confirmed */
export function backPage(doc) {
  const rows = rowsOf(doc), kitchen = kitchenOf(doc);
  const out = ALLERGENS.map((a) => {
    const listed = new Map(), off = [], ask = [], n = notesOf(doc, a.id);
    const add = (label, sub, ms) => {
      const k = label.toLowerCase(), cur = listed.get(k) || { label, sub: '', meals: [] };
      if (!cur.sub && sub) cur.sub = sub;
      cur.meals = MEALS.filter((m) => cur.meals.includes(m) || ms.includes(m));
      listed.set(k, cur);
    };
    rows.forEach((r) => r.entries.filter((e) => e.a === a.id).forEach((e) => {
      if (e.s === 'in') add(e.list || r.name, e.sub, r.meals);
      else if (e.s === 'opt') { if (e.from) off.push(e.from); }
      else ask.push((e.from || r.short || lower(r.name)) + (e.s === 'label' ? ' (label)' : ''));
    }));
    kitchen.filter((k) => k.listAs && k.carries.includes(a.id)).forEach((k) => {
      const using = rows.filter((r) => r.cross.includes(k.id));
      if (using.length) add(k.listAs, k.sub, MEALS.filter((m) => using.some((r) => r.meals.includes(m))));
    });
    return {
      id: a.id, code: a.code, name: a.name,
      listed: Array.from(listed.values()).sort((x, y) => az(x.label, y.label)),
      off: uniq(off).sort(az), offNote: n.off, ask: uniq(ask).sort(az).concat(n.ask), note: n.back
    };
  });
  const daily = uniq(rows.filter((r) => r.daily).map((r) => r.short || lower(r.name))).sort(az);
  return { allergens: out, daily, kitchen: kitchen.filter((k) => k.title || k.text) };
}

/* ---------- the front page: "on our menu" ----------
   The words rows say an allergen comes from, most-used first, a few at most. */
export function frontLines(doc, max = 6) {
  const rows = rowsOf(doc), kitchen = kitchenOf(doc), out = {};
  ALLERGENS.forEach((a) => {
    const n = new Map();
    rows.forEach((r) => uniq(r.entries.filter((e) => e.a === a.id && RANK[e.s] === 3 && e.from).map((e) => e.from)).forEach((w) => { const k = w.toLowerCase(); n.set(k, { w, c: (n.get(k) ? n.get(k).c : 0) + 1 }); }));
    // Most-used first. A longer phrase that repeats one already there ("prawns in the pasta" after "prawns") is skipped.
    const words = [];
    Array.from(n.values()).sort((x, y) => y.c - x.c || az(x.w, y.w)).forEach((x) => { if (words.length < max && !words.some((w) => x.w.toLowerCase().includes(w.toLowerCase()))) words.push(x.w); });
    kitchen.filter((k) => k.menuWord && k.carries.includes(a.id) && rows.some((r) => r.cross.includes(k.id))).forEach((k) => words.push(k.menuWord));
    out[a.id] = uniq(words).length ? uniq(words).join(', ') : notesOf(doc, a.id).menu;
  });
  return out;
}

/* ---------- things worth a look ----------
   Not errors the app fixes: a list for whoever keeps the card. The ones marked `block` are lines the
   app can't read (a misspelled allergen, a row with no id). What they say isn't on the printed card,
   so the card can't be marked kitchen checked until they're fixed. */
export function issues(doc) {
  const rows = rowsOf(doc), kitchen = kitchenOf(doc), ids = new Set(rows.map((r) => r.id)), kids = new Set(kitchen.map((k) => k.id)), out = [];
  const names = new Map();
  const lost = arr(doc && doc.rows).filter((r) => isObj(r) && !(typeof r.id === 'string' && r.id)).length;
  if (lost) out.push({ row: '', block: true, text: (lost === 1 ? 'A row in the file has no id, so it doesn’t' : lost + ' rows in the file have no id, so they don’t') + ' print. Fix the file.' });
  kitchen.forEach((k) => { if (k.bad) out.push({ row: '', block: true, text: (k.title || k.chip || 'Shared equipment') + ' lists an allergen the app can’t read, so it’s left out. Open it, tick what it carries and save.' }); });
  rows.forEach((r) => {
    const nm = r.name || '(no name)';
    if (!r.name) out.push({ row: r.id, text: 'A row has no name.' });
    if (r.kind !== 'extra' && !r.meals.length) out.push({ row: r.id, text: nm + ' isn’t on any menu, so it prints nowhere.' });
    if (r.bad) out.push({ row: r.id, block: true, text: nm + ' has an allergen line the app can’t read, so it’s left off the pages. Open the row, pick the allergen and save.' });
    r.with.concat(r.parts).forEach((x) => { if (x.ref && !ids.has(x.ref)) out.push({ row: r.id, text: nm + ' points to a sauce or part that was deleted' + (x.t ? ' (' + x.t + ')' : '') + '. Its allergens no longer show.' }); });
    r.cross.forEach((c) => { if (!kids.has(c)) out.push({ row: r.id, text: nm + ' is marked for shared equipment that isn’t on the card anymore.' }); });
    if (r.name && r.kind !== 'extra') { const k = r.name.toLowerCase() + '|' + r.kind; if (names.has(k)) out.push({ row: r.id, text: 'Two rows are named ' + r.name + '. They print as two lines.' }); names.set(k, 1); }
    r.entries.forEach((e) => { if (e.s === 'opt' && !e.from) out.push({ row: r.id, soft: true, text: nm + ': ' + ALLERGENS.find((a) => a.id === e.a).name.toLowerCase() + ' can be made without, but it doesn’t say what to leave off.' }); });
  });
  return out;
}
export const blocking = (doc) => issues(doc).filter((i) => i.block);
export function openCount(doc) { return rowsOf(doc).reduce((n, r) => n + r.entries.filter((e) => RANK[e.s] === 1).length, 0); }

/* ---------- a new, empty card ---------- */
export function emptyCard() {
  return { schema: 1, updated: null, card: {}, guide: {}, kitchen: [], notes: {}, rows: [] };
}
