import {create3mf} from './three-mf.js';

export async function exportModel(model,format) {
  if(model.previewOnly)throw new Error('Prepare the printable model before exporting. Quick previews are not printable solids.');
  if(format==='3mf')return {blob:await create3mf(model.parts,model.credits),name:'Topomapper.3mf'};
  const mesh=model.mesh;
  if(!mesh?.t.length)throw new Error('Build the 3D preview before exporting.');
  if(format==='obj') {
    const text='# Topomapper · millimetres · fused geometry\n'+mesh.v.map(v=>'v '+v.join(' ')).join('\n')+'\n'+mesh.t.map(t=>'f '+t.map(i=>i+1).join(' ')).join('\n')+'\n';
    return {blob:new Blob([text],{type:'text/plain'}),name:'Topomapper.obj'};
  }
  if(format!=='stl')throw new Error('Unsupported 3D format.');
  const buffer=new ArrayBuffer(84+50*mesh.t.length),view=new DataView(buffer);
  new Uint8Array(buffer,0,80).set(new TextEncoder().encode('Topomapper fused model - millimetres'));
  // Binary STL stores float32 coordinates and has no vertex indices.
  // A thin Boolean seam can collapse to a repeated vertex at this precision.
  const points = mesh.v.map(vertex => vertex.map(Math.fround));
  const samePoint = (a,b) => a[0]===b[0] && a[1]===b[1] && a[2]===b[2];
  let count = 0;
  for (const tri of mesh.t) {
    const [a,b,c] = tri.map(index => points[index]);
    if (samePoint(a,b) || samePoint(b,c) || samePoint(c,a)) continue;
    let offset = 84 + 50 * count++;
    const u=b.map((n,j)=>n-a[j]),v=c.map((n,j)=>n-a[j]);
    const normal=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],length=Math.hypot(...normal)||1;
    for(const n of normal.map(n=>n/length).concat(a,b,c)) {view.setFloat32(offset,n,true);offset+=4;}
  }
  view.setUint32(80,count,true);
  return {blob:new Blob([new Uint8Array(buffer,0,84+50*count)],{type:'application/sla'}),name:'Topomapper.stl'};
}
