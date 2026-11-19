import polygonClipping from 'polygon-clipping';
import {areaPlan} from './area-plan.js';
import {mapProjection} from './map-parser.js';
import {cachedBytes,cacheBytes} from './data-cache.js';
import {readBounded,downloadDetail} from './data-budget.js';
import {footprintBounds,footprintIndex} from './footprint-index.js';
import {footprintArea} from './buildings.js';

export const NYC_SOURCE='NYC Open Data building roof heights';
export function useNYCHeights(state){
  const {sw,ne}=state.renderBbox;
  return state.outputMode==='3d' && sw.lat>=40.49 && ne.lat<=40.93 && sw.lng>=-74.26 && ne.lng<=-73.69 &&
    areaPlan(state.renderBbox).km2<=0.5;
}
const area=b=>b.polygons.reduce((n,p)=>n+footprintArea(p),0);

export async function addNYCHeights(state,buildings,{signal,budget,progress,fetchImpl=fetch}){
  const eligible=b=>b.height?.estimated && !b.part && !b.hide3d;
  if(!buildings.some(eligible))return {buildings,count:0};
  const {sw,ne}=state.renderBbox,project=mapProjection(state);
  const url=new URL('https://data.cityofnewyork.us/resource/5zhs-2jue.geojson');
  const ring=[[sw.lng,sw.lat],[ne.lng,sw.lat],[ne.lng,ne.lat],[sw.lng,ne.lat],[sw.lng,sw.lat]];
  url.searchParams.set('$where','intersects(the_geom,"POLYGON (('+ring.map(p=>p.join(' ')).join(',')+'))")');
  url.searchParams.set('$select','the_geom,height_roof,doitt_id,name');
  url.searchParams.set('$order','doitt_id');
  url.searchParams.set('$limit','400');
  const key=url.href;
  let bytes=await cachedBytes(key);
  const hit=Boolean(bytes);
  if(!hit){
    const response=await fetchImpl(url,{signal});
    if(!response.ok){
      void response.body?.cancel().catch(()=>{});
      throw new Error('NYC Open Data HTTP '+response.status+(response.status===429?' rate limit exceeded':''));
    }
    bytes=await readBounded(response,{maxBytes:1500000,budget,signal,onProgress:p=>progress(downloadDetail(key,p))});
  }
  const collection=JSON.parse(new TextDecoder().decode(bytes));
  if(collection.type!=='FeatureCollection' || !Array.isArray(collection.features))throw new Error('Invalid city building data');
  const roofs=[];
  for(const feature of collection.features){
    const metres=Number(feature.properties?.height_roof)*.3048;
    if(!(metres>0 && metres<=1000))continue;
    const g=feature.geometry;
    const polys=g?.type==='MultiPolygon'?g.coordinates:g?.type==='Polygon'?[g.coordinates]:[];
    const polygons=polys.filter(p=>p.length && p.every(r=>r.length>=4 && r.every(([x,y])=>Number.isFinite(x)&&Number.isFinite(y))))
      .map(p=>p.map(r=>r.map(([lon,lat])=>project(lat,lon))));
    if(polygons.length)roofs.push({polygons,metres,name:feature.properties.name});
  }
  if(!hit)void cacheBytes(key,bytes);
  const nearby=footprintIndex(roofs,state.wMm,state.hMm);
  const proposals=new Map(),uses=new Map();
  for(const building of buildings){
    if(!eligible(building))continue;
    const footprint=area(building);
    const matches=[];
    for(const roof of nearby(footprintBounds(building))){
      const roofArea=area(roof);
      if(!roofArea || Math.min(footprint,roofArea)<.8*Math.max(footprint,roofArea))continue;
      const intersection=polygonClipping.intersection(building.polygons,roof.polygons);
      const shared=intersection.reduce((n,p)=>n+footprintArea(p),0);
      if(shared/(roofArea+footprint-shared)>=.8)matches.push(roof);
    }
    if(matches.length===1){
      const [roof]=matches;
      proposals.set(building,roof);
      uses.set(roof,(uses.get(roof)||0)+1);
    }
  }
  let count=0;
  const result=buildings.map(building=>{
    const roof=proposals.get(building);
    if(!roof || uses.get(roof)!==1)return building;
    count++;
    return {...building,name:roof.name||building.name,height:{metres:roof.metres,estimated:false,source:'nyc-roof'}};
  });
  return {buildings:result,count};
}
