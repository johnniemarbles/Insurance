"""Gate C in a real browser: a client's consents and ID, a minor who cannot consent alone, compliance verifying a
guardian's authority (the recorder cannot), consent under that authority, the family summary, and a life event that
opens a review and changes nothing else. Screenshots go to argv[1]."""
import sys
from playwright.sync_api import sync_playwright, expect

OUT = sys.argv[1]
BASE = 'http://127.0.0.1:3100'
errors = []
def open_page(p, who):
    ctx = p.chromium.launch().new_context(viewport={'width': 1360, 'height': 1000}, extra_http_headers={'x-dev-user-email': who})
    ctx.add_init_script("try { localStorage.setItem('pii.page', 'contacts') } catch (e) {}")
    page = ctx.new_page()
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(f'{BASE}/app')
    expect(page.get_by_role('button', name='Raj Singh')).to_be_visible(timeout=20000)
    return page

with sync_playwright() as p:
    page = open_page(p, 'sanjeev@uat.test')
    # Raj: consents in force for all dealings, an ID check, guardian of Aman (waiting for compliance).
    page.get_by_role('button', name='Raj Singh').click()
    panel = page.get_by_role('dialog', name='Raj Singh')
    sec = panel.get_by_role('region', name='Consent and authority')
    expect(sec.get_by_text('Collection and use', exact=True)).to_be_visible(timeout=10000)
    expect(sec.get_by_text('Age of majority in CA-BC: 19 (not yet confirmed by counsel).')).to_be_visible()
    expect(sec.get_by_text('Waiting for compliance')).to_be_visible()
    sec.get_by_text('ID checks').scroll_into_view_if_needed()
    page.screenshot(path=f'{OUT}/14-person-consents.png')
    panel.get_by_role('button', name='Close').click()
    # Aman is 12 in BC: his own consent is refused without a review note; the guardian is not verified yet.
    page.get_by_role('button', name='Aman Singh').click()
    panel = page.get_by_role('dialog', name='Aman Singh')
    sec = panel.get_by_role('region', name='Consent and authority')
    expect(sec.get_by_text('Under the age of majority until', exact=False)).to_be_visible(timeout=10000)
    sec.get_by_role('button', name='Record consent').click()
    sec.get_by_label('Given by').select_option('self')
    sec.get_by_role('button', name='Save').click()
    expect(sec.get_by_role('alert')).to_contain_text('under 19, the age of majority in CA-BC')
    sec.get_by_role('alert').scroll_into_view_if_needed()
    page.screenshot(path=f'{OUT}/15-minor-consent-refused.png')
    # The person who recorded the authority cannot verify it.
    expect(sec.get_by_text('You recorded this, so someone else in compliance verifies it.')).to_be_visible()
    assert sec.get_by_role('button', name='Verify').count() == 0, 'recorder offered Verify'
    page.context.browser.close()

    # Compliance: the queue shows the authority to verify and the coming-of-age review.
    cp = open_page(p, 'compliance@uat.test')
    cp.get_by_role('button', name='Compliance reviews').click()
    q = cp.get_by_role('dialog', name='Compliance reviews')
    tv = q.get_by_role('region', name='Authorities to verify')
    expect(tv.get_by_text('Guardian of a minor')).to_be_visible(timeout=10000)
    expect(q.get_by_text('Navjot Kaur · Coming of age', exact=False)).to_be_visible()
    tv.get_by_label('Decision note').fill('Birth certificate checked against the file')
    cp.screenshot(path=f'{OUT}/16-compliance-queue.png')
    tv.get_by_role('button', name='Verify').click()
    expect(q.get_by_role('region', name='Authorities to verify')).to_have_count(0, timeout=10000)
    cp.context.browser.close()

    # Back as the partner: Raj gives consent for Aman under the verified authority.
    page = open_page(p, 'sanjeev@uat.test')
    page.get_by_role('button', name='Aman Singh').click()
    panel = page.get_by_role('dialog', name='Aman Singh')
    sec = panel.get_by_role('region', name='Consent and authority')
    sec.get_by_role('button', name='Record consent').click()
    sec.get_by_label('Given by').select_option('authority')
    sec.get_by_role('button', name='Save').click()
    expect(sec.get_by_text('Someone with authority: Raj Singh', exact=False)).to_be_visible(timeout=10000)
    expect(sec.get_by_text('Verified', exact=True)).to_be_visible()
    sec.get_by_text('Someone with authority: Raj Singh', exact=False).scroll_into_view_if_needed()
    page.screenshot(path=f'{OUT}/17-consent-under-authority.png')
    panel.get_by_role('button', name='Close').click()
    # The family at a glance.
    page.get_by_label('Group by family').check()
    page.get_by_role('button', name='Singh family').click()
    fam = page.get_by_role('dialog', name='Singh family')
    fc = fam.get_by_role('region', name='Consent and authority')
    expect(fc.get_by_text('Minor')).to_be_visible(timeout=10000)
    fc.scroll_into_view_if_needed()
    page.screenshot(path=f'{OUT}/18-family-compliance.png')
    fam.get_by_role('button', name='Close').click()
    # A life event opens a review and changes nothing else.
    page.get_by_role('button', name='Simran Singh').click()
    panel = page.get_by_role('dialog', name='Simran Singh')
    sec = panel.get_by_role('region', name='Consent and authority')
    sec.get_by_role('button', name='Record life event').click()
    sec.get_by_label('Kind').select_option('separation')
    sec.get_by_role('button', name='Save').click()
    expect(sec.get_by_role('status')).to_contain_text('Review opened:')
    expect(sec.get_by_text('Life event: Separation', exact=False)).to_be_visible()
    sec.get_by_role('status').scroll_into_view_if_needed()
    page.screenshot(path=f'{OUT}/19-life-event-review.png')
    page.context.browser.close()
print('compliance page errors:', errors)
sys.exit(1 if errors else 0)
