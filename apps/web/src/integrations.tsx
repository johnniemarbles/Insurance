import { useEffect, useState } from 'preact/hooks';
import { useDialogFocus } from './a11y.ts';
import type { Strings } from './i18n.ts';
import type { Locale, Pipeline } from './types.ts';

type Call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown) => Promise<any>;
interface Intake { id: string; kind: 'form' | 'webhook'; name: string; stageId: string; active: boolean; uses: number; lastUsedAt: string | null; tokenPrefix: string }
interface Hook { id: string; url: string; events: string[]; active: boolean; lastStatus: number | null; lastAt: string | null; failures: number }

/** Streak-style "Integrations & Automation": ways data comes in and goes out, plus a shortcut to stage automations. */
export function IntegrationsPanel({ pipeline, call, t, locale, onAutomations, onClose }: { pipeline: Pipeline; call: Call; t: Strings; locale: Locale; onAutomations: () => void; onClose: () => void }) {
  const dlg = useDialogFocus<HTMLElement>();
  const P = `/v1/pipelines/${pipeline.id}`;
  const [intakes, setIntakes] = useState<Intake[]>([]);
  const [hooks, setHooks] = useState<Hook[]>([]);
  const [locs, setLocs] = useState<{ id: string; name: string }[]>([]);
  const [loc, setLoc] = useState('');
  const [err, setErr] = useState('');
  const [secret, setSecret] = useState<{ label: string; value: string } | null>(null);
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [intro, setIntro] = useState('');
  const [stageId, setStageId] = useState(pipeline.stages[0]?.id ?? '');
  const [hookName, setHookName] = useState('');
  const [hookUrl, setHookUrl] = useState('');
  const [tick, setTick] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => { call('GET', `${P}/intakes`).then((r) => setIntakes(r.intakes), () => undefined); call('GET', `${P}/webhooks`).then((r) => setHooks(r.webhooks), () => undefined); }, [call, P, tick]);
  useEffect(() => { call('GET', '/v1/org/contexts').then((r) => { const l = (r.locations ?? []) as { id: string; name: string }[]; setLocs(l); if (l.length === 1) setLoc(l[0]!.id); }, () => undefined); }, [call]);
  const act = async (fn: () => Promise<void>) => { setErr(''); try { await fn(); setTick((n) => n + 1); } catch (e) { setErr((e as Error).message); } };
  const needLoc = locs.length > 1 && !loc;
  const locBody = loc ? { contextNodeId: loc } : {};
  const copy = async (v: string) => { try { await navigator.clipboard.writeText(v); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked: the text stays selectable */ } };
  const when = (v: string | null) => (v ? new Date(v).toLocaleString(locale) : t.never);
  const stageName = (id: string) => pipeline.stages.find((s) => s.id === id)?.name ?? '…';

  return (
    <aside ref={dlg} tabIndex={-1} class="drawer wide" role="dialog" aria-label={t.integrations}>
      <h2>{t.integrations}</h2>
      {err && <div class="err" role="alert">{err}</div>}
      {secret && (
        <div class="secretbox" role="status">
          <b>{secret.label}</b>
          <code>{secret.value}</code>
          <div class="actions"><button class="btn" onClick={() => void copy(secret.value)}>{copied ? t.copied : t.copy}</button><button class="btn quiet" onClick={() => setSecret(null)}>{t.done}</button></div>
          <small>{t.shownOnce}</small>
        </div>
      )}
      {locs.length > 1 && (
        <>
          <label for="il">{t.location}</label>
          <select id="il" value={loc} onChange={(e) => setLoc((e.target as HTMLSelectElement).value)}><option value="">{t.chooseLocation}</option>{locs.map((l) => <option value={l.id}>{l.name}</option>)}</select>
        </>
      )}

      <section class="icard">
        <h3>{t.captureForms}</h3>
        <p class="muted">{t.captureFormsHelp}</p>
        {intakes.filter((i) => i.kind === 'form').map((i) => (
          <div class="erow" key={i.id}><span class={i.active ? '' : 'strike'}>{i.name} <small class="muted">→ {stageName(i.stageId)} · {t.uses(i.uses)} · …{i.tokenPrefix}</small></span><span class="spacer" />
            <button class="ib" aria-label={i.active ? t.pause : t.resume} onClick={() => void act(() => call('PATCH', `${P}/intakes/${i.id}`, { active: !i.active }))}>{i.active ? '⏸' : '▶'}</button>
            <button class="ib danger" aria-label={t.remove} onClick={() => { if (confirm(t.confirmRemoveLink)) void act(() => call('DELETE', `${P}/intakes/${i.id}`)); }}>✕</button></div>
        ))}
        <form class="erow wrap2" onSubmit={(e) => {
          e.preventDefault(); if (!name.trim() || needLoc) return;
          void act(async () => { const r = await call('POST', `${P}/intakes`, { kind: 'form', name: name.trim(), stageId, ...(title.trim() ? { title: title.trim() } : {}), ...(intro.trim() ? { intro: intro.trim() } : {}), ...locBody }); setSecret({ label: t.formLink, value: r.url }); setName(''); setTitle(''); setIntro(''); });
        }}>
          <input placeholder={t.formName} aria-label={t.formName} value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
          <input placeholder={t.formTitle} aria-label={t.formTitle} value={title} onInput={(e) => setTitle((e.target as HTMLInputElement).value)} />
          <input placeholder={t.formIntro} aria-label={t.formIntro} value={intro} onInput={(e) => setIntro((e.target as HTMLInputElement).value)} />
          <select aria-label={t.stage} value={stageId} onChange={(e) => setStageId((e.target as HTMLSelectElement).value)}>{pipeline.stages.map((s) => <option value={s.id}>{s.name}</option>)}</select>
          <button class="btn quiet" disabled={!name.trim() || needLoc}>{t.createForm}</button>
        </form>
      </section>

      <section class="icard">
        <h3>{t.connectApps}</h3>
        <p class="muted">{t.connectAppsHelp}</p>
        {intakes.filter((i) => i.kind === 'webhook').map((i) => (
          <div class="erow" key={i.id}><span class={i.active ? '' : 'strike'}>{i.name} <small class="muted">→ {stageName(i.stageId)} · {t.uses(i.uses)} · …{i.tokenPrefix}</small></span><span class="spacer" />
            <button class="ib" aria-label={i.active ? t.pause : t.resume} onClick={() => void act(() => call('PATCH', `${P}/intakes/${i.id}`, { active: !i.active }))}>{i.active ? '⏸' : '▶'}</button>
            <button class="ib danger" aria-label={t.remove} onClick={() => { if (confirm(t.confirmRemoveLink)) void act(() => call('DELETE', `${P}/intakes/${i.id}`)); }}>✕</button></div>
        ))}
        <form class="erow wrap2" onSubmit={(e) => {
          e.preventDefault(); if (!hookName.trim() || needLoc) return;
          void act(async () => { const r = await call('POST', `${P}/intakes`, { kind: 'webhook', name: hookName.trim(), stageId, ...locBody }); setSecret({ label: t.hookLink, value: r.url }); setHookName(''); });
        }}>
          <input placeholder={t.hookName} aria-label={t.hookName} value={hookName} onInput={(e) => setHookName((e.target as HTMLInputElement).value)} />
          <button class="btn quiet" disabled={!hookName.trim() || needLoc}>{t.createLink}</button>
        </form>
        <pre class="sample">{`POST <link>\n{"name":"Jane Roe","email":"jane@example.com","phone":"555-0100","value":1200,"note":"Wants a quote","custom":{"policy_no":"A-1"}}`}</pre>
      </section>

      <section class="icard">
        <h3>{t.sendApps}</h3>
        <p class="muted">{t.sendAppsHelp}</p>
        {hooks.map((h) => (
          <div class="erow" key={h.id}><span class={h.active ? '' : 'strike'}>{h.url} <small class="muted">{h.lastStatus == null ? t.neverSent : `${h.lastStatus || t.failed} · ${when(h.lastAt)}`}{!h.active ? ` · ${t.autoPaused}` : ''}</small></span><span class="spacer" />
            <button class="ib danger" aria-label={t.remove} onClick={() => void act(() => call('DELETE', `${P}/webhooks/${h.id}`))}>✕</button></div>
        ))}
        <form class="erow wrap2" onSubmit={(e) => {
          e.preventDefault(); if (!hookUrl.trim()) return;
          void act(async () => { const r = await call('POST', `${P}/webhooks`, { url: hookUrl.trim() }); setSecret({ label: t.signingSecret, value: r.secret }); setHookUrl(''); });
        }}>
          <input type="url" placeholder="https://hooks.zapier.com/…" aria-label={t.webhookUrl} value={hookUrl} onInput={(e) => setHookUrl((e.target as HTMLInputElement).value)} />
          <button class="btn quiet" disabled={!hookUrl.trim()}>{t.addWebhook}</button>
        </form>
      </section>

      <section class="icard">
        <h3>{t.automateTasks}</h3>
        <p class="muted">{t.automationsHelp}</p>
        <button class="btn quiet" onClick={onAutomations}>{t.openAutomations}</button>
      </section>
      <section class="icard soon">
        <h3>{t.comingSoon}</h3>
        <p class="muted">{t.soonList}</p>
      </section>

      <div class="actions"><button class="btn quiet" onClick={onClose}>{t.close}</button></div>
    </aside>
  );
}
