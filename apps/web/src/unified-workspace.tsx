import { useEffect, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { Locale } from './types.ts';

type Call = (method: 'GET'|'POST'|'PUT'|'PATCH'|'DELETE', path: string, body?: unknown) => Promise<any>;
type Module = 'crm'|'compliance'|'training'|'learning'|'audit'|'onboarding'|'carriers'|'notifications';
interface Context {
  version: number; tenantId: string; country: 'CA'|'US'; roles: string[];
  activeNodeIds: string[]; isTenantAdmin: boolean;
  modules: Record<Module, boolean>; scopes: {id:string;name:string}[];
}
type Load<T> = {state:'loading'}|{state:'ready';value:T}|{state:'error';message:string}|{state:'forbidden'}|{state:'unavailable'};
const pending = <T,>():Load<T> => ({state:'loading'});
const workspaceNames:Record<string,string> = {
  admin:'Executive',manager:'Manager',partner:'Broker',compliance:'Compliance',
  auditor:'Audit',trainer:'Training',learner:'Learning',staff:'Operations'
};
const priorities:Record<string,Module[]> = {
  admin:['crm','compliance','onboarding','carriers','training','learning','audit','notifications'],
  manager:['crm','onboarding','training','learning','notifications'],
  partner:['crm','onboarding','learning','notifications'],
  compliance:['compliance','onboarding','carriers','audit','notifications'],
  auditor:['audit','notifications'],
  trainer:['training','learning','notifications'],
  learner:['learning','notifications'],
  staff:['crm','learning','notifications'],
};
const endpoints:Partial<Record<Module,string>> = {
  crm:'/v1/dashboard?days=30',
  audit:'/v1/audit/me',
  notifications:'/v1/notifications?limit=20',
  carriers:'/v1/compliance/carrier-contracts',
  compliance:'/v1/onboarding/dashboard',
  onboarding:'/v1/onboarding/dashboard',
  training:'/v1/training/dashboard',
  learning:'/v1/my/learning',
};
const title:Record<Module,string> = {
  crm:'Pipeline performance',compliance:'Compliance alerts',onboarding:'Onboarding',
  carriers:'Carrier authorizations',learning:'My learning',training:'Training and CE',audit:'Audit engagements',
  notifications:'Notifications'
};
const destinations:Record<Module,string> = {
  crm:'pipelines',compliance:'compliance',onboarding:'compliance',
  carriers:'compliance',learning:'training',training:'training',audit:'compliance',notifications:'notifications'
};
function Metrics({module,data}:{module:Module;data:any}) {
  let entries:[string,string|number][]=[];
  if(module==='crm' && data?.totals) entries=[
    ['Open records',data.totals.openCount],['Won (30 days)',data.totals.won],
    ['Win rate',data.totals.winRate==null?'—':Math.round(data.totals.winRate*100)+'%']];
  if((module==='compliance'||module==='onboarding') && data) entries=[
    ['Expired',data.expiry?.expired??'—'],['Expiring soon',data.expiry?.expiringSoon??'—'],
    ['Overdue reports',data.selfReports?.overdue??'—'],['Rechecks overdue',data.rechecks?.overdue??'—']];
  if(module==='carriers' && Array.isArray(data?.contracts)) entries=[['Contract cases (max 200)',data.contracts.length],['Expired appointments',data.contracts.filter((x:any)=>x.effectiveState==='expired').length],['Valid appointment dates — not authorization',data.contracts.filter((x:any)=>x.appointmentCurrentlyValid===true).length]];
  if(module==='audit' && Array.isArray(data?.engagements)) entries=[['Active',data.engagements.filter((e:any)=>e.status==='active').length],['Visible',data.engagements.length]];
  if(module==='notifications' && Array.isArray(data?.notifications)) entries=[['Unread',data.unread??0],['Recent',data.notifications.length]];
  if(module==='learning' && Array.isArray(data?.enrollments)) entries=[['Enrolled',data.enrollments.length],['To do',data.enrollments.filter((e:any)=>e.status!=='completed').length],['Completed',data.enrollments.filter((e:any)=>e.status==='completed').length],['Due soon or overdue',data.enrollments.filter((e:any)=>e.status!=='completed'&&e.dueAt&&new Date(e.dueAt).getTime()<Date.now()+7*86400000).length]];
  if(module==='training' && data?.totals) entries=[
    ['Assigned',data.totals.assigned],['In progress',data.totals.inProgress],
    ['Completed',data.totals.completed],['Overdue',data.totals.overdue]];
  if(!entries.length)return <p>No summary data is available. Open the workspace for details.</p>;
  return <div class="pii-workspace-metrics" style={{display:"grid",gridTemplateColumns:"repeat(2,minmax(0,1fr))",gap:"12px"}}>{entries.map(([name,value])=>
    <div class="pii-workspace-metric" key={name} style={{padding:"12px",borderRadius:"8px",background:"rgba(125,140,165,.08)"}}><small>{name}</small><strong>{value}</strong></div>)}</div>;
}
function Panel({module,load,go}:{module:Module;load:Load<any>;go:(page:string)=>void}) {
  return <section class="pii-workspace-panel" style={{border:"1px solid #dfe5ed",borderRadius:"12px",padding:"20px"}} aria-label={title[module]}>
    <div class="pii-workspace-panel-head"><h2>{title[module]}</h2>
      <button class="btn" onClick={()=>go(destinations[module])}>Open workspace</button></div>
    {load.state==='loading'?<p role="status">Loading…</p>:
     load.state==='forbidden'?<p>Access not granted for this workspace.</p>:
     load.state==='unavailable'?<p>Summary not connected yet. Open the specialist workspace.</p>:
     load.state==='error'?<p role="alert">Could not load this summary: {load.message}</p>:
     <Metrics module={module} data={load.value}/>}
  </section>;
}
export function UnifiedWorkspace({call,go,locale,name,legacyHome}:{call:Call;go:(page:string)=>void;locale:Locale;name:string;legacyHome?:ComponentChildren}) {
  const [context,setContext]=useState<Load<Context>>(pending());
  const [active,setActive]=useState('');
  const [loads,setLoads]=useState<Partial<Record<Module,Load<any>>>>({});
  const [generation,setGeneration]=useState(0);
  useEffect(()=>{
    let cancelled=false;
    setContext(pending());setLoads({});
    call('GET','/v1/workspace/context').then((value:Context)=>{
      if(cancelled)return;
      setContext({state:'ready',value});
      setActive(previous=>value.roles.includes(previous)?previous:
        (['admin','manager','compliance','auditor','trainer','partner','learner','staff'].find(r=>value.roles.includes(r))??'staff'));
    },(e:Error)=>{if(!cancelled)setContext({state:'error',message:e.message});});
    return ()=>{cancelled=true};
  },[call,generation]);
  useEffect(()=>{
    if(context.state!=='ready' || !active || !context.value.roles.includes(active))return;
    let cancelled=false;
    const allowed=(priorities[active]??[]).filter(m=>context.value.modules[m]);
    setLoads(Object.fromEntries(allowed.map(m=>[m,pending()])));
    for(const m of allowed){
      const path=endpoints[m];
      if(!path){setLoads(old=>({...old,[m]:{state:'unavailable'}}));continue;}
      call('GET',path).then(value=>{
        if(!cancelled)setLoads(old=>({...old,[m]:{state:'ready',value}}));
      },(e:Error & {status?:number})=>{
        if(!cancelled)setLoads(old=>({...old,[m]:e.status===403?{state:'forbidden'}:{state:'error',message:e.message}}));
      });
    }
    return ()=>{cancelled=true};
  },[context,active,call]);
  if(context.state==='loading')return <div class="pii-workspace"><p role="status">Loading your workspace…</p></div>;
  if(context.state==='error')return <div class="pii-workspace"><p role="alert">{context.message}</p>
    <button class="btn" onClick={()=>setGeneration(x=>x+1)}>Retry</button></div>;
  if(context.state!=='ready')return null;
  const c=context.value;
  const visible=c.roles.includes(active)?(priorities[active]??[]).filter(m=>c.modules[m]):[];
  return <main class="pii-workspace" style={{padding:"24px",maxWidth:"1400px",margin:"0 auto"}}>
    <header class="pii-workspace-header">
      <div><small>{c.country} · {c.scopes.map(s=>s.name).join(', ')||'Authorized workspace'}</small>
        <h1>{locale==='fr-CA'?'Mon espace de travail':'My workspace'}{name?', '+name:''}</h1>
        <p>{workspaceNames[active]??'Personal'} overview · Data limited to your authorized access</p></div>
      <button class="btn" onClick={()=>setGeneration(x=>x+1)}>Refresh</button>
    </header>
    {c.roles.length>1&&<nav aria-label="Workspace perspective" class="pii-workspace-roles">
      {c.roles.map(r=><button key={r} class="btn" aria-pressed={r===active}
        onClick={()=>setActive(r)}>{workspaceNames[r]??r}</button>)}</nav>}
    {visible.length?<div class="pii-workspace-grid" style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(320px,1fr))",gap:"16px"}}>{visible.map(m=>
      <Panel key={m} module={m} load={loads[m]??pending()} go={go}/>)}</div>:
      <p>No summary modules are currently available for this role. Contact your administrator if access is expected.</p>}
    {c.roles.includes(active) && c.modules.crm && (priorities[active]??[]).includes('crm') && legacyHome}
    <p class="pii-workspace-footnote">Perspective changes do not elevate permissions. All records are authorized by the server.</p>
  </main>;
}
