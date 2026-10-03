export const CSS = `
:host{all:initial}
*{box-sizing:border-box}
.pii{font:14px/1.45 "Google Sans",Roboto,system-ui,sans-serif;color:#1f2937;background:#fff;min-height:100%;display:flex;flex-direction:column}
.pii button{font:inherit;cursor:pointer}
.bar{display:flex;align-items:center;gap:12px;padding:12px 20px;border-bottom:1px solid #e5e7eb;flex-wrap:wrap}
.bar h1{font-size:18px;margin:0 8px 0 0;font-weight:600}
.sel{padding:7px 10px;border:1px solid #d1d5db;border-radius:8px;background:#fff;font:inherit;max-width:260px}
.seg{display:inline-flex;border:1px solid #d1d5db;border-radius:8px;overflow:hidden}
.seg button{border:0;background:#fff;padding:7px 14px;color:#374151}
.seg button[aria-pressed=true]{background:#1d4ed8;color:#fff}
.search{flex:1;min-width:140px;max-width:320px;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;font:inherit}
.btn{border:0;border-radius:8px;background:#1d4ed8;color:#fff;padding:8px 16px;font-weight:500}
.btn.quiet{background:#eef2ff;color:#1d4ed8}.btn:disabled{opacity:.5;cursor:default}
.spacer{flex:1}
.stages{display:flex;gap:4px;padding:14px 20px 6px;overflow-x:auto}
.stagebtn{flex:1 1 0;min-width:120px;border:0;border-radius:6px;color:#fff;text-align:left;padding:8px 12px;position:relative;
  clip-path:polygon(0 0,calc(100% - 12px) 0,100% 50%,calc(100% - 12px) 100%,0 100%,12px 50%);padding-left:20px;padding-right:18px}
.stagebtn:first-child{clip-path:polygon(0 0,calc(100% - 12px) 0,100% 50%,calc(100% - 12px) 100%,0 100%);padding-left:12px}
.stagebtn[aria-pressed=true]{outline:3px solid #111;outline-offset:-3px}
.stagebtn.dim{opacity:.45}
.stagebtn b{display:block;font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.stagebtn span{font-size:12px;opacity:.95}
.meta{display:flex;gap:12px;align-items:center;padding:6px 20px;color:#6b7280;font-size:13px}
.meta button{border:0;background:none;color:#1d4ed8;padding:0}
.wrap{overflow:auto;flex:1;padding:0 20px 20px}
table{width:100%;border-collapse:collapse}
th{position:sticky;top:0;background:#f9fafb;text-align:left;font-weight:500;font-size:12px;color:#4b5563;padding:9px 10px;border-bottom:1px solid #e5e7eb;white-space:nowrap}
th button{all:unset;cursor:pointer}
th button:focus-visible{outline:2px solid #1d4ed8}
td{padding:9px 10px;border-bottom:1px solid #f3f4f6;white-space:nowrap;max-width:260px;overflow:hidden;text-overflow:ellipsis}
tr.row{cursor:pointer}tr.row:hover td,tr.row:focus td{background:#f8fafc}
tr.row:focus{outline:2px solid #1d4ed8;outline-offset:-2px}
.pill{display:inline-block;border-radius:999px;color:#fff;padding:2px 10px;font-size:12px}
.age{color:#6b7280}.age.warn{color:#b45309;font-weight:600}.age.bad{color:#b91c1c;font-weight:600}
.name{font-weight:500}
.msg{padding:40px 20px;text-align:center;color:#6b7280}
.err{color:#b91c1c;padding:12px 20px}
.drawer{position:absolute;top:0;right:0;bottom:0;width:min(420px,100%);background:#fff;border-left:1px solid #e5e7eb;box-shadow:-8px 0 24px rgba(0,0,0,.08);padding:20px;overflow:auto}
.drawer h2{margin:0 0 12px;font-size:17px}
.drawer label{display:block;margin:12px 0 4px;color:#4b5563;font-size:12px}
.drawer input,.drawer select{width:100%;padding:8px;border:1px solid #d1d5db;border-radius:8px;font:inherit}
.kv{display:grid;grid-template-columns:120px 1fr;gap:6px 10px;margin:12px 0}.kv dt{color:#6b7280}.kv dd{margin:0}
.ev{border-left:2px solid #e5e7eb;padding:0 0 12px 12px;margin-left:4px;font-size:13px}.ev small{color:#6b7280;display:block}
.actions{display:flex;gap:8px;margin-top:16px}
.ok{color:#047857;font-size:13px}
.root{position:relative;flex:1;display:flex;flex-direction:column;min-height:0}
@media (max-width:640px){.bar{padding:10px 12px}.stages,.meta,.wrap{padding-left:12px;padding-right:12px}}
`;
