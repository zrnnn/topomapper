// These global services accept a personal key in one documented path segment.
export const keyedProviders=[
  ['NextGIS','https://overpass.nextgis.com/{key}/api/interpreter'],
  ['FairwayMapper','https://api.fairwaymapper.com/k/{key}/api/interpreter'],
  ['Geofabrik','https://overpass.geofabrik.de/{key}/api/interpreter'],
  ['Tracestrack','https://api.tracestrack.com/overpass/{key}/interpreter'],
  ['Overspan','https://api.overspan.dev/{key}/api/interpreter'],
  ['Mapsource','https://api.mapsource.io/{key}/interpreter'],
  ['Overpass.ch','https://api.overpass.ch/v1/{key}/interpreter']
];

export function personalEndpoint(provider,value) {
  const template=keyedProviders.find(([name])=>name===provider)?.[1];
  const key=value.trim();
  if(!template || !key || key==='.' || key==='..')return null;
  return template.replace('{key}',()=>encodeURIComponent(key));
}

// Conservative interior windows within each extract. At edges use global data,
// since a successful empty regional query cannot indicate missing coverage.
const windows=[
  [43,-5,55,26,'api'],[55,6,63,25,'api'],[50,-10,59,2,'api'],
  [27,-124,49,-66,'api-na'],[49,-130,60,-60,'api-na']
];
export function regionalEndpoint({sw,ne}) {
  const window=windows.find(([s,w,n,e])=>sw.lat>=s && sw.lng>=w && ne.lat<=n && ne.lng<=e);
  return window?'https://ovp.dresel.systems/'+window[4]+'/interpreter':null;
}
