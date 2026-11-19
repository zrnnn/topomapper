const clean = value => String(value || '').replace(/\s+/g,' ').trim().slice(0,240);

export function describeError(error, context='operation') {
  const raw=clean(error?.message || error), lower=raw.toLowerCase();
  if(error?.name==='AbortError'||/cancelled|aborted/.test(lower)) return {kind:'cancelled',title:'Cancelled',message:'The operation was stopped. Your last successful result is still available.',action:'Start it again when you are ready.',technical:raw};
  if(/^check |use a value between|invalid setting/.test(lower))return {kind:'settings',title:'Check the model settings',message:raw,action:'Change the indicated field in 3D settings and prepare the model again.',technical:raw};
  if(/png (encoding|rendering)/.test(lower))return {kind:'export',title:'PNG could not be saved',message:raw,action:'Choose a smaller PNG size in Export, or download the editable SVG.',technical:raw};
  if(/401|403/.test(lower))return {kind:'access',title:'The provider denied access',message:raw,action:'Check the personal API key in Frame & Dimensions or switch to the public services and retry.',technical:raw};
  if(/429|406|quota|rate.?limit/.test(lower))return {kind:'limit',title:'Provider request limit reached',message:raw,action:'Wait and retry missing layers, or choose another Overpass endpoint in Frame & Dimensions. Loaded layers are available for export.',technical:raw};
  if(/memory|allocation|too large|exceeds|budget|over 3,000|150,000|40,000|maxsize/.test(lower))return {kind:'size',title:'Selection exceeds the detail budget',message:raw,action:'Turn off smaller streets or buildings, or frame a smaller area and reload.',technical:raw};
  if(/timed out|timeout|time limit|took too long|stalled/.test(lower))return {kind:'timeout',title:context==='model'?'Model preparation timed out':'Loading timed out',message:raw,action:context==='model'?'Choose Draft or Balanced mesh quality, then prepare again.':'Retry the missing layers. For elevation failures, turn off Terrain relief to continue on a flat base.',technical:raw};
  if(/network|fetch|http|service|elevation|overpass|map data|terrain coverage|offline/.test(lower))return {kind:'network',title:/elevation|terrain coverage/.test(lower)?'Elevation could not be loaded':'Map service unavailable',message:raw,action:/elevation|terrain coverage/.test(lower)?'Retry elevation or choose layers and turn off Terrain relief for a flat base.':'Check your connection and retry missing layers. You can export the data already loaded.',technical:raw};
  if(/mesh|solid|fusion|geometry|manifold|building/.test(lower)) return {kind:'geometry',title:'The printable model could not be completed',message:'One or more selected layers could not be fused into a valid closed model. The previous model is unchanged.',action:'Lower mesh quality or disable one layer at a time to identify problematic geometry.',technical:raw};
  if(context==='export'||/png|svg|dxf|3mf|stl|obj|encoding|render/.test(lower)) return {kind:'export',title:'Export failed',message:'The file could not be prepared or saved. Your design and preview are unchanged.',action:'Retry once. For PNG, lower the resolution; for 3D, rebuild at a lower mesh quality.',technical:raw};
  return {kind:'unknown',title:'Something went wrong',message:'The operation did not finish, but your last successful result was preserved.',action:'Retry. If it happens again, reduce the area or detail and note the technical message below.',technical:raw||'No technical details were provided.'};
}

export function batchProgress(done,total,elapsedMs){
  if(!(total>0))return {percent:null,etaSeconds:null};
  return {
    percent:Math.min(100,Math.floor(100*done/total)),
    etaSeconds:done>=2 && done<total && elapsedMs>=500 ?
      Math.ceil(elapsedMs*(total-done)/done/1000):null
  };
}

export function terrainProgress(value) {
  if(typeof value==='object'&&value) return value;
  const text=clean(value);
  return {phase:'terrain',detail:text||'Loading elevation data'};
}
