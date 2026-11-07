/* Sunshine Calculator: lets the page open with a poor or no signal.
   Always tries the internet first (so new builds and data arrive as normal);
   only if that fails, or takes over 4 seconds while a saved copy exists, is the last saved copy used. */
const CACHE='sunshine-v1';
self.addEventListener('install',()=>{self.skipWaiting()});
self.addEventListener('activate',(e)=>{e.waitUntil(self.clients.claim())});
const keyOf=(u)=>new Request(u.origin+u.pathname);
async function saved(c,u,nav){let h=await c.match(keyOf(u));if(!h&&nav){const base=u.origin+u.pathname.replace(/[^/]*$/,'');h=await c.match(new Request(base+'index.html'))||await c.match(new Request(base))}return h}
self.addEventListener('fetch',(e)=>{
  const r=e.request;if(r.method!=='GET')return;
  const u=new URL(r.url);if(u.origin!==location.origin)return; /* visitor counter, fonts, coffee button: left alone */
  const nav=r.mode==='navigate';
  e.respondWith((async()=>{
    const c=await caches.open(CACHE);
    const net=fetch(r).then((res)=>{if(res&&res.ok)c.put(keyOf(u),res.clone()).catch(()=>{});return res});
    try{return await Promise.race([net,new Promise((_,no)=>setTimeout(()=>no(new Error('slow')),4000))])}
    catch(err){const h=await saved(c,u,nav);if(h)return h;
      try{return await net}catch(_){return new Response('No signal, and no saved copy yet. Open the calculator once with a signal.',{status:503,headers:{'Content-Type':'text/plain'}})}}
  })())});
