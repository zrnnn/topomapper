import {VectorTile} from '@mapbox/vector-tile';
import {PbfReader} from 'pbf';
import {latitudeY,yLatitude,validateBounds} from './terrain.js';
import {readBounded,DataLimitError,downloadDetail} from './data-budget.js';
import {cachedBytes,cacheBytes} from './data-cache.js';
import {emptyMapData,mapProjection} from './map-parser.js';
import {roadRecord} from './road-style.js';
import {createGeometry} from './geometry.js';
import {clipBuildings} from './buildings.js';
import {selectedLayers} from './layer-selection.js';

const META='https://tiles.openfreemap.org/planet';
export function vectorTilePlan(bounds,{maxTiles=16,maxZoom=12,width=200}={}){
  validateBounds(bounds);
  const west=(bounds.sw.lng+180)/360,east=(bounds.ne.lng+180)/360,north=latitudeY(bounds.ne.lat),south=latitudeY(bounds.sw.lat);
  let z=Math.min(maxZoom,Math.max(0,Math.ceil(Math.log2(Math.max(1,width/.2)/(4096*Math.max(east-west,south-north))))+2));
  const jobs=zoom=>{
    const n=2**zoom,tiles=[];
    for(let y=Math.floor(north*n);y<=Math.min(n-1,Math.ceil(south*n)-1);y++)
      for(let x=Math.floor(west*n);x<=Math.min(n-1,Math.ceil(east*n)-1);x++)tiles.push({x,y,z:zoom});
    return tiles;
  };
  while(z>0&&jobs(z).length>maxTiles)z--;
  return {z,tiles:jobs(z)};
}
async function getBytes(url,{signal,budget,maxBytes=4*1024*1024,fetchImpl=fetch,progress=()=>{}}){
  const hit=await cachedBytes(url);if(hit){progress(`Using cached data from ${new URL(url).hostname}`);return hit;}
  progress(`Connecting to ${new URL(url).hostname}…`);
  const response=await fetchImpl(url,{signal});
  if(!response.ok)throw new Error(`OpenFreeMap HTTP ${response.status}${response.status===429?' rate limit exceeded':''}`);
  const data=await readBounded(response,{signal,budget,maxBytes,onProgress:p=>progress(downloadDetail(url,p))});
  await cacheBytes(url,data);return data;
}
export async function loadCityTiles(state,{signal,budget,progress=()=>{},fetchImpl=fetch}={}){
  const meta=JSON.parse(new TextDecoder().decode(await getBytes(META,{signal,budget,fetchImpl,progress,maxBytes:128*1024})));
  const template=meta.tiles?.[0];if(!template?.startsWith('https://'))throw new Error('Invalid city tile metadata');
  let plan=vectorTilePlan(state.renderBbox,{width:state.wMm,maxZoom:Math.min(12,meta.maxzoom||12)});
  for(let attempt=0;attempt<2;attempt++){
    const results=new Array(plan.tiles.length);let cursor=0,done=0,vertices=0,failed=null;
    try{
      await Promise.all(Array.from({length:Math.min(3,plan.tiles.length)},async()=>{
        try{while(cursor<plan.tiles.length&&!failed){
          if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
          const index=cursor++,tile=plan.tiles[index],url=template.replace('{z}',tile.z).replace('{x}',tile.x).replace('{y}',tile.y);
          const bytes=await getBytes(url,{signal,budget,fetchImpl,progress:detail=>progress(`${detail} · tile ${index+1}/${plan.tiles.length}`)});
          progress(`Decoding city tile ${index+1}/${plan.tiles.length} · simplifying geometry`);
          const decoded=decodeCityTile(bytes,tile,state);
          vertices+=decoded.vertices;if(vertices>180000)throw new DataLimitError('City tile geometry exceeds the detail budget');
          results[index]=decoded.data;progress(`OpenFreeMap · ${++done}/${plan.tiles.length} tiles · detail level ${plan.z}`);
        }}catch(error){failed??=error;}
      }));
      if(failed)throw failed;
      const data=emptyMapData();for(const item of results)for(const key of Object.keys(data))data[key].push(...item[key]);
      return {data,tiles:plan.tiles.length,zoom:plan.z,source:'OpenFreeMap / OpenMapTiles'};
    }catch(error){
      if(!(error instanceof DataLimitError)||attempt||signal?.aborted||budget?.bytes>=budget?.maxBytes)throw error;
      plan=vectorTilePlan(state.renderBbox,{width:state.wMm,maxZoom:Math.max(0,plan.z-1)});
      progress('City detail reduced to fit the data budget');
    }
  }
}
export function decodeCityTile(bytes,{x,y,z},state){
  const tile=new VectorTile(new PbfReader(bytes)),data=emptyMapData(),project=mapProjection(state),geometry=createGeometry(state);
  const n=2**z;
  const tileRing=[[x/n*360-180,yLatitude(y/n)],[(x+1)/n*360-180,yLatitude(y/n)],[(x+1)/n*360-180,yLatitude((y+1)/n)],[x/n*360-180,yLatitude((y+1)/n)]].map(([lon,lat])=>project(lat,lon));
  let vertices=0;
  const selected=selectedLayers(state),selection={water:'water',landcover:'green',landuse:'green',waterway:'rivers',transportation:'roads',place:'labels',mountain_peak:'labels'};
  for(const name of ['water','landcover','landuse','waterway','transportation','place','mountain_peak']){
    if(!selected[selection[name]])continue;
    const layer=tile.layers[name];if(!layer)continue;
    for(let i=0;i<layer.length;i++){
      const feature=layer.feature(i),p=feature.properties;
      const roadClass=p.class==='minor'?'residential':p.class;
      if(name==='transportation'&&!['motorway','trunk','primary','secondary','tertiary',...(state.includeMinorRoads?['residential','service','unclassified']:[])].includes(roadClass))continue;
      if(['landcover','landuse'].includes(name)&&!['wood','grass','forest','park','garden','recreation_ground','meadow'].includes(p.class))continue;
      const geo=feature.toGeoJSON(x,y,z).geometry;
      const mapRing=ring=>ring.map(([lon,lat])=>project(lat,lon));
      if(geo.type==='Point'&&p.name){
        const [lon,lat]=geo.coordinates,[px,py]=project(lat,lon);
        if(px>=0&&px<=state.wMm&&py>=0&&py<=state.hMm)data.labels.push({name:p.name,lat,lon,place:name==='place'?p.class:undefined,kind:name==='place'?'place':'peak'});
        continue;
      }
      if(geo.type==='Polygon'||geo.type==='MultiPolygon'){
        const polygons=(geo.type==='Polygon'?[geo.coordinates]:geo.coordinates).map(polygon=>polygon.map(mapRing));
        vertices+=polygons.reduce((a,p)=>a+p.reduce((b,r)=>b+r.length,0),0);
        if(vertices>180000)throw new DataLimitError('City tile geometry exceeds the detail budget');
        const record={id:`${z}/${x}/${y}/${name}/${i}`,polygons};
        // Remove tile buffer overlaps while retaining holes. Neighboring tile
        // pieces meet at their true border, avoiding doubled transparent fills.
        const clipped=clipBuildings([record],tileRing);
        data[name==='water'?'waterAreas':'greenAreas'].push(...clipped);
      }else if(geo.type==='LineString'||geo.type==='MultiLineString'){
        const lines=(geo.type==='LineString'?[geo.coordinates]:geo.coordinates).map(mapRing);
        for(const line of lines){
          vertices+=line.length;
          for(const points of geometry.clipPolylineToPolygon(line,tileRing))
            if(name==='transportation')data.roadLines.push(roadRecord(points,roadClass));
            else data.waterLines.push(points);
        }
      }
    }
  }
  return {data,vertices};
}
