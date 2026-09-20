// Build GPU arrays off the UI thread, then transfer their ownership to the
// renderer. Quick previews do not need a second copy of nested mesh arrays.
export function previewBuffers(mesh){
  const positions=new Float32Array(mesh.t.length*9),colors=new Float32Array(positions.length),palette=new Map();
  for(let i=0;i<mesh.t.length;i++){
    const hex=mesh.colors?.[i]||'#D4D6C8';
    if(!palette.has(hex))palette.set(hex,[1,3,5].map(offset=>{
      const channel=parseInt(hex.slice(offset,offset+2),16)/255;
      return channel<=.04045?channel/12.92:((channel+.055)/1.055)**2.4;
    }));
    const color=palette.get(hex),tri=mesh.t[i];
    for(let j=0;j<3;j++){positions.set(mesh.v[tri[j]],i*9+j*3);colors.set(color,i*9+j*3);}
  }
  return {positions,colors};
}
