const s=document.getElementById('status');
async function tab(){const[t]=await chrome.tabs.query({active:true,currentWindow:true});if(!t?.url?.startsWith('https://www.justetf.com/')){s.textContent='Open justETF Screener first.';return null}return t}
document.getElementById('start').onclick=async()=>{const t=await tab();if(!t)return;const r=await chrome.runtime.sendMessage({type:'START',tabId:t.id,url:t.url});if(!r?.ok)s.textContent=r?.error||'Could not start.'};
document.getElementById('stop').onclick=async()=>{await chrome.runtime.sendMessage({type:'STOP'});s.textContent='Stop requested.'};
document.getElementById('reset').onclick=async()=>{if(confirm('Clear saved full-universe import progress?'))await chrome.runtime.sendMessage({type:'RESET'})};
document.getElementById('open').onclick=()=>chrome.tabs.create({url:chrome.runtime.getURL('dashboard.html')});
setInterval(async()=>{const r=await chrome.runtime.sendMessage({type:'STATUS'});if(r?.message)s.textContent=r.message},700);
