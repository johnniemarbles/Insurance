import { useEffect, useState } from 'preact/hooks';
import { CarrierEvidenceForm } from './carrier-evidence.tsx';
import { CarrierAuthorizationEvidencePanel } from './carrier-authorization-evidence.tsx';
type Call = (method: 'GET' | 'POST', path: string, body?: unknown) => Promise<any>;
type Contract = { id: string; carrierName: string; jurisdiction: string; state: string; effectiveState?: string; onboardingCaseId: string; updatedAt: string; templateVersion: string | null; appointmentEffectiveOn: string | null; appointmentExpiresOn: string | null; appointmentCurrentlyValid: boolean };
const options: Record<string,string[]> = {
 requested:['documents_prepared','withdrawn'],
 documents_prepared:[],
 broker_signed:['submitted','correction_required','withdrawn'],
 submitted:['carrier_review','correction_required','declined'],
 carrier_review:['correction_required','declined'],
 correction_required:['documents_prepared','withdrawn'],
 approved:[],
 appointment_verified:[],
 active:['suspended','terminated'],
 suspended:['terminated'],
 expired:['terminated']
};
export function CarrierReviewPanel({call,locale}:{call:Call;locale:string}) {
 const [contracts,setContracts]=useState<Contract[]>([]);
 const [error,setError]=useState('');
 const [busy,setBusy]=useState(false);
 const [reason,setReason]=useState('');
 const [templateVersion,setTemplateVersion]=useState('');
 const [history,setHistory]=useState<Record<string,{toState:string;fromState:string|null;reason:string|null;recordedAt:string}[]>>({});
 const [eligibility,setEligibility]=useState<Record<string,{blocks:string[];authorized:boolean;evidence?:Record<string,boolean>}>>({});
 const fr=locale==='fr-CA';
 const refresh=async()=>{try{const r=await call('GET','/v1/compliance/carrier-contracts');setContracts(r.contracts??[]);setError('');}catch(e){setError(String(e));}};
 useEffect(()=>{void refresh();},[call]);
 const checkEligibility=async(id:string)=>{try{const result=await call('GET',`/v1/compliance/carrier-contracts/${id}/eligibility`);setEligibility(previous=>({...previous,[id]:result}));}catch(e){setError(String(e));}};
 const showHistory=async(id:string)=>{try{const r=await call('GET',`/v1/compliance/carrier-contracts/${id}/history`);setHistory(p=>({...p,[id]:r.events??[]}));}catch(e){setError(String(e));}};
 const reconcile=async()=>{setBusy(true);try{const r=await call('POST','/v1/compliance/carrier-contracts/reconcile-expiry',{});await refresh();setError('');}catch(e){setError(String(e));}finally{setBusy(false);}};
 const move=async(id:string,state:string)=>{
   setBusy(true);
   try{await call('POST',`/v1/compliance/carrier-contracts/${id}/review`,{state,reason,templateVersion});setReason('');await refresh();}
   catch(e){setError(String(e));}finally{setBusy(false);}
 };
 return <section class="obcard">
   <h3>{fr?'Contrats des assureurs':'Carrier contracting queue'}</h3>
   <p class="muted">{fr?'Les signatures et les nominations doivent être vérifiées séparément.':'Signatures and carrier appointments must be verified separately. No selling authorization is granted here.'}</p>
   {error&&<p role="alert" class="err">{error}</p>}
   <button class="btn" type="button" disabled={busy} onClick={()=>void reconcile()}>{fr?'Rapprocher les nominations expirées':'Reconcile expired appointments'}</button>
   <label class="fl">{fr?'Motif de la décision':'Review reason'}
     <input value={reason} maxLength={500} onInput={e=>setReason((e.target as HTMLInputElement).value)}/></label>
   <label class="fl">{fr?'Version du modèle de contrat':'Carrier agreement template version'}
     <input value={templateVersion} maxLength={120} onInput={e=>setTemplateVersion((e.target as HTMLInputElement).value)}/></label>
   {contracts.length===0?<p class="muted">{fr?'Aucun contrat en attente.':'No carrier contracts found.'}</p>:
     <ul class="oblist">{contracts.map(c=><li key={c.id}>
       <div><strong>{c.carrierName}</strong> · {c.jurisdiction} · {c.effectiveState??c.state}
         <small class="muted"> · {c.onboardingCaseId}</small></div>
       {c.templateVersion&&<p class="muted">{fr?'Modèle':'Template'}: {c.templateVersion}</p>}
       {c.appointmentEffectiveOn&&<p class="muted">{fr?'Nomination':'Appointment'}: {String(c.appointmentEffectiveOn).slice(0,10)} – {c.appointmentExpiresOn?String(c.appointmentExpiresOn).slice(0,10):(fr?'sans date de fin enregistrée':'no expiry recorded')}</p>}
       {c.state==='active'&&!c.appointmentCurrentlyValid&&<p role="alert" class="err">{fr?'Nomination non valide actuellement — vérification requise':'Appointment is not currently valid — review required'}</p>}
       <CarrierEvidenceForm call={call} id={c.id} state={c.effectiveState??c.state} onSaved={refresh}/>
       <CarrierAuthorizationEvidencePanel call={call} contractId={c.id}/>
       <button class="btn" type="button" onClick={()=>void showHistory(c.id)}>{fr?'Historique':'Review history'}</button>
       {history[c.id]&&<ol>{history[c.id]!.map((e,i)=><li key={i}>{e.fromState??'—'} → {e.toState} · {String(e.recordedAt).slice(0,19)}{e.reason?` · ${e.reason}`:''}</li>)}</ol>}
       <button class="btn" type="button" onClick={()=>void checkEligibility(c.id)}>{fr?'Vérifier les conditions':'Check eligibility'}</button>
       {eligibility[c.id]&&<div role="status"><p class="muted">{fr?'Autorisation bloquée':'Authorization blocked'}: {eligibility[c.id]!.blocks.join(', ')}</p>{eligibility[c.id]!.evidence&&<ul>{Object.entries(eligibility[c.id]!.evidence!).map(([name,ok])=><li key={name}>{name}: {ok?'✓':'✗'}</li>)}</ul>}</div>}
       <div>{(options[c.effectiveState??c.state]??[]).map(next=><button class="btn" type="button" disabled={busy || (next==='documents_prepared'&&!templateVersion.trim()) ||
         (['declined','withdrawn','suspended','terminated','correction_required'].includes(next)&&!reason.trim())}
         onClick={()=>void move(c.id,next)}>{next.replaceAll('_',' ')}</button>)}</div>
     </li>)}</ul>}
 </section>;
}
