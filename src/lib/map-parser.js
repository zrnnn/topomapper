import {parseBuildings,parseAreas,coastlineAreas,joinCoastlines} from './buildings.js';
import {latitudeY} from './terrain.js';
import {createGeometry} from './geometry.js';
import {roadRecord} from './road-style.js';
import {MAP_QUERY_TIMEOUT_SECONDS} from './map-service.js';
import {selectedLayers} from './layer-selection.js';
    export const buildOverpassQuery = (state,bbox,buildingPerimeter,stage) => {
      const layers=selectedLayers(state);
      const statements={
        water:layers.water?`way["natural"="water"](${bbox});way["natural"~"bay|coastline"](${bbox});way["water"~"lake|reservoir|pond|basin|lagoon|sea|ocean"](${bbox});way["landuse"~"reservoir|basin"](${bbox});way["waterway"="riverbank"](${bbox});relation["natural"="water"](${bbox});relation["natural"="bay"](${bbox});relation["water"~"lake|reservoir|pond|basin|lagoon|sea|ocean"](${bbox});relation["landuse"~"reservoir|basin"](${bbox});relation["waterway"="riverbank"](${bbox});`:'',
        green:layers.green?`way["landuse"~"forest|grass|meadow|recreation_ground"](${bbox});way["leisure"~"park|garden"](${bbox});way["natural"~"wood|grassland"](${bbox});relation["landuse"~"forest|grass|meadow|recreation_ground"](${bbox});relation["leisure"~"park|garden"](${bbox});relation["natural"~"wood|grassland"](${bbox});`:'',
        labels:layers.labels?`node["place"~"city|town|village|suburb|hamlet|neighbourhood"](${bbox});node["natural"="peak"]["name"](${bbox});`:'',
        rivers:`way["waterway"~"river|stream|canal"](${bbox});`,
        roads:`way["highway"~"${layers.minorRoads?'motorway|trunk|primary|secondary|tertiary|residential|unclassified|service':'motorway|trunk|primary|secondary|tertiary'}"](${bbox});relation["highway"~"${layers.minorRoads?'motorway|trunk|primary|secondary|tertiary|residential|unclassified|service':'motorway|trunk|primary|secondary|tertiary'}"](${bbox});`,
        buildings:layers.buildings?`way["building"]["building"!="no"](${bbox})${state.cityOverview?`(if:length()>=${buildingPerimeter})`:''};${state.cityOverview?'':`relation["building"]["building"!="no"](${bbox});`}`:''
      };
      statements.areas=statements.water+statements.green+statements.labels;
      if(!layers.rivers)statements.rivers='';
      if(!layers.roads)statements.roads='';
      const requested=Array.isArray(stage)?stage:[stage];
      return `[out:json][maxsize:67108864][timeout:${MAP_QUERY_TIMEOUT_SECONDS}];(${requested.map(name=>statements[name]||'').join('')});out geom;`;
    };


export const emptyMapData=()=>({buildings:[],waterAreas:[],greenAreas:[],waterLines:[],roadLines:[],labels:[]});
export function mapProjection(state){
  const {sw,ne}=state.renderBbox;
  const north=latitudeY(ne.lat), scaleX=state.wMm/(ne.lng-sw.lng), scaleY=state.hMm/(latitudeY(sw.lat)-north);
  return (lat,lon)=>[(lon-sw.lng)*scaleX,(latitudeY(lat)-north)*scaleY];
}
export function parseMapStage(elements,state,stage){
  const data=emptyMapData(),project=mapProjection(state);
  if (!stage || stage==='buildings') data.buildings=parseBuildings(elements,project);
  if (stage==='buildings') return data;
  const water=t=>t.natural==='water'||t.natural==='bay'||t.waterway==='riverbank'||['sea','ocean','lake','reservoir','pond','basin','lagoon'].includes(t.water)||['reservoir','basin'].includes(t.landuse);
  const green=t=>['forest','grass','meadow','recreation_ground'].includes(t.landuse)||['park','garden'].includes(t.leisure)||['wood','grassland'].includes(t.natural);
  const layers=selectedLayers(state);
  if (!stage || ['areas','water','green'].includes(stage)) {
    if(layers.water && stage!=='green')data.waterAreas=parseAreas(elements,project,water);
    if(layers.green && stage!=='water')data.greenAreas=parseAreas(elements,project,green);
  }
  const coasts=[],ids=new Set();
  for(const el of elements){
    const key=el.type+'/'+el.id;if(ids.has(key))continue;ids.add(key);
    const t=el.tags||{};
    if((!stage||stage==='areas'||stage==='labels')&&el.type==='node'&&Number.isFinite(el.lat)&&Number.isFinite(el.lon)&&t.name&&(t.place||t.natural==='peak')){
      data.labels.push({name:t.name,lat:el.lat,lon:el.lon,place:t.place,kind:t.place?'place':'peak'});continue;
    }
    const coast=(!stage||stage==='areas'||stage==='water') && t.natural==='coastline';
    const road=(!stage||stage==='roads') && t.highway;
    const river=(!stage||stage==='rivers') && ['river','stream','canal'].includes(t.waterway);
    if (!coast && !road && !river) continue;
    const lines=el.type==='way'?[el.geometry]:el.type==='relation' && road && Array.isArray(el.members)?el.members.map(m=>m?.geometry):[];
    for(const line of lines){
      if(!Array.isArray(line))continue;
      let points=[];
      const finish=()=>{
        if(points.length>=2){
          if(coast)coasts.push(points);
          else if(road)data.roadLines.push(roadRecord(points,t.highway));
          else data.waterLines.push(points);
        }
        points=[];
      };
      // Missing OSM nodes separate segments. Joining their neighbors would
      // draw a road or river across an area for which we have no geometry.
      for(const p of line){
        if(Number.isFinite(p?.lat)&&Number.isFinite(p.lon))points.push(project(p.lat,p.lon));
        else finish();
      }
      finish();
    }
  }
  if(coasts.length){
    const geometry=createGeometry(state),clip=geometry.getClipPolygon();
    data.waterAreas.push(...coastlineAreas(joinCoastlines(coasts).flatMap(line=>geometry.clipPolylineToPolygon(line,clip)),clip));
  }
  data.labels=data.labels.slice(0,36);return data;
}
