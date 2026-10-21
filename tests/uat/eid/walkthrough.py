"""Electronic ID: the company setting, PII's own check (photos, results, confirm), a Stripe Identity link the client
finishes on the stand-in page, and compliance deciding the mismatch."""
import sys, re
from playwright.sync_api import sync_playwright, expect
OUT = sys.argv[1]; PHOTOS = sys.argv[2]; BASE = 'http://127.0.0.1:3101'; errors = []
H = {'x-dev-user-email': 'sanjeev@uat.test'}
def open_deal(b, height=1300):
    ctx = b.new_context(viewport={'width': 1360, 'height': height}, extra_http_headers=H)
    ctx.add_init_script("try { localStorage.setItem('pii.page', 'pipelines') } catch (e) {}")
    page = ctx.new_page(); page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(f'{BASE}/app')
    page.get_by_text('Singh life review').first.click(timeout=20000)
    page.get_by_role('tab', name='ID & AML').click()
    return ctx, page
with sync_playwright() as p:
    b = p.chromium.launch()
    # 1. The company chooses its routes.
    ctx = b.new_context(viewport={'width': 1360, 'height': 1000}, extra_http_headers=H)
    ctx.add_init_script("try { localStorage.setItem('pii.page', 'settings') } catch (e) {}")
    page = ctx.new_page(); page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(f'{BASE}/app')
    page.get_by_role('tab', name='Advanced').click(timeout=20000)
    card = page.get_by_role('region', name='Electronic ID')
    card.get_by_text('Stripe Identity (the client uses a link').click()
    card.get_by_text('PII\'s own check (an advisor uploads').click()
    card.get_by_role('button', name='Save').click()
    expect(card.get_by_role('status')).to_have_text('Saved')
    card.scroll_into_view_if_needed()
    page.screenshot(path=f'{OUT}/1-eid-settings.png')
    ctx.close()
    # 2. PII's own check: photos, what it found, the advisor confirms.
    ctx, page = open_deal(b)
    eid = page.get_by_role('region', name='Electronic ID check')
    eid.get_by_role('button', name='Check photos here').click()
    eid.get_by_label('Front of the driver\'s licence').set_input_files(f'{PHOTOS}/licence.png')
    eid.get_by_label('Selfie of the client').set_input_files(f'{PHOTOS}/selfie.png')
    eid.get_by_text('The client agreed to this ID check').click()
    eid.get_by_role('button', name='Read the licence').click()
    expect(eid.get_by_text('Everything matches.')).to_be_visible(timeout=20000)
    expect(eid).to_contain_text('RAJ KUMAR SINGH')
    page.screenshot(path=f'{OUT}/2-own-check-result.png')
    eid.get_by_text('I looked at the licence and the selfie').click()
    eid.get_by_role('button', name='Confirm').click()
    expect(eid).to_contain_text('Raj Singh: Verified', timeout=10000)
    expect(page.get_by_text('Electronic check (licence and selfie)').first).to_be_visible()
    page.screenshot(path=f'{OUT}/3-own-check-verified.png')
    # 3. A Stripe Identity link; the client finishes it (stand-in page) with a different birth date.
    eid.get_by_role('button', name='Send a Stripe Identity link').click()
    link = eid.get_by_label('Stripe Identity link')
    expect(link).to_have_value(re.compile(r'/dev/stripe-identity/vs_fake'))
    page.screenshot(path=f'{OUT}/4-stripe-link.png')
    client = ctx.new_page(); client.goto(link.input_value())
    client.get_by_role('button', name='Different birth date').click()
    expect(client.get_by_text('Thank you')).to_be_visible()
    client.close()
    ctx.close()
    # 4. Compliance decides the mismatch.
    ctx, page = open_deal(b)
    eid = page.get_by_role('region', name='Electronic ID check')
    expect(eid).to_contain_text('Raj Singh: Waiting for compliance', timeout=20000)
    expect(eid).to_contain_text('Birth date differs from the file')
    eid.get_by_label('Decision note').fill('Birth date on the licence differs from the file. Ask for a passport.')
    page.screenshot(path=f'{OUT}/5-compliance-review.png')
    eid.get_by_role('button', name='Reject').click()
    expect(eid).to_contain_text('Raj Singh: Failed', timeout=10000)
    expect(eid).to_contain_text('Stripe\'s copy deleted')
    b.close()
print('eid page errors:', errors); sys.exit(1 if errors else 0)
