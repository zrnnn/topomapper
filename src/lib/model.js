import {buildTerrainMesh} from './mesh.js';
import {buildBuildingMeshes} from './building-mesh.js';
import {clipBuildings,prepareBuildingLod} from './buildings.js';
import {createGeometry} from './geometry.js';
import {roadPoints} from './road-style.js';

export const MODEL_PRESETS = {
  overview:{name:'City overview',description:'Whole-city relief with larger buildings. Draft mesh; streets off for faster modeling.',terrain:true,buildings:true,roads:false,water:true,green:false,rivers:false,relief:100,buildingScale:1,resolution:40,minBuildingArea:1.5},
  landscape:{name:'Landscape model',description:'Relief with buildings, streets and embossed water.',terrain:true,buildings:true,roads:true,water:true,green:false,rivers:false,relief:100,buildingScale:1},
  city:{name:'City block',description:'A flat architectural base with buildings and street context.',terrain:false,buildings:true,roads:true,water:true,green:true,rivers:false,relief:100,buildingScale:2},
  relief:{name:'Terrain study',description:'A clean terrain relief with no architectural overlays.',terrain:true,buildings:false,roads:false,water:false,green:false,rivers:false,relief:100,buildingScale:1}
};
export const defaultModel = () => ({...MODEL_PRESETS.landscape,preset:'landscape',width:200,resolution:100,base:2,roadWidth:0.7,roadRise:0.5,areaRise:0.3,fallbackHeight:9,minBuildingArea:.8,format:'3mf'});

function scaleRecords(records,scale) {
  return (records||[]).map(record=>({...record,polygons:record.polygons.map(polygon=>polygon.map(ring=>ring.map(([x,y])=>[x*scale,y*scale])))}));
}
function filterMinDimension(records,minDimension=.2) {
  return (records||[]).flatMap(record=>{
    const polygons=record.polygons.filter(polygon=>{
      const ring=polygon[0]||[],xs=ring.map(p=>p[0]),ys=ring.map(p=>p[1]);
      return ring.length>=4&&Math.max(...xs)-Math.min(...xs)>=minDimension&&Math.max(...ys)-Math.min(...ys)>=minDimension;
    });
    return polygons.length?[{...record,polygons}]:[];
  });
}
export function modelInput(state, settings) {
  const scale=settings.width/state.wMm;
  const terrainData=settings.terrain ? state.terrainData : {...state.terrainData,h:new Float32Array(state.terrainData.h.length),delta:0};
  const scaled={...state,wMm:settings.width,hMm:state.hMm*scale,terrainData};
  const geometry=createGeometry(scaled),shape=geometry.getClipPolygon();
  const lines=records=>(records||[]).flatMap(line=>geometry.clipPolylineToPolygon(roadPoints(line).map(([x,y])=>[x*scale,y*scale]),shape).map(points=>Array.isArray(line)?points:{...line,points}));
  const buildingLod=prepareBuildingLod(settings.buildings?clipBuildings(scaleRecords(state.osmData?.buildings,scale),shape):[],{minArea:settings.minBuildingArea,minDimension:.2,tolerance:.08,maxBuildings:2500});
  return {state:scaled,buildings:buildingLod.buildings,buildingStats:buildingLod.stats,
    water:settings.water?filterMinDimension(clipBuildings(scaleRecords(state.osmData?.waterAreas,scale),shape)):[],green:settings.green?filterMinDimension(clipBuildings(scaleRecords(state.osmData?.greenAreas,scale),shape)):[],
    roads:settings.roads?lines(state.osmData?.roadLines):[],rivers:settings.rivers?lines(state.osmData?.waterLines):[]};
}
export function validateModelSettings(s) {
  for(const [key,min,max] of [['width',50,400],['resolution',40,240],['base',1,10],['relief',10,500],['roadWidth',.2,3],['roadRise',.1,3],['areaRise',.1,2],['buildingScale',.1,10],['fallbackHeight',1,100],['minBuildingArea',0,20]]) {
    if(!Number.isFinite(s[key])||s[key]<min||s[key]>max) throw new Error(`Check ${key}: use a value between ${min} and ${max}.`);
  }
}
export function terrainReliefHeight(state,percent=100) {
  const bounds=state.renderBbox,midLat=(bounds?.ne.lat+bounds?.sw.lat)/2;
  const metresWide=bounds?(bounds.ne.lng-bounds.sw.lng)*Math.PI/180*6371008.8*Math.cos(midLat*Math.PI/180):0;
  if(!(metresWide>0)||!Number.isFinite(state.terrainData?.delta))throw new Error('Generate the map again to establish the terrain scale.');
  return state.terrainData.delta*state.wMm/metresWide*percent/100;
}
export function roadRings(lines,width) {
  const rings=[];
  for(const record of lines) {
    const line=roadPoints(record),radius=Math.max(.2,width*(record.scale||1))/2;
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
  const input=modelInput(state,settings), s=input.state;
  const reliefHeight=terrainReliefHeight({...s,terrainData:state.terrainData},settings.relief);
  const areaRecords=[...(settings.buildings?input.buildings:[]),...(settings.water?input.water:[]),...(settings.green?input.green:[])];
  let points=0;for(const record of areaRecords)for(const polygon of record.polygons)for(const ring of polygon){points+=ring.length;if(points>150000)throw new Error('Area geometry exceeds 150,000 points. Select a smaller area or disable buildings / area layers.');}
  if((settings.roads?input.roads:[]).reduce((n,line)=>n+roadPoints(line).length,0)+(settings.rivers?input.rivers:[]).reduce((n,line)=>n+roadPoints(line).length,0)>40000) throw new Error('Street/river geometry is too large for browser modeling. Select a smaller area or disable those layers.');
  const {Manifold,Mesh,CrossSection}=engine, owned=[];
  const keep=object=>{owned.push(object);return object;};
  const colored=(solid,color)=>{const c=rgb(color);return keep(solid.setProperties(3,(p)=>{p[0]=c[0];p[1]=c[1];p[2]=c[2];}));};
  const fromMesh=mesh=>keep(new Manifold(new Mesh({numProp:3,vertProperties:Float32Array.from(mesh.v.flat()),triVerts:Uint32Array.from(mesh.t.flat())})));
  const counts={buildings:settings.buildings?input.buildings.length:0,roads:settings.roads?input.roads.length:0,water:settings.water?input.water.length:0,green:settings.green?input.green.length:0,rivers:settings.rivers?input.rivers.length:0};
  try {
    progress({percent:8,detail:'Meshing terrain and base'});
    const terrainMesh=buildTerrainMesh(s,{resolution:settings.resolution,targetHeight:reliefHeight});
    // Existing mesher uses a 2 mm base; move only its top surface to the requested thickness.
    terrainMesh.v.forEach(v=>{if(v[2]>0)v[2]+=settings.base-2;});
    const terrain=fromMesh(terrainMesh);
    if(terrain.status()!=='NoError') throw new Error('Terrain mesh validation failed. Try a different mesh quality.');
    const solids=[colored(terrain,'#D4D6C8')];
    const drape=(rings,rise,color,name)=>{
      if(!rings.length)return;
      progress({percent:30+solids.length*7,detail:`Building ${name} geometry`});
      const cross=keep(new CrossSection(rings,'NonZero'));
      const prism=keep(cross.extrude(settings.base+reliefHeight+10));
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
      const buildings=buildBuildingMeshes(s,input.buildings,{resolution:settings.resolution,targetHeight:reliefHeight,buildingScale:settings.buildingScale,fallbackHeight:settings.fallbackHeight});
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
    const result={mesh:{v,t,colors},counts,buildingStats:input.buildingStats,width:s.wMm,height:s.hMm,reliefHeight,triangles:t.length,volume:fused.volume(),settings:{...settings}};
    progress({percent:100,detail:`Ready · ${t.length.toLocaleString()} triangles`});
    return result;
  } finally { owned.reverse().forEach(object=>object.delete()); }
}
