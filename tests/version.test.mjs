// The app's version has to change whenever its files do.
// A phone keeps the whole app offline and only fetches a new copy when sw.js itself changes. So two
// merges under one version number leave every phone that took the first one without the second, for
// good: "Check for an app update" says it has the latest. (That happened once: a fix that never arrived.)
// Compares this checkout with main on GitHub. Skipped where there is no git or no origin/main.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checker } from './lib/phone.mjs';

const T = checker();
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const swVer = (text) => (/const VERSION = 'mt-([^']+)'/.exec(text) || [])[1] || '';
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 25000, env: Object.assign({}, process.env, { GIT_TERMINAL_PROMPT: '0' }) });

console.log('\n1. One version, in both places');
const ver = swVer(read('sw.js')), appVer = (/app\.version = '([^']+)'/.exec(read('js/main.js')) || [])[1] || '';
T.check(/^\d+\.\d+\.\d+$/.test(ver) && ver === appVer, 'sw.js and js/main.js carry the same version: ' + ver + ' and ' + appVer);

console.log('\n2. App files that differ from main come with a version main doesn’t have');
// What a phone caches: the page, styles, scripts, fonts, icons, manifest and sw.js. Tests and notes don't count.
const APP = ['index.html', 'app.css', 'manifest.webmanifest', 'sw.js', 'js', 'icons', 'fonts'];
let base = '';
try {
  // Main as it is on GitHub now, not as it was when this copy was cloned: a merge may have happened since.
  try { git('fetch', '--quiet', ...(git('rev-parse', '--is-shallow-repository').trim() === 'true' ? ['--depth=50'] : []), 'origin', 'main'); } catch (e) { /* offline: use what's here */ }
  base = git('rev-parse', '--verify', '--quiet', 'origin/main').trim();
} catch (e) { base = ''; }
if (!base) {
  console.log('  skip  no git, or no origin/main, in this copy');
  process.exit(T.failures ? 1 : 2);
}
const changed = git('diff', '--name-only', base, '--', ...APP).split('\n').filter(Boolean);
const mainVer = swVer(git('show', base + ':sw.js'));
T.check(!changed.length || ver !== mainVer, changed.length
  ? changed.length + ' app file' + (changed.length === 1 ? '' : 's') + ' differ from main (' + changed.slice(0, 4).join(', ') + (changed.length > 4 ? ', …' : '') + '): the version is ' + ver + ', main has ' + mainVer + (ver === mainVer ? '. Bump VERSION in sw.js and app.version in js/main.js, or phones that already have ' + mainVer + ' will never get this' : '')
  : 'no app file differs from main (' + mainVer + ')');

T.done();
