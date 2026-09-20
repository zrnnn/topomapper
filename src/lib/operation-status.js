const clean = value => String(value || '').replace(/\s+/g,' ').trim().slice(0,240);

export function describeError(error, context='operation') {
  const raw=clean(error?.message || error), lower=raw.toLowerCase();
  if(error?.name==='AbortError'||/cancelled|aborted/.test(lower)) return {kind:'cancelled',title:'Cancelled',message:'The operation was stopped. Your last successful result is still available.',action:'Start it again when you are ready.',technical:raw};
  if(/map overlays are unavailable/.test(lower)) return {kind:'network',title:'Map layers are not loaded yet',message:'Terrain is available, but the selected map layers could not be downloaded. No incomplete model was exported.',action:'Use Retry map layers, or choose Terrain study for an explicitly terrain-only model.',technical:raw};
  if(/429|406|quota|rate.?limit|limit exceeded|maxsize/.test(lower)) return {kind:'limit',title:'The map service limit was reached',message:'The provider refused this amount of detail or is temporarily rate-limiting requests. Layers loaded before the error remain available.',action:'Wait and retry, select a smaller area, disable dense layers, or configure another Overpass endpoint in Advanced.',technical:raw};
  if(/timed out|timeout|took too long/.test(lower)) return {kind:'timeout',title:'This took too long',message:'The browser stopped the operation before it could finish. No partial result was used.',action:context==='model'?'Choose Draft or Balanced quality, disable a dense layer, or select a smaller area.':'Select a smaller area and retry. Check your connection if the area is already small.',technical:raw};
  if(/network|fetch|http|service|elevation|overpass|map data|terrain coverage|offline/.test(lower)) return {kind:'network',title:context==='area'?'Map data could not be loaded':'A data service did not respond',message:'The selected data source was unavailable or returned incomplete data. Your last successful result was preserved.',action:'Check your connection, retry, or choose a smaller area.',technical:raw};
  if(/memory|allocation|too large|exceeds|over 3,000|150,000|40,000/.test(lower)) return {kind:'size',title:'The selection is too detailed',message:'This request exceeds the safe browser processing limit. No partial result was used.',action:'Select a smaller area, lower mesh quality, or disable dense buildings and streets.',technical:raw};
  if(/check \w+|use a value between|invalid setting/.test(lower)) return {kind:'settings',title:'Check the model settings',message:'One setting is outside the supported range. The previous model is unchanged.',action:'Correct the value named in the technical details, then update the model again.',technical:raw};
  if(/mesh|solid|fusion|geometry|manifold|building/.test(lower)) return {kind:'geometry',title:'The printable model could not be completed',message:'One or more selected layers could not be fused into a valid closed model. The previous model is unchanged.',action:'Lower mesh quality or disable one layer at a time to identify problematic geometry.',technical:raw};
  if(context==='export'||/png|svg|dxf|3mf|stl|obj|encoding|render/.test(lower)) return {kind:'export',title:'Export failed',message:'The file could not be prepared or saved. Your design and preview are unchanged.',action:'Retry once. For PNG, lower the resolution; for 3D, rebuild at a lower mesh quality.',technical:raw};
  return {kind:'unknown',title:'Something went wrong',message:'The operation did not finish, but your last successful result was preserved.',action:'Retry. If it happens again, reduce the area or detail and note the technical message below.',technical:raw||'No technical details were provided.'};
}

export function terrainProgress(value) {
  if(typeof value==='object'&&value) return value;
  const text=clean(value), match=text.match(/(\d+)\s*\/\s*(\d+)/);
  const fallback=/fallback/i.test(text);
  return {phase:'terrain',detail:text||'Loading elevation data',percent:match?Math.round((fallback?35:8)+(Number(match[1])/Number(match[2]))*(fallback?25:47)):(fallback?34:10)};
}
