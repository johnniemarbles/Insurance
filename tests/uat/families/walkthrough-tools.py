"""Gate D in a real browser: one email per family with each person's facts, the send waiting in Mail merges, the import
dry run (problems listed, nothing written) then the import, the family timeline, the Families page, and the
extension's conversation panel showing the family and a suggestion added by hand. Screenshots go to argv[1]."""
import os, sys, tempfile
from playwright.sync_api import sync_playwright, expect

OUT, HARNESS = sys.argv[1], sys.argv[2]
BASE = 'http://127.0.0.1:3100'
errors = []
tmp = tempfile.mkdtemp()
bad = os.path.join(tmp, 'families-bad.csv'); good = os.path.join(tmp, 'families.csv')
open(bad, 'w').write('family,role,full_name,email,date_of_birth\nDhillon family,head,Manpreet Dhillon,manpreet@example.com,1979-05-01\nDhillon family,head,Kiran Dhillon,kiran@example.com,1981-13-01\nBrar family,child,Raj Singh,,\n')
open(good, 'w').write('family,role,full_name,email,date_of_birth\nDhillon family,head,Manpreet Dhillon,manpreet@example.com,1979-05-01\nDhillon family,spouse,Kiran Dhillon,kiran@example.com,1981-03-01\n')

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1360, 'height': 1000}, extra_http_headers={'x-dev-user-email': 'sanjeev@uat.test'})
    ctx.add_init_script("try { localStorage.setItem('pii.page', 'contacts') } catch (e) {}")
    page = ctx.new_page()
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(f'{BASE}/app')
    expect(page.get_by_role('button', name='Raj Singh')).to_be_visible(timeout=20000)
    # One email per family.
    page.get_by_role('button', name='Email families').click()
    d = page.get_by_role('dialog', name='Email families')
    d.get_by_label('Singh family', exact=False).check()
    expect(d.get_by_role('status')).to_contain_text('1 person in 1 family', timeout=10000)
    pv = d.get_by_role('region', name='Preview')
    expect(pv).to_contain_text('Raj Singh', timeout=10000)
    expect(pv).to_contain_text('Term life 20')
    expect(pv).not_to_contain_text('Critical illness')  # Simran's policy never appears in Raj's message
    pv.scroll_into_view_if_needed()
    page.screenshot(path=f'{OUT}/20-family-email-preview.png')
    d.get_by_role('button', name='Create the send').click()
    expect(page.get_by_role('dialog', name='Mail merge').get_by_text('Your annual review', exact=True)).to_be_visible(timeout=10000)
    page.screenshot(path=f'{OUT}/21-family-send-in-mail-merges.png')
    page.keyboard.press('Escape')
    page.goto(f'{BASE}/app')
    expect(page.get_by_role('button', name='Raj Singh')).to_be_visible(timeout=20000)
    # Import: problems first, nothing written; then the fixed file.
    page.get_by_role('button', name='Import families').click()
    d = page.get_by_role('dialog', name='Import families')
    d.get_by_label('CSV file').set_input_files(bad)
    d.get_by_role('button', name='Check the file').click()
    st = d.get_by_role('status')
    expect(st).to_contain_text('3 rows', timeout=10000)
    expect(st).to_contain_text('A new family needs exactly one Head (found 2)')
    expect(st).to_contain_text('A client named "Raj Singh" already exists')
    expect(d.get_by_role('button', name='Import', exact=True)).to_be_disabled()
    page.screenshot(path=f'{OUT}/22-import-dry-run.png')
    d.get_by_label('CSV file').set_input_files(good)
    d.get_by_role('button', name='Check the file').click()
    expect(st).to_contain_text('no problems', timeout=10000)
    d.get_by_role('button', name='Import', exact=True).click()
    expect(st).to_contain_text('Imported.', timeout=10000)
    page.screenshot(path=f'{OUT}/23-import-done.png')
    d.get_by_role('button', name='Close').click()
    expect(page.get_by_role('button', name='Manpreet Dhillon')).to_be_visible(timeout=10000)
    # The family timeline.
    page.get_by_label('Group by family').check()
    page.get_by_role('button', name='Singh family').click()
    fam = page.get_by_role('dialog', name='Singh family')
    tl = fam.get_by_role('region', name='Timeline')
    tl.get_by_role('button', name='Show timeline', exact=False).click()
    expect(tl.get_by_text('Added to a policy').first).to_be_visible(timeout=10000)
    tl.scroll_into_view_if_needed()
    page.screenshot(path=f'{OUT}/24-family-timeline.png')
    ctx.close()

    # The Families page: grouped by family from the start.
    ctx = b.new_context(viewport={'width': 1360, 'height': 900}, extra_http_headers={'x-dev-user-email': 'sanjeev@uat.test'})
    ctx.add_init_script("try { localStorage.setItem('pii.page', 'families') } catch (e) {}")
    page = ctx.new_page()
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(f'{BASE}/app')
    expect(page.get_by_role('button', name='Dhillon family')).to_be_visible(timeout=20000)
    expect(page.get_by_label('Group by family')).to_be_checked()
    ctx.close()

    # The extension's conversation panel (the real side-panel code on a test page): family and a suggestion.
    ctx = b.new_context(viewport={'width': 420, 'height': 900}, extra_http_headers={'x-dev-user-email': 'sanjeev@uat.test'})
    page = ctx.new_page()
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.route(f'{BASE}/__harness', lambda r: r.fulfill(status=200, content_type='text/html', body='<!doctype html><html><body></body></html>'))
    page.goto(f'{BASE}/__harness#from=raj.singh@example.com&to=gurdeep.singh@example.com')
    page.add_script_tag(path=HARNESS)
    panel = page.locator('#panel')
    expect(panel.get_by_text('Family: Singh family')).to_be_visible(timeout=15000)
    expect(panel.get_by_text('Add Gurdeep Singh to Singh family?')).to_be_visible()
    expect(panel.get_by_text('In this conversation · Same last name')).to_be_visible()
    page.screenshot(path=f'{OUT}/25-gmail-family-strip.png')
    panel.get_by_role('button', name='Add', exact=True).click()
    expect(panel.get_by_text('Gurdeep Singh added to Singh family.')).to_be_visible(timeout=10000)
    page.screenshot(path=f'{OUT}/26-gmail-strip-added.png')
    b.close()
print('tools page errors:', errors)
sys.exit(1 if errors else 0)
