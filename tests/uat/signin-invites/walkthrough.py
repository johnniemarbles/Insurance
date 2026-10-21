"""Sign-in across Canada and the US, and an invitation's two ways in (Gmail extension, web app)."""
import sys
from playwright.sync_api import sync_playwright, expect
OUT, TOKEN = sys.argv[1], sys.argv[2]
CA, US = 'http://127.0.0.1:3109', 'http://localhost:3110'
STORE = 'https://chromewebstore.google.com/detail/bbfccaiemeckdhajpejacckieamdbajm'
errors = []

def google(page, email=None, expect_hint=None):
    """The development stand-in for Google: check the suggested account, then continue."""
    expect(page.get_by_role('heading', name='Google (development stand-in)')).to_be_visible(timeout=15000)
    box = page.get_by_label('Email')
    if expect_hint is not None: expect(box).to_have_value(expect_hint)
    if email is not None: box.fill(email)
    page.get_by_role('button', name='Continue').click()

with sync_playwright() as p:
    b = p.chromium.launch()
    # 1. A US partner opens the Canada web app: Canada has no account for them and hands over to the US, back to /app.
    ctx = b.new_context(viewport={'width': 1280, 'height': 860}); page = ctx.new_page(); page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(f'{CA}/app')
    page.get_by_role('button', name='Continue with Google').click()
    google(page, 'jordan@uat.test')
    google(page, expect_hint='jordan@uat.test')  # now on the US server, same account suggested
    page.wait_for_url(f'{US}/app?signed_in=1', timeout=15000)
    expect(page.get_by_role('heading', name='Privacy notice')).to_be_visible(timeout=15000)  # accepted right in the web app
    expect(page.get_by_text('Punjab Insurance Broker Inc').first).to_be_visible(timeout=15000)  # the US notice, US company
    page.screenshot(path=f'{OUT}/1-fallback-to-us.png')
    page.get_by_role('button', name='I accept').click()
    expect(page.get_by_role('heading', name='Privacy notice')).to_have_count(0, timeout=15000)
    ctx.close()
    # 2. An invitation on the Canada server: the invitation page, then the welcome page with Gmail and the browser.
    ctx = b.new_context(viewport={'width': 1280, 'height': 860}); page = ctx.new_page(); page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(f'{CA}/accept?token={TOKEN}')
    expect(page.get_by_text('PII site')).to_be_visible()
    expect(page.locator('.card')).to_contain_text('Canada')
    page.screenshot(path=f'{OUT}/2-invitation.png')
    page.get_by_role('link', name='Continue with Google').click()
    google(page, expect_hint='navdeep@uat.test')
    page.wait_for_url(f'{CA}/?signed_in=1&welcome=1', timeout=15000)
    expect(page.get_by_text('PII Canada').first).to_be_visible()
    gmail = page.get_by_role('region', name='In Gmail')
    expect(gmail.get_by_role('link', name='Add PII to Gmail')).to_have_attribute('href', STORE)
    page.screenshot(path=f'{OUT}/3-welcome.png')
    page.get_by_role('region', name='In your browser').get_by_role('link', name='Open PII').click()
    page.wait_for_url(f'{CA}/app', timeout=15000)
    expect(page.get_by_role('heading', name='Privacy notice')).to_be_visible(timeout=15000)
    ctx.close()
    # 3. Invited in neither country: tried on both, then one clear page.
    ctx = b.new_context(viewport={'width': 1280, 'height': 860}); page = ctx.new_page(); page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(f'{US}/app')
    page.get_by_role('button', name='Continue with Google').click()
    google(page, 'stranger@example.com')
    google(page, expect_hint='stranger@example.com')
    page.wait_for_url(f'{CA}/login?error=unknown_user_both**', timeout=15000)
    expect(page.get_by_text('isn’t invited in Canada or the United States')).to_be_visible()
    page.screenshot(path=f'{OUT}/4-neither-country.png')
    # 4. The home page signs in at /app and links the store; the install page points to the store.
    page.goto(f'{CA}/?lang=en')
    expect(page.get_by_role('link', name='Sign in to PII')).to_have_attribute('href', '/app')
    expect(page.get_by_role('link', name='Add PII to Gmail')).to_have_attribute('href', STORE)
    page.goto(f'{CA}/install?lang=en')
    expect(page.get_by_role('link', name='Add PII to Chrome')).to_have_attribute('href', STORE)
    page.screenshot(path=f'{OUT}/5-install.png')
    b.close()
print('sign-in page errors:', errors); sys.exit(1 if errors else 0)
