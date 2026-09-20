import earcut,{flatten} from 'earcut';
import {modelInput,validateModelSettings,terrainReliefHeight,roadRings} from './model.js';
import {buildTerrainMesh} from './mesh.js';
import {buildBuildingMeshes} from './building-mesh.js';
import {createGeometry} from './geometry.js';

// Display geometry only: no Boolean intersections or union. Export always uses
// buildModel and its closed-solid checks, never this overlapping preview mesh.
export function buildQuickModel(state,settings){
  validateModelSettings(settings);
  const input=modelInput(state,settings),s=input.state;
  const reliefHeight=terrainReliefHeight({...s,terrainData:state.terrainData},settings.relief);
  const geometry=createGeometry(s),mesh={v:[],t:[],colors:[]};
  const add=(part,color)=>{
    if(mesh.t.length+part.t.length>250000)throw new Error('Preview geometry is too large. Reduce detail or disable a layer.');
    const offset=mesh.v.length;
    for(const v of part.v)mesh.v.push([v[0],s.hMm-v[1],v[2]]);
    for(const tri of part.t){mesh.t.push(tri.map(i=>i+offset).reverse());mesh.colors.push(color);}
  };
  const terrain=buildTerrainMesh(s,{resolution:Math.min(settings.resolution,80),targetHeight:reliefHeight});
  terrain.v.forEach(v=>{if(v[2]>0)v[2]+=settings.base-2;});add(terrain,'#D4D6C8');
  const surface=(polygon,rise,color)=>{
    const clean=polygon.map(ring=>{
      const first=ring[0],last=ring.at(-1);
      return first&&last&&first[0]===last[0]&&first[1]===last[1]?ring.slice(0,-1):ring;
    });
    const flat=flatten(clean),indices=earcut(flat.vertices,flat.holes,2);
    const part={v:clean.flat().map(([x,y])=>[x,y,settings.base+rise+(s.terrainData.delta?geometry.getZInterpolated(x/s.wMm,y/s.hMm)*reliefHeight/s.terrainData.delta:0)]),t:[]};
    for(let i=0;i<indices.length;i+=3)part.t.push(indices.slice(i,i+3));add(part,color);
  };
  for(const [key,color] of [['green','#91AA85'],['water','#6A9EA9']])
    for(const record of input[key])for(const polygon of record.polygons)surface(polygon,settings.areaRise,color);
  for(const [key,width,rise,color] of [['rivers',settings.roadWidth*.8,settings.areaRise,'#6A9EA9'],['roads',settings.roadWidth,settings.roadRise,'#536C68']])
    for(const ring of roadRings(input[key],width))surface([ring],rise,color);
  if(settings.buildings)for(const {mesh:building} of buildBuildingMeshes(s,input.buildings,{resolution:settings.resolution,targetHeight:reliefHeight,buildingScale:settings.buildingScale,fallbackHeight:settings.fallbackHeight})){
    building.v.forEach(v=>{if(v[2]>0)v[2]+=settings.base-2;});add(building,'#DDA95E');
  }
  return {mesh,width:s.wMm,height:s.hMm,reliefHeight,triangles:mesh.t.length,counts:Object.fromEntries(['buildings','roads','water','green','rivers'].map(key=>[key,input[key].length])),buildingStats:input.buildingStats,settings:{...settings},previewOnly:true};
}
