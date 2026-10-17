import { useEffect, useRef, useState } from 'preact/hooks';
type Call=(method:'GET'|'POST',path:string,body?:unknown)=>Promise<any>;
type Evidence={id:string;kind:string;productCode:string;evidenceRef:string;effectiveOn:string;expiresOn:string;revokedAt:string|null};
export function CarrierAuthorizationEvidencePanel({call,contractId}:{call:Call;contractId:string}) {
 const [items,setItems]=useState<Evidence[]>([]);
 const [kind,setKind]=useState('training');
 const [productCode,setProductCode]=useState('');
 const [evidenceRef,setEvidenceRef]=useState('');
 const [effectiveOn,setEffectiveOn]=useState('');
 const [expiresOn,setExpiresOn]=useState('');
 const [confirmed,setConfirmed]=useState(false);
 const [reason,setReason]=useState('');
 const [error,setError]=useState('');
 const [busy,setBusy]=useState(false);
 const [loading,setLoading]=useState(false);
 const generation=useRef(0);
 const loadSequence=useRef(0);
 const validProduct=/^[A-Z0-9_-]{1,80}$/.test(productCode.trim().toUpperCase());
 const validEvidence=evidenceRef.trim().length>=8&&evidenceRef.trim().length<=500&&!/[\u0000-\u001f\u007f]/.test(evidenceRef);
 const validDates=!!effectiveOn&&!!expiresOn&&effectiveOn<=expiresOn;
 const validReason=reason.trim().length>=8&&reason.trim().length<=500&&!/[\u0000-\u001f\u007f]/.test(reason);
 useEffect(()=>{generation.current++;setItems([]);setError('');setBusy(false);setLoading(false);loadSequence.current++;setReason('');setEvidenceRef('');setProductCode('');setConfirmed(false);return ()=>{generation.current++;};},[contractId]);
 const load=async()=>{const version=generation.current;const request=++loadSequence.current;setLoading(true);try{const r=await call('GET',`/v1/compliance/carrier-contracts/${contractId}/authorization-evidence`);if(version===generation.current&&request===loadSequence.current){setItems(r.evidence??[]);setError('');}}catch(e){if(version===generation.current&&request===loadSequence.current)setError(String(e));}finally{if(version===generation.current&&request===loadSequence.current)setLoading(false);}};
 const save=async()=>{const version=generation.current;setBusy(true);try{await call('POST',`/v1/compliance/carrier-contracts/${contractId}/authorization-evidence`,{kind,productCode:productCode.trim().toUpperCase(),evidenceRef:evidenceRef.trim(),effectiveOn,expiresOn,confirmedWithSource:confirmed});if(version!==generation.current)return;setEvidenceRef('');setConfirmed(false);await load();}catch(e){if(version===generation.current)setError(String(e));}finally{if(version===generation.current)setBusy(false);}};
 const revoke=async(id:string)=>{const version=generation.current;setBusy(true);try{await call('POST',`/v1/compliance/carrier-authorization-evidence/${id}/revoke`,{reason});if(version!==generation.current)return;await load();if(version===generation.current)setReason('');}catch(e){if(version===generation.current)setError(String(e));}finally{if(version===generation.current)setBusy(false);}};
 return <details><summary>Training, product, jurisdiction and hold evidence</summary>
  <p class="muted">Compliance attestations are audit records, not independent carrier integration or permission to sell.</p>
  <button type="button" class="btn" disabled={loading} onClick={()=>void load()}>{loading?'Loading evidence…':'Load evidence'}</button>
  <label>Evidence type<select value={kind} onChange={e=>setKind((e.target as HTMLSelectElement).value)}>
    {['training','product_scope','jurisdiction_scope','hold_clearance'].map(x=><option value={x}>{x}</option>)}
  </select></label>
  <label>Product code<input maxLength={80} value={productCode} onInput={e=>setProductCode((e.target as HTMLInputElement).value)}/></label>
  <label>Source reference<input maxLength={500} value={evidenceRef} onInput={e=>setEvidenceRef((e.target as HTMLInputElement).value)}/></label>
  <label>Effective on<input type="date" value={effectiveOn} onInput={e=>setEffectiveOn((e.target as HTMLInputElement).value)}/></label>
  <label>Expires on<input type="date" min={effectiveOn||undefined} value={expiresOn} onInput={e=>setExpiresOn((e.target as HTMLInputElement).value)}/></label>
  <label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed((e.target as HTMLInputElement).checked)}/> Independently checked with the source</label>
  <button class="btn" type="button" disabled={busy||!confirmed||!validProduct||!validEvidence||!validDates} onClick={()=>void save()}>Record verification</button>
  <label>Revocation reason<input maxLength={500} value={reason} onInput={e=>setReason((e.target as HTMLInputElement).value)}/></label>
  {items.map(x=><div key={x.id}>{x.kind} · {x.productCode} · {x.evidenceRef} · {x.effectiveOn} – {x.expiresOn}
    {x.revokedAt?<strong> · Revoked</strong>:<button type="button" class="btn" disabled={busy||!validReason} onClick={()=>void revoke(x.id)}>Revoke</button>}
  </div>)}
  {error&&<p role="alert" class="err">{error}</p>}
 </details>;
}
