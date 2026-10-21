"""Evidence packs: compliance downloads a partner pack, PII confirms its fingerprint, then a regulator pack naming deals."""
import sys, zipfile, hashlib, json
from playwright.sync_api import sync_playwright, expect
OUT = sys.argv[1]; BASE = 'http://127.0.0.1:3108'; errors = []
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1360, 'height': 2200}, accept_downloads=True, extra_http_headers={'x-dev-user-email': 'priya@uat.test'})
    ctx.add_init_script("try { localStorage.setItem('pii.page', 'compliance') } catch (e) {}")
    page = ctx.new_page(); page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(f'{BASE}/app')
    ep = page.get_by_role('region', name='Evidence packs')
    expect(ep).to_contain_text('None yet.', timeout=20000)
    expect(ep.get_by_label('Which')).to_contain_text('Harpreet Kaur Sandhu')
    with page.expect_download() as dl:
        ep.get_by_role('button', name='Make the pack').click()
    path = dl.value.path()
    z = zipfile.ZipFile(path)
    names = z.namelist()
    assert 'manifest.json' in names and 'README.txt' in names, names
    assert len([n for n in names if n.startswith('deals/')]) == 2, names
    assert 'Client waited two weeks' in z.read('registers/complaints.csv').decode()
    manifest = json.loads(z.read('manifest.json'))
    for f in manifest['files']: assert hashlib.sha256(z.read(f['path'])).hexdigest() == f['sha256'], f['path']
    fp = hashlib.sha256(z.read('manifest.json')).hexdigest()
    expect(ep.get_by_role('status').first).to_contain_text('Downloaded: 2 client files', timeout=10000)
    expect(ep).to_contain_text(fp)  # in the history
    ep.get_by_label('Check a pack').fill(fp)
    ep.get_by_role('button', name='Check').click()
    expect(ep).to_contain_text('Issued by PII: Harpreet Kaur Sandhu', timeout=10000)
    ep.scroll_into_view_if_needed()
    page.screenshot(path=f'{OUT}/1-partner-pack.png')
    ep.get_by_label('Check a pack').fill('0' * 64)
    ep.get_by_role('button', name='Check').click()
    expect(ep).to_contain_text('PII did not issue a pack with this fingerprint', timeout=10000)
    ep.get_by_label('Pack for').select_option('regulator')
    ep.get_by_label("Request reference (e.g. the regulator's letter number)").fill('FSRA-2026-0412')
    ep.get_by_label('Client files to include (optional, one deal name per line as shown in PII)').fill('Singh life review\nNot a deal')
    ep.get_by_role('button', name='Make the pack').click()
    expect(ep.get_by_role('alert')).to_contain_text('Not a deal', timeout=10000)
    ep.get_by_label('Client files to include (optional, one deal name per line as shown in PII)').fill('Singh life review\nGill family term')
    with page.expect_download() as dl2:
        ep.get_by_role('button', name='Make the pack').click()
    z2 = zipfile.ZipFile(dl2.value.path())
    assert 'Request reference: FSRA-2026-0412' in z2.read('README.txt').decode()
    expect(ep).to_contain_text('Regulator: ', timeout=10000)
    ep.scroll_into_view_if_needed()
    page.screenshot(path=f'{OUT}/2-regulator-pack.png')
    b.close()
print('evidence pack page errors:', errors); sys.exit(1 if errors else 0)
