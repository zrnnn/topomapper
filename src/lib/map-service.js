import {readBounded,mapFailure,downloadDetail} from './data-budget.js';
export const MAP_REQUEST_TIMEOUT_MS=45000;
export const MAP_TOTAL_TIMEOUT_MS=300000;
export const MAP_QUERY_TIMEOUT_SECONDS=30;
export const MAP_PROVIDERS=['https://overpass.private.coffee/api/interpreter','https://overpass-api.de/api/interpreter','https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
const cooldown=new Map(),providerQueue=new Map();
const speeds=new Map();
// Rank actual completed requests, not extra probes that consume public quotas.
// A user-supplied endpoint stays first; the .ru service is always a last resort.
export function rankProviders(endpoints){
  return [...endpoints].sort((a,b)=>{
    const tier=url=>!MAP_PROVIDERS.includes(url)?0:new URL(url).hostname.endsWith('.ru')?2:1;
    return tier(a)-tier(b)||(speeds.get(a)??Infinity)-(speeds.get(b)??Infinity);
  });
}
async function withProviderSlot(endpoint,signal,task){
  const previous=providerQueue.get(endpoint)||Promise.resolve();
  let release;const slot=new Promise(resolve=>{release=resolve;});
  const queued=previous.catch(()=>{}).then(()=>slot);providerQueue.set(endpoint,queued);
  try{
    await previous.catch(()=>{});
    if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
    return await task();
  }finally{release();if(providerQueue.get(endpoint)===queued)providerQueue.delete(endpoint);}
}
export async function requestMapData(query,{signal,progress=()=>{},fetchImpl=fetch,timeoutMs=MAP_REQUEST_TIMEOUT_MS,endpoints=MAP_PROVIDERS,preferLastSuccessful=true,budget}={}){
  if(preferLastSuccessful)endpoints=rankProviders(endpoints);
  const errors=[];
  for(let i=0;i<endpoints.length;i++){
    if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
    if((cooldown.get(endpoints[i])||0)>Date.now()){errors.push(new Error(`${new URL(endpoints[i]).hostname}: rate limit cooldown`));continue;}
    try{
      const data=await withProviderSlot(endpoints[i],signal,async()=>{
        const controller=new AbortController(),abort=()=>controller.abort();
        signal?.addEventListener('abort',abort,{once:true});
        const timer=setTimeout(abort,timeoutMs),started=performance.now();
        progress(`${i?'Trying mirror':'Connecting to'} ${new URL(endpoints[i]).hostname} · provider ${i+1} of ${endpoints.length}`);
        try{
          const response=await fetchImpl(endpoints[i],{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:`data=${encodeURIComponent(query)}`,signal:controller.signal});
          if(!response.ok){
            if([429,406].includes(response.status)){
              const retry=response.headers?.get?.('Retry-After');
              const delay=Number.isFinite(Number(retry))?Number(retry)*1000:Date.parse(retry)-Date.now();
              cooldown.set(endpoints[i],Date.now()+Math.max(30000,delay||0));
            }
            throw new Error(`${new URL(endpoints[i]).hostname}: HTTP ${response.status}${response.status===429?' rate limit exceeded':''}`);
          }
          const data=response.body||response.arrayBuffer?JSON.parse(new TextDecoder().decode(await readBounded(response,{budget,signal:controller.signal,onProgress:p=>progress(downloadDetail(endpoints[i],p))}))):await response.json();
          progress(`Checking map data from ${new URL(endpoints[i]).hostname}`);
          if(data.remark||!Array.isArray(data.elements))throw new Error(String(data.remark||'Map service returned incomplete data').replace(/\s+/g,' ').slice(0,220));
          const elapsed=performance.now()-started;
          speeds.set(endpoints[i],speeds.has(endpoints[i])?speeds.get(endpoints[i])*.7+elapsed*.3:elapsed);
          return data;
        }catch(error){
          if(error.name==='AbortError'&&!signal?.aborted)throw Object.assign(new Error('Map service request timed out'),{code:'timeout'});
          throw error;
        }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
      });
      return data;
    }catch(error){
      if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
      if(mapFailure(error)==='size')throw error;
      errors.push(error);
      if(i+1<endpoints.length)progress(`${error.message} · Looking for an available mirror…`);
    }
  }
  const error=new Error(errors.map(e=>e.message).join(' · ')||'Map service unavailable');
  error.code=errors.some(e=>mapFailure(e)==='quota')?'quota':errors.some(e=>mapFailure(e)==='timeout')?'timeout':'unavailable';
  throw error;
}
