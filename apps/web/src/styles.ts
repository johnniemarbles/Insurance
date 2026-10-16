export const CSS = `
:host{all:initial;--pri:#6355F6;--pri-h:#5246E0;--navy:#191C32;--ink:#1E2238;--mute:#6B7280;--faint:#9CA3AF;--accent:#EB5757;--accent-soft:#FDE8E8;--bg:#fff;--tint:#F9FAFB;--tint2:#F3F1FF;--line:#EEF1F6;--line2:#E5E7EB;--pri-soft:#EEEBFF;--pri-soft2:#E0DBFF;--pri-line:#C7C2FB;--ok:#0E8F5B;--ok-soft:#E6F6EF;--warn:#B7791F;--warn-soft:#FDF3DD;--err:#C81E3A;--err-soft:#FDE8EC;--r:10px;--r-sm:7px;--sh:0 1px 2px rgba(16,24,40,.06),0 4px 14px rgba(16,24,40,.08)}
*{box-sizing:border-box}
.pii:focus{outline:none}
.pii{--warn:#b45309;--warn2:#d97706;--okc:#0f7b4a;--gray:#98a1bd;font:14px/1.45 "Google Sans",Roboto,system-ui,sans-serif;color:var(--ink);background:var(--bg);min-height:100%;display:flex;flex-direction:column}
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
.drawer input,.drawer select{width:100%;padding:8px;border:1px solid var(--line2);border-radius:8px;font:inherit}.kv dt{color:var(--mute)}.kv dd{margin:0}
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
.scrim{position:fixed;inset:0;background:rgba(25,28,50,.28);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);display:flex;justify-content:center;align-items:flex-start;padding-top:12vh;z-index:50}
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
.settings{padding:16px 20px 28px;max-width:1180px;overflow:auto}
.shead{display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:12px}
.shead h2{margin:0;font-size:22px}
.shead .ssearch{flex:1 1 280px;max-width:520px;margin:0}
.sgrid{display:grid;grid-template-columns:200px minmax(0,1fr);gap:28px;align-items:start}
.snav{display:flex;flex-direction:column;gap:2px;position:sticky;top:12px}
.snav button{text-align:left;border:0;background:transparent;padding:9px 12px;border-radius:8px;color:var(--ink);font:inherit;cursor:pointer}
.snav button:hover{background:var(--tint2)}
.snav button[aria-selected=true]{background:var(--tint2);color:var(--pri);font-weight:600}
.snav button:focus-visible{outline:2px solid var(--pri);outline-offset:1px}
.smain{max-width:760px;min-width:0}
@media(max-width:800px){.sgrid{grid-template-columns:1fr;gap:12px}.snav{flex-direction:row;flex-wrap:wrap;position:static}}.settings h2{margin:0 0 10px}.ssearch{width:100%;box-sizing:border-box;padding:9px 12px;border:1px solid var(--line2);border-radius:8px;font:inherit;margin-bottom:10px}
.tabs.sub{margin:6px 0 12px}.srow{padding:12px 0;border-bottom:1px solid var(--line)}.srow-h{display:flex;gap:8px;align-items:center}.srow p{margin:4px 0 8px}
.srcchip{font-size:11px;background:var(--pri-soft);color:#3730a3;border-radius:10px;padding:1px 8px}.srcchip.lockd{background:var(--warn-soft);color:var(--warn)}
.switch{display:inline-flex;gap:8px;align-items:center}.toast{position:sticky;bottom:12px;margin-top:14px;background:var(--navy);color:#fff;border-radius:8px;padding:9px 14px;display:flex;gap:14px;align-items:center;width:max-content}.toast .link{color:#a5b4fc}
.layout2{display:flex;gap:20px;flex-wrap:wrap}.navlist{list-style:none;margin:0;padding:0;flex:1 1 280px}.navlist li{display:flex;align-items:center;gap:8px;padding:7px 8px;border:1px solid var(--line);border-radius:8px;margin-bottom:6px;background:var(--bg);cursor:grab}.navlist li.dragging{opacity:.4}.grip{color:var(--faint);cursor:grab}
.navprev{flex:0 0 200px;border:1px solid var(--line);border-radius:10px;background:#f8fafd;padding:10px}.navprev-h{font-size:11px;color:var(--mute);margin-bottom:6px}.navprev-b strong{display:block;margin-bottom:4px}.navprev-i{padding:5px 8px;border-radius:14px;font-size:13px}.navprev-i:hover{background:#e8eaed}
.hwelcome{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}.hwelcome h2{margin:0}.hsec-h{display:flex;align-items:center;gap:10px;justify-content:space-between;margin-bottom:8px}.hsec-h h3{margin:0}.fcard:hover{background:var(--tint)}.fcard b{font-size:15px}.qcard:hover{border-color:var(--pri-line);background:#f8fbff}.qcard.act{align-items:center;justify-content:center;text-align:center;min-width:110px;color:var(--pri)}.qcard.act .qico{color:var(--pri)}
.stagechip{color:#fff;border-radius:999px;font-size:12px;padding:1px 9px;font-weight:600}.rname{font-weight:600}
.snap{display:flex;gap:8px;overflow-x:auto;padding:4px 0 10px}.snapstage{flex:1 0 96px;display:flex;flex-direction:column;gap:2px;align-items:flex-start;text-align:left;border:1px solid var(--line);border-top:4px solid #6366f1;border-radius:8px;background:var(--bg);padding:8px 10px;cursor:pointer;font:inherit}.snapstage b{font-size:20px}.snapstage span{font-size:12px;color:var(--ink)}.snapstage:hover{background:var(--tint)}
.hist{margin-top:18px}.home{padding:16px 20px;overflow:auto}.home h2{margin:0 0 12px}.hcard{border:1px solid var(--line);border-radius:12px;padding:12px 14px;background:var(--bg)}.hcard h3{margin:0 0 8px;font-size:14px}
.privacy{display:grid;gap:12px;max-width:640px}.privacy textarea,.privacy input{width:100%;box-sizing:border-box}.plain{list-style:none;padding:0;margin:0 0 8px}.privacy .row{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
.orgnode{border-top:1px solid var(--tint2);padding:6px 0}.orgtab input,.orgtab select{max-width:100%}
.ph{max-width:880px}.ph-head{display:flex;margin:4px 0 14px}.seg2{display:inline-flex;background:var(--tint2);border-radius:12px;padding:4px;gap:2px}.seg2 button{border:0;background:none;padding:7px 16px;border-radius:9px;color:var(--mute);font-weight:600}.seg2 button[aria-selected=true]{background:var(--bg);color:var(--pri);box-shadow:0 1px 3px rgba(15,23,42,.12)}
.ph-bar{display:flex;gap:10px;align-items:center;margin-bottom:12px;flex-wrap:wrap}.ph-search{flex:1;min-width:220px;max-width:360px;padding:10px 14px;border:1px solid var(--line);border-radius:12px;background:var(--tint);font:inherit}.ph-search:focus{outline:2px solid var(--pri-line);background:var(--bg)}.ph-search.wide{max-width:none;width:100%;margin:6px 0 10px}
.btn.big{padding:10px 20px;border-radius:12px;font-weight:600;background:linear-gradient(135deg,var(--pri-h),var(--pri));box-shadow:0 4px 12px rgba(99,85,246,.28)}.btn.big:hover{filter:brightness(1.07)}
.ph-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px}@media(max-width:620px){.ph-stats{grid-template-columns:repeat(2,1fr)}}
.stat{border:1px solid #e5e9f0;background:var(--bg);border-radius:14px;padding:12px 14px;text-align:left;display:flex;flex-direction:column;gap:2px;transition:box-shadow .15s,border-color .15s}.stat:hover{box-shadow:0 4px 14px rgba(15,23,42,.08)}.stat b{font-size:24px;line-height:1.1;color:var(--navy)}.stat span{color:var(--mute);font-size:13px}.stat[aria-pressed=true]{border-color:var(--pri-h);box-shadow:0 0 0 3px var(--pri-soft2)}.stat.attention b{color:var(--warn)}.stat.active b{color:var(--ok)}
.plist{display:flex;flex-direction:column;gap:8px}.prow{display:flex;gap:12px;align-items:flex-start;background:var(--bg);border:1px solid #e8ecf2;border-radius:14px;padding:12px 14px;position:relative;transition:box-shadow .15s}.prow:hover{box-shadow:0 4px 16px rgba(15,23,42,.07)}.prow.attn{border-color:#fcd9a0;background:linear-gradient(0deg,#fffdf7,#fff)}.prow.off{opacity:.7}
.av{display:inline-grid;place-items:center;border-radius:50%;color:#fff;font-weight:700;flex:none;letter-spacing:.02em}.pmain{flex:1;min-width:0}.pname{font-weight:600;color:var(--navy);display:flex;gap:8px;align-items:center;flex-wrap:wrap;overflow-wrap:anywhere}.you{color:var(--mute);font-weight:400}.psub{color:var(--mute);font-size:13px;margin-top:2px}.why{color:var(--warn);font-weight:500}
.pill{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:2px 10px;font-size:12px;font-weight:600;background:var(--tint2);color:var(--mute)}.pill i{width:7px;height:7px;border-radius:50%;background:currentColor}
.pill.s-sent{background:var(--pri-soft2);color:var(--pri)}.pill.s-opened{background:#ede9fe;color:#9B51E0}.pill.s-accepted{background:var(--ok-soft);color:var(--ok)}.pill.s-not_sent,.pill.s-expired{background:var(--warn-soft);color:var(--warn)}.pill.s-off{background:var(--line);color:var(--mute)}.pill.s-created{background:var(--tint2);color:var(--mute)}.pill.s-sending{background:var(--pri-soft2);color:#4338ca}.pill.s-sending i{animation:piipulse 1s ease-in-out infinite}@keyframes piipulse{50%{opacity:.25}}.chk{display:flex;gap:10px;align-items:flex-start;margin:12px 0;padding:10px 12px;border:1px solid var(--line);border-radius:10px;cursor:pointer}.chk input{margin-top:3px}.chk small{display:block;color:var(--mute);font-weight:400;margin-top:2px}.why.soft{margin-top:2px}.spin{display:inline-block;width:14px;height:14px;border:2px solid var(--pri-line);border-top-color:#4338ca;border-radius:50%;animation:piispin .8s linear infinite}@keyframes piispin{to{transform:rotate(360deg)}}
.roles{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}.rolechip{display:inline-flex;gap:6px;align-items:center;background:var(--pri-soft);color:#3730a3;border-radius:999px;padding:3px 10px;font-size:12.5px}.rolechip button{border:0;background:none;color:#6366f1;padding:0 0 0 2px;font-size:15px;line-height:1}.rolechip button:hover{color:var(--err)}
.pact{display:flex;gap:6px;align-items:center;position:relative}.btn.quiet{background:var(--pri-soft);color:var(--pri)}.more{border:0;background:var(--tint2);border-radius:8px;width:32px;height:32px;font-size:18px;color:var(--mute)}.menu{position:absolute;right:0;top:38px;background:var(--bg);border:1px solid var(--line);border-radius:12px;box-shadow:0 12px 30px rgba(15,23,42,.16);padding:6px;z-index:5;min-width:170px}.menu button{display:block;width:100%;text-align:left;border:0;background:none;padding:8px 10px;border-radius:8px}.menu button:hover{background:var(--tint2)}.menu button.danger{color:var(--err)}
.empty{text-align:center;padding:36px 16px;border:1px dashed #cbd5e1;border-radius:16px;background:var(--tint);margin:10px 0}.empty-ic{font-size:34px}.empty h3{margin:6px 0}.empty p{color:var(--mute);max-width:360px;margin:6px auto 14px}
.linkbox{border:1px solid var(--pri-line);background:var(--pri-soft);border-radius:14px;padding:12px 14px;margin-bottom:12px}.linkbox p{margin:2px 0 6px}.pad{padding:8px 2px}
.toast2{position:sticky;bottom:12px;margin:14px auto 0;width:fit-content;max-width:90%;background:var(--navy);color:#fff;border-radius:12px;padding:10px 16px;box-shadow:0 10px 30px rgba(15,23,42,.3)}
.mdl-back{position:fixed;inset:0;background:rgba(25,28,50,.28);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);display:grid;place-items:center;z-index:50;padding:12px}.mdl{background:var(--bg);border-radius:20px;width:min(560px,100%);max-height:92vh;overflow:auto;box-shadow:0 30px 80px rgba(15,23,42,.35);padding:18px 22px 16px}.mdl.small{width:min(420px,100%)}.mdl h3{margin:6px 0 4px;font-size:18px}.mdl-top{display:flex;justify-content:space-between;align-items:center;font-size:15px}.mdl-top .x{border:0;background:var(--tint2);border-radius:50%;width:30px;height:30px;font-size:18px}
.steps{list-style:none;display:flex;gap:6px;padding:0;margin:12px 0 8px}.steps li{flex:1;display:flex;gap:7px;align-items:center;color:#94a3b8;font-size:13px;font-weight:600;border-bottom:3px solid var(--line);padding-bottom:8px}.steps li span{width:22px;height:22px;border-radius:50%;background:var(--line);color:var(--mute);display:inline-grid;place-items:center;font-size:12px}.steps li.cur{color:var(--pri);border-color:var(--pri-h)}.steps li.cur span{background:var(--pri-h);color:#fff}.steps li.done{color:var(--ok);border-color:#86efac}.steps li.done span{background:#22c55e;color:#fff}
.mdl-body{padding:6px 0 4px;min-height:200px}.big-ta{width:100%;border:1px solid var(--line);border-radius:12px;padding:12px;font:inherit;background:var(--tint);resize:vertical}.big-ta:focus{outline:2px solid var(--pri-line);background:var(--bg)}.chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
.places{max-height:260px;overflow:auto;display:flex;flex-direction:column;gap:4px;margin-bottom:8px}.place{display:flex;gap:10px;align-items:center;text-align:left;border:1px solid #e8ecf2;background:var(--bg);border-radius:12px;padding:9px 12px}.place small{display:block;color:var(--mute);font-size:12px}.place:hover{background:var(--tint)}.place.sel{border-color:var(--pri-h);background:var(--pri-soft);box-shadow:0 0 0 3px var(--pri-soft2)}.pi{font-size:18px}
.rolegrid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.rolegrid.two{grid-template-columns:1fr 1fr}@media(max-width:520px){.rolegrid{grid-template-columns:1fr}}.rolecard{text-align:left;border:1px solid var(--line);background:var(--bg);border-radius:14px;padding:12px;display:flex;flex-direction:column;gap:4px}.rolecard small{color:var(--mute)}.rolecard:hover:not(:disabled){background:var(--tint)}.rolecard.sel{border-color:var(--pri-h);background:var(--pri-soft);box-shadow:0 0 0 3px var(--pri-soft2)}.rolecard:disabled{opacity:.55;cursor:not-allowed}
.review{margin-top:12px;background:var(--ok-soft);border:1px solid #bbf7d0;color:#14532d;border-radius:12px;padding:10px 12px}.fl{display:block;margin-top:10px;color:var(--mute);font-size:13px;font-weight:600}.fl select,.fl textarea{display:block;width:100%;margin-top:4px;padding:9px 10px;border:1px solid var(--line);border-radius:10px;font:inherit}
.mdl-foot{display:flex;gap:8px;align-items:center;margin-top:12px;padding-top:12px;border-top:1px solid var(--line)}.res{display:flex;gap:10px;padding:10px;border-radius:12px;margin:8px 0}.res.ok{background:var(--ok-soft)}.res.bad{background:var(--warn-soft)}.res.info{background:var(--pri-soft)}.res.info .resi{background:var(--pri-soft2)}.resi{width:26px;height:26px;border-radius:50%;display:grid;place-items:center;color:#fff;font-weight:700;flex:none}.res.ok .resi{background:#22c55e}.res.bad .resi{background:#f59e0b}
.act-chips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}.achip{border:1px solid var(--line);background:var(--bg);border-radius:999px;padding:5px 12px;font-size:13px;color:var(--mute)}.achip.on{background:var(--pri);color:#fff;border-color:var(--pri)}.act-bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px}.dt{display:flex;gap:6px;align-items:center;color:var(--mute);font-size:13px}.dt input{padding:7px 8px;border:1px solid var(--line);border-radius:10px;font:inherit}
.tl-day{margin:16px 0 6px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--mute)}.tl-row{display:flex;gap:12px;align-items:flex-start;background:var(--bg);border:1px solid var(--line);border-radius:12px;padding:10px 12px;margin-bottom:6px}.tl-row.bad{background:var(--warn-soft);border-color:#fde68a}.tl-ic{width:32px;height:32px;border-radius:10px;background:var(--tint2);display:grid;place-items:center;flex:none}.tl-main{flex:1;min-width:0}.tl-text{color:var(--navy);overflow-wrap:anywhere}.tl-meta{display:flex;align-items:center;gap:4px;color:var(--mute);font-size:12.5px;margin-top:3px;flex-wrap:wrap}.pl{background:var(--tint2);border-radius:6px;padding:0 6px}
.pill.a-invitations{background:var(--pri-soft2);color:var(--pri)}.pill.a-people{background:var(--ok-soft);color:var(--ok)}.pill.a-structure{background:#ede9fe;color:#9B51E0}.pill.a-settings{background:#e0f2fe;color:#0369a1}.pill.a-privacy{background:var(--err-soft);color:var(--err)}.pill.a-records{background:var(--tint2);color:var(--mute)}
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
.vpanel{margin:16px 0;border:1px solid var(--line);border-radius:12px;padding:14px 16px;background:var(--bg)}.vpanel h3{margin:0 0 6px;font-size:14px;text-transform:none;letter-spacing:0;color:var(--navy)}.vpanel>p{margin:4px 0 10px;font-size:13px}.vpanel .ev{border-left:0;padding:12px 0 4px;margin:0;border-top:1px solid var(--line)}.vpanel .ev label{display:inline-flex;gap:8px;align-items:center;font-size:14px}.vpanel .ev small{display:inline}.vpanel .ev>div{margin-top:4px}.vpanel input:not([type=checkbox]){padding:8px 10px;border:1px solid var(--line2);border-radius:8px;font:inherit;color:var(--navy);background:var(--bg);box-sizing:border-box;max-width:100%;margin:4px 6px 4px 0}.vpanel input[type=checkbox]{width:16px;height:16px;margin:0}.adobebox{margin:8px 0 6px 24px;padding:10px 12px;background:var(--tint2);border-radius:8px;font-size:13px}.adobebox h4{margin:0 0 4px;font-size:13px}.vpanel p.vstat{margin:8px 0}.vpanel .ev>div>input{width:min(100%,380px)}.adobebox .afields{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:6px 0 10px}.adobebox .afields input{width:100%;margin:0}.adobebox .afields .wide{grid-column:1/-1}@media(max-width:700px){.adobebox .afields{grid-template-columns:1fr}}.vpanel .vrow{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:10px 0;border-top:1px solid var(--line)}.vpanel .vrow small{margin-left:4px}.vpanel .vrow .btn{margin-left:auto}
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
.pii[data-theme=dark]{--warn:#fbbf24;--warn2:#f59e0b;--okc:#34d399;--gray:#6B76A3;--bg:#0E1428;--tint:#141C38;--tint2:#1B2547;--line:#26325E;--line2:#34437A;--ink:#E6EBFF;--mute:#9AA6D1;--faint:#6B76A3;--navy:#E6EBFF;--pri:#6C8CFF;--pri-h:#8AA3FF;--pri-soft:#17224A;--pri-soft2:#1E2C5E;--pri-line:#3B54A8;--accent:#E0668A;--accent-soft:#3A1A2A;--ok:#4CC38A;--ok-soft:#10301F;--warn:#E2B04A;--warn-soft:#3A2D10;--err:#FF7A8E;--err-soft:#3D1620;color-scheme:dark}
.pii[data-theme=dark] .btn{color:#0B1020}.pii[data-theme=dark] input,.pii[data-theme=dark] select,.pii[data-theme=dark] textarea{background:var(--tint);color:var(--ink);border-color:var(--line2)}
@media (max-width:560px){.two{grid-template-columns:1fr}.drawer.rec{width:100%}}
.cbar{display:inline-block;width:96px;height:8px;border-radius:99px;background:var(--tint2);overflow:hidden;vertical-align:middle}.cbar>i{display:block;height:100%;background:var(--pri);border-radius:99px}.cstat{display:flex;gap:10px;align-items:center}.csteps{list-style:none;margin:0;padding:0;display:grid;gap:6px}.csteps li{color:var(--mute)}.csteps li.done{color:var(--ink)}.csteps li.done span{color:var(--ok,#0a7d3b)}.cform{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));align-items:end}.cform .fl{display:grid;gap:4px}.cform fieldset{border:1px solid var(--line);border-radius:8px}.chk{display:inline-flex;gap:6px;margin-right:12px}.chip.ok{background:var(--ok-soft,#e3f6ea);color:var(--ok,#0a7d3b)}.seg{display:inline-flex;gap:2px;padding:3px;border-radius:11px;background:var(--tint2);flex-wrap:wrap}.seg button{border:0;background:transparent;padding:6px 14px;border-radius:8px;font:inherit;color:var(--ink);cursor:pointer}.seg button:hover:not([aria-pressed=true]):not([aria-selected=true]):not(.on){background:rgba(255,255,255,.55)}.seg button[aria-selected=true],.seg button[aria-pressed=true],.seg button.on{background:var(--bg);color:var(--pri);box-shadow:0 1px 3px rgba(16,24,40,.18);font-weight:600}.seg button:focus-visible{outline:2px solid var(--pri);outline-offset:1px}
.scopebar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:6px 0 4px}.scopebar select{padding:6px 10px;border:1px solid var(--line2);border-radius:10px;font:inherit;background:var(--bg);color:var(--ink)}.scopebar .sep{color:var(--mute)}
.hstats{display:flex;gap:32px;flex-wrap:wrap;margin:16px 2px 6px}.hstat{display:flex;flex-direction:column}.hstat b{font-size:26px;line-height:1.1;color:var(--navy)}.hstat span{font-size:13px;color:var(--mute)}.hstat small{font-size:12px;color:var(--mute)}.hstat.warn b{color:var(--warn)}
.hcard input[type=search]{padding:8px 12px;border:1px solid var(--line2);border-radius:10px;font:inherit;background:var(--bg);color:var(--ink)}.hcard input[type=search]:focus-visible{outline:2px solid var(--pri);outline-offset:1px}
.calm{padding:22px 8px;text-align:center;color:var(--mute)}.calm b{display:block;color:var(--navy);font-size:15px;margin-bottom:2px}
.needs{border:1px solid var(--line);border-radius:12px;padding:8px 14px;background:var(--bg);margin:10px 0}.need{display:flex;gap:10px;align-items:center;padding:8px 0;border-top:1px solid var(--tint2)}.need .dot{width:8px;height:8px;border-radius:50%;background:var(--warn);flex:none}.need span{flex:1}
.charts{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px;margin:12px 0}.chartcard h4{margin:0 0 10px;font-size:14px;color:var(--navy)}
.hb{display:grid;grid-template-columns:120px 1fr 40px;gap:8px;align-items:center;margin:6px 0;font-size:13px}.hb .tr{height:10px;background:var(--tint2);border-radius:99px;overflow:hidden}.hb .tr>i{display:block;height:100%;background:var(--pri);border-radius:99px}.hb b{text-align:right;color:var(--navy)}
.wk{display:flex;align-items:flex-end;gap:4px;height:104px}.wk>div{flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;height:100%;min-width:0}.wk i{display:block;width:100%;background:var(--pri);border-radius:4px 4px 0 0}.wk i.o{background:var(--warn)}.wk small{font-size:10px;color:var(--mute);min-height:12px;white-space:nowrap}.wk em{font-style:normal;font-size:10px;color:var(--navy);min-height:12px}
.stack{display:flex;height:12px;border-radius:99px;overflow:hidden;background:var(--tint2)}.stack i{display:block;height:100%}.legend{display:flex;gap:4px 14px;flex-wrap:wrap;font-size:12px;color:var(--mute);margin-top:8px}.legend span::before{content:'';display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px;background:var(--c,var(--pri))}.legend b{color:var(--navy)}
.connect{display:flex;gap:8px;flex-wrap:wrap;align-items:flex-start;margin:4px 0 8px}.connect .chip{cursor:pointer;border:1px solid var(--line2);font:inherit;font-size:12px}.connect .hcard{flex-basis:100%}
.jump{position:relative;min-width:200px;flex:0 1 280px}.jump input{width:100%;box-sizing:border-box;padding:6px 10px;border:1px solid var(--line2);border-radius:10px;font:inherit;background:var(--bg);color:var(--ink)}.jumplist{position:absolute;right:0;left:0;top:calc(100% + 4px);z-index:5;background:var(--bg);border:1px solid var(--line2);border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.12);max-height:320px;overflow:auto;padding:4px}
.jump input::placeholder{color:var(--mute)}.jumplist .hrow[aria-selected=true],.jumplist .hrow:focus-visible{background:var(--pri-soft)}.connect .chip.warn{color:var(--warn);background:var(--bg)}
@media (prefers-reduced-motion:reduce){.pii *{transition:none!important;animation:none!important}}
@media (max-width:640px){.hstats{gap:18px}.hb{grid-template-columns:90px 1fr 32px}.jump{flex:1 1 100%}}
.trend{font-size:12px;color:var(--mute);margin-top:2px}
.dfilters{display:flex;gap:14px;flex-wrap:wrap;margin:8px 0}.dfilters select{margin-left:6px}.dgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:12px}.dbars{display:flex;flex-direction:column;gap:8px}.dbar{display:grid;grid-template-columns:110px 1fr auto;gap:8px;align-items:center;font-size:13px}.dl{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dt{background:var(--tint2);border-radius:6px;height:12px;overflow:hidden}.dt i{display:block;height:100%;border-radius:6px}.dv{white-space:nowrap;font-weight:600}.dtable{width:100%;border-collapse:collapse;font-size:13px}.dtable th{text-align:left;color:var(--mute);font-weight:500;padding:4px 6px}.dtable td{padding:6px;border-top:1px solid var(--line)}.hhead{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:8px}.hhead h2{margin:0}.qbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:6px 0 12px}.qchip{border:1px solid var(--line2);background:var(--bg);color:var(--ink);border-radius:999px;padding:6px 12px;font-size:13px}.qchip.act{background:var(--pri-soft);color:var(--pri);border-color:var(--pri-line);font-weight:600}.qchip:hover{background:var(--pri-soft2)}.kstrip{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin:0 0 12px}.ktile{display:flex;flex-direction:column;gap:2px;text-align:left;border:1px solid var(--line);border-radius:12px;background:var(--bg);padding:10px 12px;font:inherit;color:inherit}.ktile b{font-size:24px;color:var(--navy)}.ktile span{font-size:12px;color:var(--mute)}.ktile small{font-size:12px;color:var(--mute)}.ktile.hot{border-color:#fcd9a0;background:#fffbf2}.ktile.hot b{color:var(--warn)}.ktile:hover{border-color:var(--pri-line)}.hcols{display:grid;grid-template-columns:minmax(0,3fr) minmax(0,2fr);gap:12px;margin-bottom:12px}.h3grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;margin-bottom:12px}.vsnap{flex-wrap:wrap}.nudge p{margin:0 0 8px;font-weight:600}.hpart{margin:18px 0 8px;font-size:16px;color:var(--navy)}@media(max-width:760px){.hcols{grid-template-columns:1fr}}.tag.ce-met{background:var(--ok-soft,#e3f6ea);color:var(--ok,#0a7d3b)}.tag.ce-on_track{background:var(--pri-soft);color:var(--navy)}.tag.ce-at_risk{background:#fff1d6;color:#8a5200}.tag.ce-overdue{background:#fde4e1;color:#a3231a}.tag.ce-exempt{background:var(--tint2);color:var(--mute)}.tag.ok{background:var(--ok-soft,#e3f6ea);color:var(--ok,#0a7d3b)}
.tpad.xl{max-width:1280px}
.catalog{display:block}
.cat-hero{display:grid;grid-template-columns:1.3fr 1fr;border-radius:18px;overflow:hidden;background:linear-gradient(120deg,#191C32,#6355F6 60%,#9B51E0);color:#fff;margin:10px 0 18px;min-height:190px}
.cat-ht{padding:26px 30px}.cat-kicker{font-weight:700;color:#bcd0ff;margin-bottom:6px}.cat-ht h1{font-size:28px;line-height:1.15;letter-spacing:-.02em;margin:0 0 8px;color:#fff}.cat-ht p{margin:0 0 16px;color:#d7e0ff;font-size:15px}
.cat-hb{background:#fff;color:#191C32;font-weight:700;border:0;border-radius:10px;padding:11px 18px}.cat-hb:hover{background:#eef3ff}
.cat-hc{display:flex;align-items:center;justify-content:center;padding:18px}.cat-mini{width:230px;background:var(--bg);color:var(--ink);border-radius:14px;overflow:hidden;box-shadow:0 18px 40px -12px rgba(0,0,0,.45);padding-bottom:12px}.cat-mini>div:first-child{height:96px}.cat-mini b{display:block;padding:10px 14px 0;font-size:14px}.cat-mini .cc-bar{margin:8px 14px 4px}.cat-mini small{padding:0 14px;color:var(--mute)}
.cat-tools{display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin:6px 0 4px}.cat-search{flex:0 1 320px;height:42px;border:1px solid var(--ink);border-radius:999px;padding:0 18px;background:var(--bg);color:var(--ink);font:inherit}
.cat-chips{display:flex;gap:8px;flex-wrap:wrap}.cat-chips button{border:1px solid var(--ink);background:var(--bg);color:var(--ink);border-radius:999px;padding:7px 14px;font-weight:700;font-size:13px}.cat-chips button.on{background:var(--ink);color:var(--bg)}
.cat-row h2{font-size:21px;letter-spacing:-.01em;margin:26px 0 2px;color:var(--navy)}.cat-row>p{color:var(--mute);margin:0 0 12px}
.cc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(232px,1fr));gap:18px}
.cc{position:relative}.cc-main{display:block;width:100%;text-align:left;padding:0;border:1px solid var(--line);border-radius:14px;overflow:hidden;background:var(--bg);color:var(--ink);box-shadow:0 1px 2px rgba(15,23,42,.04);transition:box-shadow .15s,transform .15s,border-color .15s}
.cc-main:hover{box-shadow:0 10px 26px -10px rgba(16,24,40,.35);transform:translateY(-2px);border-color:var(--pri-line)}
.cc-th{position:relative;height:132px;overflow:hidden}.cc-th svg{position:absolute;right:-8px;bottom:-10px;width:140px;height:140px}.cc-tags{position:absolute;left:10px;top:10px;right:46px;display:flex;gap:5px;flex-wrap:wrap;z-index:1}
.cc-tag{font-size:10.5px;font-weight:800;border-radius:6px;padding:3px 7px;background:#fff;color:#1c1d1f;letter-spacing:.02em}.cc-tag.req{background:#fde68a}.cc-tag.dr{background:#e2e8f0}.cc-tag.ce{background:#c7d2fe;color:#1e1b4b}
.cc-heart{position:absolute;right:10px;top:10px;width:30px;height:30px;border-radius:50%;border:0;background:#fff;color:var(--pri);font-size:15px;display:grid;place-items:center;box-shadow:0 1px 4px rgba(0,0,0,.15)}.cc-heart.on{color:#e11d48}
.cc-b{padding:12px 14px 14px}.cc-b h3{font-size:15px;line-height:1.3;margin:0 0 3px;min-height:39px;letter-spacing:-.005em;color:var(--ink)}.cc-by{color:var(--mute);font-size:12px;margin-bottom:8px}
.cc-meta{display:flex;gap:8px;align-items:center;font-size:12px;color:var(--mute);margin-bottom:10px;flex-wrap:wrap}.cc-meta i{width:3px;height:3px;border-radius:50%;background:var(--faint)}.cc-meta em{font-style:normal;border:1px solid var(--line2);border-radius:5px;padding:0 5px;font-size:10.5px;font-weight:700}
.cc-bar{height:6px;background:var(--line);border-radius:3px;overflow:hidden;margin:0 0 8px}.cc-bar i{display:block;height:100%;background:var(--pri)}
.cc-cta{display:flex;justify-content:space-between;align-items:center;font-size:12.5px;color:var(--mute)}.cc-cta b{color:var(--pri)}.cc-cta .ok{color:var(--ok);font-weight:700}
@media(max-width:760px){.cat-hero{grid-template-columns:1fr}.cat-hc{display:none}.cat-ht h1{font-size:22px}.cc-grid{grid-template-columns:repeat(auto-fill,minmax(180px,1fr))}}

.cp{display:block}.cp-hero{background:linear-gradient(120deg,#191C32,#14307f);color:#fff;padding:22px 30px 28px;border-radius:0 0 16px 16px}.cp-hero h1{font-size:30px;line-height:1.15;letter-spacing:-.02em;margin:8px 0 8px;color:#fff;max-width:760px}.cp-lead{font-size:16px;color:#dbe4ff;margin:0 0 14px;max-width:760px}
.cp-back{color:#a9c0ff!important}.cp-meta{display:flex;gap:14px;flex-wrap:wrap;align-items:center;font-size:13px;color:#c7d6ff}
.cp-grid{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:30px;padding:0 24px 40px;align-items:start}.cp-side{order:2;margin-top:-70px;background:var(--bg);border:1px solid var(--line);border-radius:16px;box-shadow:0 18px 50px -14px rgba(16,24,40,.45);overflow:hidden;position:sticky;top:12px}.cp-main{order:1;padding-top:22px;min-width:0}
.cp-cover{position:relative;height:170px;display:grid;place-items:center;overflow:hidden}.cp-cover svg{position:absolute;right:-10px;bottom:-14px;width:170px;height:170px;opacity:.9}.cp-play{position:relative;width:64px;height:64px;border-radius:50%;border:0;background:rgba(255,255,255,.92);color:#0f172a;font-size:24px;display:grid;place-items:center;padding-left:4px}
.cp-sb{padding:18px 20px 20px}.cp-prog{margin-bottom:14px;font-size:14px}.cp-cta{width:100%;background:var(--pri);color:#fff;border:0;border-radius:10px;padding:14px;font-weight:800;font-size:15px}.cp-cta:hover{background:var(--pri-h)}
.cp-cert{margin-top:12px;font-size:13px;color:var(--ok);border:1px solid var(--ok-soft);background:var(--ok-soft);border-radius:10px;padding:10px 12px}.cp-facts{list-style:none;margin:16px 0 0;padding:0;display:grid;gap:8px;font-size:13px;color:var(--mute)}
.cp-h{font-size:21px;letter-spacing:-.01em;color:var(--navy);margin:6px 0 12px}.cp-acc{border:1px solid var(--line);border-radius:12px;overflow:hidden;background:var(--bg);margin-bottom:24px}.cp-acc .lrow{margin:0;border-bottom:1px solid var(--line)}.cp-acc .lrow:last-child{border-bottom:0}.cp-acc .lbtn{border:0;border-radius:0;padding:14px 16px}.cp-acc .lbtn.cur{background:var(--pri-soft)}.cp-acc .lbtn .lt{flex:1;font-weight:600}.cp-acc .lm{margin-left:auto;color:var(--mute);font-size:12.5px;white-space:nowrap}
@media(max-width:900px){.cp-grid{grid-template-columns:1fr;padding:0 14px 30px}.cp-side{order:0;margin-top:14px;position:static}.cp-hero h1{font-size:23px}}
.lp{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:28px;align-items:start}.lp-main h1{font-size:26px;letter-spacing:-.02em;margin:10px 0 14px}.lp-main video{background:#000;aspect-ratio:16/9;width:100%;border-radius:12px}.lp-main .prose{font-size:16.5px;line-height:1.7;max-width:720px}.lp-nav{display:flex;justify-content:space-between;gap:10px;margin-top:22px;padding-top:16px;border-top:1px solid var(--line)}.lp-side{position:sticky;top:12px;border:1px solid var(--line);border-radius:14px;padding:16px;background:var(--bg);max-height:calc(100vh - 40px);overflow:auto}.lp-t{display:block;margin-bottom:10px;color:var(--navy)}.lp-list{list-style:none;margin:12px 0 0;padding:0}.lp-i{all:unset;box-sizing:border-box;display:flex;align-items:center;gap:10px;width:100%;padding:10px 8px;border-radius:8px;cursor:pointer;font-size:14px}.lp-i:hover{background:var(--pri-soft)}.lp-i.cur{background:var(--pri-soft);font-weight:700}.lp-i:disabled{opacity:.5;cursor:not-allowed}.lp-i:focus-visible{outline:2px solid var(--pri);outline-offset:1px}.lp-d{flex:none;width:22px;height:22px;border-radius:50%;border:1.5px solid var(--line);display:grid;place-items:center;font-size:11px}.lp-d.on{background:#1a8f4c;border-color:#1a8f4c;color:#fff}.lp-n{flex:1}.lp-i .lm{color:var(--mute);font-size:12px;white-space:nowrap}
@media(max-width:900px){.lp{grid-template-columns:1fr}.lp-side{position:static;max-height:none}}
.tpad.xl{max-width:1200px;margin:0 auto;padding-left:32px;padding-right:32px;box-sizing:border-box}
.cp{width:100%}.cp-hero{border-radius:0;padding-left:max(32px,calc((100% - 1200px)/2 + 32px));padding-right:max(32px,calc((100% - 1200px)/2 + 32px))}.cp-grid{max-width:1200px;margin:0 auto;padding:0 32px 48px;gap:40px;grid-template-columns:minmax(0,1fr) 320px;box-sizing:border-box}.cp-hero h1,.cp-lead{max-width:640px}
.lp{max-width:1200px;gap:40px;grid-template-columns:minmax(0,1fr) 320px}.lp-main .prose{max-width:680px}
@media(max-width:900px){.tpad.xl{padding-left:16px;padding-right:16px}.cp-hero{padding-left:16px;padding-right:16px}.cp-grid{grid-template-columns:1fr;padding:0 16px 30px}.lp{grid-template-columns:1fr}}
.lp-hero{position:relative;overflow:hidden;color:#fff;border-radius:16px;padding:26px 28px 22px;margin:12px 0 20px}.lp-hero h1{color:#fff;font-size:30px;line-height:1.15;letter-spacing:-.02em;margin:6px 0 14px;max-width:560px}.lp-ico{position:absolute;right:-6px;top:50%;width:150px;height:150px;transform:translateY(-50%);opacity:.5}.lp-kick{display:block;text-transform:uppercase;letter-spacing:.08em;font-weight:700;font-size:12px;opacity:.85}.lp-ok{display:inline-block;vertical-align:middle;margin-left:12px;background:rgba(255,255,255,.2);border-radius:999px;padding:3px 10px;font-size:12px;font-weight:700;letter-spacing:0}.lp-chips{display:flex;flex-wrap:wrap;gap:8px}.lp-chips span{background:rgba(255,255,255,.18);border-radius:999px;padding:4px 12px;font-size:12.5px;font-weight:600}
.lp-main .lp-card{background:var(--bg);border:1px solid var(--line);border-radius:16px;padding:28px 32px;box-shadow:0 1px 2px rgba(16,24,40,.05);max-width:none}.lp-card p{margin:0 0 18px;font-size:17px;line-height:1.75;color:#2b3252}.lp-card p:first-child{font-size:19.5px;line-height:1.6;font-weight:500;color:var(--navy);padding-left:16px;border-left:4px solid var(--pri)}.lp-card p:last-child{margin-bottom:0}
.lp-nav{align-items:center;background:var(--bg);border:1px solid var(--line);border-radius:14px;padding:12px 14px;border-top:1px solid var(--line)}.lp-mid{flex:1;text-align:center}
.lp-side{box-shadow:0 8px 28px -12px rgba(16,24,40,.25)}.lp-i.cur{box-shadow:inset 3px 0 0 var(--pri)}
@media(max-width:900px){.lp-hero{padding:20px 18px}.lp-hero h1{font-size:24px}.lp-ico{width:90px;height:90px;opacity:.35}.lp-main .lp-card{padding:20px 18px}.lp-card p{font-size:16px}.lp-card p:first-child{font-size:17.5px}.lp-nav{flex-wrap:wrap}.lp-mid{order:3;flex-basis:100%}}
.rp-tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:8px 0 14px}.rp-t{border:1px solid var(--line);border-radius:12px;padding:12px 14px;background:var(--bg)}.rp-t b{display:block;font-size:24px;letter-spacing:-.02em;color:var(--navy)}.rp-t span{font-size:12.5px;color:var(--mute)}.rp-t.ok b{color:#1a8f4c}.rp-t.bad b{color:#c0392b}.rp-wrap{overflow-x:auto}.rp-s{font-size:12px;font-weight:600;border-radius:999px;padding:2px 10px;background:var(--pri-soft)}.rp-s.done{background:#e3f5ea;color:#17703c}.rp-s.overdue{background:#fde8e6;color:#b3261e}.rp-s.new{background:#eef0f5;color:var(--mute)}
.btn.danger{color:#b3261e}
.ml{max-width:900px}.ml h1{font-size:28px;letter-spacing:-.02em;margin:6px 0 14px}.ml-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:10px}.ml-stats div{border:1px solid var(--line);border-radius:14px;padding:14px 16px;background:var(--bg)}.ml-stats b{display:block;font-size:28px;letter-spacing:-.02em;color:var(--navy)}.ml-stats span{font-size:12.5px;color:var(--mute)}.ml-stats .bad b{color:#c0392b}.ml-h{font-size:17px;margin:22px 0 10px;color:var(--navy)}.ml-h small{color:var(--mute);font-weight:500;margin-left:6px}.ml-c{border:1px solid var(--line);border-radius:14px;padding:14px 16px;margin-bottom:10px;background:var(--bg)}.ml-c.late{border-color:#f0b9b4}.ml-top{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.ml-top b{flex:1;font-size:16px}.ml-due{font-size:12px;font-weight:600;border-radius:999px;padding:3px 10px;background:var(--pri-soft)}.ml-due.late{background:#fde8e6;color:#b3261e}.ml-bot{display:flex;align-items:center;gap:12px;margin-top:10px;flex-wrap:wrap;justify-content:space-between}.ml-bot .pbar{flex:1;min-width:120px}
@media(max-width:700px){.rp-tiles{grid-template-columns:repeat(2,1fr)}}
.qr{display:flex;gap:20px;align-items:center;border-radius:16px;padding:20px 22px;margin-top:18px;border:1px solid var(--line)}.qr.pass{background:#effaf3;border-color:#bfe6cd}.qr.fail{background:#fff6f4;border-color:#f3c7c1}.qr-ring{width:104px;height:104px;flex:none}.qr-ring .bg{fill:none;stroke:rgba(0,0,0,.08);stroke-width:9}.qr-ring .fg{fill:none;stroke-width:9;stroke-linecap:round}.qr.pass .fg{stroke:#1a8f4c}.qr.fail .fg{stroke:#d9534f}.qr-ring text{font-size:23px;font-weight:800;fill:var(--navy)}.qr-t{display:flex;flex-direction:column;gap:4px}.qr-t b{font-size:21px;letter-spacing:-.01em;color:var(--navy)}.qr-t span{color:var(--mute);font-size:14px}.qr-a{margin-top:8px;display:flex;gap:8px}
@media(max-width:600px){.qr{flex-direction:column;text-align:center}.qr-a{justify-content:center}}
.pa{margin-top:6px}.pa-c{border:1px solid var(--line);border-radius:14px;padding:16px 18px;margin-bottom:12px;background:var(--bg)}.pa-top{display:flex;justify-content:space-between;gap:10px;align-items:baseline;flex-wrap:wrap}.pa-top b{font-size:17px;color:var(--navy)}.pa-n{font-size:12.5px;color:var(--mute)}.pa-d{margin:4px 0 0}.pa-l{list-style:none;margin:12px 0;padding:0;display:grid;gap:6px}.pa-l li{display:flex;align-items:center;gap:10px;justify-content:space-between}.pa-l .link{display:flex;align-items:center;gap:10px;text-align:left}.pa-i{display:inline-grid;place-items:center;width:24px;height:24px;border-radius:50%;background:var(--pri-soft);font-size:12px;font-weight:700;color:var(--pri)}.pa-l li.done .pa-i{background:#1a8f4c;color:#fff}.pa-a{display:flex;gap:8px;flex-wrap:wrap}
.ov{margin:4px 0 16px}.ov-watch{display:flex;flex-direction:column;gap:6px;border:1px solid #f3cfca;background:#fff6f5;border-radius:12px;padding:10px 12px}.ov-watch b{font-size:13px;color:#b3261e}.ov-row{display:flex;justify-content:space-between;gap:10px;border:0;background:none;padding:6px 0;font:inherit;color:var(--ink);text-align:left;border-top:1px solid #f3cfca}.ov-row:first-of-type{border-top:0}.ov-row em{font-style:normal;font-weight:600;color:#b3261e;white-space:nowrap}.ov-row:hover span{text-decoration:underline}
.mailbox{padding:12px 14px}.mailbox.bad{border-color:#f3cfca;background:#fff6f5}.mailbox.bad p{color:#b3261e}
.sigset{margin:0 0 14px;border:1px solid var(--line);border-radius:12px;padding:8px 14px;background:var(--bg)}.sigset summary{cursor:pointer;font-weight:600;color:var(--navy)}.sigset .erow{margin-top:8px;flex-wrap:wrap}
@media(max-width:700px){.erow.assignform select,.erow.assignform input:not([type=color]){flex:1 1 100%;min-width:100%;box-sizing:border-box}.erow.assignform .btn{flex:1 1 40%}}
.demobar{display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px;background:#fff7e0;color:#6b4e00;border:1px solid #f0d98a;border-radius:10px;padding:8px 12px;margin:0 0 10px;font-size:13px}.demobar label{margin-left:auto;display:flex;align-items:center;gap:6px;font-weight:600}.demobar select{max-width:260px}.freshkey{background:#e6f4ea;color:#137333;padding:10px;border-radius:8px;margin:8px 0}
.dibox-top h2{margin:4px 0}.dibox-cols{display:grid;grid-template-columns:minmax(220px,300px) minmax(0,1fr) minmax(260px,340px);gap:12px;align-items:start}
.dibox-list{list-style:none;margin:0;padding:0;border:1px solid var(--line);border-radius:12px;overflow:hidden;background:var(--bg)}
.dibox-row{display:grid;grid-template-columns:1fr auto;gap:2px 8px;width:100%;text-align:left;border:0;border-bottom:1px solid var(--line);background:none;padding:9px 12px;font:inherit;color:var(--ink);cursor:pointer}
.dibox-row.on{background:#eef3fb}.dibox-row.unread .dibox-from,.dibox-row.unread .dibox-subj{font-weight:700}.dibox-from{display:flex;align-items:center;gap:6px}.dibox-from i{width:8px;height:8px;border-radius:50%;background:#6355F6;display:inline-block}
.dibox-time{font-size:12px;color:#6b7280}.dibox-subj{grid-column:1/3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dibox-snip{grid-column:1/3;color:#6b7280;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dibox-read{border:1px solid var(--line);border-radius:12px;padding:12px 14px;background:var(--bg);min-height:240px}.dibox-read h3{margin:6px 0 10px}.dibox-msg{border-top:1px solid var(--line);padding:8px 0}.dibox-msg p{white-space:pre-wrap;margin:6px 0}
.dibox-att{display:inline-block;border:1px solid var(--line);border-radius:8px;padding:2px 8px;font-size:12px;margin-right:6px}.dibox-reply{margin-top:12px;display:flex;flex-direction:column;gap:6px;align-items:flex-start}.dibox-reply textarea{width:100%;box-sizing:border-box}
.dibox-panel{border:1px solid var(--line);border-radius:12px;background:#fff;min-height:240px}.dibox-back{display:none}.dibox-empty{margin:20px 0;text-align:center}
@media(max-width:900px){.dibox-cols{grid-template-columns:1fr}.dibox.reading .dibox-list{display:none}.dibox:not(.reading) .dibox-read,.dibox:not(.reading) .dibox-panel{display:none}.dibox-back{display:inline-block}}
.home-main>.hcard+.hcard{margin-top:14px}
.obwrap{padding:16px 20px 28px;display:grid;gap:14px;max-width:1180px}
.obhead{display:flex;justify-content:space-between;align-items:flex-start;gap:12px 16px;flex-wrap:wrap}
.obhead h2{margin:0;font-size:22px;line-height:1.2}
.obhead p{margin:4px 0 0;max-width:72ch}
.obhead-right{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.obkicker{display:block;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--mute)}
.obcard{background:var(--bg);border:1px solid var(--line);border-radius:14px;padding:16px 18px;min-width:0}
.obcard h3{margin:0 0 10px;font-size:14px}
.obcard h4{margin:14px 0 6px;font-size:13px;color:var(--mute)}
.obgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px}
.obgrid .wide{grid-column:1/-1}
.obback{justify-self:start;padding-left:0}
.obtiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.obtile span{font-size:13px;color:var(--ink);font-weight:600}
.obtile small{font-size:12px;color:var(--mute)}
.obtile.ok{border-color:#9fd8b3}.obtile.ok b{color:#0a7d3b}
.obtool{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px}
.obinvite{display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;border:1px dashed var(--line);border-radius:12px;padding:12px;margin-bottom:12px}
.obinvite>b{width:100%}
.obinvite .fl{display:grid;gap:4px}
.obpanel{flex-direction:column;align-items:stretch}
.obpanel .fl input,.obpanel .fl select{max-width:360px}
.obnew{display:flex;flex-direction:column;gap:10px;align-items:flex-start}
.obnew>button{margin-top:4px}
.obmanager-row{margin:0 0 22px}
.obstaffview{margin:12px 0 0}
.obstaffview ul{list-style:none;margin:6px 0;padding:0;display:grid;gap:4px}
.obstaffview .obform{display:flex;gap:10px;align-items:flex-end;margin-top:10px;flex-wrap:wrap}
.obstaffview .obform button{width:auto}
.obnote{margin:10px 0 0}
.obtablewrap{overflow-x:auto}
.obtable{width:100%;border-collapse:collapse;font-size:14px}
.obtable th{text-align:left;font-size:12px;color:var(--mute);font-weight:600;padding:8px 10px;border-bottom:1px solid var(--line);white-space:nowrap}
.obtable td{padding:12px 10px;border-bottom:1px solid var(--line);vertical-align:middle}
.obtable tbody tr{cursor:pointer}
.obtable tbody tr:hover{background:var(--tint2)}
.obtable td small{display:block}
.oblink{background:none;border:0;padding:0;font:inherit;font-weight:600;color:var(--pri);cursor:pointer;text-align:left}
.oblink:hover{text-decoration:underline}
.obstage{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.obstage span{white-space:nowrap}
.obprog{display:inline-grid;grid-template-columns:repeat(9,1fr);gap:3px;width:120px;flex:none}
.obprog i{display:block;height:6px;border-radius:99px;background:var(--tint2)}
.obprog i.done{background:var(--pri)}
.obprog i.cur{background:var(--pri);opacity:.45}
.obtrack{list-style:none;margin:0 0 12px;padding:0;display:grid;grid-template-columns:repeat(9,minmax(0,1fr))}
.obtrack li{position:relative;display:grid;justify-items:center;text-align:center;gap:6px;min-width:0}
.obtrack li::before{content:"";position:absolute;top:11px;left:-50%;right:50%;height:2px;background:var(--line)}
.obtrack li:first-child::before{display:none}
.obtrack li.done::before,.obtrack li.cur::before{background:var(--pri)}
.obdot{width:24px;height:24px;border-radius:50%;display:grid;place-items:center;background:var(--bg);border:2px solid var(--line);font-size:11px;font-weight:700;color:var(--mute);position:relative;z-index:1;flex:none}
.obtrack li.done .obdot{background:var(--ok,#0a7d3b);border-color:var(--ok,#0a7d3b);color:#fff}
.obtrack li.cur .obdot{background:var(--pri);border-color:var(--pri);color:#fff;box-shadow:0 0 0 4px var(--tint2)}
.oblabel{display:grid;gap:2px;font-size:12px;line-height:1.25}
.oblabel b{font-weight:600;color:var(--ink)}
.obtrack li.todo .oblabel b{color:var(--mute);font-weight:500}
.oblabel small{color:var(--mute)}
@media(max-width:860px){
.obtrack{grid-template-columns:1fr;gap:10px}
.obtrack li{display:flex;align-items:center;gap:10px;text-align:left}
.obtrack li::before{display:none}
}
.obnext{border-left:4px solid var(--pri);padding:10px 14px;border-radius:8px;background:var(--tint2);color:var(--ink);margin-top:4px}
.obform{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));align-items:end;margin-top:12px}
.obform .obspan2{grid-column:1/-1}
.obform .fl{display:grid;gap:4px}
.obform .btn{justify-self:start}
.obhint{margin:0 0 8px}
.oblist{list-style:none;margin:0;padding:0}
.oblist li{display:flex;justify-content:space-between;gap:8px 12px;align-items:center;padding:8px 0;border-bottom:1px solid var(--line);flex-wrap:wrap}
.oblist li span{color:var(--mute)}
.obchecks{display:grid;gap:8px;margin:8px 0 12px}
.obchecks label{display:flex;gap:8px;align-items:center}
@media(max-width:600px){.obwrap{padding:12px 14px 24px}.obgrid{grid-template-columns:1fr}.obprog{width:90px}}
/* Phase 1 page system (docs/claude/dashboard-design-plan.md): one shell, one card, one stat row, one control height. */
:host{--pg-max:1200px;--pg-gut:32px;--pg-gap:16px;--pg-sect:24px;--ctl-h:40px;--card-r:12px}
.pg{box-sizing:border-box;width:100%;max-width:var(--pg-max);margin:0 auto;padding:24px var(--pg-gut) 40px;display:flex;flex-direction:column;gap:var(--pg-sect);overflow:auto}
.pg>*{min-width:0;margin:0;flex-shrink:0}
.pg-head h1,.pg-head h2{margin:0;font-size:22px;line-height:1.25;color:var(--navy);letter-spacing:-.01em}
.pg-head p{margin:4px 0 0;color:var(--mute)}
.pg-cols{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr);gap:var(--pg-gap);align-items:stretch}
.pg-cols>*{min-width:0}
.pg .hcard,.pg .obcard,.pg .vpanel,.pg .obtile{box-sizing:border-box;border:1px solid var(--line);border-radius:var(--card-r);background:var(--bg);box-shadow:none;padding:20px}
.pg .obtile{padding:16px 20px;display:flex;flex-direction:column;justify-content:center;gap:4px;min-height:96px}
.pg .obtile b{font-size:26px;line-height:1.1;color:var(--navy)}
.pg .obtile span{font-size:13px;color:var(--mute)}
.pg .obtile.warn{border-color:var(--warn2);background:#fff7ed}
.pg .obtile.warn b{color:var(--warn)}
.pg .btn,.pg .sel,.pg select,.pg input:not([type=checkbox]):not([type=radio]){box-sizing:border-box;min-height:var(--ctl-h);height:var(--ctl-h);padding:0 12px;border:1px solid var(--line2);border-radius:8px;font:inherit}
.pg .btn{display:inline-flex;align-items:center;justify-content:center;padding:0 16px;white-space:nowrap}
.pg textarea{box-sizing:border-box;border:1px solid var(--line2);border-radius:8px;padding:10px 12px;font:inherit}
@media(max-width:900px){.pg-cols{grid-template-columns:1fr}}
@media(max-width:600px){.pg{padding:16px 16px 32px;gap:18px}.pg-stats{grid-template-columns:repeat(2,minmax(0,1fr))}}
.pg-sec{padding:0;margin:0;max-width:none;width:100%;box-sizing:border-box;display:flex;flex-direction:column;gap:16px}
.pg .tpad{padding-left:0;padding-right:0;max-width:none}
.pg-sec h2,.pg-sec h3,.pg-sec p{margin:0}
/* Renewals and deadlines (compliance officers). Uses the page shell and card styles above. */
.dl{display:flex;flex-direction:column;gap:var(--pg-gap);min-width:0}
.dl-h h2{margin:0;font-size:18px;color:var(--navy);letter-spacing:-.01em}
.dl-h p{margin:2px 0 14px;color:var(--mute);font-size:13px}
.dl-tl{overflow-x:auto;padding-bottom:4px}
.dl-in{min-width:820px}
.dl-row{display:grid;grid-template-columns:220px repeat(14,minmax(40px,1fr));gap:6px;align-items:center;margin-bottom:8px}
.dl-head{margin-bottom:6px}
.dl-who-h{font-size:13px;color:var(--mute)}
.dl-day{font-size:12px;color:var(--mute);text-align:center;line-height:1.25}
.dl-day b{display:block;font-size:14px;color:var(--ink)}
.dl-day.today,.dl-day.today b{color:var(--pri)}
.dl-who{min-width:0;display:flex;flex-direction:column;background:var(--tint);border:1px solid var(--line);border-radius:10px;padding:6px 10px}
.dl-who b{font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dl-who span{font-size:12px;color:var(--mute);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dl-cell{height:40px;border-radius:8px;background:var(--tint);border:1px solid var(--tint2)}
.dl-cell.we{background:repeating-linear-gradient(135deg,#EEF2FB 0 6px,#F7F9FF 6px 12px)}
.dl-bar{grid-row:1;height:40px;border-radius:10px;display:flex;align-items:center;padding:0 12px;color:#fff;font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;background:var(--warn2);box-shadow:0 4px 12px rgba(16,24,40,.15)}
.dl-bar.exp{background:var(--warn)}
.dl-up{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}
.dl-up li{border:1px solid var(--line);border-radius:12px;padding:12px}
.dl-up li.hot{background:#fff7ed;border-color:#fcd9a8}
.dl-up b{display:block;font-size:14px}
.dl-up span{font-size:12px;color:var(--mute)}
.dl-ob{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px}
.dl-ob div{border:1px solid var(--line);border-radius:12px;padding:12px}
.dl-ob b{display:block;font-size:14px}
.dl-ob span{font-size:12px;color:var(--mute)}
.dl-bar2{height:6px;border-radius:999px;background:var(--tint2);margin-top:8px;overflow:hidden}
.dl-bar2 i{display:block;height:100%;background:var(--pri)}
/* Phase 2: list pages share the page width and gutter. Children keep their vertical spacing, lose their own side padding. */
.pg-frame{box-sizing:border-box;width:100%;max-width:var(--pg-max);margin:0 auto;padding:24px var(--pg-gut) 0;display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden}
.pg-frame>*{flex:1;min-height:0;width:100%;max-width:none;box-sizing:border-box;padding-left:0;padding-right:0}
.pg-raw{display:contents}
@media(max-width:600px){.pg-frame{padding:16px 16px 0}}
.pg-frame select,.pg-frame input:not([type=checkbox]):not([type=radio]),.pg-frame textarea{box-sizing:border-box;min-height:var(--ctl-h);height:var(--ctl-h);padding:0 12px;border:1px solid var(--line2);border-radius:8px;background:var(--bg);color:var(--ink);font:inherit;font-size:14px}
.pg-frame textarea{height:auto;min-height:96px;padding:10px 12px}
.pg-frame .rstats{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:var(--pg-gap)}
.pg-frame .rstat{width:100%;min-height:88px;box-sizing:border-box}
.pg-frame .msg{text-align:left;padding:20px;margin:0;border:1px solid var(--line);border-radius:var(--card-r);background:var(--bg);color:var(--mute)}
.pg-frame .settings,.pg-frame .smain{max-width:none}
.pg-frame .bar,.pg-frame .fbar,.pg-frame .wrap,.pg-frame .stages,.pg-frame .meta{padding-left:0;padding-right:0}
@media(max-width:600px){.pg-frame .meta{flex-wrap:wrap}.pg-frame select{max-width:100%;min-width:0}}
.obalerts{display:flex;flex-direction:column;gap:12px}
.obalerts>.obtiles{margin-top:4px}
.obalerts h4{margin:12px 0 0;font-size:14px;color:var(--navy)}
.obalerts ul{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.obalerts li{border:1px solid var(--line);border-radius:10px;padding:10px 12px;font-size:14px;color:var(--ink);background:var(--bg)}
.obpartner.pg{flex-shrink:0;overflow:visible}
/* Visual style (planned-absences reference): soft lit cards, rounded tiles, pill controls, glossy bars, a pill on today. */
:host{--soft:0 1px 2px rgba(16,24,40,.04),0 10px 28px rgba(16,24,40,.07);--tile:#f4f6fa;--tile-line:#e6eaf2}
.pg .hcard,.pg .obcard,.pg .vpanel,.pg .obtile{border-color:#eef1f6;box-shadow:var(--soft)}
.pg .btn,.pg select,.pg .sel{border-radius:999px}
.pg .btn{box-shadow:0 1px 2px rgba(16,24,40,.06)}
.dl-cell{border-radius:10px;background:var(--tile);border:1px solid var(--tile-line);box-shadow:inset 0 1px 2px rgba(16,24,40,.04)}
.dl-cell.we{background:repeating-linear-gradient(135deg,#e9edf5 0 6px,#f6f8fc 6px 12px)}
.dl-who{border-radius:16px;background:#fff;border:1px solid var(--tile-line);box-shadow:var(--soft)}
.dl-bar{border-radius:999px;background:linear-gradient(180deg,rgba(255,255,255,.22),rgba(255,255,255,0)),var(--warn2);box-shadow:0 8px 18px rgba(16,24,40,.14)}
.dl-bar.exp{background:linear-gradient(180deg,rgba(255,255,255,.18),rgba(255,255,255,0)),var(--warn)}
.dl-day.today b{display:table;margin:2px auto 0;background:var(--pri);color:#fff;border-radius:999px;padding:0 8px;line-height:22px;font-size:13px}
.dl-day.today{color:var(--pri)}
/* Reference completion: backdrop panel, partner avatars and status chips, days-left pills, onboarding progress text. */
.dl-glass{background:#f3f5f9;border-radius:24px;padding:16px;border:1px solid #e9edf4}
.dl-glass>.hcard,.dl-glass>.pg-cols>.hcard{background:#fff}
.dl-who{flex-direction:row;align-items:center;gap:10px}
.dl-wt{display:flex;flex-direction:column;min-width:0}
.dl-av{width:34px;height:34px;border-radius:50%;background:#EEEBFF;color:#6355F6;font-weight:700;font-size:12px;display:grid;place-items:center;flex:0 0 auto}
.dl-chip{font-style:normal;font-size:11px;font-weight:600;border-radius:999px;padding:1px 8px;background:#EEEBFF;color:#6355F6;align-self:flex-start;margin-top:3px}
.dl-chip.exp{background:#fff1e6;color:#b45309}
.dl-up li{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.dl-up .dl-wt{flex:1 1 180px}
@media(max-width:600px){.dl-up li{flex-direction:column;align-items:flex-start}.dl-up .dl-pill{margin-left:0}}
.dl-pill{margin-left:auto;flex:0 0 auto;font-style:normal;font-size:12px;font-weight:600;border-radius:999px;padding:4px 10px;background:#fff7ed;color:#b45309;white-space:nowrap}
.dl-ob>div{display:flex;flex-direction:column;gap:2px}
.dl-ob small{font-size:12px;color:var(--mute);margin-top:4px}
/* Design system (indigo): soft lit cards, pill controls, pastel tints. Amber stays for overdue and expired. */
:host{--pri:#6355F6;--pri-h:#5246E0;--pri-soft:#EEEBFF;--navy:#191C32;--ink:#1E2238;--mute:#6B7280;--faint:#9CA3AF;--line:#EEF1F6;--line2:#E5E7EB;--tint:#F9FAFB;--tint2:#F3F1FF;--shadow-soft:0 1px 2px rgba(16,24,40,.04),0 10px 28px rgba(16,24,40,.07)}
.pii{background:#F2F4F8}
.hcard,.obcard,.vpanel,.obtile,.pg .hcard,.pg .obcard,.pg .vpanel,.pg .obtile{border-radius:20px;border-color:#EEF1F6;box-shadow:var(--shadow-soft)}
.btn{border-radius:999px;font-weight:600}
.tag{border-radius:999px;background:var(--pri-soft);color:var(--pri-h)}
.search,input[type=search]{border-radius:999px;padding-left:16px;padding-right:16px;background:#fff;border-color:#E5E7EB}
.asst{display:grid;gap:14px;background:linear-gradient(135deg,#ffffff 0%,#F7F6FF 100%)}
.asst-top{display:flex;justify-content:space-between;align-items:flex-start;gap:16px}
.asst-eyebrow{font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--faint)}
.asst-h{margin:4px 0 0;font-size:20px;font-weight:700;color:var(--navy)}
.asst-sub{margin:4px 0 0;font-size:13px;color:var(--mute)}
.asst-orb{width:64px;height:64px;border-radius:50%;flex:0 0 auto;background:radial-gradient(circle at 35% 30%,#ffffff 0%,#C9C2FF 35%,#6355F6 100%);box-shadow:0 12px 28px rgba(99,85,246,.28)}
.asst-actions{display:flex;flex-wrap:wrap;gap:8px}
.asst-pill{border:1px solid #DCD8FF;background:#fff;color:var(--pri-h);border-radius:999px;padding:8px 16px;font:inherit;font-size:13px;font-weight:600;cursor:pointer}
.asst-pill.on,.asst-pill:hover{background:var(--pri);border-color:var(--pri);color:#fff}
.asst-pill:disabled{opacity:.6;cursor:progress}
.asst-note{margin:0;font-size:13px;color:var(--mute)}
.asst-list{margin:0;padding:0;list-style:none;display:grid;gap:8px}
.asst-list li{border:1px solid var(--line);border-radius:14px;padding:10px 14px;font-size:13px;color:var(--ink);background:#fff}
.asst-off{margin:0;font-size:12px;color:var(--faint)}
.ktile,.rstat,.rstats .rstat,.dl-glass{border-radius:20px}
.ktile{border-color:#EEF1F6;box-shadow:var(--shadow-soft)}
.asst-answer{margin:0;font-size:14px;line-height:1.5;color:var(--ink);background:#fff;border:1px solid var(--line);border-radius:16px;padding:12px 14px;white-space:pre-wrap}
.asst-ask{display:grid;gap:6px}
.asst-label{font-size:12px;color:var(--mute)}
.asst-row{display:flex;gap:8px}
.asst-row input{flex:1;min-width:0;border:1px solid #E5E7EB;border-radius:999px;padding:9px 16px;font:inherit;font-size:14px;background:#fff}
.asst-send{border:0;border-radius:999px;background:var(--pri);color:#fff;font:inherit;font-size:13px;font-weight:600;padding:9px 18px;cursor:pointer}
.asst-send:disabled{opacity:.5;cursor:default}
/* Indigo pass: settings and other plain list pages sit on the same white card */
.settings .sgrid{background:#fff;border:1px solid var(--line);border-radius:20px;box-shadow:var(--shadow-soft);padding:20px 24px}
@media(max-width:600px){.settings .sgrid{padding:16px}}
.pg-frame .bar{margin-bottom:12px}
/* Pipeline toolbar on phones: one scrollable strip instead of uneven wrapped rows */
@media(max-width:600px){.pg-frame .bar:has(.btn.quiet){flex-wrap:wrap}.pg-frame .bar:has(.btn.quiet)>*{flex-shrink:1}.pg-frame .bar:has(.btn.quiet) .spacer{display:none}}
/* Spec pieces: floating frame and left rail on wide screens, hero banner, Home right column, glass scrims, table style. */
.nv{display:none}
@media(min-width:1100px){
  :host{background:#E9ECF3}
  .shell{border-radius:28px;box-shadow:0 20px 48px -12px rgba(90,100,140,.10);margin:20px;min-height:calc(100vh - 40px);overflow:hidden;display:grid;grid-template-columns:200px minmax(0,1fr);align-content:stretch}
  .shell>.tabs{grid-column:1;grid-row:1 / span 30;flex-direction:column;align-items:stretch;flex-wrap:nowrap;padding:22px 14px;border-bottom:0;border-right:1px solid var(--line);gap:4px;background:#FBFCFE;min-height:100%}
  .shell>*:not(.tabs){grid-column:2;min-width:0}
  .tabs button{display:flex;align-items:center;gap:10px;text-align:left;border-bottom:0;border-radius:12px;padding:10px 12px;font-size:14px}
  .tabs button[aria-selected=true]{background:var(--pri-soft);color:var(--pri)}
  .tabs .nv{display:block;width:18px;height:18px;flex:none;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
  .tabs-fb{margin:auto 0 0;padding:10px 12px}
}
.hero{position:relative;overflow:hidden;display:flex;align-items:center;gap:16px;flex-wrap:wrap;padding:24px 28px;border-radius:20px;background:linear-gradient(120deg,#4B45E0 0%,#6355F6 55%,#8B5CF6 100%);color:#fff;box-shadow:0 14px 34px -14px rgba(99,85,246,.55);margin-bottom:16px}
.hero::before{content:"";position:absolute;inset:0;pointer-events:none;background:radial-gradient(circle at 85% 20%,rgba(255,255,255,.28) 0 2px,transparent 3px) 0 0/34px 34px,radial-gradient(circle at 30% 90%,rgba(255,255,255,.18) 0 2px,transparent 3px) 0 0/46px 46px}
.hero>*{position:relative}
.hero .hero-txt{flex:1 1 260px;min-width:0}
.hero .hero-eye{display:inline-block;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;background:rgba(255,255,255,.18);border-radius:999px;padding:4px 10px}
.hero h2{color:#fff;margin:10px 0 0;font-size:24px;font-weight:700}
.hero .link{color:#fff;text-decoration:underline}
.hero .hero-cta{border:0;border-radius:999px;background:#191C32;color:#fff;font:inherit;font-weight:600;font-size:14px;padding:10px 10px 10px 18px;cursor:pointer;display:inline-flex;align-items:center;gap:10px}
.hero .hero-cta span{display:grid;place-items:center;width:24px;height:24px;border-radius:50%;background:#fff;color:#191C32;font-size:12px}
@media(min-width:1280px){
  .home:has(>.home-side){display:grid;grid-template-columns:minmax(0,1fr) 300px;column-gap:24px;align-items:start}
  .home-main{min-width:0}
  .home-side{position:sticky;top:12px;display:grid;gap:14px}
}
.home-side .side-prof{display:grid;justify-items:center;gap:6px;text-align:center;background:#fff;border:1px solid var(--line);border-radius:20px;padding:20px;box-shadow:var(--shadow-soft)}
.side-ring{width:112px;height:112px;border-radius:50%;background:conic-gradient(var(--pri) calc(var(--p) * 1%),#E6E3FD 0);display:grid;place-items:center;position:relative;margin-bottom:4px}
.side-ring::before{content:"";position:absolute;inset:10px;border-radius:50%;background:#fff}
.side-ring span{position:relative;font-weight:700;font-size:18px;color:var(--navy)}
.home-side .side-bars{padding:16px}
.home-side .sbars{display:flex;align-items:flex-end;gap:10px;height:170px;padding-top:6px}
.sbar{flex:1;min-width:0;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:4px}
.sbar i{display:block;width:100%;max-width:34px;border-radius:10px;background:#C9C4FB}
.sbar i.alt{background:var(--pri)}
.sbar b{font-size:12px;color:var(--navy)}
.sbar small{font-size:11px;color:var(--mute);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.side-row{display:flex;align-items:center;gap:10px;width:100%;border:0;border-bottom:1px solid var(--line);background:none;padding:8px 0;text-align:left;cursor:pointer;font:inherit;color:var(--ink)}
.side-av{width:34px;height:34px;border-radius:50%;background:var(--pri-soft);color:var(--pri);display:grid;place-items:center;font-size:12px;font-weight:700;flex:none}
.side-tx{flex:1;min-width:0}.side-tx b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13.5px}
.side-pill{font-size:12px;border:1px solid var(--pri-line);color:var(--pri);border-radius:999px;padding:4px 10px;background:#fff;flex:none}
.side-all{width:100%;margin-top:12px;border:0;border-radius:999px;background:#F3F1FF;color:var(--pri);font:inherit;font-weight:600;padding:10px;cursor:pointer}
/* Tables: borderless, uppercase muted headers, row rules only */
.pg table{border-collapse:separate;border-spacing:0}
.pg th{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--faint);font-weight:600;background:transparent;border-bottom:1px solid var(--line)}
.pg td{border-bottom:1px solid var(--line)}
/* Remaining spec pieces: stat cards with pastel badges, recent-records carousel, circular open buttons in tables. */
.kstrip{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
@media(min-width:1100px){.kstrip{grid-template-columns:repeat(3,minmax(0,1fr))}}
.kstrip .ktile{position:relative;padding-left:68px;min-height:78px;display:flex;flex-direction:column;justify-content:center;text-align:left}
.kstrip .ktile::before{content:"";position:absolute;left:14px;top:50%;transform:translateY(-50%);width:38px;height:38px;border-radius:12px;background:var(--kbg);color:var(--kfg);display:grid;place-items:center;font-size:16px;font-weight:700}
.kstrip .ktile:nth-child(1){--kbg:#E8F4FD;--kfg:#2D9CDB}.kstrip .ktile:nth-child(1)::before{content:"▣"}
.kstrip .ktile:nth-child(2){--kbg:#F3E8FF;--kfg:#9B51E0}.kstrip .ktile:nth-child(2)::before{content:"✓"}
.kstrip .ktile:nth-child(3){--kbg:#EEEBFF;--kfg:#6355F6}.kstrip .ktile:nth-child(3)::before{content:"%"}
.kstrip .ktile:nth-child(4){--kbg:#FDE8E8;--kfg:#EB5757}.kstrip .ktile:nth-child(4)::before{content:"◷"}
.kstrip .ktile:nth-child(5){--kbg:#FEF3C7;--kfg:#D97706}.kstrip .ktile:nth-child(5)::before{content:"⟳"}
.kstrip .ktile:nth-child(6){--kbg:#FDE8E8;--kfg:#EB5757}.kstrip .ktile:nth-child(6)::before{content:"!"}
.car{overflow:hidden}
.car-h{display:flex;align-items:center;gap:8px;margin-bottom:12px}.car-h h3{margin:0}
.carbtn{width:34px;height:34px;border-radius:50%;border:1px solid var(--line2);background:#fff;color:var(--navy);font-size:18px;line-height:1;cursor:pointer;display:grid;place-items:center;padding:0}
.car-track{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(220px,260px);gap:12px;overflow-x:auto;scroll-snap-type:x mandatory;padding:2px 2px 6px;scrollbar-width:none}
.car-track::-webkit-scrollbar{display:none}
.carcard{scroll-snap-align:start;display:flex;flex-direction:column;gap:10px;text-align:left;border:1px solid var(--line);border-radius:18px;background:#fff;padding:14px;cursor:pointer;font:inherit;color:var(--ink);min-height:150px;box-shadow:var(--shadow-soft)}
.carcard:hover{border-color:var(--pri-line)}
.carcat{align-self:flex-start;font-size:11px;font-weight:600;border-radius:999px;padding:3px 10px;color:#fff}
.cartitle{font-size:15px;line-height:1.3;color:var(--navy);overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.carfoot{display:flex;align-items:center;gap:8px;margin-top:auto;min-width:0}
.carfoot small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.car-av{width:26px;height:26px;border-radius:50%;background:var(--pri-soft);color:var(--pri);display:grid;place-items:center;font-size:11px;font-weight:700;flex:none}
.ocirc{width:32px;height:32px;border-radius:50%;border:1px solid var(--pri-line);background:#fff;color:var(--pri);cursor:pointer;font-size:14px;line-height:1;padding:0;display:inline-grid;place-items:center}
.ocirc:hover{background:var(--pri-soft)}
.pg th.openc,.pg td.openc{width:52px;text-align:right}
/* Foldable left menu (wide screens): the toggle shows only on wide screens; folded it keeps icons. */
.rail-toggle{display:none}
@media(min-width:1100px){
  .rail-toggle{display:grid;place-items:center;width:32px;height:32px;border-radius:10px;border:1px solid var(--line2);background:#fff;color:var(--mute);cursor:pointer;padding:0;margin:0 0 6px auto}
  .rail-toggle svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
  .rail-toggle:hover{color:var(--pri);border-color:var(--pri-line)}
  .tabs button .tl{white-space:nowrap}
  .shell.rail-closed{grid-template-columns:72px minmax(0,1fr)}
  .shell.rail-closed>.tabs{padding:22px 12px;align-items:center}
  .shell.rail-closed>.tabs .rail-toggle{margin:0 auto 6px}
  .shell.rail-closed .tabs button{justify-content:center;padding:10px 0;width:100%}
  .shell.rail-closed .tabs button .tl{display:none}
  .shell.rail-closed .tabs-fb{display:none}
}
.side-name{margin-top:4px}
/* Partner onboarding: overview tiles get the same coloured glyph badges as the Home stat tiles. */
.obtiles .obtile{position:relative;padding-left:68px;min-height:78px;justify-content:center;text-align:left}
.obtiles .obtile::before{content:"";position:absolute;left:14px;top:50%;transform:translateY(-50%);width:38px;height:38px;border-radius:12px;background:var(--kbg);color:var(--kfg);display:grid;place-items:center;font-size:16px;font-weight:700}
.obtiles .obtile:nth-child(6n+1){--kbg:#E8F4FD;--kfg:#2D9CDB}.obtiles .obtile:nth-child(6n+1)::before{content:"▣"}
.obtiles .obtile:nth-child(6n+2){--kbg:#F3E8FF;--kfg:#9B51E0}.obtiles .obtile:nth-child(6n+2)::before{content:"✓"}
.obtiles .obtile:nth-child(6n+3){--kbg:#EEEBFF;--kfg:#6355F6}.obtiles .obtile:nth-child(6n+3)::before{content:"%"}
.obtiles .obtile:nth-child(6n+4){--kbg:#FDE8E8;--kfg:#EB5757}.obtiles .obtile:nth-child(6n+4)::before{content:"◷"}
.obtiles .obtile:nth-child(6n+5){--kbg:#FEF3C7;--kfg:#D97706}.obtiles .obtile:nth-child(6n+5)::before{content:"⟳"}
.obtiles .obtile:nth-child(6n){--kbg:#E6F7EE;--kfg:#0a7d3b}.obtiles .obtile:nth-child(6n)::before{content:"!"}
/* Phone and tablet: the section tabs read as pills; the current section is filled in indigo. */
@media(max-width:1099px){
  .tabs{gap:6px;padding:10px 14px 12px}
  .tabs button{border:1px solid var(--line2);border-bottom:1px solid var(--line2);border-radius:999px;background:#fff;padding:7px 14px;font-size:14px;color:var(--ink)}
  .tabs button[aria-selected=true]{background:var(--pri);border-color:var(--pri);color:#fff}
  .tabs-fb{margin-left:0;padding:6px 4px}
}
/* Phones: keyboard shortcuts do not apply; segmented controls scroll sideways inside themselves instead of spilling off the screen. */
@media(max-width:760px){.kbdhint{display:none}}
@media(max-width:600px){.seg{max-width:100%;overflow-x:auto;scrollbar-width:none}.seg::-webkit-scrollbar{display:none}.seg button{flex:none}}
@media(max-width:600px){.bar>.seg[aria-label="View"]{flex:1 1 100%;display:flex}.bar>.seg[aria-label="View"] button{flex:1 1 0}}
@media(max-width:600px){.pg-frame .bar{flex-wrap:wrap}}
/* Top menu (Dashboard, Partners, Reports) across the top; the other sections stay in the left column on wide screens. */
.topnav{display:flex;align-items:center;flex-wrap:wrap;gap:6px;padding:10px 14px;border-bottom:1px solid var(--line);background:#fff}
.topnav button{display:inline-flex;align-items:center;gap:8px;border:1px solid var(--line2);background:#fff;border-radius:999px;padding:7px 14px;font-size:14px;font-weight:600;color:var(--ink);cursor:pointer}
.topnav button[aria-selected=true]{background:var(--pri);border-color:var(--pri);color:#fff}
.topnav .nv{width:18px;height:18px;flex:none;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.topnav .pz{margin-left:auto}
@media(min-width:1100px){
  .shell>.topnav{grid-column:1 / -1;grid-row:1;padding:12px 20px;gap:6px}
  .topnav button{border:0;background:none;color:var(--mute);padding:8px 14px}
  .topnav button[aria-selected=true]{background:var(--pri-soft);color:var(--pri)}
  .shell>.tabs{grid-row:2 / span 30}
  .shell>*:not(.tabs):not(.topnav){grid-column:2;grid-row:auto;min-width:0}
}
/* Partners online in the branch: overlapping faces with a green dot. */
.pz{display:inline-flex;align-items:center;padding-left:8px;margin-left:auto}
.pz-face{position:relative;width:32px;height:32px;margin-left:-8px;border-radius:50%;border:2px solid #fff;background:var(--pri-soft);color:var(--pri);display:inline-flex;align-items:center;justify-content:center;overflow:visible;flex:none}
.pz-face img{width:100%;height:100%;border-radius:50%;object-fit:cover;display:block}
.pz-init{font-size:12px;font-weight:700}
.pz-dot{position:absolute;right:-1px;bottom:-1px;width:9px;height:9px;border-radius:50%;background:#22C55E;border:2px solid #fff}
.pz-more{margin-left:4px;font-size:12px;font-weight:600;color:var(--mute)}
/* Pipeline toolbar: two rows. Row 1 is the pipeline and its scope/view; row 2 is the actions, with More and New on the right. */
.bar:has(.bar-row){flex-direction:column;align-items:stretch;gap:8px}
.bar-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;min-width:0}
.bar-row .seg{margin-bottom:0}
@media(max-width:600px){.bar-row{gap:8px}.bar-row>.btn{flex:1 1 auto;justify-content:center}.bar-row .seg{flex:1 1 100%;display:flex}.bar-row .seg button{flex:1 1 0}}
`;
