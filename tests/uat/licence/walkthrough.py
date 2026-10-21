"""Licence checks: compliance uploads the saved register page, PII reads and compares it, compliance records the check."""
import sys
from playwright.sync_api import sync_playwright, expect
OUT = sys.argv[1]; FILES = sys.argv[2]; BASE = 'http://127.0.0.1:3105'; errors = []
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1360, 'height': 1500}, extra_http_headers={'x-dev-user-email': 'priya@uat.test'})
    ctx.add_init_script("try { localStorage.setItem('pii.page', 'compliance') } catch (e) {}")
    page = ctx.new_page(); page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(f'{BASE}/app')
    lc = page.get_by_role('region', name='Licence checks')
    expect(lc).to_contain_text('Harpreet Kaur Sandhu', timeout=20000)
    expect(lc).to_contain_text('Never checked')
    lc.scroll_into_view_if_needed()
    page.screenshot(path=f'{OUT}/1-due.png')
    lc.get_by_role('button', name='Check').click()
    lc.get_by_label('Saved register result (PDF, PNG or JPEG)').set_input_files(f'{FILES}/register.png')
    lc.get_by_role('button', name='Read it').click()
    expect(lc).to_contain_text('SANDHU, HARPREET KAUR', timeout=20000)
    expect(lc).to_contain_text('✓ Name matches the file')
    lc.scroll_into_view_if_needed()
    page.screenshot(path=f'{OUT}/2-read.png')
    lc.get_by_role('button', name='Record the check').click()
    expect(lc.get_by_role('status')).to_contain_text('Check recorded.', timeout=10000)
    expect(lc).to_contain_text('Last check')
    lc.scroll_into_view_if_needed()
    page.screenshot(path=f'{OUT}/3-recorded.png')
    b.close()
print('licence page errors:', errors); sys.exit(1 if errors else 0)
