import {selectionPolicy} from './selection-policy.js';

export const LAYER_CHOICES=[
  ['terrain','Terrain relief','Elevation, shading and contour lines'],
  ['water','Water areas','Lakes, reservoirs and coastlines'],
  ['green','Green areas','Forests, parks and grassland'],
  ['rivers','Rivers','Rivers, streams and canals'],
  ['roads','Roads','Major roads and connecting streets'],
  ['minorRoads','Smaller streets','Residential and service roads'],
  ['buildings','Buildings','Footprints and raised 3D buildings'],
  ['labels','Place names','Cities, towns and peaks (2D only)']
];
export function selectedLayers(state){
  return {terrain:true,water:true,green:true,rivers:true,roads:true,labels:true,
    buildings:state.includeBuildings!==false,minorRoads:state.includeMinorRoads!==false,...state.loadLayers};
}
export function requestedStages(state){
  const layers=selectedLayers(state);
  return [...(layers.water||layers.green||layers.labels?['areas']:[]),
    ...(layers.rivers?['rivers']:[]),...(layers.roads?['roads']:[]),...(layers.buildings?['buildings']:[])];
}
export function filterSelectedLayers(data,state){
  const layers=selectedLayers(state),keys={waterAreas:'water',greenAreas:'green',waterLines:'rivers',roadLines:'roads',buildings:'buildings',labels:'labels'};
  return Object.fromEntries(Object.entries(keys).map(([key,layer])=>[key,layers[layer]?(data[key]||[]):[]]));
}
export function layerWarning(bounds,mode,layers){
  const policy=selectionPolicy(bounds,mode),heavy=[];
  if(layers.buildings&&!policy.buildingsRecommended)heavy.push('buildings');
  if(layers.roads&&layers.minorRoads&&!policy.minorRoadsRecommended)heavy.push('smaller streets');
  if(!heavy.length&&!policy.overviewRecommended)return '';
  return `${policy.km2.toFixed(1)} km² selected. ${heavy.length?`Loading ${heavy.join(' and ')} over this area can be very slow or exhaust browser memory. `:''}Detail is adjusted automatically. Loading can take up to 5 minutes and may time out; download and geometry limits still apply. Turn off unneeded layers to reduce the load.`;
}
