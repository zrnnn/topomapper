import polygonClipping from 'polygon-clipping';

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
