import polygonClipping from 'polygon-clipping';
import {simplifyPolyline} from './geometry.js';

// Reuse the relation assembler for landcover, retaining inner rings (islands).
export function parseAreas(elements, project, predicate) {
  return parseBuildings(elements.filter(el=>predicate(el.tags||{})).map(el=>({...el,tags:{...el.tags,building:'yes'}})),project);
}

export function buildingHeight(tags = {}, fallback = 9) {
  const match = String(tags.height ?? '').trim().match(/^(\d+(?:\.\d+)?)\s*(m|metres?|meters?|ft|feet|')?$/i);
  if(match) {
    const metres = Number(match[1]) * (/^(ft|feet|')$/i.test(match[2] || '') ? 0.3048 : 1);
    if(metres > 0 && metres <= 1000) return {metres, estimated:false, source:'height'};
  }
  const levels = Number(tags['building:levels']);
  if(Number.isFinite(levels) && levels > 0 && levels <= 200) return {metres:levels*3, estimated:true, source:'levels'};
  return {metres:fallback, estimated:true, source:'fallback'};
}

const same = (a,b) => Math.hypot(a[0]-b[0],a[1]-b[1]) < 1e-6;
const area = ring => ring.reduce((sum,p,i)=>{const q=ring[(i+1)%ring.length];return sum+p[0]*q[1]-q[0]*p[1];},0)/2;
const polygonArea = polygon => Math.max(0,Math.abs(area(polygon[0]||[]))-polygon.slice(1).reduce((sum,ring)=>sum+Math.abs(area(ring)),0));

export function prepareBuildingLod(buildings,{minArea=.5,tolerance=.06,maxBuildings=2500}={}) {
  const original=(buildings||[]).length, originalPoints=(buildings||[]).reduce((sum,b)=>sum+b.polygons.flat(2).length,0);
  const candidates=(buildings||[]).flatMap(building=>{
    const polygons=building.polygons.filter(polygon=>polygonArea(polygon)>=minArea);
    const footprint=polygons.reduce((sum,polygon)=>sum+polygonArea(polygon),0);
    return polygons.length?[{...building,polygons,footprint}]:[];
  }).sort((a,b)=>b.footprint-a.footprint);
  const limited=candidates.slice(0,maxBuildings).map(building=>({...building,polygons:building.polygons.map(polygon=>polygon.map(ring=>{
    if(ring.length<=5||tolerance<=0)return ring;
    const open=ring.slice(0,-1), simplified=simplifyPolyline(open,tolerance);
    return simplified.length>=3?simplified.concat([simplified[0]]):ring;
  }))}));
  const points=limited.reduce((sum,b)=>sum+b.polygons.flat(2).length,0);
  return {buildings:limited,stats:{original,shown:limited.length,omitted:original-limited.length,originalPoints,points,simplified:Math.max(0,originalPoints-points)}};
}

export function coastlineAreas(lines,clipPolygon) {
  const clip=clipPolygon.concat([clipPolygon[0]]), closed=[], open=[];
  const onSegment=(p,a,b)=>Math.abs((b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]))<1e-4&&p[0]>=Math.min(a[0],b[0])-1e-4&&p[0]<=Math.max(a[0],b[0])+1e-4&&p[1]>=Math.min(a[1],b[1])-1e-4&&p[1]<=Math.max(a[1],b[1])+1e-4;
  const edgeOf=p=>clipPolygon.findIndex((a,i)=>onSegment(p,a,clipPolygon[(i+1)%clipPolygon.length]));
  for(const line of lines||[]) {
    if(line.length<2)continue;
    if(same(line[0],line.at(-1))){closed.push([line]);continue;}
    const start=edgeOf(line[0]),end=edgeOf(line.at(-1));if(start<0||end<0)continue;
    const boundary=[line.at(-1)];let edge=end,guard=0;
    while(edge!==start&&guard++<clipPolygon.length+1){boundary.push(clipPolygon[(edge+1)%clipPolygon.length]);edge=(edge+1)%clipPolygon.length;}
    boundary.push(line[0]);
    const candidate=line.concat(boundary.slice(1));
    // OSM coastline direction keeps land on the left in geographic coordinates.
    // Projected screen Y is inverted, so water is the positive-area side here.
    if(area(candidate)>0)open.push([candidate]);
    else {
      const reverseBoundary=[line.at(-1)];edge=end;guard=0;
      while(edge!==start&&guard++<clipPolygon.length+1){reverseBoundary.push(clipPolygon[edge]);edge=(edge-1+clipPolygon.length)%clipPolygon.length;}
      reverseBoundary.push(line[0]);const other=line.concat(reverseBoundary.slice(1));
      if(area(other)>0)open.push([other]);
    }
  }
  try {
    let water=open.length?polygonClipping.union(...open):closed.length?[clip]:[];
    if(closed.length&&water.length)water=polygonClipping.difference(water,...closed);
    return water.map((polygons,index)=>({id:`coastline/${index}`,name:'Coastal water',polygons:[polygons]}));
  } catch { return []; }
}
function joinRings(segments) {
  const pending = segments.filter(s=>s.length>=2).map(s=>s.slice()), rings=[];
  while(pending.length) {
    let ring=pending.pop(), changed=true;
    while(!same(ring[0],ring.at(-1)) && changed) {
      changed=false;
      for(let i=0;i<pending.length;i++) {
        let segment=pending[i];
        if(same(ring.at(-1),segment.at(-1))) segment=segment.slice().reverse();
        if(same(ring.at(-1),segment[0])) {ring.push(...segment.slice(1));pending.splice(i,1);changed=true;break;}
        if(same(ring[0],segment[0])) segment=segment.slice().reverse();
        if(same(ring[0],segment.at(-1))) {ring=segment.slice(0,-1).concat(ring);pending.splice(i,1);changed=true;break;}
      }
    }
    if(ring.length>=4 && same(ring[0],ring.at(-1)) && Math.abs(area(ring))>1e-8) rings.push(ring);
  }
  return rings;
}

export function parseBuildings(elements, project) {
  const result=[], consumed=new Set(), seen=new Set();
  const geometry = value => Array.isArray(value) && value.every(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lon)) ? value.map(p=>project(p.lat,p.lon)) : [];
  const add = (element,polygons) => {
    const id=`${element.type}/${element.id}`;
    if(seen.has(id) || !polygons.length) return;
    seen.add(id);
    result.push({id,polygons,height:buildingHeight(element.tags),name:String(element.tags?.name || 'Building')});
  };
  // Relations first: suppress duplicate outer ways only when a valid relation is retained.
  for(const element of elements) {
    if(element.type!=='relation' || !element.tags?.building || element.tags.building==='no' || !Array.isArray(element.members)) continue;
    const outer=joinRings(element.members.filter(m=>m.role==='outer'||!m.role).map(m=>geometry(m.geometry)));
    const inner=joinRings(element.members.filter(m=>m.role==='inner').map(m=>geometry(m.geometry)));
    try {
      const polygons=outer.length ? polygonClipping.difference(outer.map(r=>[r]),...inner.map(r=>[r])) : [];
      add(element,polygons);
      if(polygons.length) element.members.forEach(m=>{if(m.type==='way')consumed.add(m.ref);});
    } catch { /* Invalid OSM geometry is omitted; never fabricate a footprint. */ }
  }
  for(const element of elements) {
    if(element.type!=='way'||!element.tags?.building||element.tags.building==='no'||consumed.has(element.id)) continue;
    const rings=joinRings([geometry(element.geometry)]);
    if(rings.length) {
      try { add(element,polygonClipping.union([rings[0]])); } catch { /* Invalid footprint. */ }
    }
  }
  return result;
}

export function clipBuildings(buildings, clipPolygon) {
  const clip=[clipPolygon.concat([clipPolygon[0]])];
  return buildings.flatMap(building=>{
    const polygons=polygonClipping.intersection(building.polygons,clip);
    return polygons.length ? [{...building,polygons}] : [];
  });
}

export function buildingPath(building) {
  return building.polygons.flatMap(polygon=>polygon.map(ring=>ring.map((p,i)=>`${i?'L':'M'} ${p[0].toFixed(4)} ${p[1].toFixed(4)}`).join(' ')+' Z')).join(' ');
}
