const input = document.getElementById('base') as HTMLInputElement;
const msg = document.getElementById('msg') as HTMLElement;
chrome.storage.sync.get('apiBase').then((v: { apiBase?: unknown }) => { input.value = (v.apiBase as string | undefined) ?? ''; });
const embed = document.getElementById('embed') as HTMLInputElement;
chrome.storage.sync.get('bundledUi').then((v: { bundledUi?: unknown }) => { embed.checked = v.bundledUi === true; });
document.getElementById('save')!.addEventListener('click', async () => {
  const v = input.value.trim().replace(/\/+$/, '');
  if (v && !/^https:\/\/[^\s/]+$/.test(v)) { msg.style.color = '#b91c1c'; msg.textContent = 'Use an https address with no path'; return; }
  await chrome.storage.sync.set({ apiBase: v, bundledUi: embed.checked });
  await chrome.storage.sync.remove('embedUi'); // the old test switch
  msg.style.color = '#047857'; msg.textContent = 'Saved';
});
