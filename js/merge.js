// Three-way merge for synced files.
// base   = the file as it was the last time this phone synced
// local  = this phone's copy now
// remote = the file on GitHub now
// Rules: whoever changed something wins. If both changed the same item, this phone wins and
// the GitHub version is kept in `conflicts` so nothing is silently lost.

import { same, clone } from './util.js';

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const isIdArray = (a) => Array.isArray(a) && a.length > 0 && a.every((x) => isObj(x) && typeof x.id === 'string');

function mergeValue(base, local, remote, path, conflicts) {
  if (same(local, remote)) return clone(local);
  if (same(local, base)) return clone(remote);
  if (same(remote, base)) return clone(local);
  // Both sides changed.
  if ((isIdArray(local) || isIdArray(remote) || isIdArray(base)) && [base, local, remote].every((v) => v == null || Array.isArray(v))) {
    return mergeArrays(base || [], local || [], remote || [], path, conflicts);
  }
  if (isObj(local) && isObj(remote)) return mergeObjects(isObj(base) ? base : {}, local, remote, path, conflicts);
  conflicts.push({ path, kept: 'phone', theirs: clone(remote), ours: clone(local) });
  return clone(local);
}

function mergeObjects(base, local, remote, path, conflicts) {
  const out = {};
  const keys = new Set([...Object.keys(remote), ...Object.keys(local), ...Object.keys(base)]);
  for (const k of keys) {
    const inL = k in local, inR = k in remote, inB = k in base;
    if (!inL && !inR) continue;
    if (!inL && inB && same(base[k], remote[k])) continue;            // phone removed it, GitHub didn't touch it
    if (!inR && inB && same(base[k], local[k])) continue;             // GitHub removed it, phone didn't touch it
    const v = mergeValue(inB ? base[k] : undefined, inL ? local[k] : (inB ? undefined : remote[k]), inR ? remote[k] : (inB ? undefined : local[k]), path + '.' + k, conflicts);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

function mergeArrays(base, local, remote, path, conflicts) {
  const B = new Map(base.map((x) => [x.id, x]));
  const L = new Map(local.map((x) => [x.id, x]));
  const R = new Map(remote.map((x) => [x.id, x]));
  const result = new Map();
  const ids = new Set([...R.keys(), ...L.keys(), ...B.keys()]);
  for (const id of ids) {
    const b = B.get(id), l = L.get(id), r = R.get(id);
    if (l && r) { result.set(id, mergeValue(b, l, r, path + '[' + id + ']', conflicts)); continue; }
    if (l && !r) {
      if (!b) { result.set(id, clone(l)); continue; }                 // new on the phone
      if (same(l, b)) continue;                                        // GitHub deleted it, phone didn't change it
      conflicts.push({ path: path + '[' + id + ']', kept: 'phone', note: 'Deleted on GitHub, changed on the phone' });
      result.set(id, clone(l)); continue;
    }
    if (r && !l) {
      if (!b) { result.set(id, clone(r)); continue; }                 // new on GitHub
      if (same(r, b)) continue;                                        // phone deleted it, GitHub didn't change it
      conflicts.push({ path: path + '[' + id + ']', kept: 'github', note: 'Deleted on the phone, changed on GitHub' });
      result.set(id, clone(r)); continue;
    }
  }
  // Order: use the phone's order if only the phone reordered, otherwise GitHub's.
  const common = (a) => a.map((x) => x.id).filter((id) => B.has(id) && L.has(id) && R.has(id));
  const phoneReordered = !same(common(local), common(base));
  const githubReordered = !same(common(remote), common(base));
  const primary = phoneReordered && !githubReordered ? local : remote;
  const secondary = primary === local ? remote : local;
  const order = primary.map((x) => x.id).filter((id) => result.has(id));
  // Slot items that only exist on the other side in after their neighbor.
  secondary.forEach((x, i) => {
    if (!result.has(x.id) || order.includes(x.id)) return;
    let at = order.length;
    for (let j = i - 1; j >= 0; j--) { const k = order.indexOf(secondary[j].id); if (k >= 0) { at = k + 1; break; } }
    order.splice(at, 0, x.id);
  });
  return order.map((id) => result.get(id));
}

export function mergeDoc(base, local, remote) {
  const conflicts = [];
  if (local == null) return { doc: clone(remote), conflicts };
  if (remote == null) return { doc: clone(local), conflicts };
  const doc = mergeValue(base == null ? {} : base, local, remote, '', conflicts);
  return { doc, conflicts };
}
