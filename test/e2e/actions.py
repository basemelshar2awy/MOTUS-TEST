"""Browser end-to-end of real UI actions (forms -> server -> database -> UI), forced password change,
role restrictions in the UI and super-admin company creation.
Usage: actions.py BASE ADMIN_EMAIL ADMIN_PW ROOT_EMAIL ROOT_PW"""
import sys, re
from playwright.sync_api import sync_playwright, expect

base, a_email, a_pw, r_email, r_pw = sys.argv[1:6]
errors = []
fails = []

def check(name, cond, extra=''):
    print(('PASS ' if cond else 'FAIL ') + name + (' ' + str(extra) if (extra and not cond) else ''))
    if not cond:
        fails.append(name)

def login(page, email, pw):
    page.goto(base + '/')
    page.wait_for_selector('#login-form')
    page.fill('#login-form input[type=email]', email)
    page.fill('#login-form input[type=password]', pw)
    page.click('#login-form button[type=submit]')

with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_context(viewport={'width': 1366, 'height': 900}, locale='en-US').new_page()
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if (m.type == 'error' and '401' not in m.text and '409' not in m.text and '403' not in m.text) else None)
    page.add_init_script("localStorage.setItem('motus.lang','en')")

    # --- admin creates a vehicle through the form
    login(page, a_email, a_pw)
    page.wait_for_selector('[data-nav]')
    page.evaluate("location.hash='#vehicles'")
    page.wait_for_selector('[data-act="add-vehicle"]')
    page.click('[data-act="add-vehicle"]')
    page.wait_for_selector('#mf')
    # submit empty -> field-level error, nothing saved
    page.click('[data-act="mf-submit"]')
    page.wait_for_selector('#mf .field.err, .toast')
    check('empty vehicle form shows validation, stays open', page.query_selector('#mf') is not None)
    form_fields = page.eval_on_selector_all('#mf [data-f]', 'els => els.map(e => e.dataset.f)')
    def setf(name, val):
        el = page.query_selector(f'#mf [data-f="{name}"]')
        if el: el.fill(val)
    setf('plate', 'UI 5555'); setf('purchasePrice', '1500000'); setf('purchaseDate', '2025-02-01'); setf('make', 'Isuzu'); setf('model', 'NPR')
    setf('licenseExpiry', '2031-01-01'); setf('insuranceExpiry', '2031-01-01'); setf('odometer', '100')
    page.click('[data-act="mf-submit"]')
    page.wait_for_url(re.compile(r'#vehicle\.'), timeout=10000)
    check('vehicle saved and its page opened', 'UI 5555' in page.inner_text('main'), form_fields)
    # reload: persisted in the database
    page.reload(); page.wait_for_selector('[data-nav]')
    page.evaluate("location.hash='#vehicles'"); page.wait_for_timeout(500)
    check('vehicle still there after page reload', 'UI 5555' in page.inner_text('main'))

    # --- admin creates a user; the new user is forced to change password
    page.evaluate("location.hash='#users'"); page.wait_for_selector('[data-act="user-new"]')
    page.click('[data-act="user-new"]'); page.wait_for_selector('#mf')
    page.fill('#mf [data-f="email"]', 'viewer@demo.test'); page.fill('#mf [data-f="name"]', 'View Only')
    page.select_option('#mf [data-f="role"]', 'viewer')
    page.click('[data-act="mf-submit"]')
    page.wait_for_selector('.secret-row code')
    temp = page.query_selector_all('.secret-row code')[-1].inner_text().strip()
    check('temporary password shown once', len(temp) >= 12)
    page.click('.modal-foot [data-act="close-overlay"], .modal [data-act="close-overlay"]')
    page.click('[data-act="user-menu"]'); page.wait_for_selector('[data-act="logout"]'); page.click('[data-act="logout"]')

    page.wait_for_selector('#login-form')
    login(page, 'viewer@demo.test', temp)
    page.wait_for_selector('#pw-form')
    check('forced password change screen appears', page.query_selector('[data-nav]') is None)
    new_pw = 'Zebra-Quartz-2026!'
    page.fill('#pw-cur', temp); page.fill('#pw-new', new_pw); page.fill('#pw-new2', new_pw)
    page.click('#pw-btn')
    page.wait_for_selector('[data-nav]', timeout=15000)
    page.evaluate("location.hash='#vehicles'"); page.wait_for_timeout(600)
    btn = page.query_selector('[data-act="add-vehicle"]')
    if btn and btn.is_visible():
        btn.click(); page.wait_for_timeout(500)
    check('viewer cannot open the add-vehicle form', page.query_selector('#mf') is None)
    page.evaluate("location.hash='#users'"); page.wait_for_timeout(600)
    check('viewer is kept out of user administration', 'New user' not in page.inner_text('main'))
    page.click('[data-act="user-menu"]'); page.wait_for_selector('[data-act="logout"]'); page.click('[data-act="logout"]')

    # --- super admin creates a company from the platform page
    page.wait_for_selector('#login-form')
    login(page, r_email, r_pw)
    page.wait_for_selector('[data-nav]')
    page.evaluate("location.hash='#platform'"); page.wait_for_selector('[data-act="co-new"]')
    page.click('[data-act="co-new"]'); page.wait_for_selector('#mf')
    for k, v in (('code', 'UIT'), ('nameAr', 'شركة تجريبية'), ('nameEn', 'UI Test Co'), ('adminEmail', 'boss@uit.test'), ('adminName', 'Boss')):
        page.fill(f'#mf [data-f="{k}"]', v)
    page.click('[data-act="mf-submit"]')
    page.wait_for_selector('.secret-row code', timeout=15000)
    check('company created with a one-time admin password', 'UIT' in page.inner_text('.modal, #overlay'))
    b.close()

check('no JavaScript errors during the session', not errors, errors[:3])
print(f"{len(fails)} failed")
sys.exit(1 if fails else 0)
