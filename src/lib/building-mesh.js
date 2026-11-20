import polygonClipping from 'polygon-clipping';
import earcut, {flatten, deviation} from 'earcut';
import {createTerrainSurface} from './mesh.js';

class TriangulationError extends Error {}

export function extrudeBuilding(polygon, bottom, top) {
  if(!Number.isFinite(top)||!Number.isFinite(bottom)||top<=bottom) throw new Error('Invalid building height.');
  const rings=polygon.map(ring=>ring.slice(0,-1).map(p=>p.map(n=>Number(n.toFixed(6)))));
  const data=flatten(rings), indices=earcut(data.vertices,data.holes,2);
  if(!indices.length||deviation(data.vertices,data.holes,2,indices)>1e-6) throw new TriangulationError('A building footprint could not be triangulated. Choose a smaller area.');
  const points=rings.flat(), n=points.length;
  const mesh={v:points.map(p=>[...p,bottom]).concat(points.map(p=>[...p,top])),t:[]};
  const edges=new Map();
  for(let i=0;i<indices.length;i+=3) {
    let [a,b,c]=indices.slice(i,i+3);
    const [p,q,r]=[points[a],points[b],points[c]];
    if((q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0])<0) [b,c]=[c,b];
    mesh.t.push([a+n,b+n,c+n],[a,c,b]);
    for(const [u,v] of [[a,b],[b,c],[c,a]]) {
      const key=[Math.min(u,v),Math.max(u,v)].join(',');
      const edge=edges.get(key)||{a:u,b:v,count:0};edge.count++;edges.set(key,edge);
    }
  }
  for(const {a,b,count} of edges.values()) if(count===1) mesh.t.push([a+n,a,b],[a+n,b,b+n]);
  return mesh;
}

export function buildBuildingMeshes(state, buildings, options = {}) {
  const scale=Number(options.buildingScale ?? 1), fallback=Number(options.fallbackHeight ?? 9);
  if(!Number.isFinite(scale)||scale<0.1||scale>10||!Number.isFinite(fallback)||fallback<1||fallback>100) throw new Error('Check the building height settings.');
  if(buildings.length>3000) throw new Error('More than 3,000 buildings selected. Choose a smaller area for 3MF export.');
  const surface=options.surface??createTerrainSurface(state,options);
  const bounds=state.renderBbox;
  const metresWide=bounds ? (bounds.ne.lng-bounds.sw.lng)*Math.PI/180*6371008.8*Math.cos((bounds.ne.lat+bounds.sw.lat)/2*Math.PI/180) : 0;
  if(!(metresWide>0)) throw new Error('Generate the map again to establish building scale.');
  const mmPerMetre=state.wMm/metresWide;
  const meshes=[];
  for(const building of buildings) for(const polygon of building.polygons) {
    const metres=building.height.source==='fallback'?fallback:building.height.metres;
    const height=metres*mmPerMetre*scale;
    const roof=(piece)=>{
      // A mapped height is measured from the lowest contact with the terrain.
      // Sample the actual smoothed mesh along the walls, including courtyards.
      let ground=Infinity;
      for(const ring of piece)for(let i=1;i<ring.length;i++){
        const a=ring[i-1],b=ring[i],dx=b[0]-a[0],dy=b[1]-a[1];
        const steps=Math.max(1,Math.ceil(2*Math.max(Math.abs(dx)/surface.stepX,Math.abs(dy)/surface.stepY)));
        for(let j=0;j<steps;j++){
          ground=Math.min(ground,surface.heightAt(a[0]+dx*j/steps,a[1]+dy*j/steps));
        }
      }
      return ground+height;
    };
    try{
      meshes.push({name:building.name,mesh:extrudeBuilding(polygon,0,roof(polygon))});
    }catch(error){
      if(!(error instanceof TriangulationError))throw error;
      // Clipping or simplification can leave a self-touching ring. Resolve
      // its boundary before triangulating the same footprint a second time.
      const snapped=polygon.map(ring=>ring.map(point=>point.map(n=>Number(n.toFixed(6)))));
      const repaired=polygonClipping.union(snapped);
      if(!repaired.length)throw error;
      for(const piece of repaired)meshes.push({name:building.name,mesh:extrudeBuilding(piece,0,roof(piece))});
    }
  }
  return meshes;
}
