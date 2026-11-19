// Decode before drawing. A late browser callback must never save a file
// after the export has timed out and the user has retried.
export async function drawSvgOnCanvas(ctx,markup,w,h,timeoutMs=30000){
  const url=URL.createObjectURL(new Blob([markup],{type:'image/svg+xml;charset=utf-8'}));
  const image=new Image();
  let timer;
  try{
    await new Promise((resolve,reject)=>{
      timer=setTimeout(()=>reject(new Error('PNG rendering timed out. Lower the PNG resolution or turn off shaded relief and retry.')),timeoutMs);
      image.onload=resolve;
      image.onerror=()=>reject(new Error('PNG rendering failed while reading the map artwork. Try SVG or turn off shaded relief.'));
      image.src=url;
    });
    ctx.drawImage(image,0,0,w,h);
  }finally{
    clearTimeout(timer);image.onload=null;image.onerror=null;URL.revokeObjectURL(url);
  }
}

export function encodePng(canvas,timeoutMs=30000){
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('PNG encoding timed out. Reduce the PNG resolution and retry.')),timeoutMs);
    try{
      canvas.toBlob(blob=>{
        clearTimeout(timer);
        if(blob)resolve(blob);
        else reject(new Error('PNG encoding failed. Reduce the PNG resolution and retry.'));
      },'image/png');
    }catch(error){clearTimeout(timer);reject(error);}
  });
}

// Canvas encoders generally write 96 dpi. Preserve the selected physical
// dimensions for print applications while leaving the encoded pixels intact.
export async function pngPrintSize(blob,widthPx,heightPx,widthMm,heightMm){
  const chunk=new Uint8Array(21),view=new DataView(chunk.buffer);
  view.setUint32(0,9);
  chunk.set([112,72,89,115],4); // pHYs
  view.setUint32(8,Math.round(widthPx*1000/widthMm));
  view.setUint32(12,Math.round(heightPx*1000/heightMm));
  chunk[16]=1; // pixels per metre
  let crc=0xffffffff;
  for(const byte of chunk.subarray(4,17)){
    crc^=byte;
    for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);
  }
  view.setUint32(17,(crc^0xffffffff)>>>0);
  for(let offset=8;offset+12<=blob.size;){
    const header=new DataView(await blob.slice(offset,offset+8).arrayBuffer());
    const length=header.getUint32(0),type=header.getUint32(4);
    if(type===0x70485973 || type===0x49444154){
      const end=type===0x70485973?offset+length+12:offset;
      return new Blob([blob.slice(0,offset),chunk,blob.slice(end)],{type:'image/png'});
    }
    offset+=length+12;
  }
  throw new Error('PNG encoding failed. Reduce the PNG resolution and retry.');
}
