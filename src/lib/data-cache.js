// Geography caches are independent of output dimensions and colors. Storage
// denial/private mode is harmless: the bounded memory cache remains available.
const memory=new Map();
const LIMIT=32*1024*1024,TTL=24*60*60*1000;
let bytes=0;
const remember=(key,data)=>{
  if(data.byteLength>8*1024*1024)return;
  if(memory.has(key))bytes-=memory.get(key).data.byteLength;
  memory.delete(key);memory.set(key,{data,time:Date.now()});bytes+=data.byteLength;
  while(bytes>LIMIT||memory.size>64){const [old,item]=memory.entries().next().value;memory.delete(old);bytes-=item.data.byteLength;}
};
async function storageKey(key){
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key));
  return new URL('/__topomapper_cache__/'+Array.from(new Uint8Array(hash),n=>n.toString(16).padStart(2,'0')).join(''),location.origin).href;
}
export async function cachedBytes(key){
  const item=memory.get(key);
  if(item&&Date.now()-item.time<TTL){memory.delete(key);memory.set(key,item);return item.data;}
  if(item){memory.delete(key);bytes-=item.data.byteLength;}
  try{
    if(typeof caches==='undefined')return null;
    const cache=await caches.open('topomapper-geography-v1'),response=await cache.match(await storageKey(key));
    if(!response||Date.now()-Number(response.headers.get('x-saved-at'))>TTL)return null;
    const data=new Uint8Array(await response.arrayBuffer());remember(key,data);return data;
  }catch{return null;}
}
let writes=Promise.resolve();
export async function cacheBytes(key,data){
  remember(key,data);
  if(data.byteLength>8*1024*1024||typeof caches==='undefined')return;
  // Serialize eviction, including writes from parallel tile downloads.
  writes=writes.catch(()=>{}).then(async()=>{
    const cache=await caches.open('topomapper-geography-v1');
    await cache.put(await storageKey(key),new Response(data,{headers:{'x-saved-at':String(Date.now()),'x-bytes':String(data.byteLength)}}));
    const keys=await cache.keys();let retained=0;
    let count=0;
    for(const request of keys.reverse()){
      const entry=await cache.match(request);retained+=Number(entry.headers.get('x-bytes'))||0;
      if(++count>128||retained>64*1024*1024||Date.now()-Number(entry.headers.get('x-saved-at'))>TTL)await cache.delete(request);
    }
  });
  await writes.catch(()=>{});
}
