export function createCanvasPreview(container,{onStart=()=>{},onReady=()=>{},onError=()=>{}}={}){
  let revision=0,markup='',lastKey='',disposed=false,timer;
  const canvas=document.createElement('canvas');
  canvas.setAttribute('role','img');canvas.setAttribute('aria-label','Map preview. Drag to move; use the wheel or zoom buttons to zoom.');
  async function draw(){
    const generation=++revision;
    if(disposed||!markup||!container.clientWidth||!container.clientHeight)return;
    const width=Math.max(1,Math.round(container.clientWidth*2)),height=Math.max(1,Math.round(container.clientHeight*2));
    const key=width+':'+height+':'+markup;if(key===lastKey){onReady();return;}
    onStart();
    const svg=markup.replace(/width="[^"]+"/,`width="${width}"`).replace(/height="[^"]+"/,`height="${height}"`);
    const url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'})),image=new Image();
    try{
      await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error('The map preview could not be rendered. Try a lower detail level.'));image.src=url;});
      if(disposed||generation!==revision)return;
      canvas.width=width;canvas.height=height;
      canvas.getContext('2d').drawImage(image,0,0,width,height);
      if(canvas.parentNode!==container)container.replaceChildren(canvas);
      lastKey=key;onReady();
    }catch(error){if(!disposed&&generation===revision)onError(error);}
    finally{URL.revokeObjectURL(url);}
  }
  const observer=new ResizeObserver(()=>{clearTimeout(timer);timer=setTimeout(draw,100);});observer.observe(container);
  return {set(svg){markup=svg;void draw();},dispose(){disposed=true;revision++;clearTimeout(timer);observer.disconnect();}};
}
