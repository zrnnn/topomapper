export function runWorker(type, payload, {signal,progress=()=>{}}={}) {
  return new Promise((resolve,reject)=>{
    if(signal?.aborted) { reject(new DOMException('Cancelled','AbortError'));return; }
    const worker=new Worker(new URL('./terrain.worker.js',import.meta.url),{type:'module'});
    let settled=false;
    const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);worker.terminate();error?reject(error):resolve(result);};
    const abort=()=>finish(new DOMException('Cancelled','AbortError'));
    const timer=setTimeout(()=>finish(new Error('This operation took too long. Try a smaller area or lower quality.')),90000);
    signal?.addEventListener('abort',abort,{once:true});
    worker.onmessage=({data})=>{if(data.progress) progress(data.progress);else finish(data.error?new Error(data.error):null,data.result);};
    worker.onerror=()=>finish(new Error('Background processing failed. Please retry with a lower quality setting.'));
    try { worker.postMessage({type,payload}); } catch(error) { finish(error); }
  });
}
