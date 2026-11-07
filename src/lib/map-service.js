import {readBounded,mapFailure,downloadDetail,DataLimitError} from './data-budget.js';
export const MAP_REQUEST_TIMEOUT_MS=45000;
export const MAP_TOTAL_TIMEOUT_MS=300000;
export const MAP_QUERY_TIMEOUT_SECONDS=30;
export const MAP_PROVIDERS=['https://overpass.private.coffee/api/interpreter','https://overpass-api.de/api/interpreter','https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
const cooldown=new Map(),providerQueue=new Map();
const speeds=new Map();
const FIRST_RESPONSE_MS=12000;
// Rank actual completed requests, not extra probes that consume public quotas.
// A user-supplied endpoint stays first; the .ru service is always a last resort.
export function rankProviders(endpoints){
  return [...endpoints].sort((a,b)=>{
    const tier=url=>!MAP_PROVIDERS.includes(url)?0:new URL(url).hostname.endsWith('.ru')?2:1;
    return tier(a)-tier(b)||Number(providerQueue.has(a))-Number(providerQueue.has(b))||(speeds.get(a)??Infinity)-(speeds.get(b)??Infinity);
  });
}
function pausedReason(endpoint) {
  const pause=cooldown.get(endpoint);
  return pause && pause.until>Date.now()?pause.reason+' · retry in '+Math.ceil((pause.until-Date.now())/1000)+' s':null;
}
function pauseProvider(endpoint,reason,delay=30000) {
  cooldown.set(endpoint,{until:Date.now()+delay,reason});
}
async function withProviderSlot(endpoint,signal,task){
  // Check again on wakeup: several stage retries may be waiting for the same host.
  while (providerQueue.has(endpoint)) {
    signal?.throwIfAborted();
    const busy=providerQueue.get(endpoint);
    await new Promise((resolve,reject)=>{
      const abort=()=>reject(signal.reason);
      signal?.addEventListener('abort',abort,{once:true});
      busy.then(()=>{
        signal?.removeEventListener('abort',abort);
        resolve();
      });
    });
  }
  signal?.throwIfAborted();
  let release;
  providerQueue.set(endpoint,new Promise(resolve=>{release=resolve;}));
  try {
    return await task();
  } finally {
    providerQueue.delete(endpoint);
    release();
  }
}
export function isCompleteMapResponse(data){
  return !data?.remark && Array.isArray(data?.elements) &&
    data.elements.every(el=>Number.isSafeInteger(el?.id) && ['node','way','relation'].includes(el.type));
}
export async function requestMapData(query,{signal,progress=()=>{},fetchImpl=fetch,timeoutMs=MAP_REQUEST_TIMEOUT_MS,endpoints=MAP_PROVIDERS,preferLastSuccessful=true,budget,onBytes,firstResponseMs=FIRST_RESPONSE_MS}={}){
  if(preferLastSuccessful)endpoints=rankProviders(endpoints);
  const errors=[];
  for(let i=0;i<endpoints.length;i++){
    if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
    const paused=pausedReason(endpoints[i]);
    if(paused){errors.push(new Error(`${new URL(endpoints[i]).hostname}: ${paused}`));continue;}
    try{
      const data=await withProviderSlot(endpoints[i],signal,async()=>{
        if(budget && budget.bytes>=budget.maxBytes)throw new DataLimitError('Map download budget reached');
        const host=new URL(endpoints[i]).hostname;
        // A queued request may acquire its slot after a preceding HTTP 429.
        const reason=pausedReason(endpoints[i]);
        if (reason) throw new Error(host+': '+reason);
        const controller=new AbortController(),abort=()=>controller.abort();
        signal?.addEventListener('abort',abort,{once:true});
        const timer=setTimeout(abort,timeoutMs),started=performance.now();
        const hasAlternate=endpoints.slice(i+1).some(url=>!providerQueue.has(url)&&!pausedReason(url));
        // Only shorten the wait for headers. A responding server keeps its transfer budget.
        const headerTimer=hasAlternate?setTimeout(()=>{
          pauseProvider(endpoints[i],'no response from provider');
          abort();
        },Math.min(firstResponseMs,timeoutMs)):null;
        progress(`${i?'Trying mirror':'Connecting to'} ${new URL(endpoints[i]).hostname} · provider ${i+1} of ${endpoints.length}`);
        try{
          const response=await fetchImpl(endpoints[i],{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:`data=${encodeURIComponent(query)}`,signal:controller.signal});
          clearTimeout(headerTimer);
          if(!response.ok){
            if([429,406].includes(response.status)){
              const retry=response.headers?.get?.('Retry-After');
              const delay=Number.isFinite(Number(retry))?Number(retry)*1000:Date.parse(retry)-Date.now();
              pauseProvider(endpoints[i],`HTTP ${response.status} rate limit cooldown`,Math.max(30000,delay||0));
            }
            if([502,503].includes(response.status))pauseProvider(endpoints[i],`HTTP ${response.status}`,10000);
            void response.body?.cancel().catch(()=>{});
            throw new Error(`${new URL(endpoints[i]).hostname}: HTTP ${response.status}${response.status===429?' rate limit exceeded':''}`);
          }
          let bytes;
          if (response.body || response.arrayBuffer) {
            bytes = await readBounded(response,{budget,signal:controller.signal,
              onProgress:p=>progress(downloadDetail(endpoints[i],p))});
          }
          const data = bytes ? JSON.parse(new TextDecoder().decode(bytes)) : await response.json();
          progress(`Checking map data from ${new URL(endpoints[i]).hostname}`);
          if (!isCompleteMapResponse(data)) {
            const reason = mapFailure(data?.remark);
            const messages = {quota:'API rate limit exceeded', timeout:'query timed out', size:'response exceeds size limit'};
            throw Object.assign(new Error(new URL(endpoints[i]).hostname + ': ' +
              (messages[reason] || 'incomplete map response')), {code:reason});
          }
          if (bytes) onBytes?.(bytes);
          const elapsed=performance.now()-started;
          speeds.set(endpoints[i],speeds.has(endpoints[i])?speeds.get(endpoints[i])*.7+elapsed*.3:elapsed);
          return data;
        }catch(error){
          if(error.name==='AbortError'&&!signal?.aborted)throw Object.assign(new Error(host+': request timed out'),{code:'timeout'});
          // Fetch exceptions can contain the custom endpoint, including its query token.
          if (error instanceof SyntaxError) throw new Error(host+': invalid JSON response');
          if (error instanceof TypeError) throw new Error(new URL(endpoints[i]).hostname + ': connection failed');
          throw error;
        }finally{clearTimeout(headerTimer);clearTimeout(timer);signal?.removeEventListener('abort',abort);}
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
