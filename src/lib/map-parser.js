import {parseBuildings,parseAreas,coastlineAreas,joinCoastlines} from './buildings.js';
import {latitudeY} from './terrain.js';
import {createGeometry} from './geometry.js';
import {roadRecord} from './road-style.js';
import {MAP_QUERY_TIMEOUT_SECONDS} from './map-service.js';
import {selectedLayers} from './layer-selection.js';
    export const buildOverpassQuery = (state,bbox,buildingPerimeter,stage) => {
      const layers=selectedLayers(state);
      const statements={
        areas:`way["natural"="water"](${bbox});way["natural"~"bay|coastline"](${bbox});way["water"~"lake|reservoir|pond|basin|lagoon|sea|ocean"](${bbox});way["landuse"~"reservoir|basin"](${bbox});way["waterway"="riverbank"](${bbox});relation["natural"="water"](${bbox});relation["natural"="bay"](${bbox});relation["water"~"lake|reservoir|pond|basin|lagoon|sea|ocean"](${bbox});relation["landuse"~"reservoir|basin"](${bbox});relation["waterway"="riverbank"](${bbox});${`way["landuse"~"forest|grass|meadow|recreation_ground"](${bbox});way["leisure"~"park|garden"](${bbox});way["natural"~"wood|grassland"](${bbox});relation["landuse"~"forest|grass|meadow|recreation_ground"](${bbox});relation["leisure"~"park|garden"](${bbox});relation["natural"~"wood|grassland"](${bbox});`}node["place"~"city|town|village|suburb|hamlet|neighbourhood"](${bbox});node["natural"="peak"]["name"](${bbox});`,
        rivers:`way["waterway"~"river|stream|canal"](${bbox});`,
        roads:`way["highway"~"${layers.minorRoads?'motorway|trunk|primary|secondary|tertiary|residential|unclassified|service':'motorway|trunk|primary|secondary|tertiary'}"](${bbox});relation["highway"~"${layers.minorRoads?'motorway|trunk|primary|secondary|tertiary|residential|unclassified|service':'motorway|trunk|primary|secondary|tertiary'}"](${bbox});`,
        buildings:layers.buildings?`way["building"]["building"!="no"](${bbox})${state.cityOverview?`(if:length()>=${buildingPerimeter})`:''};${state.cityOverview?'':`relation["building"]["building"!="no"](${bbox});`}`:''
      };
      // Filter the statements before requesting geometry, not after downloading it.
      if(stage==='areas')statements.areas=statements.areas.split(';').filter(statement=>{
        if(!statement)return false;
        if(statement.startsWith('node'))return layers.labels;
        if(/forest|grass|meadow|recreation_ground|park|garden|wood/.test(statement))return layers.green;
        return layers.water;
      }).join(';')+';';
      if(stage==='rivers'&&!layers.rivers||stage==='roads'&&!layers.roads||stage==='buildings'&&!layers.buildings)statements[stage]='';
      return `[out:json][maxsize:67108864][timeout:${MAP_QUERY_TIMEOUT_SECONDS}];(${statements[stage]||''});out geom;`;
    };


export const emptyMapData=()=>({buildings:[],waterAreas:[],greenAreas:[],waterLines:[],roadLines:[],labels:[]});
export function mapProjection(state){
  const {sw,ne}=state.renderBbox;
  return (lat,lon)=>[(lon-sw.lng)/(ne.lng-sw.lng)*state.wMm,(latitudeY(lat)-latitudeY(ne.lat))/(latitudeY(sw.lat)-latitudeY(ne.lat))*state.hMm];
}
export function parseMapStage(elements,state){
  const data=emptyMapData(),project=mapProjection(state);
  data.buildings=parseBuildings(elements,project);
  const water=t=>t.natural==='water'||t.natural==='bay'||t.waterway==='riverbank'||['sea','ocean','lake','reservoir','pond','basin','lagoon'].includes(t.water)||['reservoir','basin'].includes(t.landuse);
  const green=t=>['forest','grass','meadow','recreation_ground'].includes(t.landuse)||['park','garden'].includes(t.leisure)||['wood','grassland'].includes(t.natural);
  data.waterAreas=parseAreas(elements,project,water);data.greenAreas=parseAreas(elements,project,green);
  const coasts=[],ids=new Set();
  for(const el of elements){
    const key=el.type+'/'+el.id;if(ids.has(key))continue;ids.add(key);
    const t=el.tags||{};
    if(el.type==='node'&&t.name&&(t.place||t.natural==='peak')){
      data.labels.push({name:t.name,lat:el.lat,lon:el.lon,place:t.place,kind:t.place?'place':'peak'});continue;
    }
    const lines=el.type==='way'&&el.geometry?[el.geometry]:el.type==='relation'&&t.highway?(el.members||[]).filter(m=>m.geometry).map(m=>m.geometry):[];
    for(const line of lines){
      const points=line.filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lon)).map(p=>project(p.lat,p.lon));
      if(points.length<2)continue;
      if(t.natural==='coastline')coasts.push(points);
      else if(t.highway)data.roadLines.push(roadRecord(points,t.highway));
      else if(['river','stream','canal'].includes(t.waterway))data.waterLines.push(points);
    }
  }
  if(coasts.length){
    const geometry=createGeometry(state),clip=geometry.getClipPolygon();
    data.waterAreas.push(...coastlineAreas(joinCoastlines(coasts).flatMap(line=>geometry.clipPolylineToPolygon(line,clip)),clip));
  }
  data.labels=data.labels.slice(0,36);return data;
}
