"""Real-browser check of the Gate A family screens against the local server. Saves screenshots and fails loudly."""
import sys
from playwright.sync_api import sync_playwright, expect

OUT = sys.argv[1]
BASE = 'http://127.0.0.1:3100'
errors = []

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1360, 'height': 900}, extra_http_headers={'x-dev-user-email': 'sanjeev@uat.test'})
    ctx.add_init_script("try { localStorage.setItem('pii.page', 'contacts') } catch (e) {}")
    page = ctx.new_page()
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(f'{BASE}/app')
    expect(page.get_by_role('button', name='Raj Singh')).to_be_visible(timeout=20000)
    page.screenshot(path=f'{OUT}/1-contacts.png')

    page.get_by_label('Group by family').check()
    expect(page.get_by_role('button', name='Singh family')).to_be_visible()
    expect(page.get_by_text('2 families')).to_be_visible()
    page.screenshot(path=f'{OUT}/2-grouped.png')

    page.get_by_role('button', name='Raj Singh').click()
    dlg = page.get_by_role('dialog', name='Raj Singh')
    expect(dlg.get_by_label('Role: Simran Singh')).to_have_value('spouse_partner')
    expect(dlg.get_by_text('12 yrs').or_(dlg.get_by_text('11 yrs'))).to_be_visible()
    page.screenshot(path=f'{OUT}/3-client-family-card.png')

    dlg.get_by_role('button', name='Open family').click()
    fam = page.get_by_role('dialog', name='Singh family')
    expect(fam.get_by_text('12 King George Blvd, Surrey BC')).to_be_visible()
    expect(fam.get_by_text('gives no authority')).to_be_visible()
    page.screenshot(path=f'{OUT}/4-family-panel.png')

    # Change Head to Simran in the real UI, then put Raj back.
    fam.get_by_role('button', name='Make Head').first.click()
    expect(fam.get_by_label('The current Head becomes')).to_have_value('spouse_partner')
    page.screenshot(path=f'{OUT}/5-change-head-confirm.png')
    fam.get_by_role('button', name='Confirm').click()
    expect(fam.get_by_text('Head: Simran Singh')).to_be_visible()
    expect(fam.get_by_label('Role: Raj Singh')).to_have_value('spouse_partner')
    fam.get_by_role('button', name='Make Head').first.click()
    fam.get_by_role('button', name='Confirm').click()
    expect(fam.get_by_text('Head: Raj Singh')).to_be_visible()
    expect(fam.get_by_label('Role: Simran Singh')).to_have_value('spouse_partner')

    # Add a member through the picker.
    fam.get_by_role('button', name='Add a member').click()
    fam.get_by_label('Find a client by name or email').fill('Harjit')
    fam.get_by_role('button', name='Harjit Singh').click()
    expect(fam.get_by_text('4 members')).to_be_visible()
    expect(fam.get_by_label('Role: Harjit Singh')).to_have_value('other')
    page.screenshot(path=f'{OUT}/6-member-added.png')
    fam.get_by_role('button', name='Close').click()

    # A client with no family: shown as a family of one, nothing created.
    page.get_by_label('Group by family').uncheck()
    page.get_by_role('button', name='Priya Sharma').click()
    solo = page.get_by_role('dialog', name='Priya Sharma')
    expect(solo.get_by_text('family of one')).to_be_visible()
    page.screenshot(path=f'{OUT}/7-family-of-one.png')
    solo.get_by_role('button', name='Close').click()

    # French: the user's own language setting drives the labels.
    r = page.request.put(f'{BASE}/v1/me/locale', data={'locale': 'fr-CA'})
    assert r.status in (200, 204), r.status
    page.reload()
    expect(page.get_by_label('Regrouper par famille')).to_be_visible(timeout=20000)
    page.get_by_label('Regrouper par famille').check()
    page.get_by_role('button', name='Raj Singh').click()
    frd = page.get_by_role('dialog', name='Raj Singh')
    expect(frd.get_by_text('Chef de famille').first).to_be_visible()
    expect(frd.get_by_role('button', name='Ajouter un membre')).to_be_visible()
    page.screenshot(path=f'{OUT}/8-french.png')
    page.request.put(f'{BASE}/v1/me/locale', data={'locale': 'en'})
    b.close()

print('page errors:', errors)
sys.exit(1 if errors else 0)
