// A "phone" for tests: its own copy of the app's modules (so two phones don't share state),
// with IndexedDB swapped for an in-memory store at globalThis.__mem_<name>.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SRC = path.join(ROOT, 'js');

/* Where tests write their throwaway files. run-all.mjs passes one in; otherwise make a fresh one. */
export function outDir() {
  if (process.env.THE_SHEET_TEST_OUT) { fs.mkdirSync(process.env.THE_SHEET_TEST_OUT, { recursive: true }); return process.env.THE_SHEET_TEST_OUT; }
  return fs.mkdtempSync(path.join(os.tmpdir(), 'the-sheet-test-'));
}

export function makePhone(name, out = outDir()) {
  if (!/^[A-Za-z]\w*$/.test(name)) throw new Error('phone name must be a word: ' + name);
  const dir = path.join(out, 'phone-' + name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.cpSync(SRC, path.join(dir, 'js'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'js', 'db.js'), `
const mem = globalThis.__mem_${name} = globalThis.__mem_${name} || {};
export const getAll = async () => JSON.parse(JSON.stringify(mem));
export const put = async (k, v) => { mem[k] = JSON.parse(JSON.stringify(v)); };
export const del = async (k) => { delete mem[k]; };
export const clearAll = async () => { for (const k of Object.keys(mem)) delete mem[k]; };
export const persist = async () => true; export const persisted = async () => true;`);
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  return dir;
}

/* A tiny pass/fail counter shared by the Node tests. */
export function checker() {
  const t = { passes: 0, failures: 0 };
  t.check = (cond, msg) => { if (cond) { t.passes++; console.log('  ok   ' + msg); } else { t.failures++; console.log('  FAIL ' + msg); } };
  t.done = () => { console.log('\n' + t.passes + ' passed, ' + t.failures + ' failed'); process.exit(t.failures ? 1 : 0); };
  return t;
}
