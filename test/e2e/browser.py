"""Browser end-to-end check with real Chromium: sign in, open every page in Arabic and English,
fail on JavaScript errors / failed requests / pages that render nothing.
Usage: browser.py BASE EMAIL PASSWORD [shots_dir]"""
import sys
from playwright.sync_api import sync_playwright

base, email, pw = sys.argv[1:4]
shots = sys.argv[4] if len(sys.argv) > 4 else None
ROUTES = ("dashboard alerts vehicles drivers fuel oil workorders tires bookings programs trips calendar dispatch "
          "readiness inspections availability subcontract incidents handover documents driverapp clients invoices "
          "payments expenses journal items stock movements purchasing suppliers counts livemap history geofences "
          "behavior devices reports copilot assign profit fuelai maintai pricing docai invai reconai insights "
          "company users vtypes coa erp providers reconcile api audit aisettings contracts lines mytrips").split()
errors = []

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1366, 'height': 900}, locale='en-US')
    page = ctx.new_page()
    page.on('pageerror', lambda e: errors.append(('pageerror', page.url, str(e))))
    page.on('console', lambda m: errors.append(('console', page.url, m.text)) if (m.type == 'error' and '401' not in m.text) else None)
    page.on('response', lambda r: errors.append(('http', r.url, r.status)) if (r.status >= 500 or (r.status >= 400 and '/api/' in r.url and r.status not in (401,))) else None)
    page.goto(base + '/')
    page.wait_for_selector('#login-form')
    if shots:
        page.screenshot(path=f'{shots}/00-login.png')
    page.fill('#lg-email', email)
    page.fill('#login-form input[type=password]', 'wrong-password')
    page.click('#login-form button[type=submit]')
    page.wait_for_selector('.form-error')
    login_err = [e for e in errors]  # the 401 on a wrong password is expected and filtered above
    page.wait_for_timeout(500); page.fill('#lg-email', email); page.fill('#login-form input[type=password]', pw)
    page.click('#login-form button[type=submit]')
    page.wait_for_selector('[data-nav]', timeout=15000)
    results = []
    for lang in ('ar', 'en'):
        page.evaluate(f"localStorage.setItem('motus.lang','{lang}')")
        page.reload()
        page.wait_for_selector('[data-nav]')
        for r in ROUTES:
            n0 = len(errors)
            page.evaluate(f"location.hash='#{r}'")
            page.wait_for_timeout(300)
            sel = '#view' if page.query_selector('#view') else 'main'
            txt = page.inner_text(sel)
            bad = len(txt.strip()) < 20 or 'MISSING' in txt or 'undefined' in txt or 'NaN' in txt or '[object' in txt
            results.append((lang, r, len(txt), bad, errors[n0:]))
            if shots and ((lang == 'en' and r in ('dashboard', 'vehicles', 'bookings', 'invoices', 'livemap', 'reports', 'users')) or (lang == 'ar' and r in ('dashboard', 'trips'))):
                page.screenshot(path=f'{shots}/{lang}-{r}.png')
    b.close()

bad = [r for r in results if r[3] or r[4]]
for lang, r, n, isbad, errs in bad:
    print('PROBLEM', lang, r, n, errs[:2] if errs else 'bad content')
print(f'{len(results)} page views checked, {len(bad)} with problems; {len(errors)} browser errors total')
for e in errors[:15]:
    print(' ', e)
sys.exit(1 if bad or errors else 0)
