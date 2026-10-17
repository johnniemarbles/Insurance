import { useState } from 'preact/hooks';
type Call = (method:'GET'|'POST', path:string, body?:unknown)=>Promise<any>;
export function CarrierEvidenceForm({call,id,state,onSaved}:{call:Call;id:string;state:string;onSaved:()=>Promise<void>}) {
 const [reference,setReference]=useState('');
 const [effectiveOn,setEffectiveOn]=useState('');
 const [expiresOn,setExpiresOn]=useState('');
 const [confirmed,setConfirmed]=useState(false);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const kind=state==='documents_prepared'?'signature':state==='carrier_review'?'carrier_approval':state==='approved'?'appointment':null;
 if (!kind) return null;
 return <form class="obform" onSubmit={e=>{
   e.preventDefault();setBusy(true);setError('');
   void call('POST',`/v1/compliance/carrier-contracts/${id}/verify`,
     {kind,reference,confirmedWithSource:confirmed,effectiveOn,expiresOn})
     .then(()=>{setReference('');setConfirmed(false);return onSaved();})
     .catch(e=>setError(String(e))).finally(()=>setBusy(false));
 }}>
   <label class="fl">Evidence reference
     <input required minLength={8} maxLength={500} value={reference}
       onInput={e=>setReference((e.target as HTMLInputElement).value)}/></label>
   {kind==='appointment'&&<label class="fl">Appointment effective date
     <input type="date" required value={effectiveOn}
       onInput={e=>setEffectiveOn((e.target as HTMLInputElement).value)}/></label>}
   {kind==='appointment'&&<label class="fl">Appointment expiry date (if specified)
     <input type="date" value={expiresOn} min={effectiveOn || undefined}
       onInput={e=>setExpiresOn((e.target as HTMLInputElement).value)}/></label>}
   <label><input type="checkbox" required checked={confirmed}
     onChange={e=>setConfirmed((e.target as HTMLInputElement).checked)}/>
     I independently verified this evidence with the source.</label>
   {error&&<p class="err" role="alert">{error}</p>}
   <button class="btn" type="submit" disabled={busy||!confirmed||reference.trim().length<8}>Record verified {kind.replace('_',' ')}</button>
 </form>;
}
