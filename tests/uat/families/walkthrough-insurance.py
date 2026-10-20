"""Gate B in a real browser: family totals counted once, the coverage grid, recording a gap with its evidence,
fixing beneficiary shares on a policy, and the queue of policies missing people. Screenshots go to argv[1]."""
import sys
from playwright.sync_api import sync_playwright, expect

OUT = sys.argv[1]
BASE = 'http://127.0.0.1:3100'
errors = []
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1360, 'height': 1000}, extra_http_headers={'x-dev-user-email': 'sanjeev@uat.test'})
    ctx.add_init_script("try { localStorage.setItem('pii.page', 'contacts') } catch (e) {}")
    page = ctx.new_page()
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(f'{BASE}/app')
    expect(page.get_by_role('button', name='Raj Singh')).to_be_visible(timeout=20000)
    page.get_by_label('Group by family').check()
    page.get_by_role('button', name='Singh family').click()
    fam = page.get_by_role('dialog', name='Singh family')
    ins = fam.get_by_role('region', name='Insurance')
    # Life $1,200 + Health $2,400 (three family members on it, counted once). Lapsed critical illness not added.
    expect(ins.get_by_text('$3,600.00')).to_be_visible(timeout=10000)
    expect(ins.get_by_text('2 in force')).to_be_visible()
    expect(ins.get_by_text('Named as beneficiary on')).to_be_visible()
    ins.scroll_into_view_if_needed()
    page.screenshot(path=f'{OUT}/10-family-insurance.png', full_page=False)
    # Coverage grid: Raj's life is covered (from his policy); everything else unknown, never a gap by default.
    expect(ins.get_by_role('button', name='Raj Singh, Life: Covered')).to_be_visible()
    expect(ins.get_by_role('button', name='Simran Singh, Life: Unknown')).to_be_visible()
    ins.get_by_role('button', name='Raj Singh, Disability: Unknown').click()
    ins.get_by_label('State').select_option('potential_gap')
    ins.get_by_label('Signed needs analysis').select_option(label='Needs analysis, October 2026')
    ins.get_by_role('button', name='Save').click()
    expect(ins.get_by_role('button', name='Raj Singh, Disability: Potential gap')).to_be_visible()
    ins.get_by_role('button', name='Raj Singh, Disability: Potential gap').scroll_into_view_if_needed()
    page.screenshot(path=f'{OUT}/11-coverage-grid.png')
    # Who is on the life policy: shares checked per group.
    ins.get_by_role('button', name='iA Financial Group (Industrial Alliance) · Term life 20').click()
    expect(ins.get_by_text('Ready to submit')).to_be_visible()
    ins.get_by_role('button', name='Add a person').click()
    ins.get_by_label('Role').select_option('beneficiary')
    ins.get_by_label('Client').select_option(label='Simran Singh')
    ins.get_by_label('Class').select_option('contingent')
    ins.get_by_label('Share (%)').fill('50')
    ins.get_by_role('button', name='Add', exact=True).click()
    expect(ins.get_by_text('Not ready to submit')).to_be_visible()
    expect(ins.get_by_text("The contingent beneficiaries' shares total 50%")).to_be_visible()
    page.screenshot(path=f'{OUT}/12-policy-people-check.png')
    ins.get_by_role('button', name='← Back').click()
    fam.get_by_role('button', name='Close').click()
    # The queue: the travel policy has nobody on it.
    page.get_by_role('button', name='Policies missing people').click()
    q = page.get_by_role('dialog', name='Policies missing people')
    expect(q.get_by_text('Travel annual')).to_be_visible()
    expect(q.get_by_text('Missing: Owner, Insured')).to_be_visible()
    page.screenshot(path=f'{OUT}/13-missing-people-queue.png')
    b.close()
print('insurance page errors:', errors)
sys.exit(1 if errors else 0)
