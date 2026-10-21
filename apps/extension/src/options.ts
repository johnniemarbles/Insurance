// The server address is for development builds only. In store builds the country comes from signing in (Gmail's PII mark).
if (!__DEV_BUILD__) for (const id of ['base-block']) { const el = document.getElementById(id); if (el) el.hidden = true; }
const input = document.getElementById('base') as HTMLInputElement;
const msg = document.getElementById('msg') as HTMLElement;
chrome.storage.sync.get('apiBase').then((v: { apiBase?: unknown }) => { input.value = (v.apiBase as string | undefined) ?? ''; });
const embed = document.getElementById('embed') as HTMLInputElement;
chrome.storage.sync.get('bundledUi').then((v: { bundledUi?: unknown }) => { embed.checked = v.bundledUi === true; });
document.getElementById('save')!.addEventListener('click', async () => {
  const v = input.value.trim().replace(/\/+$/, '');
  if (__DEV_BUILD__ && v && !/^https:\/\/[^\s/]+$/.test(v)) { msg.style.color = '#b91c1c'; msg.textContent = 'Use an https address with no path'; return; }
  await chrome.storage.sync.set(__DEV_BUILD__ ? { apiBase: v, bundledUi: embed.checked } : { bundledUi: embed.checked });
  if (!__DEV_BUILD__) await chrome.storage.sync.remove('apiBase'); // an address typed before 1.7.0 is not used any more
  await chrome.storage.sync.remove('embedUi'); // the old test switch
  msg.style.color = '#047857'; msg.textContent = 'Saved';
});
