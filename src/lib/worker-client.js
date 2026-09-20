const idle=new Map();
export function disposeWorkers(){for(const {worker,timer} of idle.values()){clearTimeout(timer);worker.terminate();}idle.clear();}
export function runWorker(type, payload, {signal,progress=()=>{},timeoutMs=180000,reuse=true}={}) {
  return new Promise((resolve,reject)=>{
    if(signal?.aborted) { reject(new DOMException('Cancelled','AbortError'));return; }
    const lane=type.startsWith('model')?'model':type;
    const parked=idle.get(lane);if(parked){clearTimeout(parked.timer);idle.delete(lane);}
    const worker=parked?.worker||new Worker(new URL('./terrain.worker.js',import.meta.url),{type:'module'});
    let settled=false;
    const finish=(error,result)=>{
      if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);
      worker.onmessage=null;worker.onerror=null;
      if(!error&&reuse&&!idle.has(lane)){
        const cleanup=setTimeout(()=>{if(idle.get(lane)?.worker===worker)idle.delete(lane);worker.terminate();},60000);
        cleanup.unref?.();idle.set(lane,{worker,timer:cleanup});
      }else worker.terminate();
      error?reject(error):resolve(result);
    };
    const abort=()=>finish(new DOMException('Cancelled','AbortError'));
    const timer=setTimeout(()=>finish(new Error('This operation took too long. Try a smaller area or lower quality.')),Math.max(1,timeoutMs));
    signal?.addEventListener('abort',abort,{once:true});
    worker.onmessage=({data})=>{if(data.progress) progress(data.progress);else finish(data.error?new Error(data.error):null,data.result);};
    worker.onerror=()=>finish(new Error('Background processing failed. Please retry with a lower quality setting.'));
    try { worker.postMessage({type,payload}); } catch(error) { finish(error); }
  });
}
