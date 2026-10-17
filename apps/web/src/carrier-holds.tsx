import { useEffect, useState } from 'preact/hooks';
type Call=(method:'GET'|'POST',path:string,body?:unknown)=>Promise<any>;
type Hold={id:string;reason:string;created_at:string;released_at:string|null;release_reason:string|null};
export function CarrierHoldsPanel({call,contractId}:{call:Call;contractId:string}){
 const [holds,setHolds]=useState<Hold[]>([]);
 const [reason,setReason]=useState('');
 const [error,setError]=useState('');
 const url='/v1/compliance/carrier-contracts/'+contractId+'/holds';
 const refresh=async()=>{try{const r=await call('GET',url);setHolds(r.holds??[]);}catch(e){setError(String(e));}};
 useEffect(()=>{void refresh();},[call,contractId]);
 const create=async()=>{try{await call('POST',url,{reason});setReason('');await refresh();}catch(e){setError(String(e));}};
 return <section class="obcard">
  <h4>Carrier compliance holds</h4>
  {error&&<p role="alert">{error}</p>}
  <label>Hold reason<input value={reason} maxLength={500} onInput={e=>setReason((e.target as HTMLInputElement).value)}/></label>
  <button type="button" disabled={reason.trim().length<8} onClick={()=>void create()}>Place hold</button>
  {holds.map(h=><p key={h.id}>{h.released_at?'Released':'Open'}: {h.reason}</p>)}
 </section>;
}
