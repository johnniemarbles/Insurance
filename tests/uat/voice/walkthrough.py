"""Voice, part 1: speak a question, hear the answer read aloud, dictate a note and a task on a deal."""
import sys
from playwright.sync_api import sync_playwright, expect
OUT = sys.argv[1]
BASE = 'http://127.0.0.1:3111'
errors = []
# Headless Chrome has no voices: give it one local English voice and record what it is asked to say.
FAKE_VOICES = """
(() => {
  const v = { name: 'Local English', lang: 'en-CA', localService: true, default: true, voiceURI: 'local-en' };
  window.__spoken = [];
  const s = window.speechSynthesis;
  s.getVoices = () => [v];
  s.speak = (u) => { window.__spoken.push(u.text); setTimeout(() => u.onend && u.onend(), 50); };
  s.cancel = () => {};
  window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
})();
"""

def speak(page, scope, seconds=2):
    """Press Speak, let the fake microphone run, press Stop."""
    scope.get_by_role('button', name='Speak').click()
    page.wait_for_timeout(seconds * 1000)
    scope.get_by_role('button', name='Stop').click()

with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'])
    ctx = b.new_context(viewport={'width': 1280, 'height': 900}, locale='en-CA')
    ctx.grant_permissions(['microphone'], origin=BASE)
    ctx.add_init_script(FAKE_VOICES)
    page = ctx.new_page(); page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(f'{BASE}/app')
    page.get_by_role('button', name='Continue with Google').click()
    expect(page.get_by_role('heading', name='Google (development stand-in)')).to_be_visible(timeout=15000)
    page.get_by_label('Email').fill('sanjeev@uat.test'); page.get_by_role('button', name='Continue').click()
    page.wait_for_url(f'{BASE}/app?signed_in=1', timeout=15000)
    accept = page.get_by_role('button', name='I accept')
    expect(accept).to_be_visible(timeout=15000); accept.click()
    expect(accept).to_have_count(0, timeout=15000)
    # A pipeline and a deal to work on, made through the API as this person.
    ids = page.evaluate("""async () => {
      const j = async (m, u, b) => { const r = await fetch(u, { method: m, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }); const t = await r.json(); if (!r.ok) throw new Error(u + ' ' + r.status + ' ' + JSON.stringify(t)); return t; };
      const pipe = await j('POST', '/v1/pipelines', { name: 'Life', stages: [{ name: 'New' }, { name: 'Quoted' }] });
      const box = await j('POST', '/v1/boxes', { pipelineId: pipe.id, name: 'Raj Singh, term life' });
      return { pipe: pipe.id, box: box.id };
    }""")
    assert ids['box'], ids
    # 1. Ask PII by voice: the words appear in the box to check, then Ask; the answer has a Listen button.
    page.goto(f'{BASE}/app'); page.wait_for_timeout(1500)
    page.get_by_role('button', name='Ask PII').click()
    drawer = page.get_by_role('dialog', name='Ask PII')
    speak(page, drawer)
    box = drawer.get_by_role('textbox', name='Ask PII')
    expect(box).to_have_value('Called Raj Singh, he wants a quote for term life cover, follow up Friday.', timeout=15000)
    page.screenshot(path=f'{OUT}/1-spoken-question.png')
    drawer.get_by_role('button', name='Ask', exact=True).click()
    drawer.get_by_role('button', name='Listen').click()
    page.wait_for_function('window.__spoken.length > 0', timeout=15000)
    spoken = page.evaluate('window.__spoken[0]')
    assert '[' not in spoken, spoken  # references are not read out
    page.screenshot(path=f'{OUT}/2-answer-read-aloud.png')
    drawer.get_by_role('button', name='Close').click()
    # 2. Dictate a note on the deal: the tidied note and a suggested task to review, then save both.
    page.get_by_text('Raj Singh, term life').first.click()
    rec = page.get_by_role('dialog', name='Raj Singh, term life')
    rec.get_by_role('tab', name='Activity').click()
    card = rec.get_by_role('region', name='Dictate a note')
    speak(page, card)
    expect(card.get_by_role('textbox', name='Note')).to_have_value('Called Raj Singh. He wants a quote for term life cover.', timeout=15000)
    expect(card.get_by_text('Send Raj the term 20 quote')).to_be_visible()
    card.scroll_into_view_if_needed()
    page.screenshot(path=f'{OUT}/3-dictated-note-review.png')
    card.get_by_role('button', name='Save note and tasks').click()
    expect(card.get_by_text('Note saved with 1 task.')).to_be_visible(timeout=15000)
    expect(rec.get_by_text('Send Raj the term 20 quote').first).to_be_visible(timeout=15000)
    page.screenshot(path=f'{OUT}/4-note-and-task-saved.png')
    # 3. A task by voice: the words fill the task box.
    rec.get_by_role('tab', name='Task').click()
    composer = rec.locator('.composer')
    speak(page, composer)
    expect(composer.get_by_role('textbox', name='Task')).to_have_value('Called Raj Singh, he wants a quote for term life cover, follow up Friday.', timeout=15000)
    # 4. Inside Gmail before extension 1.8.0 (or if Gmail blocks the frame's microphone): the small PII voice window
    #    records and hands the audio back to the PII page that opened it, which sends it signed in as usual.
    page.evaluate("""() => { window.__got = null; window.addEventListener('message', (e) => { if (e.origin === location.origin && e.data && e.data.pii === 'voice-audio') window.__got = e.data; });
      window.__w = window.open('/voice-recorder?id=uatwindow01&lang=en&max=60', 'pii-voice', 'popup,width=440,height=320'); }""")
    pop = next(pg for pg in ctx.pages if 'voice-recorder' in pg.url) if any('voice-recorder' in pg.url for pg in ctx.pages) else ctx.wait_for_event('page')
    pop.wait_for_load_state()
    pop.get_by_role('button', name='Speak').click(); pop.wait_for_timeout(2000)
    pop.screenshot(path=f'{OUT}/5-voice-window.png')
    pop.get_by_role('button', name='Stop').click()
    page.wait_for_function('window.__got !== null', timeout=15000)
    got = page.evaluate("({ id: window.__got.id, mime: window.__got.mime, bytes: window.__got.data.length, seconds: window.__got.seconds })")
    assert got['id'] == 'uatwindow01' and got['mime'].startswith('audio/') and got['bytes'] > 200 and got['seconds'] >= 1, got
    text = page.evaluate("""async () => { const g = window.__got; const r = await fetch('/v1/voice/transcribe', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mime: g.mime, dataBase64: g.data, seconds: g.seconds, purpose: 'question', language: 'en' }) }); return (await r.json()).text; }""")
    assert text.startswith('Called Raj Singh'), text
    ctx.close()
    b.close()
print('voice page errors:', errors); sys.exit(1 if errors else 0)
