// Quick view: big tiles for a small screen, like the Flip's cover screen.

import { app } from '../app.js';
import { S, B, blockState, listItemsFor, isTicked, hasBook } from '../state.js';
import { esc, fmt12, dur } from '../util.js';
import { ICON } from '../ui.js';
import { floorSummary } from './lead.js';
import { countSummary } from './count.js';

function nextUp() {
  const st = blockState(); if (st.idx < 0) return null;
  const b = st.bl[st.idx];
  const lists = B().lists.filter((l) => l.role === S.settings.role && !l.draft && !l.standards);
  for (const l of lists) { const its = listItemsFor(l, b.id); if (!its) continue; const t = its.find((x) => !isTicked(x.id)); if (t) return { t, l, left: its.filter((x) => !isTicked(x.id)).length }; }
  return null;
}
const strip = (html) => String(html).replace(/<[^>]+>/g, '').trim();

export function render() {
  if (!hasBook()) return '<div class="quick-grid"><button class="qt wide" data-act="quick-exit">' + ICON.more + '<b>Set up</b><span>Open the full app</span></button></div>';
  const st = blockState(), b = st.idx >= 0 ? st.bl[st.idx] : null, nx = nextUp();
  const notes = S.shift.notes.length;
  const fs = strip(floorSummary()).replace(/^Floor\s*/, ''), cs = strip(countSummary()).replace(/^Count\s*/, '');
  return '<div class="quick-grid">' +
    '<button class="qt wide hero-t" data-act="quick-go" data-id="#now"><span class="q-eb mono">' + (b ? 'Now · ' + fmt12(st.t) : 'Today') + '</span><b>' + esc(b ? b.name : 'Off hours') + '</b><span>' + esc(b ? dur(Math.max(0, b.e - st.t)) + ' left' : '') + '</span></button>' +
    '<button class="qt" data-act="quick-note">' + ICON.note + '<b>Note</b><span>' + (notes ? notes + ' this shift' : 'Jot it down') + '</span></button>' +
    (nx ? '<button class="qt" data-act="tick" data-id="' + esc(nx.t.id) + '" data-quick="1">' + ICON.check + '<b>' + esc(nx.t.text.length > 46 ? nx.t.text.slice(0, 44) + '…' : nx.t.text) + '</b><span>' + esc(nx.l.short || nx.l.name) + ' · ' + nx.left + ' left · tap when done</span></button>'
      : '<button class="qt" data-act="quick-go" data-id="#now">' + ICON.check + '<b>Checklists</b><span>All caught up</span></button>') +
    '<button class="qt" data-act="quick-go" data-id="#lead/floor">' + ICON.people + '<b>Floor</b><span>' + esc(fs || '') + '</span></button>' +
    '<button class="qt" data-act="quick-go" data-id="#count">' + ICON.count + '<b>Count</b><span>' + esc(cs || '') + '</span></button>' +
    '<button class="qt wide subtle" data-act="quick-exit">' + ICON.grid + '<b>Full app</b></button>' +
  '</div>';
}

export const acts = {
  'quick-go': (el) => { app.ui.leftQuick = true; app.go(el.dataset.id); },
  'quick-exit': () => { app.ui.leftQuick = true; app.go('#now'); }
};
