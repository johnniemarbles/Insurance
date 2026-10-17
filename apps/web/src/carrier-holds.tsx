import { useEffect, useRef, useState } from 'preact/hooks';
type Call=(method:'GET'|'POST',path:string,body?:unknown)=>Promise<any>;
type Hold={id:string;reason:string;created_by:string;created_at:string;released_by:string|null;released_at:string|null;release_reason:string|null};
export function CarrierHoldsPanel({call,contractId}:{call:Call;contractId:string}){
 const [holds,setHolds]=useState<Hold[]>([]);
 const generation=useRef(0);
 const [reason,setReason]=useState('');
 const [error,setError]=useState('');
 const [busy,setBusy]=useState(false);
 const [releaseReasons,setReleaseReasons]=useState<Record<string,string>>({});
 const url='/v1/compliance/carrier-contracts/'+contractId+'/holds';
 const refresh=async(version:number)=>{try{const r=await call('GET',url);if(generation.current!==version)return;setHolds(r.holds??[]);setError('');}catch(e){if(generation.current===version)setError(String(e));}};
 useEffect(()=>{const version=++generation.current;setHolds([]);setReason('');setReleaseReasons({});setError('');setBusy(false);void refresh(version);return ()=>{generation.current++;};},[call,contractId]);
 const create=async()=>{const version=generation.current;setBusy(true);try{await call('POST',url,{reason});if(generation.current!==version)return;setReason('');await refresh(version);}catch(e){if(generation.current===version)setError(String(e));}finally{if(generation.current===version)setBusy(false);}};
 const release=async(id:string)=>{const version=generation.current;setBusy(true);try{await call('POST',url+'/'+id+'/release',{reason:(releaseReasons[id]??'').trim()});if(generation.current!==version)return;setReleaseReasons(p=>({...p,[id]:''}));await refresh(version);}catch(e){if(generation.current===version)setError(String(e));}finally{if(generation.current===version)setBusy(false);}};
 return <section class="obcard">
  <h4>Carrier compliance holds</h4>
  {error&&<p role="alert">{error}</p>}
  <label>Hold reason<input value={reason} maxLength={500} onInput={e=>setReason((e.target as HTMLInputElement).value)}/></label>
  <button type="button" disabled={busy||reason.trim().length<8||reason.trim().length>500} onClick={()=>void create()}>Place hold</button>
  {holds.map(h=><div key={h.id}><p>{h.released_at?'Released':'Open'}: {h.reason} · opened {String(h.created_at).slice(0,10)}{h.released_at?' · released '+String(h.released_at).slice(0,10)+' ('+(h.release_reason??'')+')':''}</p>{!h.released_at&&<><label>Release reason<input maxLength={500} value={releaseReasons[h.id]??''} onInput={e=>setReleaseReasons(p=>({...p,[h.id]:(e.target as HTMLInputElement).value}))}/></label><button type="button" disabled={busy||(releaseReasons[h.id]??'').trim().length<8||(releaseReasons[h.id]??'').trim().length>500} onClick={()=>void release(h.id)}>Release hold</button></>}</div>)}
 </section>;
}
