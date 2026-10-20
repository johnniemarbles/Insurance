"""With FAMILIES_ENABLED off, the Contacts page must look exactly as before: no family controls, rows not clickable."""
import sys
from playwright.sync_api import sync_playwright, expect
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1360, 'height': 900}, extra_http_headers={'x-dev-user-email': 'sanjeev@uat.test'})
    ctx.add_init_script("try { localStorage.setItem('pii.page', 'contacts') } catch (e) {}")
    page = ctx.new_page()
    errs = []
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.goto('http://127.0.0.1:3100/app')
    expect(page.get_by_text('Raj Singh')).to_be_visible(timeout=20000)
    page.wait_for_timeout(1500)
    assert page.get_by_label('Group by family').count() == 0, 'group toggle visible while off'
    assert page.get_by_role('button', name='Raj Singh').count() == 0, 'rows clickable while off'
    page.screenshot(path=sys.argv[1] + '/9-switched-off.png')
    b.close()
    print('off check ok, page errors:', errs)
    sys.exit(1 if errs else 0)
