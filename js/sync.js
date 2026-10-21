// Sync with the private GitHub repo through the GitHub API, using a fine-grained key
// that can only read and write that one repo. Runs only when you tap Sync and have a connection.

import { S, save, flush } from './state.js';
import { mergeDoc } from './merge.js';
import { clone, same } from './util.js';

const API = 'https://api.github.com';
export const FILES = { book: 'book.json', inv: 'inventory.json', state: 'state.json' };

export const configured = () => !!(S.settings.owner && S.settings.repo && S.settings.token);

function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function b64decode(b64) {
  const bin = atob(String(b64).replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

class SyncError extends Error { constructor(msg, status) { super(msg); this.status = status; } }

async function gh(method, path, body, cfg) {
  const c = cfg || S.settings;
  let res;
  try {
    res = await fetch(API + '/repos/' + encodeURIComponent(c.owner) + '/' + encodeURIComponent(c.repo) + path, {
      method,
      cache: 'no-store',
      headers: Object.assign({ Authorization: 'Bearer ' + c.token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined
    });
  } catch (e) {
    throw new SyncError(navigator.onLine === false ? 'No connection. Everything is saved on this phone; sync when you’re back online.' : 'Couldn’t reach GitHub. Check the connection and try again.', 0);
  }
  if (res.status === 401) throw new SyncError('GitHub didn’t accept the key. It may have expired. Make a new one and paste it in More → Sync.', 401);
  if (res.status === 403) {
    const left = res.headers.get('x-ratelimit-remaining');
    throw new SyncError(left === '0' ? 'GitHub says to slow down. Try again in a few minutes.' : 'The key works but isn’t allowed to do this. It needs Contents: read and write on the book repo.', 403);
  }
  return res;
}

async function getFile(path) {
  const res = await gh('GET', '/contents/' + path + '?ref=' + encodeURIComponent(S.settings.branch || 'main'));
  if (res.status === 404) return null;
  if (!res.ok) throw new SyncError('GitHub error ' + res.status + ' reading ' + path + '.', res.status);
  const j = await res.json();
  let text;
  if (j.content && j.encoding === 'base64') text = b64decode(j.content);
  else {
    // Files over 1 MB come back without content; fetch the raw blob.
    const raw = await gh('GET', '/git/blobs/' + j.sha);
    if (!raw.ok) throw new SyncError('Couldn’t read ' + path + ' (' + raw.status + ').', raw.status);
    const rj = await raw.json(); text = b64decode(rj.content);
  }
  try { return { sha: j.sha, json: JSON.parse(text) }; } catch (e) { throw new SyncError(path + ' on GitHub isn’t valid JSON, so it wasn’t loaded. Fix it there and sync again.', 0); }
}

async function putFile(path, json, sha, message) {
  const body = { message, content: b64encode(JSON.stringify(json, null, 1) + '\n'), branch: S.settings.branch || 'main' };
  if (sha) body.sha = sha;
  const res = await gh('PUT', '/contents/' + path, body);
  if (res.status === 409 || res.status === 422) return { conflict: true };
  if (!res.ok) throw new SyncError('GitHub error ' + res.status + ' saving ' + path + '.', res.status);
  const j = await res.json();
  return { sha: j.content && j.content.sha };
}

/* One file: pull, merge, push if this phone has anything new. */
async function syncOne(key, report, attempt = 0) {
  const path = FILES[key];
  const slot = S[key];
  const remote = await getFile(path);
  if (!remote) {
    if (slot.local) {
      const r = await putFile(path, slot.local, null, 'Add ' + path + ' from phone');
      if (r.conflict) { if (attempt < 1) return syncOne(key, report, attempt + 1); throw new SyncError(path + ' changed while syncing. Try again.', 409); }
      slot.base = clone(slot.local); slot.sha = r.sha; slot.syncedAt = new Date().toISOString(); report.pushed.push(path);
    }
    return;
  }
  if (!slot.local) {
    slot.local = clone(remote.json); slot.base = clone(remote.json); slot.sha = remote.sha; slot.syncedAt = new Date().toISOString();
    report.pulled.push(path); return;
  }
  const localChanged = !same(slot.local, slot.base);
  if (remote.sha === slot.sha && !localChanged) { slot.syncedAt = new Date().toISOString(); return; }
  let next = slot.local, conflicts = [];
  if (remote.sha !== slot.sha) {
    const m = mergeDoc(slot.base, slot.local, remote.json);
    next = m.doc; conflicts = m.conflicts;
    if (!same(remote.json, slot.base)) report.pulled.push(path);
  }
  if (same(next, remote.json)) {
    slot.local = clone(remote.json); slot.base = clone(remote.json); slot.sha = remote.sha;
  } else {
    const r = await putFile(path, next, remote.sha, 'Update ' + path + ' from phone');
    if (r.conflict) { if (attempt < 1) return syncOne(key, report, attempt + 1); throw new SyncError(path + ' changed while syncing. Try again.', 409); }
    slot.local = clone(next); slot.base = clone(next); slot.sha = r.sha; report.pushed.push(path);
  }
  slot.syncedAt = new Date().toISOString();
  if (conflicts.length) {
    report.conflicts += conflicts.length;
    S.conflicts = (S.conflicts || []).concat(conflicts.map((c) => Object.assign({ file: path, at: new Date().toISOString() }, c))).slice(-50);
    save('conflicts');
  }
}

let running = null;
export function syncAll() {
  if (running) return running;
  running = (async () => {
    const report = { pulled: [], pushed: [], conflicts: 0 };
    try {
      for (const key of Object.keys(FILES)) { await syncOne(key, report); save(key); }
      S.settings.lastSync = new Date().toISOString(); save('settings');
      await flush();
      return report;
    } finally { running = null; }
  })();
  return running;
}
export const isSyncing = () => !!running;

/* Check a key before saving it: is the repo reachable, private, and writable? */
export async function testConnection(cfg) {
  const res = await gh('GET', '', null, cfg);
  if (res.status === 404) throw new SyncError('Repo not found. Check the owner and repo name, and that the key includes that repo.', 404);
  if (!res.ok) throw new SyncError('GitHub error ' + res.status + '.', res.status);
  const j = await res.json();
  return { private: !!j.private, push: !!(j.permissions && j.permissions.push), fullName: j.full_name, defaultBranch: j.default_branch };
}
