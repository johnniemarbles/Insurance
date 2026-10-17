import { useEffect, useRef, useState } from 'preact/hooks';

type Call = (method: 'GET' | 'POST', path: string, body?: unknown) => Promise<any>;
type Staged = { id: string; product_code: string; external_reference: string; status: string; created_at: string };

export function CarrierBusinessStagingPanel({ call, contractId }: { call: Call; contractId: string }) {
  const [entries, setEntries] = useState<Staged[]>([]);
  const [product, setProduct] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const activeContract = useRef(contractId);
  const requestVersion = useRef(0);
  if (activeContract.current !== contractId) {
    activeContract.current = contractId;
    requestVersion.current += 1;
  }
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const path = `/v1/compliance/carrier-contracts/${contractId}/business-staging`;

  useEffect(() => {
    let active = true;
    const version = ++requestVersion.current;
    setEntries([]);
    setBusy(false);
    setProduct('');
    setReference('');
    setError('');
    setMessage('');
    void call('GET', path).then(result => {
      if (active && requestVersion.current === version) setEntries(result.submissions ?? []);
    }).catch(e => { if (active && requestVersion.current === version) setError(String(e)); });
    return () => { active = false; };
  }, [call, contractId]);

  const stage = async () => {
    const requestedContract = contractId;
    const version = requestVersion.current;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await call('POST', path, { productCode: product.trim().toUpperCase(), externalReference: reference.trim() });
      if (activeContract.current !== requestedContract || requestVersion.current !== version) return;
      if (!result.staged) {
        setError(result.reason === 'duplicate_external_reference' ? 'Reference already staged.' : 'Carrier product authorization is not current.');
        return;
      }
      if (activeContract.current !== requestedContract || requestVersion.current !== version) return;
      setReference('');
      setMessage('Recorded in the internal staging ledger. Nothing has been sent to an insurer.');
      const latest = await call('GET', path);
      if (activeContract.current === requestedContract && requestVersion.current === version) setEntries(latest.submissions ?? []);
    } catch (e) {
      if (activeContract.current !== requestedContract || requestVersion.current !== version) return;
      const description = String(e);
      setError(description.includes('duplicate_external_reference') ? 'Reference already staged.' : description.includes('carrier_product_not_authorized') ? 'Carrier product authorization is not current.' : description);
    } finally {
      if (activeContract.current === requestedContract && requestVersion.current === version) setBusy(false);
    }
  };

  return <section class="obcard">
    <h4>Internal carrier business staging</h4>
    <p class="muted">Compliance-only internal record. This does not submit business to an insurer.</p>
    {error && <p role="alert" class="err">{error}</p>}
    {message && <p role="status">{message}</p>}
    <label class="fl">Authorized product code
      <input maxLength={80} value={product} onInput={e => setProduct((e.target as HTMLInputElement).value.toUpperCase())}/>
    </label>
    <label class="fl">External business reference
      <input maxLength={120} value={reference} onInput={e => setReference((e.target as HTMLInputElement).value)}/>
    </label>
    <button class="btn" type="button" disabled={busy || !/^[A-Z0-9_-]{1,80}$/.test(product.trim()) || !reference.trim() || reference.trim().length > 120 || /[\u0000-\u001f\u007f]/.test(reference)} onClick={() => void stage()}>
      {busy ? 'Recording…' : 'Stage internally'}
    </button>
    {entries.length === 0 ? <p class="muted">No staged business records.</p> :
      <ul>{entries.map(entry => <li key={entry.id}>{entry.product_code} · {entry.external_reference} · {String(entry.created_at).slice(0,10)} · {entry.status}</li>)}</ul>}
  </section>;
}
