import {emptyMapData,buildOverpassQuery,parseMapStage} from './map-parser.js';
import {requestMapData} from './map-service.js';
import {mapFailure} from './data-budget.js';
import {cachedBytes,cacheBytes} from './data-cache.js';
import {createMapTileSession,loadMapTiles} from './map-tiles.js';
import {detailPlan} from './area-plan.js';
import {selectionPolicy} from './selection-policy.js';
import {applyMapPointBudget} from './map-lod.js';
import {loadCityTiles} from './city-tiles.js';
import {requestedStages,filterSelectedLayers,selectedLayers} from './layer-selection.js';

export async function loadMapLayers(state,{deadline=Date.now()+270000,endpoints,progress=()=>{},request=requestMapData,cityLoader=loadCityTiles}={}){
  let data=emptyMapData(),points=null;
  const errors=[],completed=[],timings=[],budget={bytes:0,maxBytes:24*1024*1024};
  const policy=selectionPolicy(state.renderBbox,state.outputMode);
  const sourceCity=state.cityOverview;
  let city=null,cityError=null;
  const selected=selectedLayers(state);
  const labels={areas:[selected.water?'water areas':'',selected.green?'green areas':'',selected.labels?'place names':''].filter(Boolean).join(', '),rivers:'rivers',roads:'roads',buildings:'buildings'};
  const stages=requestedStages(state);
  const started=performance.now();
  const status=()=>({loaded:!stages.length||completed.length>0,error:errors.join(' ')||null,completed:[...completed],requested:stages,tiles:city?.tiles||0,pointStats:points,source:!stages.length?'No map layers requested':city?.source||'OpenStreetMap / Overpass',bytes:budget.bytes,timings:[...timings]});
  const publish=(stage,detail)=>progress({phase:'map',percent:62+Math.round(completed.length/stages.length*28),title:'Loading '+labels[stage],detail});
  async function fetchStage(stage,signal){
    const {sw,ne}=state.renderBbox,perimeter=detailPlan(state.renderBbox,state.wMm,state.hMm,state.cityOverview).minPerimeter;
    const load=async bounds=>{
      const bbox=[bounds.sw.lat,bounds.sw.lng,bounds.ne.lat,bounds.ne.lng].join(',');
      const query=buildOverpassQuery(state,bbox,perimeter,stage),cacheKey='osm-v2:'+JSON.stringify(endpoints)+':'+query;
      const cached=await cachedBytes(cacheKey);
      if(cached){publish(stage,'Reusing saved '+labels[stage]);return JSON.parse(new TextDecoder().decode(cached));}
      const result=await request(query,{signal,endpoints,budget,progress:detail=>publish(stage,detail)});
      const bytes=new TextEncoder().encode(JSON.stringify(result));
      await cacheBytes(cacheKey,bytes);return result;
    };
    try{return (await load({sw,ne})).elements;}
    catch(error){
      if(mapFailure(error)!=='size'||signal.aborted||budget.bytes>=budget.maxBytes)throw error;
      const session=createMapTileSession({sw,ne},{tileAreaKm2:state.cityOverview?36:9});
      if(session.total>16)throw new Error('This stage needs too many detailed requests. Use city overview or a smaller area.');
      return loadMapTiles(session,{signal,request:load,progress:p=>publish(stage,`Fallback: ${p.done}/${p.total} sections`)});
    }
  }
  for(const stage of stages){
    if(Date.now()>=deadline||budget.bytes>=budget.maxBytes){errors.push('Remaining details skipped at the time or download budget.');break;}
    const stageStart=performance.now();
    const signal=AbortSignal.timeout(Math.max(1,Math.min(100000,deadline-Date.now())));
    publish(stage,'Completed layers remain available.');
    try{
      let incoming;
      // The city tile download contains areas, rivers and roads together. Publish
      // its validated layers in the same order as the detailed source.
      if(sourceCity&&stage!=='buildings'){
        if(!city&&!cityError){
          try{city=await cityLoader(state,{signal,budget,progress:detail=>publish(stage,detail)});}
          catch(error){cityError=error;errors.push('City tiles unavailable: '+error.message);}
        }
        if(city){
          incoming=emptyMapData();
          for(const key of stage==='areas'?['waterAreas','greenAreas','labels']:stage==='rivers'?['waterLines']:['roadLines'])incoming[key]=city.data[key];
          // Experimental minor streets require the detailed source.
          if(stage==='roads'&&state.includeMinorRoads&&!policy.minorRoadsRecommended)incoming=parseMapStage(await fetchStage(stage,signal),state);
        }
      }
      if(!incoming){const elements=await fetchStage(stage,signal);publish(stage,'Generating '+labels[stage]+' · clipping downloaded geometry');incoming=parseMapStage(elements,state);}
      incoming=filterSelectedLayers(incoming,state);
      const candidate=emptyMapData();
      for(const key of Object.keys(candidate))candidate[key]=data[key].concat(incoming[key]||[]);
      const ranks={city:1,town:2,village:3,suburb:4,neighbourhood:5,hamlet:6};
      candidate.labels=Array.from(new Map(candidate.labels.map(label=>[label.name+':'+label.lat+':'+label.lon,label])).values()).sort((a,b)=>(ranks[a.place]||9)-(ranks[b.place]||9)).slice(0,36);
      publish(stage,'Simplifying '+labels[stage]+' · checking the combined data budget');
      const bounded=applyMapPointBudget(candidate,{maxPoints:policy.maxMapPoints,minBuildingArea:state.mapFeatures.buildings.minArea,maxBuildings:2500});
      data=bounded.data;points=bounded.stats;completed.push(stage);
      timings.push({stage,ms:Math.round(performance.now()-stageStart)});
      progress({snapshot:{data,status:status()},phase:'map',percent:62+Math.round(completed.length/stages.length*28),title:labels[stage]+' ready',detail:`${points.points.toLocaleString()} retained points · ${(budget.bytes/1048576).toFixed(1)} MB downloaded`});
    }catch(error){
      errors.push(`${labels[stage]}: ${signal.aborted?'stage time limit reached':error.message}.`);
      timings.push({stage,ms:Math.round(performance.now()-stageStart),failed:true});
    }
  }
  return {data,status:{...status(),durationMs:Math.round(performance.now()-started)}};
}
