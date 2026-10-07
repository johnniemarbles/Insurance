import { useEffect, useState } from 'preact/hooks';
import type { Locale } from './types.ts';

const TEXT = {
  en: {
    title: 'Welcome back',
    sub: 'Sign in to your team’s CRM and training, right alongside Gmail.',
    google: 'Continue with Google',
    invite: 'Invite-only. Use the Google account your administrator invited.',
    where: { CA: 'Canada', US: 'United States' },
    stored: (c: string) => `Your data is stored in ${c}.`,
    other: (c: string) => `Looking for ${c}? Switch to the ${c} sign-in`,
    feats: ['Gmail-native pipelines and contacts', 'Renewals, tasks and reminders', 'Compliance and training in one place'],
    privacy: 'Privacy', terms: 'Terms', support: 'Support',
    lang: 'Français',
    note: 'We only ask Google for your name and email address.',
  },
  'fr-CA': {
    title: 'Content de vous revoir',
    sub: 'Connectez-vous au CRM et à la formation de votre équipe, directement dans Gmail.',
    google: 'Continuer avec Google',
    invite: 'Sur invitation seulement. Utilisez le compte Google invité par votre administrateur.',
    where: { CA: 'Canada', US: 'États-Unis' },
    stored: (c: string) => `Vos données sont stockées ${c === 'Canada' ? 'au Canada' : 'aux États-Unis'}.`,
    other: (c: string) => `Votre agence est ${c === 'Canada' ? 'au Canada' : 'aux États-Unis'}? Passer à la connexion ${c === 'Canada' ? 'canadienne' : 'américaine'}`,
    feats: ['Pipelines et contacts dans Gmail', 'Renouvellements, tâches et rappels', 'Conformité et formation au même endroit'],
    privacy: 'Confidentialité', terms: 'Conditions', support: 'Soutien',
    lang: 'English',
    note: 'Nous demandons à Google seulement votre nom et votre courriel.',
  },
} as const;

const LOGIN_CSS = `
.lg{min-height:100vh;display:grid;grid-template-columns:1.05fr 1fr;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#0f172a;background:#fff}
.lg *{box-sizing:border-box}
.lg-hero{position:relative;overflow:hidden;color:#fff;padding:48px 56px;display:flex;flex-direction:column;justify-content:space-between;background:radial-gradient(1200px 600px at 10% -10%,#4f6bff 0%,transparent 60%),radial-gradient(900px 600px at 110% 110%,#7c3aed 0%,transparent 55%),linear-gradient(160deg,#0b1b4d,#16286e)}
.lg-hero:after{content:"";position:absolute;inset:0;background-image:radial-gradient(rgba(255,255,255,.12) 1px,transparent 1px);background-size:22px 22px;mask-image:linear-gradient(to bottom,rgba(0,0,0,.5),transparent 70%);pointer-events:none}
.lg-brand{display:flex;align-items:center;gap:12px;font-weight:700;font-size:18px;position:relative;z-index:1}
.lg-brand img{width:44px;height:44px;border-radius:12px;background:#fff;padding:3px}
.lg-pitch{position:relative;z-index:1;max-width:460px}
.lg-pitch h2{font-size:38px;line-height:1.12;margin:0 0 18px;letter-spacing:-.02em;font-weight:750}
.lg-pitch ul{list-style:none;margin:0;padding:0;display:grid;gap:12px}
.lg-pitch li{display:flex;gap:10px;align-items:center;font-size:16px;color:#dbe4ff}
.lg-pitch li:before{content:"";flex:none;width:20px;height:20px;border-radius:50%;background:rgba(255,255,255,.18) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'%3E%3Cpath d='M5.5 10.5l3 3 6-7' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center/20px no-repeat}
.lg-foot-l{position:relative;z-index:1;font-size:13px;color:#b9c6f5}
.lg-main{display:flex;flex-direction:column;justify-content:space-between;padding:28px 40px;background:#f8fafc}
.lg-top{display:flex;justify-content:flex-end}
.lg-lang{background:none;border:1px solid #cbd5e1;border-radius:999px;padding:6px 14px;font:inherit;font-size:14px;cursor:pointer;color:#334155}
.lg-lang:hover{background:#fff}
.lg-card{width:100%;max-width:420px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:20px;padding:36px 32px;box-shadow:0 20px 50px -20px rgba(15,23,42,.25)}
.lg-card img{width:56px;height:56px;border-radius:14px;display:none}
.lg-badge{display:inline-flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:#1e3a8a;background:#e0e7ff;border-radius:999px;padding:5px 12px;margin-bottom:18px}
.lg-flag{width:20px;height:14px;border-radius:2px;display:inline-block;overflow:hidden;box-shadow:0 0 0 1px rgba(0,0,0,.12)}
.lg-card h1{font-size:28px;margin:0 0 8px;letter-spacing:-.02em}
.lg-card p{margin:0 0 22px;color:#475569;line-height:1.5}
.lg-g{width:100%;display:flex;align-items:center;justify-content:center;gap:12px;background:#fff;border:1px solid #cbd5e1;border-radius:12px;padding:13px 16px;font:inherit;font-size:16px;font-weight:600;color:#0f172a;cursor:pointer;transition:box-shadow .15s,transform .05s,border-color .15s}
.lg-g:hover{box-shadow:0 6px 18px -6px rgba(37,99,235,.35);border-color:#93a8f4}
.lg-g:active{transform:translateY(1px)}
.lg-g:focus-visible,.lg-lang:focus-visible,.lg a:focus-visible{outline:3px solid #93a8f4;outline-offset:2px}
.lg-g svg{width:20px;height:20px}
.lg-fine{margin-top:16px;font-size:13px;color:#64748b;line-height:1.5}
.lg-res{margin-top:22px;padding-top:18px;border-top:1px solid #eef2f7;font-size:14px;color:#334155;display:grid;gap:8px}
.lg-res a{color:#1d4ed8;text-decoration:none;font-weight:600}.lg-res a:hover{text-decoration:underline}
.lg-links{display:flex;gap:18px;justify-content:center;font-size:13px}
.lg-links a{color:#64748b;text-decoration:none}.lg-links a:hover{color:#0f172a;text-decoration:underline}
@media(max-width:860px){.lg{grid-template-columns:1fr}.lg-hero{padding:28px 24px 32px}.lg-pitch h2{font-size:26px}.lg-pitch ul,.lg-foot-l{display:none}.lg-main{padding:20px 16px 28px}.lg-card{padding:28px 22px}}
@media(prefers-color-scheme:dark){.lg-main{background:#0b1020}.lg-card{background:#121a33;border-color:#243055;color:#e5e7eb;box-shadow:none}.lg-card p,.lg-fine,.lg-res{color:#a9b4d6}.lg-g{background:#1a2342;color:#fff;border-color:#33406b}.lg-lang{color:#cbd5e1;border-color:#33406b}.lg-lang:hover{background:#121a33}.lg-badge{background:#1e2a5a;color:#c7d2fe}.lg-res{border-color:#243055}.lg-res a{color:#8ab4ff}.lg-links a{color:#94a3b8}}
@media(prefers-reduced-motion:reduce){.lg-g{transition:none}}
`;

const Flag = ({ c }: { c: 'CA' | 'US' }) => c === 'CA'
  ? <svg class="lg-flag" viewBox="0 0 20 14" aria-hidden="true"><rect width="20" height="14" fill="#fff"/><rect width="5" height="14" fill="#d52b1e"/><rect x="15" width="5" height="14" fill="#d52b1e"/><path d="M10 3l.9 1.8 1.3-.5-.4 2.4 1.2-.6-.5 1.5.9.5-2.3 1.9.1 1H10.3v1h-.6v-1H8.7l.1-1-2.3-1.9.9-.5-.5-1.5 1.2.6-.4-2.4 1.3.5z" fill="#d52b1e"/></svg>
  : <svg class="lg-flag" viewBox="0 0 20 14" aria-hidden="true"><rect width="20" height="14" fill="#fff"/>{[0, 2, 4, 6, 8, 10, 12].map((y) => <rect y={y} width="20" height="1.08" fill="#b22234" />)}<rect width="9" height="7.5" fill="#3c3b6e"/></svg>;

const G = () => (
  <svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.9 2.4 30.4 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.5-4.1 7-10.2 7-17.6z"/><path fill="#FBBC05" d="M10.5 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>
);

/** The full-page sign-in screen for /app. The Gmail panel keeps its small version. */
export function LoginPage({ locale, onLocale, onSignIn }: { locale: Locale; onLocale: (l: Locale) => void; onSignIn: () => void }) {
  const [c, setC] = useState<'CA' | 'US'>(() => (location.hostname.startsWith('us.') ? 'US' : 'CA'));
  const x = TEXT[locale];
  useEffect(() => {
    fetch('/v1/region').then((r) => r.json()).then((j: { country?: string }) => { if (j.country === 'US' || j.country === 'CA') setC(j.country); }).catch(() => undefined);
  }, []);
  const otherC = c === 'CA' ? 'US' : 'CA';
  const otherHost = c === 'CA' ? location.host.replace(/^ca\./, 'us.') : location.host.replace(/^us\./, 'ca.');
  const lang = locale === 'fr-CA' ? 'fr' : 'en';
  return (
    <div class="lg">
      <style>{LOGIN_CSS}</style>
      <section class="lg-hero" aria-hidden="false">
        <div class="lg-brand"><img src="/brand/logo.png" alt="" />PII by Punjab Insurance</div>
        <div class="lg-pitch">
          <h2>{locale === 'fr-CA' ? 'Votre agence, directement dans Gmail.' : 'Your agency, right inside Gmail.'}</h2>
          <ul>{x.feats.map((f) => <li>{f}</li>)}</ul>
        </div>
        <div class="lg-foot-l">© Punjab Insurance</div>
      </section>
      <main class="lg-main">
        <div class="lg-top"><button class="lg-lang" onClick={() => onLocale(locale === 'fr-CA' ? 'en' : 'fr-CA')} lang={locale === 'fr-CA' ? 'en' : 'fr'}>{x.lang}</button></div>
        <div class="lg-card">
          <span class="lg-badge"><Flag c={c} />{x.where[c]}</span>
          <h1>{x.title}</h1>
          <p>{x.sub}</p>
          <button class="lg-g" onClick={onSignIn}><G />{x.google}</button>
          <div class="lg-fine">{x.invite}<br />{x.note}</div>
          <div class="lg-res">
            <span>{x.stored(x.where[c])}</span>
            <a href={`${location.protocol}//${otherHost}/app`}><Flag c={otherC} /> {x.other(x.where[otherC])}</a>
          </div>
        </div>
        <nav class="lg-links" aria-label="Legal">
          <a href={`/privacy?lang=${lang}`}>{x.privacy}</a><a href={`/terms?lang=${lang}`}>{x.terms}</a><a href={`/support?lang=${lang}`}>{x.support}</a>
        </nav>
      </main>
    </div>
  );
}
