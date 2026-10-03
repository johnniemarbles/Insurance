const input = document.getElementById('base') as HTMLInputElement;
const msg = document.getElementById('msg') as HTMLElement;
chrome.storage.sync.get('apiBase').then((v) => { input.value = (v.apiBase as string | undefined) ?? ''; });
document.getElementById('save')!.addEventListener('click', async () => {
  const v = input.value.trim().replace(/\/+$/, '');
  if (v && !/^https:\/\/[^\s/]+$/.test(v)) { msg.style.color = '#b91c1c'; msg.textContent = 'Use an https address with no path'; return; }
  await chrome.storage.sync.set({ apiBase: v });
  msg.style.color = '#047857'; msg.textContent = 'Saved';
});
