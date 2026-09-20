import {create3mf} from './three-mf.js';

export async function exportModel(model,format) {
  const mesh=model.mesh;
  if(!mesh?.t.length)throw new Error('Build the 3D preview before exporting.');
  if(format==='3mf')return {blob:await create3mf([{name:'Fused map',mesh}]),name:'Topomapper.3mf'};
  if(format==='obj') {
    const text='# Topomapper · millimetres · fused geometry\n'+mesh.v.map(v=>'v '+v.join(' ')).join('\n')+'\n'+mesh.t.map(t=>'f '+t.map(i=>i+1).join(' ')).join('\n')+'\n';
    return {blob:new Blob([text],{type:'text/plain'}),name:'Topomapper.obj'};
  }
  if(format!=='stl')throw new Error('Unsupported 3D format.');
  const buffer=new ArrayBuffer(84+50*mesh.t.length),view=new DataView(buffer);
  new Uint8Array(buffer,0,80).set(new TextEncoder().encode('Topomapper fused model - millimetres'));
  view.setUint32(80,mesh.t.length,true);
  mesh.t.forEach((tri,i)=>{
    let offset=84+i*50;
    const [a,b,c]=tri.map(index=>mesh.v[index]),u=b.map((n,j)=>n-a[j]),v=c.map((n,j)=>n-a[j]);
    const normal=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],length=Math.hypot(...normal)||1;
    for(const n of normal.map(n=>n/length).concat(a,b,c)) {view.setFloat32(offset,n,true);offset+=4;}
  });
  return {blob:new Blob([buffer],{type:'application/sla'}),name:'Topomapper.stl'};
}
