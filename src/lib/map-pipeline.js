import {batchProgress} from './operation-status.js';
import {emptyMapData,buildOverpassQuery,parseMapStage} from './map-parser.js';
import {MAP_PROVIDERS,requestMapData,isCompleteMapResponse} from './map-service.js';
import {mapFailure} from './data-budget.js';
import {cachedBytes,cacheBytes} from './data-cache.js';
import {createMapTileSession,loadMapTiles} from './map-tiles.js';
import {detailPlan} from './area-plan.js';
import {selectionPolicy} from './selection-policy.js';
import {limitCityFootprints} from './buildings.js';
import {applyMapPointBudget,countMapPoints} from './map-lod.js';
import {loadCityTiles,vectorTilePlan,cityBuildingPlan} from './city-tiles.js';
import {requestedStages,filterSelectedLayers,selectedLayers,incompleteMapLayers} from './layer-selection.js';

export async function loadMapLayers(state,{deadline=Date.now()+270000,endpoints,progress=()=>{},request=requestMapData,cityLoader=loadCityTiles,previous=null}={}){
  let data=previous?.data??emptyMapData(),points=previous?.status.pointStats??null;
  const completed=[...(previous?.status.completed??[])];
  const initialCount=completed.length;
  const errors=[],timings=[],budget={bytes:0,maxBytes:24*1024*1024};
  const policy=selectionPolicy(state.renderBbox,state.outputMode);
  const sourceCity=state.cityOverview;
  let city=null,buildingTiles=0,coverage=previous?.status.buildingCoverage??null;
  const requested=selectedLayers(state);
  const requestedGroups=requestedStages(state);
  if(previous){
    const pending=new Set(incompleteMapLayers(previous.status,requested));
    const remaining={...requested};
    for(const key of ['water','green','labels','roads','rivers','buildings'])remaining[key]=pending.has(key);
    state={...state,loadLayers:remaining};
  }
  const selected=selectedLayers(state);
  const labels={water:'water areas',green:'green areas',labels:'place names',areas:[selected.water?'water areas':'',selected.green?'green areas':'',selected.labels?'place names':''].filter(Boolean).join(', '),rivers:'rivers',roads:'roads',buildings:'buildings'};
  let stages=requestedStages(state);
  const individual=stages.flatMap(stage=>stage==='areas'?['water','green','labels'].filter(layer=>selected[layer]):[stage]);
  let tileError=null;
  const sources=new Set((initialCount||coverage) && previous.status.source ? previous.status.source.split(' + ') : []);
  const started=performance.now();
  const status=()=>({loaded:!stages.length||completed.length>0||!!coverage,buildingCoverage:coverage,error:errors.join(' ')||null,completed:[...completed],requested:previous?requestedGroups:stages,tiles:buildingTiles+(city?.tiles||0)+(previous?.status.tiles||0),pointStats:points,source:[...sources].join(' + ')||(!stages.length?'No map layers requested':'OpenStreetMap / Overpass'),bytes:budget.bytes,timings:[...timings]});
  const publish=(stage,detail)=>progress({phase:'map',title:'Loading '+labels[stage],detail});
  function tileReporter(title){
    let last;
    return {
      onTileProgress(p){last=p;},
      progress(detail){
        progress({phase:'map',title,detail,...(last?batchProgress(last.done,last.total,last.elapsedMs):{})});
      }
    };
  }
  const bounds=state.renderBbox;
  const perimeter=detailPlan(bounds,state.wMm,state.hMm,state.cityOverview).minPerimeter;
  function queryFor(stage,{sw,ne}) {
    return buildOverpassQuery(state,[sw.lat,sw.lng,ne.lat,ne.lng].join(','),perimeter,stage);
  }
  const cacheKey=query=>'osm-v2:'+JSON.stringify(endpoints)+':'+query;
  async function loadQuery(query,signal,report,options={}) {
    const key=cacheKey(query),cached=await cachedBytes(key);
    if(cached){
      let data;
      try{data=JSON.parse(new TextDecoder().decode(cached));}catch{ /* Retry the source below. */ }
      if(isCompleteMapResponse(data)){report('Reusing saved map details');return data;}
      report('Saved map details are incomplete · downloading a fresh copy');
    }
    if(budget.bytes>=budget.maxBytes)throw new Error('Map download budget reached');
    let responseBytes;
    const result=await request(query,{signal,endpoints,budget,...options,
      onBytes:bytes=>{responseBytes=bytes;},progress:report});
    void cacheBytes(key,responseBytes ?? new TextEncoder().encode(JSON.stringify(result)));
    return result;
  }
  async function fetchStage(stage,signal){
    const load=extent=>loadQuery(queryFor(stage,extent),signal,detail=>publish(stage,detail));
    try{return (await load(bounds)).elements;}
    catch(error){
      if(mapFailure(error)!=='size'||signal.aborted||budget.bytes>=budget.maxBytes)throw error;
      const session=createMapTileSession(bounds,{tileAreaKm2:state.cityOverview?36:9,minSide:2});
      if(session.total>16)throw new Error('This stage needs too many detailed requests. Use city overview or a smaller area.');
      return loadMapTiles(session,{signal,request:load,progress:p=>publish(stage,`Fallback: ${p.done}/${p.total} sections`)});
    }
  }
  const stageSignal=()=>AbortSignal.timeout(Math.max(1,Math.min(100000,deadline-Date.now())));
  const publicPool=(endpoints||MAP_PROVIDERS).every(endpoint=>MAP_PROVIDERS.includes(endpoint));
  const autoTiles=publicPool && !state.rawMapDetail;
  const needNative=!sourceCity || selected.buildings || (selected.minorRoads && selected.roads);
  const native=autoTiles && stages.length>0 && needNative &&
    vectorTilePlan(bounds,{maxZoom:14,native:true}).z===14;
  let neighborhoodTiles=false;
  // Read all requested geographic layers from the same static tiles when full
  // source zoom fits. Large selections retain the smaller overview tile plan.
  const needsDetailedRoads=selected.roads && selected.minorRoads;
  const overviewStages=stages.filter(stage=>stage!=='buildings' && !(stage==='roads' && needsDetailedRoads));
  if (Date.now()<deadline && autoTiles && (native || overviewStages.length)) {
    const tileStart=performance.now();
    const signal=stageSignal();
    const overviewState={...state,loadLayers:{...selected,roads:selected.roads && !needsDetailedRoads,buildings:false}};
    const loadTiles=neighborhood=>cityLoader(neighborhood?state:overviewState,{
      signal,budget,neighborhood,...tileReporter(neighborhood?'Map detail tiles':'City overview tiles')
    });
    try {
      try {
        city=await loadTiles(native);
        neighborhoodTiles=native;
      }catch(error){
        if(!native || !overviewStages.length || mapFailure(error)!=='size' || budget.bytes>=budget.maxBytes || signal.aborted)throw error;
        publish(stages[0],'Full detail exceeds the budget · loading lower-resolution map layers');
        city=await loadTiles(false);
      }
      timings.push({stage:'vector tiles',ms:Math.round(performance.now()-tileStart)});
    } catch(error) {
      timings.push({stage:'vector tiles',ms:Math.round(performance.now()-tileStart),failed:true});
      tileError=error.message;
      publish(stages[0],'Tile source unavailable · switching to map mirrors: '+error.message);
    }
  }

  // Combine small Overpass selections only when no individual stage is cached.
  let neighborhood=null;
  if (!city && !sourceCity && policy.km2<=1 && stages.length>=3 && Date.now()<deadline) {
    const hits=await Promise.all(individual.map(stage=>cachedBytes(cacheKey(queryFor(stage,bounds)))));
    if (!hits.some(Boolean)) {
      const report=detail=>progress({phase:'map',title:'Loading neighborhood details',detail});
      const signal=AbortSignal.timeout(Math.max(1,Math.min(20000,deadline-Date.now())));
      const queryStart=performance.now();
      try {
        neighborhood=await loadQuery(queryFor(stages,bounds),signal,report,{firstResponseMs:6000});
      } catch(error) {
        report(`Combined query unavailable: ${signal.aborted?'time limit reached':error.message}. Trying individual layers.`);
      } finally {
        timings.push({stage:'combined query',ms:Math.round(performance.now()-queryStart),failed:!neighborhood});
      }
    }
  }

  // When the shared sources fail, keep expensive water relations independent of
  // small labels and green areas. Successful individual queries are reusable.
  if(!city && !neighborhood)stages=individual;

  async function loadStage(stage) {
    const signal=stageSignal(), stageStart=performance.now();
    let buildingTileError;
    try {
      let incoming;
      let source='OpenStreetMap / Overpass';
      if (neighborhood) {
        incoming=parseMapStage(neighborhood.elements,state,stage);
      } else if (city && (neighborhoodTiles || overviewStages.includes(stage))) {
        source=city.source;
        incoming=emptyMapData();
        const keys=stage==='buildings'?['buildings']:stage==='areas'?['waterAreas','greenAreas','labels']:stage==='rivers'?['waterLines']:['roadLines'];
        for (const key of keys) incoming[key]=city.data[key];
      } else {
        if(stage==='buildings' && autoTiles && (!native||sourceCity) && budget.bytes<budget.maxBytes && cityBuildingPlan(bounds)){
          try{
            const buildings=await cityLoader(state,{signal,budget,cityBuildings:true,continuation:coverage,...tileReporter('City building tiles')});
            return {incoming:{buildings:buildings.data.buildings},tileCount:buildings.tiles,nextCoverage:buildings.coverage,source:buildings.source,stageStart};
          }catch(error){
            if(coverage || signal.aborted || budget.bytes>=budget.maxBytes)throw error;
            buildingTileError=error.message;
            publish(stage,'Building tiles unavailable · trying filtered OpenStreetMap footprints: '+error.message);
          }
        }
        publish(stage,'Requesting selected details');
        const elements=await fetchStage(stage,signal);
        publish(stage,'Preparing '+labels[stage]);
        incoming=parseMapStage(elements,state,stage);
      }
      return {incoming:filterSelectedLayers(incoming,state),source,stageStart};
    } catch(error) {
      const message=signal.aborted?'stage time limit reached':error.message;
      return {error:new Error([buildingTileError,message].filter(Boolean).join(' · ')),stageStart};
    }
  }

  // Bound both simultaneous requests and completed layers waiting for an earlier one.
  const pending=new Map();
  let next=0;
  for (const stage of stages) {
    while (pending.size<2 && next<stages.length && Date.now()<deadline) {
      const name=stages[next++];
      pending.set(name,loadStage(name));
    }
    if (!pending.has(stage)) {
      errors.push('Remaining details skipped at the time or download budget.');
      break;
    }
    const {incoming,error,source,tileCount=0,nextCoverage,stageStart}=await pending.get(stage);
    pending.delete(stage);
    try {
      if (error) throw error;
      const candidate=emptyMapData();
      for(const key of Object.keys(candidate))candidate[key]=data[key].concat(incoming[key]||[]);
      if(tileCount){
        const base={...data,buildings:[]};
        const pool=nextCoverage?.start ? candidate.buildings : incoming.buildings;
        candidate.buildings=limitCityFootprints(pool,policy.maxMapPoints-countMapPoints(base));
      }
      const ranks={city:1,town:2,village:3,suburb:4,neighbourhood:5,hamlet:6};
      candidate.labels=Array.from(new Map(candidate.labels.map(label=>[label.name+':'+label.lat+':'+label.lon,label])).values()).sort((a,b)=>(ranks[a.place]||9)-(ranks[b.place]||9)).slice(0,36);
      publish(stage,'Simplifying '+labels[stage]+' · checking the combined data budget');
      const bounded=applyMapPointBudget(candidate,{maxPoints:policy.maxMapPoints,minBuildingArea:state.mapFeatures.buildings.minArea,maxBuildings:2500});
      data=bounded.data;points=bounded.stats;sources.add(source);buildingTiles+=tileCount;
      if(stage==='buildings')coverage=nextCoverage?.done<nextCoverage?.total?nextCoverage:null;
      if(stage==='buildings' && coverage){
        errors.push(`Buildings cover ${coverage.done}/${coverage.total} tiles. Load more building tiles to extend coverage.`);
      }else completed.push(stage);
      timings.push({stage,ms:Math.round(performance.now()-stageStart)});
      progress({snapshot:{data,status:status()},phase:'map',title:labels[stage]+' ready',detail:`${points.points.toLocaleString()} retained points · ${(budget.bytes/1048576).toFixed(1)} MB downloaded`});
    }catch(error){
      errors.push(`${labels[stage]}: ${error.message}.`);
      timings.push({stage,ms:Math.round(performance.now()-stageStart),failed:true});
    }
  }
  if(errors.length && tileError)errors.push('Vector tile sources: '+tileError+'.');
  return {data,status:{...status(),durationMs:Math.round(performance.now()-started)}};
}
