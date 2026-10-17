import { useEffect, useState } from 'preact/hooks';
type Call=(method:'GET'|'POST',path:string,body?:unknown)=>Promise<any>;
type Hold={id:string;reason:string;created_by:string;created_at:string;released_by:string|null;released_at:string|null;release_reason:string|null};
export function CarrierHoldsPanel({call,contractId}:{call:Call;contractId:string}){
 const [holds,setHolds]=useState<Hold[]>([]);
 const [reason,setReason]=useState('');
 const [error,setError]=useState('');
 const [releaseReasons,setReleaseReasons]=useState<Record<string,string>>({});
 const url='/v1/compliance/carrier-contracts/'+contractId+'/holds';
 const refresh=async()=>{try{const r=await call('GET',url);setHolds(r.holds??[]);}catch(e){setError(String(e));}};
 useEffect(()=>{void refresh();},[call,contractId]);
 const create=async()=>{try{await call('POST',url,{reason});setReason('');await refresh();}catch(e){setError(String(e));}};
 const release=async(id:string)=>{try{await call('POST',url+'/'+id+'/release',{reason:(releaseReasons[id]??'').trim()});setReleaseReasons(p=>({...p,[id]:''}));await refresh();}catch(e){setError(String(e));}};
 return <section class="obcard">
  <h4>Carrier compliance holds</h4>
  {error&&<p role="alert">{error}</p>}
  <label>Hold reason<input value={reason} maxLength={500} onInput={e=>setReason((e.target as HTMLInputElement).value)}/></label>
  <button type="button" disabled={reason.trim().length<8} onClick={()=>void create()}>Place hold</button>
  {holds.map(h=><div key={h.id}><p>{h.released_at?'Released':'Open'}: {h.reason} · opened {String(h.created_at).slice(0,10)}{h.released_at?' · released '+String(h.released_at).slice(0,10)+' ('+(h.release_reason??'')+')':''}</p>{!h.released_at&&<><label>Release reason<input maxLength={500} value={releaseReasons[h.id]??''} onInput={e=>setReleaseReasons(p=>({...p,[h.id]:(e.target as HTMLInputElement).value}))}/></label><button type="button" disabled={(releaseReasons[h.id]??'').trim().length<8} onClick={()=>void release(h.id)}>Release hold</button></>}</div>)}
 </section>;
}
