export const CSS = `
:host{all:initial;--pri:#0347F2;--pri-h:#0A3FD0;--navy:#0A1F5C;--ink:#1B2447;--mute:#5A6486;--faint:#98A1BD;--accent:#800028;--accent-soft:#FBE9EF;--bg:#fff;--tint:#F4F7FF;--tint2:#EAEFFC;--line:#E3E9FB;--line2:#CFD8F3;--pri-soft:#EEF3FF;--pri-soft2:#DCE6FF;--pri-line:#AFC2F7;--ok:#0E8F5B;--ok-soft:#E6F6EF;--warn:#B7791F;--warn-soft:#FDF3DD;--err:#C81E3A;--err-soft:#FDE8EC;--r:10px;--r-sm:7px;--sh:0 1px 2px rgba(10,31,92,.06),0 4px 14px rgba(10,31,92,.08)}
*{box-sizing:border-box}
.pii:focus{outline:none}
.pii{font:14px/1.45 "Google Sans",Roboto,system-ui,sans-serif;color:var(--ink);background:var(--bg);min-height:100%;display:flex;flex-direction:column}
.pii button{font:inherit;cursor:pointer}
.bar{display:flex;align-items:center;gap:12px;padding:12px 20px;border-bottom:1px solid var(--line);flex-wrap:wrap}
.bar h1{font-size:18px;margin:0 8px 0 0;font-weight:600;color:var(--navy);letter-spacing:-.01em}.btn:hover{background:var(--pri-h)}.btn:active{transform:translateY(1px)}.pii button:focus-visible,.pii a:focus-visible{outline:2px solid var(--pri);outline-offset:2px}.btn.quiet:hover{background:var(--pri-soft2)}.ring{--p:0;width:64px;height:64px;border-radius:50%;background:conic-gradient(var(--accent) calc(var(--p)*1%),var(--accent-soft) 0);display:grid;place-items:center}.ring>span{width:50px;height:50px;border-radius:50%;background:var(--bg);display:grid;place-items:center;font-weight:600;color:var(--accent);font-size:14px}
.sel{padding:7px 10px;border:1px solid var(--line2);border-radius:8px;background:var(--bg);font:inherit;max-width:260px}
.seg{display:inline-flex;border:1px solid var(--line2);border-radius:8px;overflow:hidden}
.seg button{border:0;background:var(--bg);padding:7px 14px;color:var(--ink)}
.seg button[aria-pressed=true]{background:var(--pri);color:#fff}
.search{flex:1;min-width:140px;max-width:320px;padding:8px 12px;border:1px solid var(--line2);border-radius:8px;font:inherit}
.btn{border:0;border-radius:var(--r-sm);transition:background .12s,transform .06s;background:var(--pri);color:#fff;padding:8px 16px;font-weight:500}
.btn.quiet{background:var(--pri-soft);color:var(--pri)}.btn:disabled{opacity:.5;cursor:default}
.spacer{flex:1}
.stages{display:flex;gap:4px;padding:14px 20px 6px;overflow-x:auto}
.stagebtn{flex:1 1 0;min-width:120px;border:0;border-radius:6px;color:#fff;text-align:left;padding:8px 12px;position:relative;
  clip-path:polygon(0 0,calc(100% - 12px) 0,100% 50%,calc(100% - 12px) 100%,0 100%,12px 50%);padding-left:20px;padding-right:18px}
.stagebtn:first-child{clip-path:polygon(0 0,calc(100% - 12px) 0,100% 50%,calc(100% - 12px) 100%,0 100%);padding-left:12px}
.stagebtn[aria-pressed=true]{outline:3px solid #111;outline-offset:-3px}
.stagebtn.dim{opacity:.45}
.stagebtn b{display:block;font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.stagebtn span{font-size:12px;opacity:.95}
.meta{display:flex;gap:12px;align-items:center;padding:6px 20px;color:var(--mute);font-size:13px}
.meta button{border:0;background:none;color:var(--pri);padding:0}
.wrap{overflow:auto;flex:1;padding:0 20px 20px}
table{width:100%;border-collapse:collapse}
th{position:sticky;top:0;background:var(--tint);text-align:left;font-weight:500;font-size:12px;color:var(--mute);padding:9px 10px;border-bottom:1px solid var(--line);white-space:nowrap}
th button{all:unset;cursor:pointer}
th button:focus-visible{outline:2px solid var(--pri)}
td{padding:9px 10px;border-bottom:1px solid var(--tint2);white-space:nowrap;max-width:260px;overflow:hidden;text-overflow:ellipsis}
tr.row{cursor:pointer}tr.row:hover td,tr.row:focus td{background:var(--tint)}
tr.row:focus{outline:2px solid var(--pri);outline-offset:-2px}
.pill{display:inline-block;border-radius:999px;color:#fff;padding:2px 10px;font-size:12px}
.age{color:var(--mute)}.age.warn{color:var(--warn);font-weight:600}.age.bad{color:var(--err);font-weight:600}
.name{font-weight:500}
.msg{padding:40px 20px;text-align:center;color:var(--mute)}
.err{color:var(--err);padding:12px 20px}.errbar{display:flex;gap:12px;align-items:center}
.drawer{position:fixed;top:var(--pii-top,0);right:var(--pii-right,0);bottom:0;width:min(420px,100%);background:var(--bg);border-left:1px solid var(--line);box-shadow:-8px 0 24px rgba(0,0,0,.08);padding:20px;overflow:auto}
.drawer h2{margin:0 0 12px;font-size:17px}
.drawer label{display:block;margin:12px 0 4px;color:var(--mute);font-size:12px}
.drawer input,.drawer select{width:100%;padding:8px;border:1px solid var(--line2);border-radius:8px;font:inherit}
.kv{display:grid;grid-template-columns:120px 1fr;gap:6px 10px;margin:12px 0}.kv dt{color:var(--mute)}.kv dd{margin:0}
.ev{border-left:2px solid var(--line);padding:0 0 12px 12px;margin-left:4px;font-size:13px}.ev small{color:var(--mute);display:block}
.actions{display:flex;gap:8px;margin-top:16px}
.ok{color:#047857;font-size:13px}
.bulk{display:flex;gap:10px;align-items:center;padding:8px 20px;background:var(--pri-soft);border-top:1px solid var(--pri-line);border-bottom:1px solid var(--pri-line)}
td input[type=checkbox],th input[type=checkbox]{width:16px;height:16px}
.board{display:flex;gap:12px;align-items:flex-start;padding-top:8px;min-height:100%}
.col{flex:0 0 260px;background:var(--tint2);border-radius:10px;padding:8px;min-height:120px}
.col.over{background:var(--pri-soft2)}
.col header{border-top:4px solid;border-radius:4px;padding:8px 6px;display:flex;justify-content:space-between;gap:8px;font-size:13px}
.col header span{color:var(--mute)}
.card{background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:10px;margin-top:8px;cursor:grab;box-shadow:0 1px 2px rgba(0,0,0,.04)}
.card:hover,.card:focus{border-color:var(--pri);outline:none}
.cname{font-weight:500;margin-bottom:6px;overflow-wrap:anywhere}.cmeta{display:flex;justify-content:space-between;font-size:12px;color:var(--mute)}
.maplist{list-style:none;padding:0;margin:8px 0}.maplist li{padding:4px 0;border-bottom:1px solid var(--tint2);font-size:13px}.muted{color:var(--mute)}
.drawer.wide{width:min(520px,100%)}
.erow{display:flex;gap:6px;align-items:center;margin:6px 0;flex-wrap:wrap}.erow input:not([type=color]),.erow select{flex:1;min-width:90px;padding:7px 8px;border:1px solid var(--line2);border-radius:8px;font:inherit}
.erow input[type=color]{width:34px;height:34px;padding:0;border:1px solid var(--line2);border-radius:8px;background:var(--bg)}
.ib{border:1px solid var(--line2);background:var(--bg);border-radius:8px;width:30px;height:30px;color:var(--ink)}.ib:disabled{opacity:.35}.ib.danger{color:var(--err)}
.confirm{flex-basis:100%;display:flex;gap:8px;align-items:center;background:#fef2f2;padding:8px;border-radius:8px}
.tag{font-size:11px;color:var(--mute);background:var(--tint2);border-radius:999px;padding:2px 8px}
.check{display:flex!important;align-items:center;gap:8px}.check input{width:auto!important}
.tpl{display:block;width:100%;text-align:left;border:1px solid var(--line);background:var(--bg);border-radius:10px;padding:12px;margin:8px 0}.tpl:hover{border-color:var(--pri);background:var(--tint)}
.tpl b{display:block}.tpl span{display:block;color:var(--mute);margin:2px 0}.tpl small{color:var(--mute)}
.drawer{z-index:5}
.task{display:flex!important;gap:8px;align-items:flex-start;margin:6px 0!important;color:var(--ink)!important;font-size:14px!important}.task input{width:auto!important;margin-top:3px}
.strike{text-decoration:line-through;color:var(--mute)}.overdue{color:var(--err);font-weight:600}
.badge{background:var(--err);color:#fff;border-radius:999px;font-size:11px;padding:1px 7px;margin-left:6px}
.drawer textarea{width:100%;padding:8px;border:1px solid var(--line2);border-radius:8px;font:inherit;resize:vertical}
.pii .pii{flex:1;min-height:0;overflow:hidden}
.tabs{display:flex;gap:4px;padding:0 20px;border-bottom:1px solid var(--line);flex-wrap:wrap;align-items:center}
.savebar{position:sticky;bottom:0;display:flex;gap:8px;align-items:center;padding:10px 14px;margin-top:16px;background:var(--bg);border-top:1px solid var(--line);box-shadow:0 -6px 12px -8px rgba(0,0,0,.15);z-index:5}
.tabs-fb{margin-left:auto;font-size:12px;color:var(--mute);text-decoration:none;padding:6px 8px}.tabs-fb:hover{color:var(--pri);text-decoration:underline}
.banner{padding:9px 20px;font-size:13px}.banner.warn{background:var(--warn-soft);color:var(--warn);border-bottom:1px solid #fcd34d}
.tabs button{border:0;background:none;padding:10px 14px;color:var(--mute);border-bottom:3px solid transparent;font-weight:500}
.tabs button[aria-selected=true]{color:var(--pri);border-bottom-color:var(--pri)}
.train{flex:1;overflow:auto}.tpad{padding:16px 20px 40px;max-width:980px}.tpad.narrow{max-width:720px}
.tpad h1{font-size:20px;margin:6px 0}.tpad h3{margin:22px 0 8px;font-size:14px}
.link{border:0;background:none;color:var(--pri);padding:0}
.cgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px}
.ccard{text-align:left;border:1px solid var(--line);background:var(--bg);border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:6px}.ccard:hover{border-color:var(--pri)}
.pbar{height:8px;background:var(--line);border-radius:999px;overflow:hidden;margin:6px 0}.pbar i{display:block;height:100%;background:var(--ok)}
.lrow{display:flex;gap:6px;align-items:center;margin:6px 0}.lbtn{flex:1;display:flex;gap:10px;align-items:center;text-align:left;border:1px solid var(--line);background:var(--bg);border-radius:10px;padding:10px 12px}.lbtn:hover{border-color:var(--pri)}
.dot{width:26px;height:26px;border-radius:50%;background:var(--tint2);display:inline-grid;place-items:center;font-size:12px;color:var(--mute)}.dot.on{background:var(--ok);color:#fff}
.prose p{line-height:1.6;margin:0 0 12px}
.q{border:1px solid var(--line);border-radius:10px;margin:12px 0;padding:10px 14px}.q legend{font-weight:500;padding:0 6px}
.opt{display:flex;gap:8px;align-items:center;margin:6px 0}
.wide{width:100%;padding:8px;border:1px solid var(--line2);border-radius:8px;font:inherit;display:block}
.tpad label{display:block;margin:10px 0 4px;color:var(--mute);font-size:12px}
.chk{display:inline-flex;gap:6px;align-items:center;color:var(--ink)}.sel.small{padding:4px 8px;font-size:13px;max-width:200px}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.drawer:focus{outline:none}
.pii button:focus-visible,.pii a:focus-visible,.pii input:focus-visible,.pii select:focus-visible,.pii textarea:focus-visible{outline:2px solid var(--pri);outline-offset:2px}
.root{position:relative;flex:1;display:flex;flex-direction:column;min-height:0}
.fbar{position:relative;padding:8px 20px 0}
.fbox{display:flex;flex-wrap:wrap;gap:6px;align-items:center;border:1px solid var(--line2);border-radius:10px;padding:5px 10px;background:var(--bg);cursor:text;min-height:40px}
.fbox:focus-within{border-color:var(--pri);box-shadow:0 0 0 3px var(--pri-soft2)}
.fglass{color:var(--faint);font-size:16px}
.fin{flex:1;min-width:180px;border:0;outline:none!important;font:inherit;padding:4px 2px;background:transparent}
.chip{display:inline-flex;align-items:center;background:var(--pri-soft);color:var(--navy);border-radius:999px;font-size:13px;overflow:hidden}
.chiplabel{border:0;background:none;padding:3px 4px 3px 10px;color:inherit}
.chipx{border:0;background:none;padding:3px 9px 3px 4px;color:var(--mute);font-size:16px;line-height:1}
.chip:hover{background:var(--pri-soft2)}
.fclear{border:0;background:none;color:var(--pri);font-size:13px;margin-left:auto}
.fmenu,.fpop{position:absolute;left:20px;top:100%;margin-top:4px;z-index:20;background:var(--bg);border:1px solid var(--line);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.12);min-width:260px;max-width:min(420px,calc(100% - 40px));max-height:60vh;overflow:auto;padding:6px}
.fsec{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--mute);padding:8px 10px 2px}
.fopt{display:block;width:100%;text-align:left;border:0;background:none;padding:7px 10px;border-radius:6px}.fopt:hover,.fopt:focus{background:var(--pri-soft)}
.fpop{padding:10px}.fchk{display:flex;gap:8px;align-items:center;padding:5px 4px}.fchk input{width:auto}
.frow{display:flex;gap:8px;align-items:center;margin:6px 0}.frow label{min-width:110px;color:var(--mute)}.frow input{width:90px;padding:6px 8px;border:1px solid var(--line2);border-radius:8px;font:inherit}
.menuwrap{position:relative}.kebab{position:absolute;right:0;top:100%;margin-top:4px;z-index:20;background:var(--bg);border:1px solid var(--line);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.12);min-width:220px;padding:6px}
.kebab button{display:flex;justify-content:space-between;gap:12px;width:100%;text-align:left;border:0;background:none;padding:8px 10px;border-radius:6px}.kebab button:hover{background:var(--pri-soft)}.kebab small{color:var(--mute)}
tr.ghead td{background:var(--tint);border-bottom:1px solid var(--line);padding:6px 10px;max-width:none;position:sticky;top:33px;z-index:1}
.gtoggle{border:0;background:none;padding:2px 0;display:inline-flex;gap:8px;align-items:center}.gtoggle i{width:10px;height:10px;border-radius:3px;display:inline-block}
.gadd{border:0;background:none;color:var(--pri);margin-left:12px}
.quick{display:flex;gap:8px;padding:10px 0;flex-wrap:wrap}.quick input{flex:1;min-width:200px;padding:8px 12px;border:1px dashed var(--faint);border-radius:8px;font:inherit}.quick select{padding:7px 8px;border:1px solid var(--line2);border-radius:8px;font:inherit;max-width:200px}
.start{border:1px solid var(--pri-line);background:#f5f7ff;border-radius:12px;padding:14px 18px;margin:10px 0;display:flex;flex-direction:column;align-items:flex-start;gap:8px}
.start h2{margin:0;font-size:16px}.start button:not(.link){border:1px solid var(--pri-line);background:var(--bg);border-radius:8px;padding:8px 12px;display:flex;gap:10px;align-items:center}.start b{display:inline-grid;place-items:center;width:22px;height:22px;border-radius:50%;background:var(--pri);color:#fff;font-size:12px}
.avatar{display:inline-grid;place-items:center;width:22px;height:22px;border-radius:50%;color:#fff;font-size:10px;font-weight:600;flex:none}
.who{display:inline-flex;gap:6px;align-items:center}
.namebtn{all:unset;cursor:pointer;font-weight:500;color:var(--navy)}.namebtn:hover{text-decoration:underline;color:var(--pri)}.namebtn:focus-visible{outline:2px solid var(--pri)}
td.ed{cursor:text}td.ed:hover{background:var(--pri-soft);box-shadow:inset 0 0 0 1px var(--pri-line)}td.ed:focus{outline:2px solid var(--pri);outline-offset:-2px}
td.editing{padding:3px 6px}td.editing input,td.editing select{width:100%;min-width:110px;padding:5px 6px;border:2px solid var(--pri);border-radius:6px;font:inherit}
.sticky1{position:sticky;left:0;z-index:2;background:var(--bg);width:40px;min-width:40px;max-width:40px;box-sizing:border-box;padding-left:12px;padding-right:0}.sticky2{position:sticky;left:40px;z-index:2;background:var(--bg);box-shadow:1px 0 0 var(--line)}
th.sticky1,th.sticky2{background:var(--tint);z-index:3}tr.row:hover td.sticky1,tr.row:hover td.sticky2{background:var(--tint)}
.fresh{display:inline-flex;gap:6px;align-items:center}.fresh i{width:9px;height:9px;border-radius:50%;background:var(--faint)}.fresh.good i{background:var(--ok)}.fresh.mid i{background:#f59e0b}.fresh.bad i{background:#dc2626}
.mini{display:inline-block;width:60px;height:6px;border-radius:999px;background:var(--line);overflow:hidden;vertical-align:middle}.mini i{display:block;height:100%;background:var(--ok)}
.colpick{width:320px;max-height:70vh;overflow:auto}.colpick p{margin:4px 8px 8px}.colrow{display:flex;justify-content:space-between;align-items:center}.colrow .ib{width:26px;height:26px;margin-left:4px}
.toast{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);background:var(--navy);color:#fff;border-radius:10px;padding:10px 16px;z-index:30;box-shadow:0 8px 24px rgba(0,0,0,.25);display:flex;gap:14px;align-items:center}.toast.bad{background:#7f1d1d;max-width:min(560px,92vw)}.toast button{border:0;background:none;color:var(--pri-line);font-weight:600}
.viz{margin:8px 0 14px;padding:12px 14px;border:1px solid var(--line);border-radius:12px;background:var(--bg)}.vizbar{display:flex;justify-content:flex-end;margin-bottom:6px}
.donut{display:flex;gap:24px;align-items:center;flex-wrap:wrap}.legend{list-style:none;margin:0;padding:0;display:grid;gap:4px}.legend i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:8px}
.cols{display:flex;gap:10px;align-items:flex-end;height:170px;padding-top:18px}.colbar{flex:1;min-width:48px;height:100%;display:flex;flex-direction:column;justify-content:flex-end;align-items:stretch;text-align:center;font-size:12px}
.colfill{border-radius:6px 6px 0 0}.colval{color:var(--ink);font-weight:600}.collab{color:var(--mute);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-top:4px}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px;margin:8px 0}.kpis div{border:1px solid var(--line);border-radius:10px;padding:10px}.kpis b{display:block;font-size:22px}.kpis span{display:block;color:var(--mute);font-size:12px}.kpis small{color:var(--mute)}
.funnel{display:grid;gap:6px}.frowx{display:grid;grid-template-columns:110px 1fr 90px 60px;gap:8px;align-items:center;font-size:13px}.fname{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.fbarx{background:var(--tint2);border-radius:6px;height:16px}.fbarx i{display:block;height:100%;border-radius:6px}
.mt{width:100%;font-size:13px}.mt th{position:static}.drawer h3{margin:18px 0 6px;font-size:14px}
.feed{padding:8px 0;border-bottom:1px solid var(--tint2)}.feed blockquote{margin:4px 0 0;padding-left:10px;border-left:3px solid var(--line);color:var(--mute)}
.scrim{position:fixed;inset:0;background:rgba(17,24,39,.35);display:flex;justify-content:center;align-items:flex-start;padding-top:12vh;z-index:50}
.palette{width:min(560px,92vw);background:var(--bg);border-radius:14px;box-shadow:0 20px 50px rgba(0,0,0,.3);overflow:hidden}.palette>input{width:100%;border:0;border-bottom:1px solid var(--line);padding:14px 16px;font:inherit;font-size:16px;outline:none}
.palrow{display:flex;justify-content:space-between;width:100%;text-align:left;border:0;background:none;padding:10px 16px}.palrow.on{background:var(--pri-soft)}.palrow small{color:var(--mute)}
.reqd{flex-basis:100%;font-size:13px;color:var(--mute)}.reqd summary{cursor:pointer}.reqd label{margin:2px 0 2px 16px!important}
.icard{border:1px solid var(--line);border-radius:12px;padding:4px 14px 12px;margin:14px 0}.icard h3{margin:10px 0 2px!important}.icard.soon{background:var(--tint)}
.secretbox{border:1px solid var(--pri-line);background:var(--pri-soft);border-radius:10px;padding:12px;margin:10px 0}.secretbox code{display:block;word-break:break-all;background:var(--bg);border:1px solid var(--pri-soft2);border-radius:6px;padding:8px;margin:8px 0;user-select:all}
.sample{background:var(--navy);color:var(--line);border-radius:8px;padding:10px;font-size:12px;white-space:pre-wrap;word-break:break-all}
.itabs{display:flex;margin:12px 0}.itabs button{flex:1;padding:8px 6px;font-size:13px}.itabs button[aria-selected=true]{background:var(--pri);color:#fff}
.gchips{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 10px}.gchip{border:1px solid var(--line2);background:var(--bg);border-radius:999px;padding:5px 12px;font-size:13px;color:var(--ink);cursor:pointer}.gchip[aria-pressed=true]{background:var(--navy);border-color:var(--navy);color:#fff}
.rcard{display:block;position:relative;width:100%;text-align:left;border:1px solid var(--line);background:var(--bg);border-radius:12px;padding:12px 78px 12px 14px;margin:8px 0;cursor:pointer;font:inherit}.rcard:hover,.rcard:focus-visible{border-color:var(--pri-line);box-shadow:0 2px 10px rgba(29,78,216,.1)}.rcard b{display:block;color:var(--navy)}.rcard span{display:block;color:var(--mute);font-size:13px;margin-top:2px}
.rbadge{font-style:normal;font-size:11px;font-weight:600;border-radius:6px;padding:2px 7px;background:#d1fae5;color:#065f46;vertical-align:middle}.rcard .rbadge{position:absolute;right:12px;top:12px}.rbadge.zapier{background:var(--line);color:var(--ink)}.rbadge.script{background:var(--warn-soft);color:var(--warn)}
.isteps{padding-left:20px;line-height:1.55}.isteps li{margin:6px 0}.linkbtn{border:0;background:none;color:var(--pri);padding:0;cursor:pointer;font:inherit;text-decoration:underline}.linkbtn.pill{background:var(--pri-soft);border-radius:999px;padding:2px 9px;margin:3px 4px 0 0;text-decoration:none;font-size:13px}.bad{color:var(--err)}
.wrap2 select,.wrap2 input:not([type=checkbox]){min-width:140px;flex:1 1 140px}
.settings{padding:16px 20px;max-width:860px;overflow:auto}.settings h2{margin:0 0 10px}.ssearch{width:100%;box-sizing:border-box;padding:9px 12px;border:1px solid var(--line2);border-radius:8px;font:inherit;margin-bottom:10px}
.tabs.sub{margin:6px 0 12px}.srow{padding:12px 0;border-bottom:1px solid var(--line)}.srow-h{display:flex;gap:8px;align-items:center}.srow p{margin:4px 0 8px}
.srcchip{font-size:11px;background:var(--pri-soft);color:#3730a3;border-radius:10px;padding:1px 8px}.srcchip.lockd{background:var(--warn-soft);color:var(--warn)}
.switch{display:inline-flex;gap:8px;align-items:center}.toast{position:sticky;bottom:12px;margin-top:14px;background:var(--navy);color:#fff;border-radius:8px;padding:9px 14px;display:flex;gap:14px;align-items:center;width:max-content}.toast .link{color:#a5b4fc}
.layout2{display:flex;gap:20px;flex-wrap:wrap}.navlist{list-style:none;margin:0;padding:0;flex:1 1 280px}.navlist li{display:flex;align-items:center;gap:8px;padding:7px 8px;border:1px solid var(--line);border-radius:8px;margin-bottom:6px;background:var(--bg);cursor:grab}.navlist li.dragging{opacity:.4}.grip{color:var(--faint);cursor:grab}
.navprev{flex:0 0 200px;border:1px solid var(--line);border-radius:10px;background:#f8fafd;padding:10px}.navprev-h{font-size:11px;color:var(--mute);margin-bottom:6px}.navprev-b strong{display:block;margin-bottom:4px}.navprev-i{padding:5px 8px;border-radius:14px;font-size:13px}.navprev-i:hover{background:#e8eaed}
.hwelcome{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}.hwelcome h2{margin:0}.hsum{margin:4px 0 14px}.hsec{margin-bottom:16px}.hsec-h{display:flex;align-items:center;gap:10px;justify-content:space-between;margin-bottom:8px}.hsec-h h3{margin:0}
.qa{display:flex;gap:10px;overflow-x:auto;padding:2px 2px 8px;align-items:stretch}.qcard{flex:0 0 auto;min-width:130px;max-width:190px;display:flex;flex-direction:column;gap:4px;align-items:flex-start;text-align:left;border:1px solid var(--line);border-radius:10px;background:var(--bg);padding:12px 14px;cursor:pointer;font:inherit}.qcard:hover{border-color:var(--pri-line);background:#f8fbff}.qcard.act{align-items:center;justify-content:center;text-align:center;min-width:110px;color:var(--pri)}.qico{font-size:18px;line-height:1;color:var(--mute)}.qcard.act .qico{color:var(--pri)}.qname{font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}.qsep{flex:0 0 1px;background:var(--line);margin:4px 2px}.qhint{align-self:center;margin:0 8px;max-width:240px}
.stagechip{color:#fff;border-radius:999px;font-size:12px;padding:1px 9px;font-weight:600}.rname{font-weight:600}
.snap{display:flex;gap:8px;overflow-x:auto;padding:4px 0 10px}.snapstage{flex:1 0 96px;display:flex;flex-direction:column;gap:2px;align-items:flex-start;text-align:left;border:1px solid var(--line);border-top:4px solid #6366f1;border-radius:8px;background:var(--bg);padding:8px 10px;cursor:pointer;font:inherit}.snapstage b{font-size:20px}.snapstage span{font-size:12px;color:var(--ink)}.snapstage:hover{background:var(--tint)}
.hist{margin-top:18px}.home{padding:16px 20px;overflow:auto}.home h2{margin:0 0 12px}.homegrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:14px}.hcard{border:1px solid var(--line);border-radius:12px;padding:12px 14px;background:var(--bg)}.hcard h3{margin:0 0 8px;font-size:14px}
.privacy{display:grid;gap:12px;max-width:640px}.privacy textarea,.privacy input{width:100%;box-sizing:border-box}.plain{list-style:none;padding:0;margin:0 0 8px}.privacy .row{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
.orgnode{border-top:1px solid var(--tint2);padding:6px 0}.orgtab input,.orgtab select{max-width:100%}
.ph{max-width:880px}.ph-head{display:flex;margin:4px 0 14px}.seg2{display:inline-flex;background:var(--tint2);border-radius:12px;padding:4px;gap:2px}.seg2 button{border:0;background:none;padding:7px 16px;border-radius:9px;color:var(--mute);font-weight:600}.seg2 button[aria-selected=true]{background:var(--bg);color:var(--pri);box-shadow:0 1px 3px rgba(15,23,42,.12)}
.ph-bar{display:flex;gap:10px;align-items:center;margin-bottom:12px;flex-wrap:wrap}.ph-search{flex:1;min-width:220px;max-width:360px;padding:10px 14px;border:1px solid var(--line);border-radius:12px;background:var(--tint);font:inherit}.ph-search:focus{outline:2px solid var(--pri-line);background:var(--bg)}.ph-search.wide{max-width:none;width:100%;margin:6px 0 10px}
.btn.big{padding:10px 20px;border-radius:12px;font-weight:600;background:linear-gradient(135deg,var(--pri-h),var(--pri));box-shadow:0 4px 12px rgba(37,99,235,.28)}.btn.big:hover{filter:brightness(1.07)}
.ph-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px}@media(max-width:620px){.ph-stats{grid-template-columns:repeat(2,1fr)}}
.stat{border:1px solid #e5e9f0;background:var(--bg);border-radius:14px;padding:12px 14px;text-align:left;display:flex;flex-direction:column;gap:2px;transition:box-shadow .15s,border-color .15s}.stat:hover{box-shadow:0 4px 14px rgba(15,23,42,.08)}.stat b{font-size:24px;line-height:1.1;color:var(--navy)}.stat span{color:var(--mute);font-size:13px}.stat[aria-pressed=true]{border-color:var(--pri-h);box-shadow:0 0 0 3px var(--pri-soft2)}.stat.attention b{color:var(--warn)}.stat.active b{color:var(--ok)}
.plist{display:flex;flex-direction:column;gap:8px}.prow{display:flex;gap:12px;align-items:flex-start;background:var(--bg);border:1px solid #e8ecf2;border-radius:14px;padding:12px 14px;position:relative;transition:box-shadow .15s}.prow:hover{box-shadow:0 4px 16px rgba(15,23,42,.07)}.prow.attn{border-color:#fcd9a0;background:linear-gradient(0deg,#fffdf7,#fff)}.prow.off{opacity:.7}
.av{display:inline-grid;place-items:center;border-radius:50%;color:#fff;font-weight:700;flex:none;letter-spacing:.02em}.pmain{flex:1;min-width:0}.pname{font-weight:600;color:var(--navy);display:flex;gap:8px;align-items:center;flex-wrap:wrap;overflow-wrap:anywhere}.you{color:var(--mute);font-weight:400}.psub{color:var(--mute);font-size:13px;margin-top:2px}.why{color:var(--warn);font-weight:500}
.pill{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:2px 10px;font-size:12px;font-weight:600;background:var(--tint2);color:var(--mute)}.pill i{width:7px;height:7px;border-radius:50%;background:currentColor}
.pill.s-sent{background:var(--pri-soft2);color:var(--pri)}.pill.s-opened{background:#ede9fe;color:#6d28d9}.pill.s-accepted{background:var(--ok-soft);color:var(--ok)}.pill.s-not_sent,.pill.s-expired{background:var(--warn-soft);color:var(--warn)}.pill.s-off{background:var(--line);color:var(--mute)}.pill.s-created{background:var(--tint2);color:var(--mute)}.pill.s-sending{background:var(--pri-soft2);color:#4338ca}.pill.s-sending i{animation:piipulse 1s ease-in-out infinite}@keyframes piipulse{50%{opacity:.25}}.chk{display:flex;gap:10px;align-items:flex-start;margin:12px 0;padding:10px 12px;border:1px solid var(--line);border-radius:10px;cursor:pointer}.chk input{margin-top:3px}.chk small{display:block;color:var(--mute);font-weight:400;margin-top:2px}.why.soft{margin-top:2px}.spin{display:inline-block;width:14px;height:14px;border:2px solid var(--pri-line);border-top-color:#4338ca;border-radius:50%;animation:piispin .8s linear infinite}@keyframes piispin{to{transform:rotate(360deg)}}
.roles{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}.rolechip{display:inline-flex;gap:6px;align-items:center;background:var(--pri-soft);color:#3730a3;border-radius:999px;padding:3px 10px;font-size:12.5px}.rolechip button{border:0;background:none;color:#6366f1;padding:0 0 0 2px;font-size:15px;line-height:1}.rolechip button:hover{color:var(--err)}
.pact{display:flex;gap:6px;align-items:center;position:relative}.btn.quiet{background:var(--pri-soft);color:var(--pri)}.more{border:0;background:var(--tint2);border-radius:8px;width:32px;height:32px;font-size:18px;color:var(--mute)}.menu{position:absolute;right:0;top:38px;background:var(--bg);border:1px solid var(--line);border-radius:12px;box-shadow:0 12px 30px rgba(15,23,42,.16);padding:6px;z-index:5;min-width:170px}.menu button{display:block;width:100%;text-align:left;border:0;background:none;padding:8px 10px;border-radius:8px}.menu button:hover{background:var(--tint2)}.menu button.danger{color:var(--err)}
.empty{text-align:center;padding:36px 16px;border:1px dashed #cbd5e1;border-radius:16px;background:var(--tint);margin:10px 0}.empty-ic{font-size:34px}.empty h3{margin:6px 0}.empty p{color:var(--mute);max-width:360px;margin:6px auto 14px}
.linkbox{border:1px solid var(--pri-line);background:var(--pri-soft);border-radius:14px;padding:12px 14px;margin-bottom:12px}.linkbox p{margin:2px 0 6px}.pad{padding:8px 2px}
.toast2{position:sticky;bottom:12px;margin:14px auto 0;width:fit-content;max-width:90%;background:var(--navy);color:#fff;border-radius:12px;padding:10px 16px;box-shadow:0 10px 30px rgba(15,23,42,.3)}
.mdl-back{position:fixed;inset:0;background:rgba(15,23,42,.45);backdrop-filter:blur(2px);display:grid;place-items:center;z-index:50;padding:12px}.mdl{background:var(--bg);border-radius:20px;width:min(560px,100%);max-height:92vh;overflow:auto;box-shadow:0 30px 80px rgba(15,23,42,.35);padding:18px 22px 16px}.mdl.small{width:min(420px,100%)}.mdl h3{margin:6px 0 4px;font-size:18px}.mdl-top{display:flex;justify-content:space-between;align-items:center;font-size:15px}.mdl-top .x{border:0;background:var(--tint2);border-radius:50%;width:30px;height:30px;font-size:18px}
.steps{list-style:none;display:flex;gap:6px;padding:0;margin:12px 0 8px}.steps li{flex:1;display:flex;gap:7px;align-items:center;color:#94a3b8;font-size:13px;font-weight:600;border-bottom:3px solid var(--line);padding-bottom:8px}.steps li span{width:22px;height:22px;border-radius:50%;background:var(--line);color:var(--mute);display:inline-grid;place-items:center;font-size:12px}.steps li.cur{color:var(--pri);border-color:var(--pri-h)}.steps li.cur span{background:var(--pri-h);color:#fff}.steps li.done{color:var(--ok);border-color:#86efac}.steps li.done span{background:#22c55e;color:#fff}
.mdl-body{padding:6px 0 4px;min-height:200px}.big-ta{width:100%;border:1px solid var(--line);border-radius:12px;padding:12px;font:inherit;background:var(--tint);resize:vertical}.big-ta:focus{outline:2px solid var(--pri-line);background:var(--bg)}.chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
.places{max-height:260px;overflow:auto;display:flex;flex-direction:column;gap:4px;margin-bottom:8px}.place{display:flex;gap:10px;align-items:center;text-align:left;border:1px solid #e8ecf2;background:var(--bg);border-radius:12px;padding:9px 12px}.place small{display:block;color:var(--mute);font-size:12px}.place:hover{background:var(--tint)}.place.sel{border-color:var(--pri-h);background:var(--pri-soft);box-shadow:0 0 0 3px var(--pri-soft2)}.pi{font-size:18px}
.rolegrid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.rolegrid.two{grid-template-columns:1fr 1fr}@media(max-width:520px){.rolegrid{grid-template-columns:1fr}}.rolecard{text-align:left;border:1px solid var(--line);background:var(--bg);border-radius:14px;padding:12px;display:flex;flex-direction:column;gap:4px}.rolecard small{color:var(--mute)}.rolecard:hover:not(:disabled){background:var(--tint)}.rolecard.sel{border-color:var(--pri-h);background:var(--pri-soft);box-shadow:0 0 0 3px var(--pri-soft2)}.rolecard:disabled{opacity:.55;cursor:not-allowed}
.review{margin-top:12px;background:var(--ok-soft);border:1px solid #bbf7d0;color:#14532d;border-radius:12px;padding:10px 12px}.fl{display:block;margin-top:10px;color:var(--mute);font-size:13px;font-weight:600}.fl select,.fl textarea{display:block;width:100%;margin-top:4px;padding:9px 10px;border:1px solid var(--line);border-radius:10px;font:inherit}
.mdl-foot{display:flex;gap:8px;align-items:center;margin-top:12px;padding-top:12px;border-top:1px solid var(--line)}.res{display:flex;gap:10px;padding:10px;border-radius:12px;margin:8px 0}.res.ok{background:var(--ok-soft)}.res.bad{background:var(--warn-soft)}.res.info{background:var(--pri-soft)}.res.info .resi{background:var(--pri-soft2)}.resi{width:26px;height:26px;border-radius:50%;display:grid;place-items:center;color:#fff;font-weight:700;flex:none}.res.ok .resi{background:#22c55e}.res.bad .resi{background:#f59e0b}
.act-chips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}.achip{border:1px solid var(--line);background:var(--bg);border-radius:999px;padding:5px 12px;font-size:13px;color:var(--mute)}.achip.on{background:var(--pri);color:#fff;border-color:var(--pri)}.act-bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px}.dt{display:flex;gap:6px;align-items:center;color:var(--mute);font-size:13px}.dt input{padding:7px 8px;border:1px solid var(--line);border-radius:10px;font:inherit}
.tl-day{margin:16px 0 6px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--mute)}.tl-row{display:flex;gap:12px;align-items:flex-start;background:var(--bg);border:1px solid var(--line);border-radius:12px;padding:10px 12px;margin-bottom:6px}.tl-row.bad{background:var(--warn-soft);border-color:#fde68a}.tl-ic{width:32px;height:32px;border-radius:10px;background:var(--tint2);display:grid;place-items:center;flex:none}.tl-main{flex:1;min-width:0}.tl-text{color:var(--navy);overflow-wrap:anywhere}.tl-meta{display:flex;align-items:center;gap:4px;color:var(--mute);font-size:12.5px;margin-top:3px;flex-wrap:wrap}.pl{background:var(--tint2);border-radius:6px;padding:0 6px}
.pill.a-invitations{background:var(--pri-soft2);color:var(--pri)}.pill.a-people{background:var(--ok-soft);color:var(--ok)}.pill.a-structure{background:#ede9fe;color:#6d28d9}.pill.a-settings{background:#e0f2fe;color:#0369a1}.pill.a-privacy{background:var(--err-soft);color:var(--err)}.pill.a-records{background:var(--tint2);color:var(--mute)}
.hrow{display:flex;flex-wrap:wrap;gap:4px 10px;align-items:center;width:100%;text-align:left;background:none;border:0;border-top:1px solid var(--tint2);padding:8px 2px;cursor:pointer;font:inherit}.hrow.unread{font-weight:600;background:#f5f8ff}.hrow:hover{background:var(--tint)}.hrow progress{width:100%}.chip.warn{background:var(--err-soft);color:#991b1b}
.aibox{border-top:1px solid var(--line);margin-top:12px}.ev.ai{background:#f5f3ff;border-radius:8px;padding:8px}.riskrow{display:block;width:100%;text-align:left;cursor:pointer;background:none;border:1px solid var(--line);border-radius:8px;padding:8px;margin:6px 0}.riskrow .chip{display:inline-block;background:var(--warn-soft);border-radius:10px;padding:1px 8px;margin:4px 4px 0 0;font-size:12px}.check{display:block;margin:6px 0}
.pvbody{border-top:1px solid var(--line);margin-top:8px;padding-top:4px}.pvbody p{margin:6px 0}
@media (max-width:640px){.bar{padding:10px 12px}.stages,.meta,.wrap,.fbar{padding-left:12px;padding-right:12px}.fmenu,.fpop{left:12px}}

.drawer.rec{width:min(max(440px,60%),760px);padding:0;display:flex;flex-direction:column;overflow:hidden}
.rec-formwrap{display:flex;flex-direction:column;height:100%;min-height:0}
.rec-head{padding:16px 20px 0;border-bottom:1px solid var(--line);flex:none}.rec-top{display:flex;align-items:flex-start;gap:8px}.rec-top h2{flex:1;margin:0 0 8px;font-size:18px;overflow-wrap:anywhere}.rec .x{border:0;background:var(--tint2);border-radius:8px;width:32px;height:32px;font-size:20px;line-height:1;color:var(--mute);cursor:pointer}
.rec-stage{display:flex;align-items:center;gap:10px;margin-bottom:10px}.rec-stage label{margin:0;font-size:12px;color:var(--mute)}.rec-stage select{width:auto;min-width:160px;flex:0 1 220px}
.savedchip{background:var(--ok-soft);color:var(--ok);border-radius:999px;padding:2px 10px;font-size:12px;font-weight:600;animation:piifade .25s ease-out}@keyframes piifade{from{opacity:0;transform:translateY(-2px)}}
.rec-tabs{display:flex;gap:4px}.rec-tabs button{border:0;background:none;padding:10px 14px;font:inherit;color:var(--mute);border-bottom:2px solid transparent;cursor:pointer}.rec-tabs button.on{color:var(--pri);border-bottom-color:var(--pri);font-weight:600}
.rec-body{flex:1;min-height:0;overflow:auto;padding:16px 20px}
.rec-foot{flex:none;border-top:1px solid var(--line);background:var(--bg);padding:10px 20px;box-shadow:0 -6px 16px rgba(15,23,42,.05)}.rec-foot .err{margin:0 0 8px}.foot-row{display:flex;gap:8px;align-items:center}.foot-note{color:var(--mute);font-size:13px}.foot-note.warn{color:var(--warn);font-weight:600}
.rec-form h3{margin:18px 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:var(--mute)}.rec-form h3:first-child{margin-top:0}
.fld{display:block;margin:0 0 12px;font-size:12px;color:var(--mute)}.fld input,.fld select{display:block;width:100%;margin-top:4px;padding:9px 10px;border:1px solid var(--line2);border-radius:8px;font:inherit;color:var(--navy);background:var(--bg);box-sizing:border-box}.fld input:disabled,.fld select:disabled{background:var(--tint);color:var(--mute)}.fld input:focus,.fld select:focus{outline:2px solid var(--pri-line);border-color:#60a5fa}
.two{display:grid;grid-template-columns:1fr 1fr;gap:0 14px}.chk2{display:flex;gap:8px;align-items:center;margin:8px 0 14px;font-size:14px;color:var(--navy)}.chk2 input{width:auto}
.composer{border:1px solid #dbe3ee;border-radius:12px;padding:12px;background:var(--tint);margin-bottom:14px}.composer textarea,.composer>input{width:100%;box-sizing:border-box;padding:9px 10px;border:1px solid var(--line2);border-radius:8px;font:inherit;background:var(--bg);margin-bottom:8px}.comp-actions{display:flex;justify-content:flex-end}
.seg{display:inline-flex;background:#e8eef6;border-radius:10px;padding:3px;margin-bottom:10px}.seg button{border:0;background:none;padding:6px 16px;border-radius:8px;font:inherit;color:var(--mute);cursor:pointer}.seg button.on{background:var(--bg);color:var(--pri);font-weight:600;box-shadow:0 1px 2px rgba(15,23,42,.12)}
.feed-filter{display:flex;gap:6px;margin:6px 0 10px;flex-wrap:wrap}.feed-filter button{border:1px solid var(--line);background:var(--bg);border-radius:999px;padding:3px 12px;font:inherit;font-size:12px;color:var(--mute);cursor:pointer}.feed-filter button.on{background:var(--pri-soft);border-color:var(--pri-line);color:var(--pri);font-weight:600}
.feed{list-style:none;margin:0;padding:0}.fi{border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin-bottom:8px;background:var(--bg)}.fi small{display:block;color:var(--mute);margin-top:4px}.fi-text{white-space:pre-wrap;overflow-wrap:anywhere}.fi-sys{color:var(--mute)}.fi-stage,.fi-created{background:var(--tint);border-style:dashed}
.fi.fresh{animation:piihl 2.4s ease-out}@keyframes piihl{0%{background:var(--pri-soft2);border-color:var(--pri-line)}100%{background:var(--bg)}}
ul.cards{list-style:none;margin:8px 0;padding:0;display:grid;gap:8px}.card{border:1px solid var(--line);border-radius:12px;padding:12px 14px;background:var(--bg);cursor:pointer}.card:hover,.card:focus{border-color:var(--pri-line);background:var(--tint);outline:none}.card-top{display:flex;justify-content:space-between;gap:10px;align-items:center}.card-top b{overflow-wrap:anywhere}.card-meta{display:flex;gap:14px;align-items:center;margin-top:8px;color:var(--mute);font-size:13px;flex-wrap:wrap}
td.ed{cursor:default}td.ed:hover{box-shadow:inset 0 0 0 1px var(--pri-line)}
.hwelcome{display:flex;align-items:center;gap:16px}.goal{display:flex;flex-direction:column;align-items:center;gap:2px}
.pii.compact td{padding:4px 8px}.pii.compact th{padding:5px 8px}.pii.compact .hrow{padding:5px 10px}.pii.compact .fi{padding:6px 0}.btn.danger,.btn.quiet.danger{color:var(--err);background:var(--err-soft)}.fi-call b{color:var(--navy);font-size:13px}
.rstats{display:flex;gap:10px;flex-wrap:wrap;margin:14px 0}.rstat{display:flex;flex-direction:column;align-items:flex-start;min-width:110px;padding:10px 14px;border:1px solid var(--line);border-radius:var(--r);background:var(--bg);color:var(--ink)}.rstat b{font-size:22px;color:var(--navy)}.rstat span{font-size:12px;color:var(--mute)}.rstat[aria-selected=true]{border-color:var(--pri);background:var(--pri-soft)}.rstat.bad b{color:var(--err)}.rstat.warn b{color:var(--warn)}.rgroup{margin-bottom:12px}.due{font-size:12.5px;font-weight:600;padding:3px 9px;border-radius:12px;white-space:nowrap}.due.ok{background:var(--ok-soft);color:var(--ok)}.due.warn{background:var(--warn-soft);color:var(--warn)}.due.bad{background:var(--err-soft);color:var(--err)}
.dupgroup{margin-bottom:12px}.duprow{display:flex;gap:10px;align-items:center;padding:8px 10px;border:1px solid var(--line);border-radius:var(--r-sm);margin:6px 0;cursor:pointer}.duprow.on{border-color:var(--pri);background:var(--pri-soft)}.duprow input{margin:0;flex:none}.duprow .chip{margin-left:auto;flex:none;white-space:nowrap}.duprow>span:first-of-type{flex:1;min-width:0}
.pii[data-theme=dark]{--bg:#0E1428;--tint:#141C38;--tint2:#1B2547;--line:#26325E;--line2:#34437A;--ink:#E6EBFF;--mute:#9AA6D1;--faint:#6B76A3;--navy:#E6EBFF;--pri:#6C8CFF;--pri-h:#8AA3FF;--pri-soft:#17224A;--pri-soft2:#1E2C5E;--pri-line:#3B54A8;--accent:#E0668A;--accent-soft:#3A1A2A;--ok:#4CC38A;--ok-soft:#10301F;--warn:#E2B04A;--warn-soft:#3A2D10;--err:#FF7A8E;--err-soft:#3D1620;color-scheme:dark}
.pii[data-theme=dark] .btn{color:#0B1020}.pii[data-theme=dark] input,.pii[data-theme=dark] select,.pii[data-theme=dark] textarea{background:var(--tint);color:var(--ink);border-color:var(--line2)}.pii[data-theme=dark] .seg button[aria-pressed=true]{color:#0B1020}
@media (max-width:560px){.two{grid-template-columns:1fr}.drawer.rec{width:100%}}
.cbar{display:inline-block;width:96px;height:8px;border-radius:99px;background:var(--tint2);overflow:hidden;vertical-align:middle}.cbar>i{display:block;height:100%;background:var(--pri);border-radius:99px}.cstat{display:flex;gap:10px;align-items:center}.csteps{list-style:none;margin:0;padding:0;display:grid;gap:6px}.csteps li{color:var(--mute)}.csteps li.done{color:var(--ink)}.csteps li.done span{color:var(--ok,#0a7d3b)}.cform{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));align-items:end}.cform .fl{display:grid;gap:4px}.cform fieldset{border:1px solid var(--line);border-radius:8px}.chk{display:inline-flex;gap:6px;margin-right:12px}.chip.ok{background:var(--ok-soft,#e3f6ea);color:var(--ok,#0a7d3b)}.seg{display:inline-flex;gap:2px;padding:3px;border-radius:11px;background:var(--tint2);flex-wrap:wrap}.seg button{border:0;background:transparent;padding:6px 14px;border-radius:8px;font:inherit;color:var(--ink);cursor:pointer}.seg button:hover{background:rgba(255,255,255,.55)}.seg button[aria-selected=true]{background:var(--bg);box-shadow:0 1px 3px rgba(10,31,92,.18);font-weight:600}.seg button:focus-visible{outline:2px solid var(--pri);outline-offset:1px}
.scopebar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:6px 0 4px}.scopebar select{padding:6px 10px;border:1px solid var(--line2);border-radius:10px;font:inherit;background:var(--bg);color:var(--ink)}.scopebar .sep{color:var(--mute)}
.hstats{display:flex;gap:32px;flex-wrap:wrap;margin:16px 2px 6px}.hstat{display:flex;flex-direction:column}.hstat b{font-size:26px;line-height:1.1;color:var(--navy)}.hstat span{font-size:13px;color:var(--mute)}.hstat small{font-size:12px;color:var(--mute)}.hstat.warn b{color:#b45309}
.hcard input[type=search]{padding:8px 12px;border:1px solid var(--line2);border-radius:10px;font:inherit;background:var(--bg);color:var(--ink)}.hcard input[type=search]:focus-visible{outline:2px solid var(--pri);outline-offset:1px}
.calm{padding:22px 8px;text-align:center;color:var(--mute)}.calm b{display:block;color:var(--navy);font-size:15px;margin-bottom:2px}
`;
