# Printing the way a phone does it, in a real browser. Chrome and Firefox on Android return from
# window.print() straight away, say "afterprint" at once, and only make the PDF afterwards, so the
# printout must still be in place by then. Also: no paper size on ordinary printouts (Firefox on
# Android mis-scales a page that sets one). Needs Chrome and Playwright for Python; exits 2 (skipped)
# when they aren't there. Made-up data only.
import json, os, subprocess, sys, socket, time
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
CHROME = next((c for c in ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'] if os.path.exists(c)), None)
try:
    from playwright.sync_api import sync_playwright
except Exception:
    print('skipped: Playwright for Python is not installed'); sys.exit(2)
if not CHROME:
    print('skipped: no Chrome found'); sys.exit(2)

seed = json.loads(subprocess.run(['node', '-e', "import('./tests/lib/fixtures.mjs').then(m => console.log(JSON.stringify(m.fullPhone({ clash: false }))))"], cwd=ROOT, capture_output=True, text=True, check=True).stdout)
s = socket.socket(); s.bind(('127.0.0.1', 0)); port = s.getsockname()[1]; s.close()
server = subprocess.Popen([sys.executable, '-m', 'http.server', str(port), '--bind', '127.0.0.1'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
base = 'http://127.0.0.1:%d/' % port
passes = fails = 0
def check(ok, msg):
    global passes, fails
    passes += bool(ok); fails += (not ok)
    print(('  ok   ' if ok else '  FAIL ') + msg)
PUT = """(seed) => new Promise((res, rej) => { const rq = indexedDB.open('multitool', 1); rq.onupgradeneeded = () => rq.result.createObjectStore('kv'); rq.onsuccess = () => { const tx = rq.result.transaction('kv', 'readwrite'); for (const [k, v] of Object.entries(seed)) tx.objectStore('kv').put(v, k); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }; rq.onerror = () => rej(rq.error); })"""
# As a phone does it: print() returns at once and afterprint fires straight away.
PHONE_PRINT = "window.__printed = 0; window.print = () => { window.__printed++; window.dispatchEvent(new Event('afterprint')); }"
# What would go on paper right now: which of the app and the printout show in print, and the printout's words.
ON_PAPER = """(() => { const d = (id) => getComputedStyle(document.getElementById(id)).display;
  return { app: d('app'), sheet: d('print-root'), text: document.getElementById('print-root').innerText, printing: document.body.classList.contains('printing') }; })()"""
try:
    for _ in range(50):
        try: socket.create_connection(('127.0.0.1', port), timeout=0.2).close(); break
        except OSError: time.sleep(0.1)
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=CHROME, args=['--no-sandbox'])
        errors = []
        ctx = b.new_context(viewport={'width': 384, 'height': 860}, device_scale_factor=2, service_workers='block')
        page = ctx.new_page()
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'api.github.com' not in m.text and 'ERR_FAILED' not in m.text else None)
        page.route('https://api.github.com/**', lambda r: r.abort())
        page.goto(base + 'manifest.webmanifest'); page.evaluate(PUT, seed)
        page.goto(base + 'index.html#count'); page.wait_for_selector('[data-act="print"][data-kind="count"]')
        page.evaluate(PHONE_PRINT)

        print('\n1. The count sheet, printed the way a phone prints')
        page.click('[data-act="print"][data-kind="count"]'); page.wait_for_selector('[data-act="print-go"]')
        page.click('[data-act="print-go"]')
        page.wait_for_function('window.__printed === 1'); page.wait_for_timeout(200)
        page.emulate_media(media='print')
        now = page.evaluate(ON_PAPER)
        check(now['printing'] and now['app'] == 'none' and now['sheet'] == 'block', 'after print() returns and afterprint has fired, the printout is still what prints, not the app (%s, %s)' % (now['app'], now['sheet']))
        check(all(w in now['text'] for w in ['Item', 'Servery', 'Kitchen', 'To order', 'Paper cups, 12 oz']), 'and it’s the count sheet, with a column per room')
        pdf = page.pdf(print_background=True)
        check(pdf.count(b'/Type /Page') + pdf.count(b'/Type/Page') >= 1 and len(pdf) > 5000, 'a PDF made now has the sheet on it (%d bytes)' % len(pdf))
        page.emulate_media(media='screen')
        check(page.is_visible('#view') and not page.is_visible('#print-root'), 'on screen the app shows as usual meanwhile')

        print('\n2. Back in the app, the first tap or key puts things back')
        page.mouse.click(190, 300); page.wait_for_timeout(100)
        page.emulate_media(media='print')
        now = page.evaluate(ON_PAPER)
        check(not now['printing'] and now['app'] != 'none' and now['sheet'] == 'none' and now['text'] == '', 'a tap takes the printout away; printing now would print the screen (%s, %s)' % (now['app'], now['sheet']))
        page.emulate_media(media='screen')
        page.click('[data-act="print"][data-kind="count"]'); page.wait_for_selector('[data-act="print-go"]'); page.click('[data-act="print-go"]')
        page.wait_for_function('window.__printed === 2'); page.wait_for_timeout(200)
        check(page.evaluate(ON_PAPER)['printing'], '(setup: another printout is waiting)')
        page.keyboard.press('Tab'); page.wait_for_timeout(100)
        check(not page.evaluate(ON_PAPER)['printing'], 'so does a key')

        print('\n3. Paper size')
        # Every page rule, the printed footer's included: [name, size, margin].
        rules = page.evaluate("(() => { const out = []; for (const sh of document.styleSheets) for (const r of sh.cssRules) if (r.constructor.name === 'CSSPageRule') out.push([r.selectorText, r.style.size, r.style.margin]); return out; })()")
        plain = [r for r in rules if not r[0]]
        check(plain and all(r[1] == '' for r in plain) and any(r[2] for r in plain), 'ordinary printouts set margins but no paper size, so the printer’s paper is used (%s)' % plain)
        check(any(r[0] == 'card' and 'letter' in r[1] for r in rules), 'the allergen card still sets Letter on its own pages')
        check(not errors, 'no errors in the browser' + (': ' + ' | '.join(errors[:3]) if errors else ''))
        ctx.close(); b.close()
finally:
    server.terminate()
print('\n%d passed, %d failed' % (passes, fails))
sys.exit(1 if fails else 0)
