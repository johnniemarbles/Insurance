import { useEffect, useState } from 'preact/hooks';
import type { Locale } from './types.ts';

type Call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown) => Promise<any>;
type Draft = { mode: 'manual' | 'semi_automated'; recipientTo: string | null; recipientCc: string[]; replyTo: string | null; subjectTemplate: string; bodyTemplate: string };
const initial: Draft = { mode: 'manual', recipientTo: null, recipientCc: [], replyTo: null, subjectTemplate: 'Carrier contracting application — {{caseReference}}', bodyTemplate: 'Please review the attached contracting application.' };
export function IaContractingSettings({ call, locale, editable }: { call: Call; locale: Locale; editable: boolean }) {
  const fr = locale === 'fr-CA';
  const [draft, setDraft] = useState<Draft>(initial);
  const [ccText, setCcText] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let live = true;
    call('GET', '/v1/compliance/carrier-submission-settings/ia').then(r => {
      if (!live) return;
      const s = r.settings as Draft & { revision: number };
      setDraft({ mode: s.mode, recipientTo: s.recipientTo, recipientCc: s.recipientCc, replyTo: s.replyTo, subjectTemplate: s.subjectTemplate, bodyTemplate: s.bodyTemplate });
      setCcText(s.recipientCc.join(', '));
      setRevision(s.revision);
      setLoaded(true);
    }, () => { if (live) setMessage(fr ? 'Impossible de charger les paramètres.' : 'Could not load carrier settings.'); });
    return () => { live = false; };
  }, [call, locale]);
  const update = (key: keyof Draft, value: Draft[keyof Draft]) => setDraft(v => ({ ...v, [key]: value }));
  const save = async () => {
    setBusy(true); setMessage('');
    try {
      const recipientCc = ccText.split(',').map(x => x.trim()).filter(Boolean);
      const result = await call('PUT', '/v1/compliance/carrier-submission-settings/ia', { ...draft, recipientCc, expectedRevision: revision });
      setDraft(v => ({ ...v, recipientCc }));
      setRevision(result.settings.revision);
      setMessage(fr ? 'Enregistré. La vérification du destinataire est requise avant tout envoi.' : 'Saved. Recipient verification is required before any sending.');
    } catch (err) {
      setMessage((err instanceof Error ? err.message : String(err)) + (fr ? ' Actualisez la page avant de réessayer.' : ' Reload before retrying.'));
    } finally { setBusy(false); }
  };
  return <section class="hcard" id="s-ia-contracting">
    <h3>{fr ? 'Industrial Alliance — contrat direct' : 'Industrial Alliance — Direct contracting'}</h3>
    <p class="muted">{fr ? 'Punjab Insurance Agency envoie directement à iA, sans MGA intermédiaire.' : 'Punjab Insurance Agency submits directly to iA, without an MGA intermediary.'}</p>
    <p class="muted">{fr ? 'Les envois sont désactivés jusqu’à vérification du destinataire et approbation.' : 'Sending is disabled until the recipient is verified and the package is approved.'}</p>
    {!loaded ? <p role="status">{message || (fr ? 'Chargement…' : 'Loading…')}</p> : <>
      <div style={{ display: 'grid', gap: 12, maxWidth: 650 }}>
        <label>{fr ? 'Mode' : 'Mode'}<select disabled={!editable || busy} value={draft.mode} onChange={e => update('mode', e.currentTarget.value as Draft['mode'])}><option value="manual">{fr ? 'Manuel' : 'Manual'}</option><option value="semi_automated">{fr ? 'Semi-automatique' : 'Semi-automated'}</option></select></label>
        <label>{fr ? 'Destinataire principal (À)' : 'Primary recipient (To)'}<input type="email" disabled={!editable || busy} value={draft.recipientTo ?? ''} onInput={e => update('recipientTo', e.currentTarget.value || null)} placeholder="contracting@example.com" /></label>
        <label>{fr ? 'Copie (séparée par des virgules)' : 'CC (comma-separated)'}<input type="text" disabled={!editable || busy} value={ccText} onInput={e => setCcText(e.currentTarget.value)} /></label>
        <label>{fr ? 'Adresse de réponse' : 'Reply-To'}<input type="email" disabled={!editable || busy} value={draft.replyTo ?? ''} onInput={e => update('replyTo', e.currentTarget.value || null)} /></label>
        <label>{fr ? 'Objet du courriel' : 'Email subject'}<input type="text" disabled={!editable || busy} value={draft.subjectTemplate} onInput={e => update('subjectTemplate', e.currentTarget.value)} /></label>
        <label>{fr ? 'Modèle du message' : 'Email body template'}<textarea rows={5} disabled={!editable || busy} value={draft.bodyTemplate} onInput={e => update('bodyTemplate', e.currentTarget.value)} /></label>
        <div class="muted">{fr ? 'Version de configuration' : 'Configuration revision'}: {revision} · {fr ? 'Destinataire non vérifié' : 'Recipient not verified'}</div>
        {editable && <button class="btn primary" disabled={busy} onClick={() => void save()}>{busy ? (fr ? 'Enregistrement…' : 'Saving…') : (fr ? 'Enregistrer' : 'Save configuration')}</button>}
        {message && <p role="status">{message}</p>}
      </div>
    </>}
  </section>;
}
