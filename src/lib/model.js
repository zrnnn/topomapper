import {buildTerrainMesh} from './mesh.js';
import {buildBuildingMeshes} from './building-mesh.js';
import {clipBuildings} from './buildings.js';
import {createGeometry} from './geometry.js';

export const MODEL_PRESETS = {
  landscape:{name:'Landscape model',description:'Relief with buildings, streets and embossed water.',terrain:true,buildings:true,roads:true,water:true,green:false,rivers:false,relief:12,buildingScale:1},
  city:{name:'City block',description:'A flat architectural base with buildings and street context.',terrain:false,buildings:true,roads:true,water:true,green:true,rivers:false,relief:10,buildingScale:2},
  relief:{name:'Terrain study',description:'A clean terrain relief with no architectural overlays.',terrain:true,buildings:false,roads:false,water:false,green:false,rivers:false,relief:18,buildingScale:1}
};
export const defaultModel = () => ({...MODEL_PRESETS.landscape,preset:'landscape',width:200,resolution:100,base:2,roadWidth:0.7,roadRise:0.5,areaRise:0.3,fallbackHeight:9,format:'3mf'});

function scaleRecords(records,scale) {
  return (records||[]).map(record=>({...record,polygons:record.polygons.map(polygon=>polygon.map(ring=>ring.map(([x,y])=>[x*scale,y*scale])))}));
}
export function modelInput(state, settings) {
  const scale=settings.width/state.wMm;
  const terrainData=settings.terrain ? state.terrainData : {...state.terrainData,h:new Float32Array(state.terrainData.h.length),delta:0};
  const scaled={...state,wMm:settings.width,hMm:state.hMm*scale,terrainData};
  const geometry=createGeometry(scaled),shape=geometry.getClipPolygon();
  const lines=records=>(records||[]).flatMap(line=>geometry.clipPolylineToPolygon(line.map(([x,y])=>[x*scale,y*scale]),shape));
  return {state:scaled,buildings:clipBuildings(scaleRecords(state.osmData?.buildings,scale),shape),
    water:clipBuildings(scaleRecords(state.osmData?.waterAreas,scale),shape),green:clipBuildings(scaleRecords(state.osmData?.greenAreas,scale),shape),
    roads:lines(state.osmData?.roadLines),rivers:lines(state.osmData?.waterLines)};
}
export function validateModelSettings(s) {
  for(const [key,min,max] of [['width',50,400],['resolution',40,240],['base',1,10],['relief',1,80],['roadWidth',.2,3],['roadRise',.1,3],['areaRise',.1,2],['buildingScale',.1,10],['fallbackHeight',1,100]]) {
    if(!Number.isFinite(s[key])||s[key]<min||s[key]>max) throw new Error(`Check ${key}: use a value between ${min} and ${max}.`);
  }
}
function roadRings(lines,width) {
  const rings=[],radius=width/2;
  for(const line of lines) {
    for(let i=1;i<line.length;i++) {
      const a=line[i-1],b=line[i],dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);
      if(length<1e-5)continue;
      const nx=-dy/length*radius,ny=dx/length*radius;
      rings.push([[a[0]-nx,a[1]-ny],[b[0]-nx,b[1]-ny],[b[0]+nx,b[1]+ny],[a[0]+nx,a[1]+ny]]);
    }
    for(const p of line) rings.push(Array.from({length:8},(_,i)=>[p[0]+radius*Math.cos(i*Math.PI/4),p[1]+radius*Math.sin(i*Math.PI/4)]));
  }
  return rings;
}
const rgb = hex => [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255);

export async function buildModel(engine, state, settings, progress=()=>{}) {
  validateModelSettings(settings);
  if(!state.terrainData) throw new Error('Load an area before building a model.');
  const areaRecords=[...(settings.buildings?state.osmData?.buildings||[]:[]),...(settings.water?state.osmData?.waterAreas||[]:[]),...(settings.green?state.osmData?.greenAreas||[]:[])];
  let points=0;for(const record of areaRecords)for(const polygon of record.polygons)for(const ring of polygon){points+=ring.length;if(points>150000)throw new Error('Area geometry exceeds 150,000 points. Select a smaller area or disable buildings / area layers.');}
  const input=modelInput(state,settings), s=input.state;
  if(settings.buildings && input.buildings.length>3000) throw new Error('This area has over 3,000 buildings. Select a smaller area or turn buildings off.');
  if((settings.roads?input.roads:[]).flat().length+(settings.rivers?input.rivers:[]).flat().length>40000) throw new Error('Street/river geometry is too large for browser modeling. Select a smaller area or disable those layers.');
  const {Manifold,Mesh,CrossSection}=engine, owned=[];
  const keep=object=>{owned.push(object);return object;};
  const colored=(solid,color)=>{const c=rgb(color);return keep(solid.setProperties(3,(p)=>{p[0]=c[0];p[1]=c[1];p[2]=c[2];}));};
  const fromMesh=mesh=>keep(new Manifold(new Mesh({numProp:3,vertProperties:Float32Array.from(mesh.v.flat()),triVerts:Uint32Array.from(mesh.t.flat())})));
  const counts={buildings:settings.buildings?input.buildings.length:0,roads:settings.roads?input.roads.length:0,water:settings.water?input.water.length:0,green:settings.green?input.green.length:0,rivers:settings.rivers?input.rivers.length:0};
  try {
    progress({percent:8,detail:'Meshing terrain and base'});
    const terrainMesh=buildTerrainMesh(s,{resolution:settings.resolution,targetHeight:settings.relief});
    // Existing mesher uses a 2 mm base; move only its top surface to the requested thickness.
    terrainMesh.v.forEach(v=>{if(v[2]>0)v[2]+=settings.base-2;});
    const terrain=fromMesh(terrainMesh);
    if(terrain.status()!=='NoError') throw new Error('Terrain mesh validation failed. Try a different mesh quality.');
    const solids=[colored(terrain,'#D4D6C8')];
    const drape=(rings,rise,color,name)=>{
      if(!rings.length)return;
      progress({percent:30+solids.length*7,detail:`Building ${name} geometry`});
      const cross=keep(new CrossSection(rings,'NonZero'));
      const prism=keep(cross.extrude(settings.base+settings.relief+10));
      const shifted=keep(terrain.translate([0,0,rise]));
      const layer=keep(shifted.intersect(prism));
      if(layer.status()!=='NoError')throw new Error(`${name} geometry could not be modeled. Reduce the area or disable this layer.`);
      solids.push(colored(layer,color));
    };
    if(settings.green)drape(input.green.flatMap(f=>f.polygons.flat()),settings.areaRise,'#91AA85','green areas');
    if(settings.water)drape(input.water.flatMap(f=>f.polygons.flat()),settings.areaRise,'#6A9EA9','water');
    if(settings.rivers)drape(roadRings(input.rivers,settings.roadWidth*.8),settings.areaRise,'#6A9EA9','rivers');
    if(settings.roads)drape(roadRings(input.roads,settings.roadWidth),settings.roadRise,'#536C68','streets');
    if(settings.buildings) {
      progress({percent:62,detail:`Extruding ${input.buildings.length} building footprints`});
      const buildings=buildBuildingMeshes(s,input.buildings,{resolution:settings.resolution,targetHeight:settings.relief,buildingScale:settings.buildingScale,fallbackHeight:settings.fallbackHeight});
      for(const {mesh} of buildings) {
        mesh.v.forEach(v=>{if(v[2]>0)v[2]+=settings.base-2;});
        const solid=fromMesh(mesh);
        if(solid.status()!=='NoError')throw new Error('A building mesh is invalid. Try a smaller area or turn buildings off.');
        solids.push(colored(solid,'#DDA95E'));
      }
    }
    progress({percent:78,detail:`Fusing ${solids.length} solids into a printable model`});
    const fused=keep(Manifold.union(solids));
    if(fused.status()!=='NoError'||fused.isEmpty()) throw new Error('Solid fusion failed. Reduce model detail or disable a layer. No partial model was exported.');
    progress({percent:94,detail:'Checking the final surface and layer colors'});
    const raw=fused.getMesh(), stride=raw.numProp;
    const parent=Array.from({length:raw.vertProperties.length/stride},(_,i)=>i);
    const root=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
    for(let i=0;i<raw.mergeFromVert.length;i++)parent[root(raw.mergeFromVert[i])]=root(raw.mergeToVert[i]);
    const index=new Map(),v=[],t=[],colors=[];
    const vertex=i=>{
      const r=root(i);if(index.has(r))return index.get(r);
      const j=r*stride,id=v.length;
      v.push([raw.vertProperties[j],s.hMm-raw.vertProperties[j+1],raw.vertProperties[j+2]]);index.set(r,id);return id;
    };
    for(let i=0;i<raw.triVerts.length;i+=3) {
      const ids=Array.from(raw.triVerts.slice(i,i+3));
      t.push(ids.map(vertex).reverse());
      const j=ids[0]*stride;
      colors.push('#'+[3,4,5].map(k=>Math.round(Math.max(0,Math.min(1,raw.vertProperties[j+k]??.7))*255).toString(16).padStart(2,'0')).join(''));
    }
    const result={mesh:{v,t,colors},counts,width:s.wMm,height:s.hMm,triangles:t.length,volume:fused.volume(),settings:{...settings}};
    progress({percent:100,detail:`Ready · ${t.length.toLocaleString()} triangles`});
    return result;
  } finally { owned.reverse().forEach(object=>object.delete()); }
}
