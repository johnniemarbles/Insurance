"""Conduct flags: compliance sees the flags and reasons, records a decision, logs and resolves a complaint."""
import sys
from playwright.sync_api import sync_playwright, expect
OUT = sys.argv[1]; BASE = 'http://127.0.0.1:3107'; errors = []
def ctx_for(b, who, page_name, h=1700):
    ctx = b.new_context(viewport={'width': 1360, 'height': h}, extra_http_headers={'x-dev-user-email': who})
    ctx.add_init_script(f"try {{ localStorage.setItem('pii.page', '{page_name}') }} catch (e) {{}}")
    page = ctx.new_page(); page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(f'{BASE}/app')
    return ctx, page
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx, page = ctx_for(b, 'priya@uat.test', 'compliance', 1900)
    cf = page.get_by_role('region', name='Conduct risk flags')
    expect(cf).to_contain_text('Replacement churn', timeout=20000)
    for t in ['3 of 4 recommendations in the last 12 months replaced existing cover (75%)', '2 of 5 policies issued lapsed or were cancelled within 24 months (40%)', 'On 3 policies that started in the last 24 months', 'is 27% of household income']:
        expect(cf).to_contain_text(t)
    cf.scroll_into_view_if_needed()
    page.screenshot(path=f'{OUT}/1-flags.png')
    cf.get_by_label('What you found (at least 10 characters): Replacement churn Harpreet Kaur Sandhu').fill('All three replacements had signed disclosures and clear client benefit. No concern.')
    cf.locator('.ev', has_text='Replacement churn').get_by_role('button', name='No concern').click()
    expect(cf).not_to_contain_text('Replacement churn', timeout=10000)
    expect(cf).to_contain_text('Conduct risk flags (3)')  # four flags, one decided
    ctx.close()
    ctx, page = ctx_for(b, 'priya@uat.test', 'pipelines', 1500)
    page.get_by_text('Singh life review').first.click(timeout=20000)
    page.get_by_role('tab', name='Files').click()
    cc = page.get_by_role('region', name='Complaints')
    cc.get_by_label('How').select_option('regulator')
    cc.get_by_label('About').select_option('premium')
    cc.get_by_label('What the client says (at least 10 characters)').fill('Client told FSRA the premium was not explained before signing.')
    cc.get_by_role('button', name='Log complaint').click()
    expect(cc).to_contain_text('Open: Premium', timeout=10000)
    cc.get_by_label('Outcome (at least 10 characters)').fill('Premium walked through again with the client; client satisfied. FSRA informed.')
    cc.scroll_into_view_if_needed()
    page.screenshot(path=f'{OUT}/2-complaint.png')
    cc.get_by_role('button', name='Resolve').click()
    expect(cc).to_contain_text('Resolved: Premium', timeout=10000)
    b.close()
print('conduct page errors:', errors); sys.exit(1 if errors else 0)
