import { useEffect, useRef, useState } from 'preact/hooks';
import { CarrierEvidenceForm } from './carrier-evidence.tsx';
import { CarrierAuthorizationEvidencePanel } from './carrier-authorization-evidence.tsx';
import { CarrierHoldsPanel } from './carrier-holds.tsx';
import { CarrierBusinessStagingPanel } from './carrier-business-staging.tsx';
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
 const [loading,setLoading]=useState(true);
 const [reasons,setReasons]=useState<Record<string,string>>({});
 const [contractProducts,setContractProducts]=useState<Record<string,string>>({});
 const latestProducts=useRef<Record<string,string>>({});
 const [productRevocationReason,setProductRevocationReason]=useState<Record<string,string>>({});
 const [preflight,setPreflight]=useState<Record<string,{missing:string[];blocks?:string[];eligibleForFurtherChecks:boolean}>>({});
 const [templateVersions,setTemplateVersions]=useState<Record<string,string>>({});
 const [history,setHistory]=useState<Record<string,{toState:string;fromState:string|null;reason:string|null;recordedAt:string}[]>>({});
 const [eligibility,setEligibility]=useState<Record<string,{blocks:string[];authorized:boolean;evidence?:Record<string,boolean>}>>({});
 const fr=locale==='fr-CA';
 const activeCount=contracts.filter(c=>c.effectiveState==='active'||c.state==='active').length;
 const attentionCount=contracts.filter(c=>['suspended','expired','correction_required'].includes(c.effectiveState??c.state)||(c.state==='active'&&!c.appointmentCurrentlyValid)).length;
 const [expanded,setExpanded]=useState<Record<string,boolean>>({});
 const [search,setSearch]=useState('');
 const [statusFilter,setStatusFilter]=useState('all');
 const visibleContracts=contracts.filter(c=>{
   const state=c.effectiveState??c.state;
   const query=search.trim().toLocaleLowerCase();
   return (statusFilter==='all'||(statusFilter==='attention'?['suspended','expired','correction_required'].includes(state)||(c.state==='active'&&!c.appointmentCurrentlyValid):state===statusFilter))
     && (!query||[c.carrierName,c.jurisdiction,c.onboardingCaseId].some(value=>value.toLocaleLowerCase().includes(query)));
 });
 const refresh=async()=>{try{const r=await call('GET','/v1/compliance/carrier-contracts');setContracts(r.contracts??[]);setError('');}catch(e){setError(String(e));}finally{setLoading(false);}};
 useEffect(()=>{void refresh();},[call]);
 const checkEligibility=async(id:string)=>{try{const result=await call('GET',`/v1/compliance/carrier-contracts/${id}/eligibility`);setEligibility(previous=>({...previous,[id]:result}));}catch(e){setError(String(e));}};
 const showHistory=async(id:string)=>{try{const r=await call('GET',`/v1/compliance/carrier-contracts/${id}/history`);setHistory(p=>({...p,[id]:r.events??[]}));}catch(e){setError(String(e));}};
 const productFor=(id:string)=>(contractProducts[id]??'').trim().toUpperCase();
 const validProduct=(id:string)=>/^[A-Z0-9_-]{1,80}$/.test(productFor(id));
 const checkProduct=async(id:string)=>{const selected=productFor(id);try{const r=await call('GET',`/v1/carrier-contracts/${id}/products/${selected}/preflight`);if(latestProducts.current[id]===selected){setPreflight(p=>({...p,[id]:r}));setError('');}}catch(e){setError(String(e));}};
 const activate=async(id:string)=>{setBusy(true);try{const r=await call('POST',`/v1/compliance/carrier-contracts/${id}/activate`,{productCode:productFor(id)});if(!r.activated)setError(`Activation blocked: ${(r.blocks??[]).join(', ')}`);else{setError('');await refresh();}}catch(e){setError(String(e));}finally{setBusy(false);}};
 const revokeProduct=async(id:string)=>{setBusy(true);try{await call('POST',`/v1/compliance/carrier-contracts/${id}/products/${productFor(id)}/revoke`,{reason:productRevocationReason[id]??''});setProductRevocationReason(p=>({...p,[id]:''}));setPreflight(p=>{const next={...p};delete next[id];return next;});setError('');await refresh();}catch(e){setError(String(e));}finally{setBusy(false);}};
 const reconcile=async()=>{setBusy(true);try{const r=await call('POST','/v1/compliance/carrier-contracts/reconcile-expiry',{});await refresh();setError('');}catch(e){setError(String(e));}finally{setBusy(false);}};
 const move=async(id:string,state:string)=>{
   setBusy(true);
   try{await call('POST',`/v1/compliance/carrier-contracts/${id}/review`,{state,reason:reasons[id]??'',templateVersion:templateVersions[id]??''});setReasons(p=>({...p,[id]:''}));await refresh();}
   catch(e){setError(String(e));}finally{setBusy(false);}
 };
 return <section class="obcard">
   <h3>{fr?'Contrats des assureurs':'Carrier contracting queue'}</h3>
   <p class="muted">{fr?'Les signatures et les nominations doivent être vérifiées séparément.':'Signatures and carrier appointments must be verified separately. No selling authorization is granted here.'}</p>
   {error&&<p role="alert" class="err">{error}</p>}
   <div class="obcard" role="status"><strong>{fr?'Vue d’ensemble des contrats':'Contract overview'}</strong><p>{contracts.length} {fr?'contrats':'contracts'} · {activeCount} {fr?'actifs':'active'} · {attentionCount} {fr?'à examiner':'requiring attention'}</p></div>
   <button class="btn" type="button" disabled={busy} onClick={()=>void reconcile()}>{fr?'Rapprocher les nominations expirées':'Reconcile expired appointments'}</button>

   <div class="obcard"><label class="fl">{fr?'Rechercher un assureur ou une juridiction':'Search carrier or jurisdiction'}<input type="search" value={search} onInput={e=>setSearch((e.target as HTMLInputElement).value)}/></label><label class="fl">{fr?'Filtrer les contrats':'Filter contracts'}<select value={statusFilter} onChange={e=>setStatusFilter((e.target as HTMLSelectElement).value)}><option value="all">{fr?'Tous':'All'}</option><option value="attention">{fr?'À examiner':'Needs attention'}</option><option value="active">{fr?'Actifs':'Active'}</option><option value="appointment_verified">{fr?'Nominations vérifiées':'Appointment verified'}</option><option value="requested">{fr?'Demandés':'Requested'}</option><option value="suspended">{fr?'Suspendus':'Suspended'}</option><option value="expired">{fr?'Expirés':'Expired'}</option></select></label></div>
   {loading?<p role="status" class="muted">{fr?'Chargement des contrats…':'Loading carrier contracts…'}</p>:contracts.length===0?<p class="muted">{error?(fr?'Impossible de charger les contrats.':'Unable to load contracts.'):(fr?'Aucun contrat en attente.':'No carrier contracts found.')}</p>:
     <ul class="oblist">{visibleContracts.length===0?<li class="muted">{fr?'Aucun contrat ne correspond aux filtres.':'No contracts match these filters.'}</li>:visibleContracts.map(c=><li key={c.id}>
       <div><strong>{c.carrierName}</strong> · {c.jurisdiction} · {c.effectiveState??c.state}
         <small class="muted"> · {c.onboardingCaseId}</small></div>
       {c.templateVersion&&<p class="muted">{fr?'Modèle':'Template'}: {c.templateVersion}</p>}
       {c.appointmentEffectiveOn&&<p class="muted">{fr?'Nomination':'Appointment'}: {String(c.appointmentEffectiveOn).slice(0,10)} – {c.appointmentExpiresOn?String(c.appointmentExpiresOn).slice(0,10):(fr?'sans date de fin enregistrée':'no expiry recorded')}</p>}
       {c.state==='active'&&!c.appointmentCurrentlyValid&&<p role="alert" class="err">{fr?'Nomination non valide actuellement — vérification requise':'Appointment is not currently valid — review required'}</p>}
       <button type="button" class="btn" aria-expanded={expanded[c.id]===true} onClick={()=>setExpanded(p=>({...p,[c.id]:!p[c.id]}))}>{expanded[c.id]?(fr?'Masquer le flux de travail':'Hide workflow'):(fr?'Ouvrir le flux de travail':'Open workflow')}</button>
       {expanded[c.id]&&<div>
       <h4>{fr?'1. Contrat et preuve de nomination':'1. Contract and appointment evidence'}</h4>
       <label class="fl">{fr?'Motif de la décision':'Review reason'}<input value={reasons[c.id]??''} maxLength={500} onInput={e=>setReasons(p=>({...p,[c.id]:(e.target as HTMLInputElement).value}))}/></label>
       <label class="fl">{fr?'Version du modèle de contrat':'Carrier agreement template version'}<input value={templateVersions[c.id]??''} maxLength={120} onInput={e=>setTemplateVersions(p=>({...p,[c.id]:(e.target as HTMLInputElement).value}))}/></label>
       <label class="fl">Product code for this carrier<input maxLength={80} value={contractProducts[c.id]??''} onInput={e=>{latestProducts.current[c.id]=(e.target as HTMLInputElement).value.toUpperCase();setContractProducts(p=>({...p,[c.id]:latestProducts.current[c.id]}));setPreflight(p=>{const next={...p};delete next[c.id];return next;});}}/></label>
       {!validProduct(c.id)&&productFor(c.id).length>0&&<p class="err" role="alert">{fr?'Utilisez 1 à 80 caractères : A–Z, 0–9, _ ou -.':'Use 1–80 characters: A–Z, 0–9, _ or -.'}</p>}
       <label class="fl">Product revocation reason<input value={productRevocationReason[c.id]??''} maxLength={500} onInput={e=>setProductRevocationReason(p=>({...p,[c.id]:(e.target as HTMLInputElement).value}))}/></label>
       <CarrierEvidenceForm call={call} id={c.id} state={c.effectiveState??c.state} onSaved={refresh}/>
       <h4>{fr?'2. Vérification de conformité':'2. Compliance verification'}</h4>
       <CarrierAuthorizationEvidencePanel call={call} contractId={c.id}/>
       <CarrierHoldsPanel call={call} contractId={c.id}/>
       <h4>{fr?'3. Autorisation du produit':'3. Product authorization'}</h4>
       <button class="btn" type="button" disabled={busy||!validProduct(c.id)} onClick={()=>void checkProduct(c.id)}>Check product evidence</button>
       {preflight[c.id]&&<p class="muted" role="status">{preflight[c.id]!.eligibleForFurtherChecks?'Evidence present; final checks still required':`Missing or invalid: ${(preflight[c.id]!.blocks??preflight[c.id]!.missing).join(', ')}`}</p>}
       {(c.state==='appointment_verified'||c.state==='active')&&<button class="btn" type="button" disabled={busy||!validProduct(c.id)} onClick={()=>void activate(c.id)}>Activate after eligibility checks</button>}
       {c.state==='active'&&<button class="btn" type="button" disabled={busy||!validProduct(c.id)||(productRevocationReason[c.id]??'').trim().length<8} onClick={()=>void revokeProduct(c.id)}>Revoke product authorization</button>}
       <h4>{fr?'4. Enregistrement interne':'4. Internal business staging'}</h4>
       <CarrierBusinessStagingPanel call={call} contractId={c.id}/>
       <h4>{fr?'5. Historique et suivi':'5. History and monitoring'}</h4>
       <button class="btn" type="button" onClick={()=>void showHistory(c.id)}>{fr?'Historique':'Review history'}</button>
       {history[c.id]&&<ol>{history[c.id]!.map((e,i)=><li key={i}>{e.fromState??'—'} → {e.toState} · {String(e.recordedAt).slice(0,19)}{e.reason?` · ${e.reason}`:''}</li>)}</ol>}
       <button class="btn" type="button" onClick={()=>void checkEligibility(c.id)}>{fr?'Vérifier les conditions':'Check eligibility'}</button>
       {eligibility[c.id]&&<div role="status"><p class="muted">{fr?'Autorisation bloquée':'Authorization blocked'}: {eligibility[c.id]!.blocks.join(', ')}</p>{eligibility[c.id]!.evidence&&<ul>{Object.entries(eligibility[c.id]!.evidence!).map(([name,ok])=><li key={name}>{name}: {ok?'✓':'✗'}</li>)}</ul>}</div>}
       <div>{(options[c.effectiveState??c.state]??[]).map(next=><button class="btn" type="button" disabled={busy || (next==='documents_prepared'&&!(templateVersions[c.id]??'').trim()) ||
         (['declined','withdrawn','suspended','terminated','correction_required'].includes(next)&&!(reasons[c.id]??'').trim())}
         onClick={()=>void move(c.id,next)}>{next.replaceAll('_',' ')}</button>)}</div>
       </div>}
     </li>)}</ul>}
 </section>;
}
