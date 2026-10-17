import { useState } from 'preact/hooks';
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
 const load=async()=>{const r=await call('GET',`/v1/compliance/carrier-contracts/${contractId}/authorization-evidence`);setItems(r.evidence??[]);};
 const save=async()=>{setBusy(true);try{await call('POST',`/v1/compliance/carrier-contracts/${contractId}/authorization-evidence`,{kind,productCode,evidenceRef,effectiveOn,expiresOn,confirmedWithSource:confirmed});setEvidenceRef('');setConfirmed(false);await load();setError('');}catch(e){setError(String(e));}finally{setBusy(false);}};
 const revoke=async(id:string)=>{setBusy(true);try{await call('POST',`/v1/compliance/carrier-authorization-evidence/${id}/revoke`,{reason});await load();setReason('');setError('');}catch(e){setError(String(e));}finally{setBusy(false);}};
 return <details><summary>Training, product, jurisdiction and hold evidence</summary>
  <p class="muted">Compliance attestations are audit records, not independent carrier integration or permission to sell.</p>
  <button type="button" class="btn" onClick={()=>void load()}>Load evidence</button>
  <label>Evidence type<select value={kind} onChange={e=>setKind((e.target as HTMLSelectElement).value)}>
    {['training','product_scope','jurisdiction_scope','hold_clearance'].map(x=><option value={x}>{x}</option>)}
  </select></label>
  <label>Product code<input value={productCode} onInput={e=>setProductCode((e.target as HTMLInputElement).value)}/></label>
  <label>Source reference<input value={evidenceRef} onInput={e=>setEvidenceRef((e.target as HTMLInputElement).value)}/></label>
  <label>Effective on<input type="date" value={effectiveOn} onInput={e=>setEffectiveOn((e.target as HTMLInputElement).value)}/></label>
  <label>Expires on<input type="date" value={expiresOn} onInput={e=>setExpiresOn((e.target as HTMLInputElement).value)}/></label>
  <label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed((e.target as HTMLInputElement).checked)}/> Independently checked with the source</label>
  <button class="btn" type="button" disabled={busy||!confirmed||!productCode||evidenceRef.length<8||!effectiveOn||!expiresOn} onClick={()=>void save()}>Record verification</button>
  <label>Revocation reason<input value={reason} onInput={e=>setReason((e.target as HTMLInputElement).value)}/></label>
  {items.map(x=><div key={x.id}>{x.kind} · {x.productCode} · {x.evidenceRef} · {x.effectiveOn} – {x.expiresOn}
    {x.revokedAt?<strong> · Revoked</strong>:<button type="button" class="btn" disabled={busy||reason.trim().length<8} onClick={()=>void revoke(x.id)}>Revoke</button>}
  </div>)}
  {error&&<p role="alert" class="err">{error}</p>}
 </details>;
}
