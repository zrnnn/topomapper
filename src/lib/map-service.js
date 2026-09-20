export const MAP_REQUEST_TIMEOUT_MS=20000;
export const MAP_TOTAL_TIMEOUT_MS=90000;
export const MAP_QUERY_TIMEOUT_SECONDS=15;
const servers=['https://overpass-api.de/api/interpreter','https://overpass.kumi.systems/api/interpreter'];

export async function requestMapData(query,{signal,progress=()=>{},fetchImpl=fetch,timeoutMs=MAP_REQUEST_TIMEOUT_MS,endpoints=servers}={}) {
  let lastError;
  for(let i=0;i<endpoints.length;i++){
    if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
    const controller=new AbortController(),abort=()=>controller.abort();
    signal?.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(abort,timeoutMs);
    progress(`Map service ${i+1} of ${endpoints.length}${i?' · retrying with an alternate provider':''}`);
    try{
      const response=await fetchImpl(endpoints[i],{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:`data=${encodeURIComponent(query)}`,signal:controller.signal});
      if(!response.ok)throw new Error(`Map service HTTP ${response.status}`);
      const data=await response.json();
      if(data.remark||!Array.isArray(data.elements))throw new Error('Map service returned incomplete data');
      return data;
    }catch(error){
      if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
      lastError=error.name==='AbortError'?new Error('Map service request timed out'):error;
    }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  }
  throw lastError||new Error('Map service unavailable');
}
