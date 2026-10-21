import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { X, type N } from './notifications.tsx';
import type { HostOptions, Locale } from './types.ts';

export const HEADER_CSS = `
:host{all:initial;--pri:#6355F6;--navy:#191C32;--ink:#1E2238;--mute:#6B7280;--accent:#EB5757;--line:#EEF1F6;--tint:#F9FAFB;--pri-soft:#EEEBFF;--bg:#fff}
*{box-sizing:border-box}
.h{display:flex;align-items:center;gap:4px;font:14px/1.4 "Google Sans",Roboto,system-ui,sans-serif;color:var(--ink)}
.ib{position:relative;width:40px;height:40px;border-radius:50%;border:0;background:none;display:grid;place-items:center;cursor:pointer;color:var(--navy)}
.ib:hover,.ib[aria-expanded=true]{background:var(--pri-soft)}
.ib:focus-visible{outline:2px solid var(--pri);outline-offset:1px}
.mark{width:28px;height:28px;border-radius:8px;display:block}
.dot{position:absolute;top:3px;right:2px;min-width:17px;height:17px;padding:0 4px;border-radius:9px;background:var(--accent);color:#fff;font-size:11px;font-weight:600;display:grid;place-items:center;border:2px solid #fff;box-sizing:content-box}
.pop{position:fixed;z-index:2147483000;width:380px;max-width:calc(100vw - 16px);max-height:min(560px,calc(100vh - 80px));display:flex;flex-direction:column;background:#fff;border-radius:14px;box-shadow:0 2px 6px rgba(16,24,40,.1),0 14px 40px rgba(16,24,40,.22);border:1px solid var(--line);overflow:hidden;animation:in .14s ease-out}
@keyframes in{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.pop{animation:none}}
.ph{display:flex;align-items:center;gap:8px;padding:14px 16px 10px;border-bottom:1px solid var(--line)}
.ph b{font-size:16px;color:var(--navy);flex:1}
.lk{border:0;background:none;color:var(--pri);font:inherit;font-size:13px;cursor:pointer;padding:4px 6px;border-radius:6px}
.lk:hover:not(:disabled){background:var(--pri-soft)}.lk:disabled{color:#9CA3AF;cursor:default}
.list{overflow:auto;flex:1}
.it{display:flex;gap:10px;width:100%;text-align:left;border:0;background:#fff;padding:11px 16px;cursor:pointer;font:inherit;color:var(--ink);border-bottom:1px solid var(--line)}
.it:hover{background:var(--tint)}
.it.un{background:var(--pri-soft)}.it.un:hover{background:#EEEBFF}
.av{flex:none;width:32px;height:32px;border-radius:50%;background:var(--navy);color:#fff;display:grid;place-items:center;font-size:13px;font-weight:600}
.av.sys{background:var(--accent)}
.tx{flex:1;min-width:0}.tx span{display:block;font-size:13.5px;overflow-wrap:anywhere}.tx small{color:var(--mute);font-size:12px}
.ud{flex:none;width:8px;height:8px;border-radius:50%;background:var(--pri);margin-top:6px}
.empty{padding:36px 24px;text-align:center;color:var(--mute)}.empty b{display:block;color:var(--navy);font-size:15px;margin-bottom:4px}
.pf{padding:8px 12px;border-top:1px solid var(--line);display:flex;justify-content:space-between}
.cc{position:absolute;bottom:2px;right:-2px;background:var(--navy);color:#fff;font-size:9px;font-weight:700;line-height:1;padding:2px 3px;border-radius:5px;border:1.5px solid #fff}
.menu{width:240px;padding:6px}
.mi{display:flex;align-items:center;gap:10px;width:100%;border:0;background:none;padding:9px 10px;border-radius:8px;font:inherit;color:var(--ink);cursor:pointer;text-align:left}
.mi:hover{background:var(--pri-soft)}.mi small{margin-left:auto;background:var(--accent);color:#fff;border-radius:9px;padding:0 6px;font-size:11px}
.mh{padding:8px 10px 6px;font-size:12px;color:var(--mute);text-transform:uppercase;letter-spacing:.04em}
`;

interface NavItem { id: string; name: string; count: number }
const T = {
  en: { bell: 'Notifications', all: 'See all in settings', markAll: 'Mark all read', clear: 'Nothing new', clearSub: 'We will tell you when something needs you.', open: 'Open PII', country: 'Country', signIn: 'Sign in', pick: 'Sign in to PII', signInTo: (c: string) => `Sign in: ${c}`, noticeT: 'Privacy notice', noticeRead: 'Read the privacy notice', noticeOk: 'I accept', retry: 'Could not load. Try again', ago: (m: number) => (m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`) },
  'fr-CA': { bell: 'Notifications', all: 'Tout voir dans les paramètres', markAll: 'Tout marquer comme lu', clear: 'Rien de nouveau', clearSub: 'Nous vous aviserons quand quelque chose vous attend.', open: 'Ouvrir PII', country: 'Pays', signIn: 'Connexion', pick: 'Se connecter à PII', signInTo: (c: string) => `Se connecter : ${c}`, noticeT: 'Avis de confidentialité', noticeRead: 'Lire l’avis de confidentialité', noticeOk: 'J’accepte', retry: 'Chargement impossible. Réessayer', ago: (m: number) => (m < 1 ? 'à l’instant' : m < 60 ? `il y a ${m} min` : m < 1440 ? `il y a ${Math.round(m / 60)} h` : `il y a ${Math.round(m / 1440)} j`) },
};
const changed = () => { try { window.dispatchEvent(new CustomEvent('pii-settings-changed')); } catch { /* ignore */ } };

function Header({ host, markUrl }: { host: HostOptions; markUrl: string }) {
  const [locale, setLocale] = useState<Locale>('en');
  const [list, setList] = useState<N[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<NavItem[]>([]);
  const [open, setOpen] = useState<'' | 'bell' | 'menu'>('');
  const [bad, setBad] = useState(false);
  const [signedIn, setSignedIn] = useState(true);
  const [consent, setConsent] = useState<string | null>(null);
  const [needs, setNeeds] = useState(false);
  const regions = host.regions ?? [];
  const [seen, setSeen] = useState<Record<string, boolean>>({}); // signed in per country
  const [isHo, setIsHo] = useState(false);
  const [cur, setCur] = useState(host.region);
  const root = useRef<HTMLDivElement>(null);
  const pos = useRef({ right: 8, top: 56 });
  const t = T[locale];
  const load = async () => {
    const [n, nav, me] = await Promise.all([host.transport('GET', '/v1/notifications?limit=20'), host.transport('GET', '/v1/nav'), host.transport('GET', '/v1/me')]);
    if (me.status === 401 || n.status === 401 || me.status === 409) { setSignedIn(false); return; }
    setSignedIn(true);
    setNeeds(me.status === 200 && Boolean(me.json?.needsConsent));
    setIsHo(me.status === 200 && Boolean(me.json?.isHeadOffice));
    setCur(host.region);
    if (regions.length > 1) void Promise.all(regions.map(async (r) => [r.id, (await host.transport('GET', '/v1/me', undefined, r.id)).status === 200] as const)).then((e) => setSeen(Object.fromEntries(e)));
    if (me.status === 200 && me.json?.user?.locale === 'fr-CA') setLocale('fr-CA');
    if (n.status === 200) { setList(n.json.notifications as N[]); setUnread(n.json.unread ?? 0); setBad(false); } else setBad(true);
    if (nav.status === 200) setItems((nav.json.items as NavItem[]).filter((i) => i.id !== 'notifications'));
  };
  useEffect(() => { void load().catch(() => setBad(true)); const id = setInterval(() => void load().catch(() => undefined), 60_000); window.addEventListener('pii-settings-changed', () => void load().catch(() => undefined)); window.addEventListener('pii-region-changed', () => { setList(null); setItems([]); setNeeds(false); setConsent(null); setOpen(''); void load().catch(() => undefined); }); return () => clearInterval(id); }, []);
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => { if (!e.composedPath().includes(root.current as EventTarget)) setOpen(''); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(''); };
    document.addEventListener('mousedown', away, true); document.addEventListener('keydown', esc, true);
    return () => { document.removeEventListener('mousedown', away, true); document.removeEventListener('keydown', esc, true); };
  }, [open]);
  const toggle = (which: 'bell' | 'menu', ev: MouseEvent) => {
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    pos.current = { right: Math.max(8, Math.round(window.innerWidth - r.right - (which === 'bell' ? 0 : 180))), top: Math.round(r.bottom + 6) };
    if (which === 'bell' && open !== 'bell') void load().catch(() => undefined);
    setOpen(open === which ? '' : which);
  };
  const go = (page: string, id?: string) => { setOpen(''); host.navigate?.(page, id); };
  const pick = async (n: N) => {
    if (!n.readAt) { await host.transport('POST', '/v1/notifications/read', { ids: [n.id] }).catch(() => undefined); setList((l) => (l ?? []).map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x))); setUnread((u) => Math.max(0, u - 1)); changed(); }
    if (n.kind === 'merge_done' || n.kind === 'unsubscribed') go('merges'); else if (n.pipelineId) go('pipelines', n.pipelineId); else go('home');
  };
  const markAll = async () => { await host.transport('POST', '/v1/notifications/read', { all: true }).catch(() => undefined); setUnread(0); setList((l) => (l ?? []).map((x) => ({ ...x, readAt: x.readAt ?? new Date().toISOString() }))); changed(); };
  const x = X[locale];
  const showCountries = regions.length > 1 && (isHo || Object.values(seen).filter(Boolean).length > 1);
  // Signed out: with two countries the mark opens a choice, so nobody is sent to a country they do not belong to.
  if (!signedIn) {
    if (regions.length < 2) return <div class="h" ref={root}><button class="ib" title={t.open} onClick={() => host.onSignIn()}><img class="mark" src={markUrl} alt="PII" /></button></div>;
    return (
      <div class="h" ref={root}>
        <button class="ib" aria-label={t.open} aria-haspopup="menu" aria-expanded={open === 'menu'} title={t.open} onClick={(e) => toggle('menu', e as unknown as MouseEvent)}><img class="mark" src={markUrl} alt="" /></button>
        {open === 'menu' && (
          <div class="pop menu" role="menu" aria-label={t.pick} style={{ right: `${pos.current.right}px`, top: `${pos.current.top}px` }}>
            <div class="mh">{t.pick}</div>
            {regions.map((r) => <button class="mi" role="menuitem" key={r.id} onClick={() => { setOpen(''); host.onSignIn(r.id); }}><span style={{ fontWeight: r.id === cur ? 700 : 400 }}>{t.signInTo(r.id === 'us' && locale === 'fr-CA' ? 'États-Unis' : r.label)}</span></button>)}
          </div>
        )}
      </div>
    );
  }
  return (
    <div class="h" ref={root}>
      <button class="ib" aria-label="PII" aria-haspopup="menu" aria-expanded={open === 'menu'} title="PII" onClick={(e) => toggle('menu', e as unknown as MouseEvent)}><img class="mark" src={markUrl} alt="" />{showCountries && cur && <span class="cc">{cur.toUpperCase()}</span>}</button>
      <button class="ib" aria-label={`${t.bell}${unread ? ` (${unread})` : ''}`} aria-haspopup="dialog" aria-expanded={open === 'bell'} onClick={(e) => toggle('bell', e as unknown as MouseEvent)}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8" /><path d="M10.3 20a2 2 0 0 0 3.4 0" /></svg>
        {unread > 0 && <span class="dot">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open === 'menu' && needs && (
        <div class="pop" role="dialog" style={{ right: `${pos.current.right}px`, top: `${pos.current.top}px`, padding: '14px 16px' }}>
          <b style={{ color: 'var(--navy)' }}>{t.noticeT}</b>
          {consent === null ? <p><button class="lk" onClick={async () => { const r = await host.transport('GET', '/v1/consent/first-login'); setConsent(r.status === 200 ? String(r.json?.text ?? '') : t.retry); }}>{t.noticeRead}</button></p>
            : <><p style={{ whiteSpace: 'pre-wrap', overflow: 'auto', maxHeight: '260px', fontSize: '13px' }}>{consent}</p>
              <button class="lk" style={{ background: 'var(--pri)', color: '#fff' }} onClick={async () => { await host.transport('POST', '/v1/consent/first-login'); setConsent(null); await load().catch(() => undefined); changed(); }}>{t.noticeOk}</button></>}
        </div>
      )}
      {open === 'menu' && !needs && (
        <div class="pop menu" role="menu" style={{ right: `${pos.current.right}px`, top: `${pos.current.top}px` }}>
          {showCountries && <>
            <div class="mh">{t.country}</div>
            {regions.map((r) => <button class="mi" role="menuitemradio" aria-checked={r.id === cur} onClick={() => { setOpen(''); if (r.id === cur) return; if (seen[r.id]) host.switchRegion?.(r.id); else host.onSignIn(r.id); }}><span style={{ fontWeight: r.id === cur ? 700 : 400 }}>{r.label}</span>{r.id !== cur && !seen[r.id] ? <small style={{ background: '#9CA3AF' }}>{t.signIn}</small> : null}</button>)}
            <div style={{ borderTop: '1px solid var(--line)', margin: '6px 0' }} />
          </>}
          <div class="mh">PII · Punjab Insurance</div>
          {items.map((i) => <button class="mi" role="menuitem" onClick={() => go(i.id)}>{i.name}{i.count > 0 && i.id === 'home' && <small>{i.count}</small>}</button>)}
        </div>
      )}
      {open === 'bell' && (
        <div class="pop" role="dialog" aria-label={t.bell} style={{ right: `${pos.current.right}px`, top: `${pos.current.top}px` }}>
          <div class="ph"><b>{t.bell}</b><button class="lk" disabled={unread === 0} onClick={() => void markAll()}>{t.markAll}</button></div>
          <div class="list">
            {bad && <div class="empty"><button class="lk" onClick={() => void load().catch(() => setBad(true))}>{t.retry}</button></div>}
            {!bad && list && list.length === 0 && <div class="empty"><b>{t.clear}</b>{t.clearSub}</div>}
            {!bad && list?.map((n) => {
              const who = n.actorName ?? '';
              return (
                <button class={`it${n.readAt ? '' : ' un'}`} key={n.id} onClick={() => void pick(n)}>
                  <span class={`av${who ? '' : ' sys'}`}>{who ? who.trim()[0]!.toUpperCase() : 'P'}</span>
                  <span class="tx"><span>{x.text(n)}</span><small>{t.ago(Math.max(0, Math.round((Date.now() - new Date(n.createdAt).getTime()) / 60000)))}</small></span>
                  {!n.readAt && <i class="ud" />}
                </button>
              );
            })}
          </div>
          <div class="pf"><button class="lk" onClick={() => go('settings', 'notifications')}>{t.all}</button></div>
        </div>
      )}
    </div>
  );
}

/** The PII mark and the bell, drawn in their own shadow root so they can sit inside Gmail's top bar. */
export function mountHeader(el: HTMLElement, host: HostOptions, markUrl: string): () => void {
  const root = el.shadowRoot ?? el.attachShadow({ mode: 'open' });
  const style = document.createElement('style'); style.textContent = HEADER_CSS;
  const mount = document.createElement('div');
  root.replaceChildren(style, mount);
  render(<Header host={host} markUrl={markUrl} />, mount);
  return () => render(null, mount);
}
