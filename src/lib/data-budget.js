export class DataLimitError extends Error {
  constructor(message){super(message);this.name='DataLimitError';this.code='size';}
}
// Bound decoded response bytes before parsing; Content-Length may be compressed.
export async function readBounded(response,{maxBytes=8*1024*1024,budget,signal,onProgress=()=>{}}={}) {
  const reader=response.body?.getReader();let size=0;
  // Content-Length can describe compressed wire bytes, not the decoded stream.
  const length=Number(response.headers?.get?.('Content-Length'));
  const total=response.headers?.get?.('Content-Encoding')==='identity'&&length>0?length:null;
  let reportedAt=0;
  const report=(force=false)=>{const now=Date.now();if(force||now-reportedAt>=120){reportedAt=now;onProgress({loaded:size,total:total>=size?total:null});}};
  report(true);
  const accept=bytes=>{
    size+=bytes;if(budget)budget.bytes=(budget.bytes||0)+bytes;
    if(size>maxBytes||(budget&&budget.bytes>budget.maxBytes))throw new DataLimitError('Map download exceeds the data budget. Reduce detail or choose a smaller area.');
    if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
    report();
  };
  if(!reader){const data=new Uint8Array(await response.arrayBuffer());accept(data.length);report(true);return data;}
  const chunks=[];
  try{while(true){const {done,value}=await reader.read();if(done)break;accept(value.byteLength);chunks.push(value);}}
  catch(error){await reader.cancel().catch(()=>{});throw error;}
  finally{reader.releaseLock();}
  report(true);
  const result=new Uint8Array(size);let offset=0;
  for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length;}return result;
}
export function downloadDetail(url,{loaded=0,total=null}={}){
  return `Downloading from ${new URL(url).hostname} · ${loaded.toLocaleString()}${total?'/'+total.toLocaleString():''} bytes loaded${total?'':' (total size unknown)'}`;
}
export function mapFailure(error){
  if(error?.code)return error.code;
  const text=String(error?.message||error);
  if(/429|quota|rate.?limit/i.test(text))return 'quota';
  if(/maxsize|out of memory|too large|exceeds|exceeded.*memory/i.test(text))return 'size';
  if(/timed out|timeout/i.test(text))return 'timeout';
  return 'unavailable';
}
