// More: sync with the private repo, backups, imports, phone settings, links, and erase.

import { app } from '../app.js';
import { S, B, save, flush, eraseAll, dirty, anyDirty, hasBook, hasInv, SYNCED } from '../state.js';
import { esc, ago, todayKey, downloadFile, shareFile, pickFile, clone, $ } from '../util.js';
import { ICON, empty, toast, armed, field, input, opts } from '../ui.js';
import { syncAll, testConnection, configured, isSyncing, FILES } from '../sync.js';
import { persist, persisted } from '../db.js';

let lastResult = null, persistState = null, showConn = false;
const NAMES = { book: 'Book', inv: 'Inventory', state: 'Follow-ups, wins, saved counts' };

function syncCard() {
  let h = '<section class="panel"><div class="row-h"><h2 class="sec-h">' + ICON.sync + ' Sync</h2></div>';
  if (!configured()) {
    h += '<p>Connect your private book repo to load the book and inventory, and to back up your edits. You only need a connection when you sync.</p>' + connForm(true) + keyHelp();
    return h + '</section>';
  }
  const waiting = SYNCED.filter(dirty);
  h += '<p class="sync-status">' + (S.settings.lastSync ? 'Last synced ' + esc(ago(S.settings.lastSync)) : 'Not synced yet') + '. ' + (waiting.length ? '<b>Changes waiting:</b> ' + esc(waiting.map((k) => NAMES[k]).join(', ')) + '.' : 'Nothing waiting.') + '</p>';
  if (lastResult) h += '<p class="note">' + esc(lastResult) + '</p>';
  h += '<div class="row-actions"><button class="btn primary big" data-act="sync-now"' + (isSyncing() ? ' disabled' : '') + '>' + ICON.sync + (isSyncing() ? ' Syncing…' : ' Sync now') + '</button><button class="btn ghost" data-act="conn-toggle">' + ICON.key + ' Connection</button></div>';
  if ((S.conflicts || []).length) {
    h += '<details class="hist"><summary><span class="hdate">' + S.conflicts.length + ' merge note' + (S.conflicts.length === 1 ? '' : 's') + '</span><span class="hsum">The same thing changed on the phone and on GitHub. The phone’s version was kept.</span></summary><div class="hbody"><ul class="plain-list">' +
      S.conflicts.slice().reverse().map((c) => '<li><b>' + esc(c.file) + '</b> ' + esc(c.path.replace(/^\./, '')) + (c.note ? ' · ' + esc(c.note) : '') + ' · ' + esc(ago(c.at)) + '</li>').join('') + '</ul><button class="btn small ghost" data-act="conflicts-clear">Clear notes</button></div></details>';
  }
  if (showConn) h += connForm(false) + keyHelp();
  return h + '</section>';
}
function connForm(first) {
  const s = S.settings;
  return '<div class="form conn">' +
    field('cf-owner', 'GitHub owner', input('cf-owner', s.owner, 'autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="your-username"'), '', 'half') +
    field('cf-repo', 'Book repo', input('cf-repo', s.repo, 'autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="my-book"'), 'Must be private', 'half') +
    field('cf-token', 'Key (fine-grained token)', '<input id="cf-token" type="password" autocomplete="off" spellcheck="false" placeholder="' + (s.token ? 'Saved. Paste a new one to replace it.' : 'github_pat_…') + '">', 'Stays on this phone. It’s left out of backups.') +
    '<div class="row-actions full"><button class="btn primary" data-act="conn-save">' + (first ? 'Connect and sync' : 'Test and save') + '</button>' + (!first ? '<button class="btn danger" data-act="conn-forget">Disconnect</button>' : '') + '</div></div>';
}
function keyHelp() {
  return '<details class="todo-list"><summary>How to make the key</summary><ol class="help-steps">' +
    '<li>On github.com, open <b>Settings → Developer settings → Personal access tokens → Fine-grained tokens</b>, and tap <b>Generate new token</b>.</li>' +
    '<li>Name it “MultiTool phone”. Set an expiration you’re comfortable with (a year is fine; you’ll paste a new one when it runs out).</li>' +
    '<li><b>Repository access:</b> Only select repositories → your book repo. Nothing else.</li>' +
    '<li><b>Permissions → Repository permissions → Contents:</b> Read and write. Leave everything else as it is.</li>' +
    '<li>Generate, copy the token, and paste it above.</li></ol><p class="hint">That key can only touch the one repo. If the phone is ever lost, delete the token on GitHub and it stops working.</p></details>';
}

function backupCard() {
  return '<section class="panel"><div class="row-h"><h2 class="sec-h">' + ICON.download + ' Backup</h2></div>' +
    '<p>A backup file holds everything on this phone, including phone-only things like shift notes, the floor board and trainees. The GitHub key is left out.</p>' +
    '<p class="hint">Last backup file: ' + esc(S.settings.lastExport ? ago(S.settings.lastExport) : 'never') + '.</p>' +
    '<div class="row-actions"><button class="btn" data-act="backup-share">' + ICON.share + ' Save backup</button><button class="btn ghost" data-act="import">' + ICON.upload + ' Import a file</button></div>' +
    '<p class="hint">Import takes a backup file, the phone-only staffing plan file, or a book or inventory file.</p></section>';
}
function phoneCard() {
  const s = S.settings;
  const ps = persistState == null ? 'Checking…' : persistState ? 'Protected: Chrome won’t clear it to save space.' : 'Not protected yet. Installing the app to your home screen usually fixes that.';
  return '<section class="panel"><div class="row-h"><h2 class="sec-h">This phone</h2></div><div class="form">' +
    field('st-name', 'Sign messages as', input('st-name', s.name, 'data-setting="name" autocomplete="name" placeholder="Your name"')) +
    field('st-theme', 'Look', '<select id="st-theme" data-setting="theme">' + opts([['auto', 'Match the phone'], ['light', 'Light'], ['dark', 'Dark']], s.theme) + '</select>', '', 'half') +
    field('st-quick', 'Small screens', '<select id="st-quick" data-setting="quick">' + opts([['true', 'Open to the quick view'], ['false', 'Normal view']], String(s.quick !== false)) + '</select>', 'Like the Flip’s cover screen', 'half') +
    '</div><p class="hint">Storage: ' + esc(ps) + '</p><div class="row-actions"><button class="btn small ghost" data-act="go" data-id="#quick">' + ICON.grid + ' Open quick view</button></div></section>';
}
function linksCard() {
  const links = (B().links || []);
  if (!links.length) return '';
  return '<section class="panel"><div class="row-h"><h2 class="sec-h">' + ICON.link + ' Links</h2></div><ul class="plain-list links">' + links.map((l) => '<li><a href="' + esc(l.url) + '" target="_blank" rel="noopener">' + esc(l.label) + '</a></li>').join('') + '</ul><p class="hint">These open in the browser and need a connection.</p></section>';
}
function aboutCard() {
  return '<section class="panel"><div class="row-h"><h2 class="sec-h">About</h2></div>' +
    '<p>MultiTool ' + esc(app.version) + '. The app itself holds no work content. The book and inventory come from your private repo; everything else stays on this phone.</p>' +
    '<ul class="plain-list"><li><b>Synced:</b> book, inventory, follow-ups, wins, printed log, saved counts.</li><li><b>Phone only:</b> today’s ticks, shift notes, floor board, trainees, message drafts, staffing plan, the key.</li></ul>' +
    '<div class="row-actions"><button class="btn small ghost" data-act="check-update">Check for an app update</button><button class="btn small danger" data-act="erase">' + ICON.trash + ' Erase this phone’s data</button></div></section>';
}

export function render() {
  if (persistState == null) persisted().then((v) => { persistState = !!v; if (app.route.tab === 'more') app.renderView(); });
  return syncCard() + backupCard() + phoneCard() + linksCard() + aboutCard();
}

/* ---------- backup and import ---------- */
function backupJSON() {
  const data = {};
  ['book', 'inv', 'state', 'count', 'day', 'shift', 'floor', 'trainees', 'priv', 'msgs', 'settings', 'conflicts'].forEach((k) => { data[k] = clone(S[k]); });
  delete data.settings.token;
  return JSON.stringify({ type: 'multitool-backup', schema: 1, exported: new Date().toISOString(), app: app.version, data }, null, 1);
}
async function importFile() {
  const f = await pickFile();
  if (!f) return;
  let j; try { j = JSON.parse(f.text); } catch (e) { toast('That file isn’t JSON.'); return; }
  if (j && j.type === 'multitool-private') {
    S.priv = S.priv || { staffPlan: null, cards: [] };
    if (j.staffPlan) S.priv.staffPlan = j.staffPlan;
    (j.cards || []).forEach((c) => { const i = (S.priv.cards || []).findIndex((x) => x.id === c.id); if (i >= 0) S.priv.cards[i] = c; else (S.priv.cards = S.priv.cards || []).push(c); });
    save('priv'); toast('Imported the phone-only file. It stays on this phone.'); app.render(); return;
  }
  if (j && j.type === 'multitool-backup' && j.data) {
    if (!confirm('Replace everything on this phone with the backup from ' + (j.exported || 'that file').slice(0, 10) + '?')) return;
    const keep = { token: S.settings.token, owner: S.settings.owner, repo: S.settings.repo };
    Object.keys(j.data).forEach((k) => { if (k in S) { S[k] = j.data[k]; save(k); } });
    S.settings = Object.assign({}, S.settings, { token: keep.token || '', owner: S.settings.owner || keep.owner, repo: S.settings.repo || keep.repo, setupDone: true });
    save('settings'); await flush(); toast('Backup restored.'); app.go('#now'); return;
  }
  if (j && Array.isArray(j.lists) && Array.isArray(j.cards)) {
    if (hasBook() && !confirm('Replace the book on this phone with this file?')) return;
    S.book.local = j; save('book'); toast('Book loaded.'); app.go('#now'); return;
  }
  if (j && Array.isArray(j.lines) && Array.isArray(j.cats)) {
    if (hasInv() && !confirm('Replace the inventory on this phone with this file?')) return;
    S.inv.local = j; save('inv'); toast('Inventory loaded.'); app.go('#count'); return;
  }
  toast('Didn’t recognize that file.');
}

async function doSync() {
  lastResult = null; app.renderView();
  try {
    const r = await syncAll();
    const parts = [], F = { 'book.json': 'the book', 'inventory.json': 'inventory', 'state.json': 'follow-ups and counts' };
    const nice = (a) => a.map((f) => F[f] || f).join(', ');
    if (r.pulled.length) parts.push('got updates to ' + nice(r.pulled));
    if (r.pushed.length) parts.push('saved ' + nice(r.pushed) + ' to GitHub');
    if (r.conflicts) parts.push(r.conflicts + ' merge note' + (r.conflicts === 1 ? '' : 's'));
    lastResult = parts.length ? 'Synced: ' + parts.join('; ') + '.' : 'Synced. Everything already matched.';
    toast('Synced.');
  } catch (e) { lastResult = e.message || String(e); toast('Sync didn’t finish.'); }
  app.render();
}

export const acts = {
  'sync-now': () => doSync(),
  'conn-toggle': () => { showConn = !showConn; app.renderView(); },
  'conn-save': async (el) => {
    const owner = $('#cf-owner').value.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\/.*$/, ''), repo = $('#cf-repo').value.trim().replace(/\.git$/, ''), tok = $('#cf-token').value.trim() || S.settings.token;
    if (!owner || !repo || !tok) { toast('Fill in the owner, the repo and the key.'); return; }
    el.disabled = true; el.textContent = 'Checking…';
    try {
      const info = await testConnection({ owner, repo, token: tok });
      if (!info.private) { toast('That repo is public. Make it private on GitHub first; the book shouldn’t be public.'); el.disabled = false; el.textContent = 'Test and save'; return; }
      Object.assign(S.settings, { owner, repo, token: tok, branch: info.defaultBranch || 'main', setupDone: true }); save('settings');
      showConn = false;
      toast(info.push ? 'Connected. Syncing…' : 'Connected, but GitHub didn’t confirm write access. Syncing…');
      await doSync();
      persist().then((v) => { persistState = !!v; });
    } catch (e) { toast(e.message || 'Couldn’t connect.'); el.disabled = false; el.textContent = 'Test and save'; }
  },
  'conn-forget': (el) => { if (!armed(el, 'Forget the key?')) return; S.settings.token = ''; save('settings'); showConn = false; toast('Key removed from this phone. Your data stays.'); app.renderView(); },
  'conflicts-clear': () => { S.conflicts = []; save('conflicts'); app.renderView(); },
  'backup-share': async () => { const name = 'multitool-backup-' + todayKey() + '.json'; const r = await shareFile(name, backupJSON()); if (r !== 'cancelled') { S.settings.lastExport = new Date().toISOString(); save('settings'); toast(r === 'shared' ? 'Backup shared.' : 'Backup saved to Downloads.'); app.renderView(); } },
  'import': () => importFile(),
  'erase': async (el) => { if (!armed(el, 'Erase everything here?')) return; if (!confirm('Erase everything MultiTool has stored on this phone? Anything not synced or backed up is gone for good.')) return; await eraseAll(); toast('Erased.'); app.go('#now'); },
  'check-update': async () => { try { const reg = await navigator.serviceWorker.getRegistration(); if (reg) { await reg.update(); toast(reg.waiting || reg.installing ? 'Update found. It’s getting ready.' : 'You have the latest version.'); } else toast('Updates work once the app is installed.'); } catch (e) { toast('Couldn’t check. Are you online?'); } }
};
export function onInput(el, ev) {
  if (!el.dataset.setting) return false;
  const k = el.dataset.setting;
  if (k === 'quick') S.settings.quick = el.value === 'true';
  else S.settings[k] = el.value;
  save('settings');
  if (k === 'theme') app.applyTheme();
  return true;
}
export function prefill(owner, repo) { if (owner && !S.settings.owner) S.settings.owner = owner; if (repo && !S.settings.repo) S.settings.repo = repo; save('settings'); }
