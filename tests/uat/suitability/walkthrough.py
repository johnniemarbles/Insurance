"""Suitability: the advisor runs the check and asks compliance; compliance clears it; the deal moves to Submitted."""
import sys
from playwright.sync_api import sync_playwright, expect
OUT = sys.argv[1]; BASE = 'http://127.0.0.1:3102'; errors = []
def open_deal(b, who, tab='Advice'):
    ctx = b.new_context(viewport={'width': 1360, 'height': 1400}, extra_http_headers={'x-dev-user-email': who})
    ctx.add_init_script("try { localStorage.setItem('pii.page', 'pipelines') } catch (e) {}")
    page = ctx.new_page(); page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(f'{BASE}/app')
    page.get_by_text('Singh life review').first.click(timeout=20000)
    page.get_by_role('tab', name=tab).click()
    return ctx, page
with sync_playwright() as p:
    b = p.chromium.launch()
    # 1. The advisor runs the check.
    ctx, page = open_deal(b, 'sanjeev@uat.test')
    su = page.get_by_role('region', name='Suitability check')
    su.get_by_role('button', name='Run the check').click()
    expect(su).to_contain_text('Waiting for your decision', timeout=20000)
    expect(su).to_contain_text('below the uncovered need')
    expect(su).to_contain_text('Education is one of the client')
    su.scroll_into_view_if_needed()
    page.screenshot(path=f'{OUT}/1-suitability-findings.png')
    su.get_by_label('Your reason').fill('Client wants to start at 500,000 and review next year; please check.')
    su.get_by_role('button', name='Ask compliance').click()
    expect(su).to_contain_text('With compliance')
    ctx.close()
    # 2. Compliance clears it from their queue.
    ctx = b.new_context(viewport={'width': 1360, 'height': 1300}, extra_http_headers={'x-dev-user-email': 'priya@uat.test'})
    ctx.add_init_script("try { localStorage.setItem('pii.page', 'compliance') } catch (e) {}")
    page = ctx.new_page(); page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(f'{BASE}/app')
    q = page.get_by_role('region', name='Suitability reviews')
    expect(q).to_contain_text('Singh life review', timeout=20000)
    q.get_by_label('Your note').first.fill('Client signed acknowledgement of the lower amount; review set for next year.')
    q.scroll_into_view_if_needed()
    page.screenshot(path=f'{OUT}/2-compliance-queue.png')
    q.get_by_role('button', name='Clear').click()
    expect(q).to_contain_text('Nothing waiting.')
    ctx.close()
    # 3. The advisor sees it cleared, and the deal can move to Submitted.
    ctx, page = open_deal(b, 'sanjeev@uat.test')
    su = page.get_by_role('region', name='Suitability check')
    expect(su).to_contain_text('Cleared by compliance', timeout=20000)
    su.scroll_into_view_if_needed()
    page.screenshot(path=f'{OUT}/3-cleared.png')
    sel = page.locator('#rec-stg')
    sel.select_option(label='Submitted')
    page.wait_for_timeout(1500)
    expect(page.get_by_role('alert')).to_have_count(0)
    assert sel.evaluate('s => s.options[s.selectedIndex].text') == 'Submitted'
    b.close()
print('suitability page errors:', errors); sys.exit(1 if errors else 0)
