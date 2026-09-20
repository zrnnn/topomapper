import earcut, {flatten, deviation} from 'earcut';

export function extrudeBuilding(polygon, bottom, top) {
  if(!Number.isFinite(top)||!Number.isFinite(bottom)||top<=bottom) throw new Error('Invalid building height.');
  const rings=polygon.map(ring=>ring.slice(0,-1).map(p=>p.map(n=>Number(n.toFixed(6)))));
  const data=flatten(rings), indices=earcut(data.vertices,data.holes,2);
  if(!indices.length||deviation(data.vertices,data.holes,2,indices)>1e-6) throw new Error('A building footprint could not be triangulated. Choose a smaller area.');
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
  const T=state.terrainData, terrainScale=T.delta>0 ? options.targetHeight/T.delta : 0;
  const bounds=state.renderBbox;
  const metresWide=bounds ? (bounds.ne.lng-bounds.sw.lng)*Math.PI/180*6371008.8*Math.cos((bounds.ne.lat+bounds.sw.lat)/2*Math.PI/180) : 0;
  if(!(metresWide>0)) throw new Error('Generate the map again to establish building scale.');
  const mmPerMetre=state.wMm/metresWide;
  const meshes=[];
  for(const building of buildings) for(const polygon of building.polygons) {
    const ring=polygon[0], xs=ring.map(p=>p[0]),ys=ring.map(p=>p[1]);
    // Enclose the terrain interpolation/smoothing neighbourhood beneath the footprint.
    const pad=Math.ceil(2*Math.max(T.rows,T.cols)/Math.max(40,options.resolution||160))+2;
    const c0=Math.max(0,Math.floor(Math.min(...xs)/state.wMm*(T.cols-1))-pad), c1=Math.min(T.cols-1,Math.ceil(Math.max(...xs)/state.wMm*(T.cols-1))+pad);
    const r0=Math.max(0,Math.floor(Math.min(...ys)/state.hMm*(T.rows-1))-pad), r1=Math.min(T.rows-1,Math.ceil(Math.max(...ys)/state.hMm*(T.rows-1))+pad);
    let ground=0;
    for(let r=r0;r<=r1;r++) for(let c=c0;c<=c1;c++) ground=Math.max(ground,T.h[r*T.cols+c]*terrainScale);
    const metres=building.height.source==='fallback' ? fallback : building.height.metres;
    const height=Math.max(0.4,metres*mmPerMetre*scale);
    // Each closed building extends into the base for reliable slicer union with terrain.
    meshes.push({name:building.name,mesh:extrudeBuilding(polygon,0,2+ground+height)});
  }
  return meshes;
}
