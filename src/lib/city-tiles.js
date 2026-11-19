import {VectorTile,classifyRings} from '@mapbox/vector-tile';
import {PbfReader} from 'pbf';
import {latitudeY,yLatitude,validateBounds} from './terrain.js';
import {readBounded,DataLimitError,downloadDetail} from './data-budget.js';
import {cachedBytes,cacheBytes} from './data-cache.js';
import {emptyMapData,mapProjection} from './map-parser.js';
import {roadRecord} from './road-style.js';
import {createGeometry} from './geometry.js';
import {isLandmark,buildingHeight,clipBuildings,prepareBuildingLod,footprintArea,limitCityFootprints} from './buildings.js';
import {selectedLayers} from './layer-selection.js';

const tileSources=[
  {name:'OpenFreeMap / OpenMapTiles',url:'https://tiles.openfreemap.org/planet',buildings:'building',
    layers:{water:'water',landcover:'green',landuse:'green',waterway:'rivers',transportation:'roads',place:'labels',mountain_peak:'labels',building:'buildings'}},
  {name:'VersaTiles / Shortbread',url:'https://tiles.versatiles.org/tiles/osm/tiles.json',buildings:'buildings',
    layers:{water_polygons:'water',ocean:'water',land:'green',water_lines:'rivers',streets:'roads',place_labels:'labels',mountain_peaks:'labels',buildings:'buildings'}}
];
const resumeAt=new Map();
export function vectorTilePlan(bounds,{maxTiles=16,maxZoom=12,width=200,native=false}={}){
  validateBounds(bounds);
  const west=(bounds.sw.lng+180)/360,east=(bounds.ne.lng+180)/360,north=latitudeY(bounds.ne.lat),south=latitudeY(bounds.sw.lat);
  let z=native?maxZoom:Math.min(maxZoom,Math.max(0,Math.ceil(Math.log2(Math.max(1,width/.2)/(4096*Math.max(east-west,south-north))))+2));
  while(z>=0){
    const n=2**z;
    const x0=Math.floor(west*n),x1=Math.min(n-1,Math.ceil(east*n)-1);
    const y0=Math.floor(north*n),y1=Math.min(n-1,Math.ceil(south*n)-1);
    if((x1-x0+1)*(y1-y0+1)<=maxTiles || z===0){
      const tiles=[];
      for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)tiles.push({x,y,z});
      return {z,tiles};
    }
    z--;
  }
}
async function getBytes(url,{signal,budget,maxBytes=4*1024*1024,fetchImpl=fetch,progress=()=>{},stallMs=12000}){
  const host=new URL(url).hostname;
  const key='vector-v2:'+url;
  const hit=await cachedBytes(key);
  if(hit){progress(`Using cached data from ${host}`);return {bytes:hit};}
  signal?.throwIfAborted();
  if(budget && budget.bytes>=budget.maxBytes)throw new DataLimitError('Map download budget reached');
  if(Date.now()<resumeAt.get(host))throw new Error('HTTP 429 rate limit cooldown');
  progress(`Connecting to ${new URL(url).hostname}…`);
  const stalled=new AbortController();
  const requestSignal=signal?AbortSignal.any([signal,stalled.signal]):stalled.signal;
  let timer;
  const resetTimer=()=>{
    clearTimeout(timer);
    timer=setTimeout(()=>stalled.abort(),stallMs);
  };
  resetTimer();
  try {
    const response=await fetchImpl(url,{signal:requestSignal});
    if(!response.ok){
      if(response.status===429){
        const retry=response.headers?.get('Retry-After');
        const until=retry && Number.isFinite(Number(retry))?Date.now()+Number(retry)*1000:Date.parse(retry);
        resumeAt.set(host,Math.max(Date.now()+30000,until||0));
      }
      void response.body?.cancel().catch(()=>{});
      throw new Error(`HTTP ${response.status}${response.status===429?' rate limit exceeded':''}`);
    }
    const data=await readBounded(response,{signal:requestSignal,budget,maxBytes,onProgress:p=>{
      resetTimer();
      progress(downloadDetail(url,p));
    }});
    return {bytes:data,save:()=>cacheBytes(key,data)};
  } catch (error) {
    if(stalled.signal.aborted && !signal?.aborted)throw new Error('Tile download stalled');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
// City footprints can use a coarser source zoom than individual building parts.
export function cityBuildingPlan(bounds,zoom=13){
  const plan=vectorTilePlan(bounds,{maxZoom:zoom,maxTiles:512,native:true});
  return plan.z===zoom?plan:null;
}
export async function loadCityTiles(state,options={}){
  const failures=[];
  for(const source of tileSources){
    if(options.continuation && options.continuation.source!==source.name)continue;
    options.signal?.throwIfAborted();
    options.onTileProgress?.(null);
    try {
      return await loadTileSource(source,state,options);
    }catch(error){
      if(options.signal?.aborted || error instanceof DataLimitError)throw error;
      failures.push(source.name+': '+error.message);
      options.progress?.(failures.at(-1)+' · trying another map source');
    }
  }
  throw new Error(failures.join(' · '));
}
async function loadTileSource(source,state,{signal,budget,progress=()=>{},fetchImpl=fetch,stallMs=12000,neighborhood=false,cityBuildings=false,onTileProgress=()=>{},continuation=null}){
  const metadata=await getBytes(source.url,{signal,budget,fetchImpl,stallMs,progress,maxBytes:128*1024});
  const meta=JSON.parse(new TextDecoder().decode(metadata.bytes));
  const path=meta.tiles?.[0];
  if(typeof path!=='string' || !['{x}','{y}','{z}'].every(token=>path.includes(token)))throw new Error('Invalid tile URL template');
  const template=path.startsWith('/')?new URL(source.url).origin+path:path;
  if(!template.startsWith('https://'))throw new Error('Invalid tile protocol');
  if(neighborhood && selectedLayers(state).buildings && Array.isArray(meta.vector_layers) &&
      !meta.vector_layers.some(layer=>layer.id===source.buildings && (layer.minzoom??0)<=14)){
    throw new Error('Tile source does not include building detail');
  }
  void metadata.save?.();
  let plan,coverage=null;
  if(cityBuildings){
    const layer=meta.vector_layers?.find(layer=>layer.id===source.buildings);
    const zoom=Math.max(13,layer?.minzoom??14);
    if(!layer || zoom>(meta.maxzoom??14) || !(plan=cityBuildingPlan(state.renderBbox,zoom))){
      throw new Error('Building tiles cannot cover this frame within the city tile limit');
    }
    const total=plan.tiles.length;
    if(total>64){
      const cx=(plan.tiles[0].x+plan.tiles.at(-1).x)/2,cy=(plan.tiles[0].y+plan.tiles.at(-1).y)/2;
      const distance=t=>(t.x-cx)**2+(t.y-cy)**2;
      plan.tiles.sort((a,b)=>distance(a)-distance(b)||a.y-b.y||a.x-b.x);
      // Resume only the same tile edition. On an edition change the pipeline
      // replaces the old footprint set with a fresh first batch.
      const start=continuation?.template===template && continuation.zoom===zoom && continuation.total===total?continuation.done:0;
      plan.tiles=plan.tiles.slice(start,start+32);
      coverage={start,done:start+plan.tiles.length,total,zoom,source:source.name,template};
    }
  }else{
    const maxZoom=Math.min(neighborhood?14:12,meta.maxzoom??12);
    plan=vectorTilePlan(state.renderBbox,{width:state.wMm,maxZoom,native:neighborhood});
    if(neighborhood && plan.z<14)throw new Error('Native neighborhood tile detail unavailable');
  }
  for(let attempt=0;attempt<2;attempt++){
    let footprints=[];
    const results=new Array(plan.tiles.length);let cursor=0,done=0,vertices=0,failed=null;
    const started=performance.now();
    onTileProgress({done:0,total:plan.tiles.length,elapsedMs:0});
    const batch=new AbortController();
    const tileSignal=signal?AbortSignal.any([signal,batch.signal]):batch.signal;
    try{
      await Promise.all(Array.from({length:Math.min(3,plan.tiles.length)},async()=>{
        try{while(cursor<plan.tiles.length&&!failed){
          if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
          const index=cursor++,tile=plan.tiles[index],url=template.replace('{z}',tile.z).replace('{x}',tile.x).replace('{y}',tile.y);
          const payload=await getBytes(url,{signal:tileSignal,budget,fetchImpl,stallMs,progress:detail=>progress(`${detail} · tile ${index+1}/${plan.tiles.length}`)});
          progress(`Decoding city tile ${index+1}/${plan.tiles.length} · simplifying geometry`);
          const decoded=decodeCityTile(payload.bytes,tile,state,{neighborhood,source,cityBuildings});
          void payload.save?.();
          if(cityBuildings){
            footprints=limitCityFootprints(footprints.concat(decoded.data.buildings),60000);
          }else{
            vertices+=decoded.vertices;if(vertices>180000)throw new DataLimitError('City tile geometry exceeds the detail budget');
            results[index]=decoded.data;
          }
          done++;onTileProgress({done,total:plan.tiles.length,elapsedMs:performance.now()-started});
          progress(`${source.name} · ${done}/${plan.tiles.length} tiles in batch${coverage?' · '+(coverage.start+done)+'/'+coverage.total+' in frame':''} · detail level ${plan.z}`);
        }}catch(error){failed??=error;batch.abort();}
      }));
      if(failed)throw failed;
      const data=emptyMapData();
      if(cityBuildings)data.buildings=footprints;
      else for(const item of results)for(const key of Object.keys(data))data[key].push(...item[key]);
      return {data,coverage,tiles:plan.tiles.length,zoom:plan.z,source:source.name+(cityBuildings?' · simplified city buildings':neighborhood?' · detailed vector tiles':'')};
    }catch(error){
      if(cityBuildings||neighborhood||!(error instanceof DataLimitError)||attempt||signal?.aborted||(budget && budget.bytes>=budget.maxBytes))throw error;
      plan=vectorTilePlan(state.renderBbox,{width:state.wMm,maxZoom:Math.max(0,plan.z-1)});
      progress('City detail reduced to fit the data budget');
    }
  }
}
function tileBuilding(properties) {
  const mapped=buildingHeight(properties);
  const render=buildingHeight({height:properties.render_height});
  const height=mapped.source!=='fallback'?mapped:render.source==='fallback'?mapped:
    {...render,estimated:true,source:'tile'};
  return {name:String(properties.name||'Building'),landmark:isLandmark(properties),height,
    hide3d:[true,1,'true'].includes(properties.hide_3d)};
}
export function decodeCityTile(bytes,{x,y,z},state,{neighborhood=false,cityBuildings=false,source=tileSources[0]}={}){
  const tile=new VectorTile(new PbfReader(bytes)),data=emptyMapData(),project=mapProjection(state),geometry=createGeometry(state);
  const n=2**z;
  const tileRing=[[x/n*360-180,yLatitude(y/n)],[(x+1)/n*360-180,yLatitude(y/n)],[(x+1)/n*360-180,yLatitude((y+1)/n)],[x/n*360-180,yLatitude((y+1)/n)]].map(([lon,lat])=>project(lat,lon));
  const clip=geometry.clipPolygon(tileRing,[[0,0],[state.wMm,0],[state.wMm,state.hMm],[0,state.hMm]]);
  if(clip.length<3)return {data,vertices:0};
  let vertices=0;
  const selected=selectedLayers(state);
  const minArea=state.mapFeatures?.buildings?.minArea??0;
  const tileWidth=Math.abs(tileRing[1][0]-tileRing[0][0]),tileHeight=Math.abs(tileRing[2][1]-tileRing[1][1]);
  for(const [name,category] of Object.entries(source.layers)){
    if(!selected[category] || (cityBuildings && category!=='buildings') || (category==='buildings' && !neighborhood && !cityBuildings))continue;
    const layer=tile.layers[name];if(!layer)continue;
    for(let i=0;i<layer.length;i++){
      const feature=layer.feature(i),p=feature.properties,kind=p.class??p.kind;
      const roadClass=kind==='minor'?'residential':kind;
      if(category==='roads'&&!['motorway','trunk','primary','secondary','tertiary',...(selected.minorRoads?['residential','service','unclassified']:[])].includes(roadClass))continue;
      if(category==='green'&&!['wood','grass','grassland','forest','park','garden','recreation_ground','meadow'].includes(kind))continue;
      if(cityBuildings){
        // A z13 feature can pack hundreds of unrelated buildings into one
        // multipolygon. Rank actual footprints; keep each courtyard with its shell.
        if(feature.type!==3)continue;
        const sx=tileWidth/layer.extent,sy=tileHeight/layer.extent;
        const attributes=tileBuilding(p);
        let part=0;
        for(const rings of classifyRings(feature.loadGeometry())){
          const polygon=rings.map(ring=>ring.map(pt=>[tileRing[0][0]+pt.x*sx,tileRing[0][1]+pt.y*sy]));
          if(footprintArea(polygon)<minArea)continue;
          const record={id:`${z}/${x}/${y}/${i}/${part++}`,polygons:[polygon],...attributes};
          data.buildings.push(...clipBuildings([record],clip));
        }
        continue;
      }
      if(category==='buildings' && state.cityOverview && minArea>0){
        const [left,top,right,bottom]=feature.bbox();
        const boxArea=(right-left)*(bottom-top)*tileWidth*tileHeight/(layer.extent*layer.extent);
        if(boxArea<minArea)continue;
      }
      const geo=feature.toGeoJSON(x,y,z).geometry;
      const mapRing=ring=>ring.map(([lon,lat])=>project(lat,lon));
      if(category==='labels' && geo.type==='Point'&&p.name){
        const [lon,lat]=geo.coordinates,[px,py]=project(lat,lon);
        if(px>=0&&px<=state.wMm&&py>=0&&py<=state.hMm)data.labels.push({name:p.name,lat,lon,place:name.startsWith('place')?kind:undefined,kind:name.startsWith('place')?'place':'peak'});
        continue;
      }
      if(geo.type==='Polygon'||geo.type==='MultiPolygon'){
        if(!['buildings','water','green'].includes(category))continue;
        const polygons=(geo.type==='Polygon'?[geo.coordinates]:geo.coordinates).map(polygon=>polygon.map(mapRing));
        vertices+=polygons.reduce((a,p)=>a+p.reduce((b,r)=>b+r.length,0),0);
        if(vertices>180000)throw new DataLimitError('City tile geometry exceeds the detail budget');
        const record={id:`${z}/${x}/${y}/${name}/${i}`,polygons};
        // Remove tile buffer overlaps while retaining holes. Neighboring tile
        // pieces meet at their true border, avoiding doubled transparent fills.
        if(category==='buildings')Object.assign(record,tileBuilding(p));
        const clipped=clipBuildings([record],clip);
        const key=category==='buildings'?'buildings':category==='water'?'waterAreas':'greenAreas';
        data[key].push(...clipped);
      }else if((category==='roads'||category==='rivers') && (geo.type==='LineString'||geo.type==='MultiLineString')){
        const lines=(geo.type==='LineString'?[geo.coordinates]:geo.coordinates).map(mapRing);
        for(const line of lines){
          vertices+=line.length;
          if(vertices>180000)throw new DataLimitError('City tile geometry exceeds the detail budget');
          for(const points of geometry.clipPolylineToPolygon(line,clip))
            if(category==='roads')data.roadLines.push(roadRecord(points,roadClass));
            else data.waterLines.push(points);
        }
      }
    }
  }
  if(cityBuildings){
    const kept=prepareBuildingLod(data.buildings,{minArea,tolerance:.08,maxBuildings:2500});
    data.buildings=kept.buildings;
    vertices=kept.stats.points;
  }
  return {data,vertices};
}
