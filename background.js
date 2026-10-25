let state={running:false,stop:false,message:'Ready.'};
const cats=[
 {label:'Non-leveraged, passive',lev:'No',dir:'Long',style:'Passive'},
 {label:'Active ETFs',lev:'No',dir:'Long',style:'Active'},
 {label:'Long leveraged',lev:'Yes',dir:'Long',style:'Leveraged'},
 {label:'Short',lev:'No',dir:'Short',style:'Short'},
 {label:'Short leveraged',lev:'Yes',dir:'Short',style:'Leveraged'}
];
chrome.runtime.onMessage.addListener((m,s,reply)=>{
 if(m.type==='STATUS'){reply({message:state.message});return}
 if(m.type==='STOP'){state.stop=true;state.message='Stop requested. Finishing current category.';reply({ok:true});return}
 if(m.type==='RESET'){chrome.storage.local.remove(['etfUniverseBatches']).then(()=>state.message='Import progress cleared.');reply({ok:true});return}
 if(m.type==='START'){
  if(state.running){reply({ok:false,error:'Import is already running.'});return}
  state={running:true,stop:false,message:'Starting full-universe import...'};run(m.tabId,m.url);reply({ok:true})
 }
});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function exec(tabId,func,args=[]){const r=await chrome.scripting.executeScript({target:{tabId},world:'MAIN',func,args});if(!r?.length)throw new Error('Page did not return a result.');if(r[0].error)throw new Error(r[0].error.message||String(r[0].error));return r[0].result}
async function run(tabId,url){
 try{
  const saved=await chrome.storage.local.get('etfUniverseBatches');const batches=saved.etfUniverseBatches||{};
  for(let ci=0;ci<cats.length;ci++){
   const c=cats[ci];if(batches[c.label])continue;if(state.stop)break;
   state.message=`Category ${ci+1}/5: selecting ${c.label}...`;
   const selected=await exec(tabId,selectCategory,[cats.map(x=>x.label),c.label]);
   if(!selected?.ok)throw new Error(selected?.error||'Category selection failed.');
   await wait(6000);if(state.stop)break;
   state.message=`Category ${ci+1}/5: importing ${c.label}...`;
   const batch=await exec(tabId,scrapeCategory,[c]);
   if(!batch?.headers?.length||!batch?.rows?.length)throw new Error(batch?.error||`No rows returned for ${c.label}.`);
   batches[c.label]=batch;const combined=combine(batches);
   await chrome.storage.local.set({etfUniverseBatches:batches,etfData:{...combined,sourceUrl:url,capturedAt:new Date().toISOString(),importMode:'Automatic full universe v0.4.2'}});
   state.message=`Saved ${c.label}: ${batch.rows.length} rows. Combined: ${combined.rows.length}.`;
   await wait(12000);
  }
  const combined=combine(batches);
  state.message=state.stop?`Stopped safely. Saved ${Object.keys(batches).length}/5 categories and ${combined.rows.length} unique rows.`:`Done: ${combined.rows.length} unique rows, ${combined.headers.length} columns.`;
 }catch(e){state.message='Stopped: '+(e?.message||String(e))}finally{state.running=false;state.stop=false}
}
function combine(b){const list=Object.values(b);if(!list.length)return{headers:[],rows:[],pageInfo:{categories:[]}};const h=list[0].headers,ii=h.findIndex(x=>/\bisin\b/i.test(x)),m=new Map();for(const x of list)for(const r of x.rows){const k=ii>=0&&r[ii]?String(r[ii]).toUpperCase():JSON.stringify(r.slice(0,-4));if(!m.has(k))m.set(k,r.slice());else{const e=m.get(k);for(let i=h.length-4;i<h.length;i++)e[i]=[...new Set([e[i],r[i]].flatMap(v=>String(v||'').split(' | ')).filter(Boolean))].join(' | ')}}return{headers:h,rows:[...m.values()],pageInfo:{categories:list.map(x=>x.pageInfo)}}}
function selectCategory(labels,target){
 const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
 function find(name){const targetText=name.toLowerCase();for(const l of document.querySelectorAll('label')){const text=clean(l.textContent).toLowerCase();if(text===targetText){const i=l.querySelector('input[type=checkbox]')||(l.htmlFor&&document.getElementById(l.htmlFor));if(i)return i}}for(const i of document.querySelectorAll('input[type=checkbox]')){const text=clean(i.closest('label')?.textContent).toLowerCase();if(text===targetText)return i}return null}
 const controls=labels.map(label=>({label,input:find(label)}));const missing=controls.filter(x=>!x.input).map(x=>x.label);if(missing.length)return{error:'Keep ETF Universe panel visible. Missing exact controls: '+missing.join(', ')};
 for(const x of controls){const wanted=x.label===target;if(x.input.checked!==wanted)x.input.click()}
 return{ok:true};
}
async function scrapeCategory(c){
 const sleep=ms=>new Promise(r=>setTimeout(r,ms)),clean=v=>String(v??'').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();
 const decode=v=>{const d=document.createElement('div');d.innerHTML=String(v??'');return clean(d.textContent||'')};
 const read=(v,n=0)=>{if(v==null||n>5)return'';if(v instanceof Node)return clean([v.textContent,v.href||v.querySelector?.('a[href]')?.href].filter(Boolean).join(' | '));if(typeof v==='string')return decode(v);if(typeof v==='number'||typeof v==='boolean')return String(v);if(Array.isArray(v))return clean(v.map(x=>read(x,n+1)).filter(Boolean).join(' | '));if(typeof v==='object'){for(const k of ['display','_','filter','value','text','label','name','title','isin','ticker','url','href'])if(k in v){const z=read(v[k],n+1);if(z&&z!=='[object Object]')return z}return clean(Object.values(v).map(x=>read(x,n+1)).filter(Boolean).join(' | '))}return clean(v)};
 if(!window.jQuery||!jQuery.fn?.DataTable)return{error:'justETF DataTable is absent. If the tab shows an Edge error page, access is currently limited.'};
 const ts=[...jQuery.fn.dataTable.tables(true)],t=ts.find(x=>x.id==='etfsTable')||ts.sort((a,b)=>b.querySelectorAll('tbody tr').length-a.querySelectorAll('tbody tr').length)[0];if(!t)return{error:'ETF table not found.'};
 const dt=jQuery(t).DataTable();
 const draw=(action,delay)=>new Promise((ok,bad)=>{const timer=setTimeout(()=>bad(new Error('Server response timeout. No retry was sent.')),45000);dt.one('draw',()=>{clearTimeout(timer);setTimeout(ok,delay)});action()});
 if(dt.page.len()!==500)await draw(()=>dt.page.len(500).draw(),5000);
 const st=dt.settings()[0],info=dt.page.info(),w=st.aoColumns.length,dom=[...t.querySelectorAll('thead th')].map(x=>clean(x.textContent));
 const headers=[...st.aoColumns.map((x,i)=>dom[i]||decode(x.sTitle)||clean(x.sName)||`Column ${i+1}`),'ETF Universe','Leveraged','Direction','Management style'],rows=[];
 for(let p=0;p<info.pages;p++){
  if(dt.page()!==p)await draw(()=>dt.page(p).draw('page'),5000);else await sleep(2000);
  for(const ri of dt.rows({page:'current'}).indexes().toArray()){const r=[];for(let ci=0;ci<w;ci++){let v='';try{v=dt.cell(ri,ci).render('display')}catch(e){try{v=dt.cell(ri,ci).data()}catch(_){}}r.push(read(v))}if(r.some(Boolean))rows.push([...r,c.label,c.lev,c.dir,c.style])}
  await sleep(7000);
 }
 return{category:c.label,headers,rows,pageInfo:{category:c.label,pages:info.pages,recordsDisplay:info.recordsDisplay,pageLength:info.length}};
}
