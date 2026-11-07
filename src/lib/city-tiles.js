import {VectorTile} from '@mapbox/vector-tile';
import {PbfReader} from 'pbf';
import {latitudeY,yLatitude,validateBounds} from './terrain.js';
import {readBounded,DataLimitError,downloadDetail} from './data-budget.js';
import {cachedBytes,cacheBytes} from './data-cache.js';
import {emptyMapData,mapProjection} from './map-parser.js';
import {roadRecord} from './road-style.js';
import {createGeometry} from './geometry.js';
import {buildingHeight,clipBuildings} from './buildings.js';
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
export async function loadCityTiles(state,options={}){
  const failures=[];
  for(const source of tileSources){
    options.signal?.throwIfAborted();
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
async function loadTileSource(source,state,{signal,budget,progress=()=>{},fetchImpl=fetch,stallMs=12000,neighborhood=false}){
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
  const maxZoom=Math.min(neighborhood?14:12,meta.maxzoom??12);
  // Buildings are generalized below native detail. Fall back to detailed queries
  // if the source cannot cover this selection at z14 inside the tile budget.
  let plan=vectorTilePlan(state.renderBbox,{width:state.wMm,maxZoom,native:neighborhood});
  if (neighborhood && plan.z<14) throw new Error('Native neighborhood tile detail unavailable');
  for(let attempt=0;attempt<2;attempt++){
    const results=new Array(plan.tiles.length);let cursor=0,done=0,vertices=0,failed=null;
    const batch=new AbortController();
    const tileSignal=signal?AbortSignal.any([signal,batch.signal]):batch.signal;
    try{
      await Promise.all(Array.from({length:Math.min(3,plan.tiles.length)},async()=>{
        try{while(cursor<plan.tiles.length&&!failed){
          if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
          const index=cursor++,tile=plan.tiles[index],url=template.replace('{z}',tile.z).replace('{x}',tile.x).replace('{y}',tile.y);
          const payload=await getBytes(url,{signal:tileSignal,budget,fetchImpl,stallMs,progress:detail=>progress(`${detail} · tile ${index+1}/${plan.tiles.length}`)});
          progress(`Decoding city tile ${index+1}/${plan.tiles.length} · simplifying geometry`);
          const decoded=decodeCityTile(payload.bytes,tile,state,{neighborhood,source});
          void payload.save?.();
          vertices+=decoded.vertices;if(vertices>180000)throw new DataLimitError('City tile geometry exceeds the detail budget');
          results[index]=decoded.data;progress(`${source.name} · ${++done}/${plan.tiles.length} tiles · detail level ${plan.z}`);
        }}catch(error){failed??=error;batch.abort();}
      }));
      if(failed)throw failed;
      const data=emptyMapData();for(const item of results)for(const key of Object.keys(data))data[key].push(...item[key]);
      return {data,tiles:plan.tiles.length,zoom:plan.z,source:source.name+(neighborhood?' · detailed vector tiles':'')};
    }catch(error){
      if(neighborhood||!(error instanceof DataLimitError)||attempt||signal?.aborted||(budget && budget.bytes>=budget.maxBytes))throw error;
      plan=vectorTilePlan(state.renderBbox,{width:state.wMm,maxZoom:Math.max(0,plan.z-1)});
      progress('City detail reduced to fit the data budget');
    }
  }
}
export function decodeCityTile(bytes,{x,y,z},state,{neighborhood=false,source=tileSources[0]}={}){
  const tile=new VectorTile(new PbfReader(bytes)),data=emptyMapData(),project=mapProjection(state),geometry=createGeometry(state);
  const n=2**z;
  const tileRing=[[x/n*360-180,yLatitude(y/n)],[(x+1)/n*360-180,yLatitude(y/n)],[(x+1)/n*360-180,yLatitude((y+1)/n)],[x/n*360-180,yLatitude((y+1)/n)]].map(([lon,lat])=>project(lat,lon));
  const clip=geometry.clipPolygon(tileRing,[[0,0],[state.wMm,0],[state.wMm,state.hMm],[0,state.hMm]]);
  if(clip.length<3)return {data,vertices:0};
  let vertices=0;
  const selected=selectedLayers(state);
  for(const [name,category] of Object.entries(source.layers)){
    if(!selected[category] || (category==='buildings' && !neighborhood))continue;
    const layer=tile.layers[name];if(!layer)continue;
    for(let i=0;i<layer.length;i++){
      const feature=layer.feature(i),p=feature.properties,kind=p.class??p.kind;
      const roadClass=kind==='minor'?'residential':kind;
      if(category==='roads'&&!['motorway','trunk','primary','secondary','tertiary',...(selected.minorRoads?['residential','service','unclassified']:[])].includes(roadClass))continue;
      if(category==='green'&&!['wood','grass','grassland','forest','park','garden','recreation_ground','meadow'].includes(kind))continue;
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
        if (category==='buildings') {
          record.hide3d=p.hide_3d===true || p.hide_3d===1 || p.hide_3d==='true';
          const height=buildingHeight({height:p.render_height??p.height});
          record.height={...height,estimated:true,source:height.source==='fallback'?'fallback':'tile'};
          record.name='Building';
        }
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
  return {data,vertices};
}
