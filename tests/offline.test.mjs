// The app is self-contained: everything it needs is in the offline cache, and the only outside
// address it may contact is GitHub's API (for syncing). Reads the files; no browser needed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checker } from './lib/phone.mjs';

const T = checker();
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const norm = (u) => path.posix.normalize(u.replace(/^\.\//, ''));

const sw = read('sw.js');
const SHELL = JSON.parse('[' + /const SHELL = \[([\s\S]*?)\];/.exec(sw)[1].replace(/'/g, '"').replace(/,\s*$/, '') + ']').map(norm);
const inShell = (f) => SHELL.includes(norm(f));

console.log('\n1. Every file in the offline list exists');
const missing = SHELL.filter((f) => f !== '.' && !fs.existsSync(path.join(ROOT, f)));
T.check(missing.length === 0, missing.length ? 'missing: ' + missing.join(', ') : SHELL.length + ' files listed, all present');

console.log('\n2. Everything the app loads is in the offline list');
const html = read('index.html');
const fromHtml = [...html.matchAll(/(?:href|src)="([^"#:]+)"/g)].map((m) => m[1]);
const css = read('app.css');
const fromCss = [...css.matchAll(/url\(([^)'"]+)\)/g)].map((m) => m[1]);
const manifest = JSON.parse(read('manifest.webmanifest'));
const fromManifest = (manifest.icons || []).map((i) => i.src);
// Every module reachable from js/main.js through import statements.
const seen = new Set();
(function walk(f) {
  if (seen.has(f)) return; seen.add(f);
  for (const m of read(f).matchAll(/(?:import|export)\s[^'"]*?from\s+'(\.[^']+)'|import\(\s*'(\.[^']+)'\s*\)/g)) walk(path.posix.join(path.posix.dirname(f), m[1] || m[2]));
})('js/main.js');
const fromJs = [...seen];
for (const [where, list] of [['index.html', fromHtml], ['app.css', fromCss], ['the manifest', fromManifest], ['the app code', fromJs]]) {
  const out = list.filter((f) => !inShell(f));
  T.check(list.length > 0 && out.length === 0, out.length ? where + ' loads files that aren’t cached: ' + out.join(', ') : where + ': ' + list.length + ' files, all cached');
}
const fonts = fromCss.filter((f) => f.startsWith('fonts/'));
T.check(fonts.length >= 8, 'the fonts ship with the app (' + fonts.length + ' files)');
const families = [...new Set([...css.matchAll(/@font-face\{font-family:'([^']+)'/g)].map((m) => m[1]))];
const licences = fs.readdirSync(path.join(ROOT, 'fonts')).filter((f) => f.startsWith('OFL-'));
T.check(families.length > 0 && families.length === licences.length, 'each font family has its license file (' + families.join(', ') + ')');

console.log('\n3. Nothing loads from outside, except syncing with GitHub');
const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)[1];
const outsideIn = csp.split(';').map((d) => d.trim().split(/\s+/)).filter((d) => d[0]).flatMap(([dir, ...src]) => src.filter((s) => !/^'|^data:$/.test(s)).map((s) => dir + ' ' + s));
T.check(outsideIn.length === 1 && outsideIn[0] === 'connect-src https://api.github.com', 'the page’s security rules allow one outside address: ' + outsideIn.join(', '));
const appFiles = ['index.html', 'app.css', 'manifest.webmanifest', 'sw.js', ...fromJs];
const hosts = appFiles.flatMap((f) => [...read(f).matchAll(/(?:https?:)?\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)].map((m) => f + ': ' + m[1]));
const others = hosts.filter((h) => !h.endsWith(': api.github.com'));
T.check(others.length === 0, others.length ? 'other addresses in the app: ' + others.join(', ') : 'no other web addresses anywhere in the app’s ' + appFiles.length + ' files');

T.done();
