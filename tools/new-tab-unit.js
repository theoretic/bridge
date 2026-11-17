// New-tab unit check (tools/new-tab-unit.js): the new-tab listener of scripts/main.js on a static
// page that copies the admin's markup (module Settings, Install, Delete with a confirm, a tree
// title, a Lister title, a .pw-modal link, a button inside a link, data-pw-href, a plain link),
// with no sandbox: for a quick run in each browser. tools/new-tab-check.js drives the real screens.
// Serves the page on 127.0.0.1:8313.
//
// usage: node tools/new-tab-unit.js <playwright-core dir> <firefox|chromium|webkit> [built main.js]
//   main.js defaults to modules/AdminThemeBridge/scripts/main.js of this repository
//
// Original work, MIT.
const pw = require(process.argv[2]); const browserName = process.argv[3] || 'firefox';
const http=require('http'), fs=require('fs');
const main=fs.readFileSync(process.argv[4] || require('path').join(__dirname, '..', 'modules', 'AdminThemeBridge', 'scripts', 'main.js'),'utf8');
const html=`<!doctype html><body>
<form id=modules_form method=post action="/module/"><table><tr><td><a href="/module/edit?name=Foo"><span class=ConfigurableModule>Foo</span></a></td><td><button type=button class="ProcessModuleSettings" id=settings>Settings</button></td></tr>
<tr><td><button type=submit name=install data-install=Bar value=Bar id=install>Install</button><button type=submit name=delete data-delete=Baz value=Baz data-pw-confirm="Delete?" id=delete>Delete</button></td></tr></table></form>
<div class=PageList><div class=PageListItem><a class="PageListPage label" href="#" id=tree>Home</a><ul class="PageListActions actions"><li class=PageListActionEdit><a href="/page/edit/?id=1">Edit</a></li></ul></div></div>
<table><tr><td><a class=actions_toggle id=page5 href="#">Lister row</a> <div class="PageListerActions actions"><a class="PageEdit" href="/page/edit/?id=5">Edit</a></div></td></tr></table>
<a class="pw-modal" href="/field/edit?id=3&modal=1" id=modal>modal</a>
<a class=InputfieldButtonLink href="/template/add" tabindex=-1><button type=button id=abutton>Add New</button></a>
<span data-pw-href="/setup/x" id=dhref>data href</span>
<a href="/plain" id=plain>plain</a>
<script>${main}</script><script>
ProcessWireAdminTheme.newTab.init();
document.addEventListener('click',function(e){var el=e.target.closest('[data-pw-confirm]'); if(!el) return; if(el.pwConfirmed){el.pwConfirmed=false;return;} e.preventDefault(); e.stopImmediatePropagation(); setTimeout(function(){el.pwConfirmed=true; el.click();},50);},true);
document.addEventListener('click',function(e){ if(e.target.closest('.ProcessModuleSettings')) location.href='/module/edit?name=Foo&collapse_info=1&SAMETAB'; if(e.target.closest('a.PageListPage, a.actions_toggle, .pw-modal')) { e.preventDefault(); window.toggled=(window.toggled||0)+1; } });
</script>`;
const want={settings:'GET /module/edit?name=Foo&collapse_info=1',install:'POST /module/ install=Bar',delete:'POST /module/ delete=Baz',tree:'GET /page/edit/?id=1',page5:'GET /page/edit/?id=5',modal:'GET /field/edit?id=3',abutton:'GET /template/add',dhref:'GET /setup/x',plain:'GET /plain'};
const srv=http.createServer((q,r)=>{let b='';q.on('data',d=>b+=d);q.on('end',()=>{r.setHeader('content-type','text/html');r.end(q.url==='/'?html:'<p>'+q.method+' '+q.url+(b?' '+b:'')+'</p>')})}).listen(8313);
(async()=>{const b=await pw[browserName].launch({headless:true});const ctx=await b.newContext();const p=await ctx.newPage();let fail=0;
for (const id of Object.keys(want)) for (const [m,opts] of [['ctrl',{modifiers:['Control']}],['middle',{button:'middle'}]]){
 await p.goto('http://127.0.0.1:8313/'); 
 const opened=ctx.waitForEvent('page',{timeout:5000}).catch(()=>null);
 await p.click('#'+id,opts); const tab=await opened; let got='(no new tab)';
 if(tab){ await tab.waitForLoadState().catch(()=>{}); got=(await tab.textContent('body').catch(()=>'')).trim(); await tab.close(); }
 await p.waitForTimeout(300);
 const stays=p.url()==='http://127.0.0.1:8313/', toggled=await p.evaluate(()=>window.toggled||0).catch(()=>-1);
 const ok=got===want[id]&&stays&&!toggled; if(!ok) fail++;
 console.log((ok?'PASS':'FAIL'),browserName,id,m,'| new tab:',got,'| stayed:',stays,'| page handler ran:',toggled);
}
for (const id of ['install','dhref','settings']) { await p.goto('http://127.0.0.1:8313/'); await Promise.all([p.waitForNavigation().catch(()=>{}),p.click('#'+id)]); const t=(await p.textContent('body')).trim(); const ok=t.startsWith(id==='settings'?'GET /module/edit?name=Foo&collapse_info=1&SAMETAB':want[id]); if(!ok) fail++; console.log(ok?'PASS':'FAIL',browserName,id,'plain click, same tab |',t); }
await p.goto('http://127.0.0.1:8313/'); const o=ctx.waitForEvent('page',{timeout:5000}).catch(()=>null); await p.click('#install',{modifiers:['Control']}); const t=await o; if(t) await t.close(); await p.waitForTimeout(300);
const ft=await p.evaluate(()=>document.getElementById('install').getAttribute('formtarget')); if(ft) fail++; console.log(ft?'FAIL':'PASS',browserName,'formtarget cleared after the post:',ft);
console.log(fail?`${fail} FAILED`:'ALL PASSED'); await b.close(); srv.close(); process.exitCode=fail?1:0;})();
