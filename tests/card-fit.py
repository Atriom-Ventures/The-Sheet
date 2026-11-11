# The allergen card in a real browser: do the four pages fit on Letter paper with the fonts the app
# ships, does the app say so when one doesn't, and does it print as exactly four sheets?
# Needs Chrome and Playwright for Python. Exits 2 (skipped) when they aren't there. Made-up data only.
import json, os, re, subprocess, sys, socket, time
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
CHROME = next((c for c in ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'] if os.path.exists(c)), None)
try:
    from playwright.sync_api import sync_playwright
except Exception:
    print('skipped: Playwright for Python is not installed'); sys.exit(2)
if not CHROME:
    print('skipped: no Chrome found'); sys.exit(2)

seed = json.loads(subprocess.run(['node', '-e', "import('./tests/lib/fixtures.mjs').then(m => console.log(JSON.stringify(m.fullPhone({ clash: false }))))"], cwd=ROOT, capture_output=True, text=True, check=True).stdout)
long_seed = json.loads(json.dumps(seed))
for i in range(30):
    long_seed['menu']['local']['rows'].append({'id': 'm-extra-%d' % i, 'name': 'Extra Dish %d' % i, 'kind': 'dish', 'meals': ['D'], 'allergens': [{'a': 'egg', 's': 'in'}]})

s = socket.socket(); s.bind(('127.0.0.1', 0)); port = s.getsockname()[1]; s.close()
server = subprocess.Popen([sys.executable, '-m', 'http.server', str(port), '--bind', '127.0.0.1'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
base = 'http://127.0.0.1:%d/' % port
passes = fails = 0
def check(ok, msg):
    global passes, fails
    passes += bool(ok); fails += (not ok)
    print(('  ok   ' if ok else '  FAIL ') + msg)
PUT = """(seed) => new Promise((res, rej) => { const rq = indexedDB.open('multitool', 1); rq.onupgradeneeded = () => rq.result.createObjectStore('kv'); rq.onsuccess = () => { const tx = rq.result.transaction('kv', 'readwrite'); for (const [k, v] of Object.entries(seed)) tx.objectStore('kv').put(v, k); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }; rq.onerror = () => rej(rq.error); })"""
def open_app(browser, data, errors):
    ctx = browser.new_context(viewport={'width': 384, 'height': 860}, device_scale_factor=2, service_workers='block')
    page = ctx.new_page()
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'api.github.com' not in m.text and 'ERR_FAILED' not in m.text and 'favicon' not in m.location.get('url', '') else None)
    page.route('https://api.github.com/**', lambda r: r.abort())
    page.goto(base + 'manifest.webmanifest'); page.evaluate(PUT, data)
    page.goto(base + 'index.html#book/allergens/preview')
    for _ in range(150):  # the app's rules don't allow scripts from strings, so ask from outside until it's ready
        if page.evaluate("document.querySelectorAll('.c3-frame').length === 4 && !/Checking the fit/.test(document.querySelector('#view').textContent)"): break
        page.wait_for_timeout(100)
    return ctx, page
try:
    for _ in range(50):
        try: socket.create_connection(('127.0.0.1', port), timeout=0.2).close(); break
        except OSError: time.sleep(0.1)
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=CHROME, args=['--no-sandbox'])
        errors = []
        print('\n1. The sample card fits')
        ctx, page = open_app(b, seed, errors)
        txt = page.inner_text('#view')
        check(txt.count('Fits on Letter') == 4 and 'Too long' not in txt, 'all four pages say they fit')
        check(page.locator('.c3-frame.over').count() == 0 and page.locator('.banner.warn').count() == 0, 'no warning shown')
        box = page.evaluate("(() => { const f = document.querySelector('.c3-frame'), g = f.querySelector('.c3-page').getBoundingClientRect(), r = f.getBoundingClientRect(); return [Math.round(g.width), Math.round(r.width), Math.round(g.height), Math.round(r.height)]; })()")
        check(abs(box[0] - box[1]) <= 2 and abs(box[2] - box[3]) <= 3, 'each page is shrunk to the width of the phone, whole (%s)' % box)
        fonts = page.evaluate("[...document.fonts].filter(f => f.status === 'loaded').map(f => f.family.replace(/\"/g, '') + ' ' + f.weight)")
        check(all(f in fonts for f in ['Atkinson Hyperlegible 400', 'Atkinson Hyperlegible 700', 'IBM Plex Mono 600', 'Sofia Sans Extra Condensed 800']), 'measured with the fonts that ship with the app')
        # Print it: the pages go to paper as exactly four Letter sheets.
        page.evaluate("import('./js/views/card.js').then(c => { document.querySelector('#print-root').innerHTML = c.printHTML(); document.body.classList.add('printing'); })")
        page.wait_for_timeout(300)
        pdf = page.pdf(prefer_css_page_size=True, print_background=True)
        n = len(re.findall(rb'/Type\s*/Page(?![s\w])', pdf)); media = re.search(rb'/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)', pdf)
        check(n == 4, 'prints as 4 sheets, one per page (got %d)' % n)
        check(bool(media) and abs(float(media.group(1)) - 612) < 1 and abs(float(media.group(2)) - 792) < 1, 'on Letter paper')
        # The pages are drawn edge to edge at full Letter size, so the printed sheet must add no margin of its own.
        rule = page.evaluate("(() => { for (const sh of document.styleSheets) for (const r of sh.cssRules) if (r.constructor.name === 'CSSPageRule' && r.selectorText === 'card') return [r.style.margin, r.style.size]; return null; })()")
        check(rule is not None and rule[0] in ('0px', '0') and 'letter' in rule[1], 'with no margin added by the print rule (%s)' % rule)
        top = page.evaluate("(() => { const m = matchMedia('print'); const pg = document.querySelector('#print-root .c3-page'); const cs = getComputedStyle(pg); return [cs.width, cs.height]; })()")
        check(top == ['816px', '1056px'], 'each page is laid out at full Letter size (%s)' % top)
        ctx.close()

        print('\n2. A card that has grown too long says so')
        ctx, page = open_app(b, long_seed, errors)
        txt = page.inner_text('#view')
        check('Too long for the sheet' in txt and page.locator('.c3-frame.over').count() >= 1, 'the page that overflows is marked')
        check(page.locator('.banner.warn').count() == 1 and 'Lunch and dinner' in page.inner_text('.banner.warn') and 'cut off' in page.inner_text('.banner.warn'), 'a warning names the page and says the bottom would be cut off')
        check(txt.count('Fits on Letter') >= 2, 'pages that still fit say so')
        page.click('button[data-act="print"][data-kind="card3"]'); page.wait_for_selector('#sheet-root .sheet')
        check('Won’t fit' in page.inner_text('#sheet-root') and 'draft' in page.inner_text('#sheet-root'), 'the print sheet warns before printing, and says it prints as a draft')
        page.goto(base + 'index.html#book/allergens'); page.wait_for_selector('.c3-state')
        check(page.locator('.banner.warn').count() == 1, 'the card screen shows the warning too')
        ctx.close()
        check(not errors, 'no errors in the browser' + (': ' + ' | '.join(errors[:3]) if errors else ''))
        b.close()
finally:
    server.terminate()
print('\n%d passed, %d failed' % (passes, fails))
sys.exit(1 if fails else 0)
