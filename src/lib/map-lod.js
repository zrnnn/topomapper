import {simplifyPolyline} from './geometry.js';
import {prepareBuildingLod} from './buildings.js';
import {roadPoints} from './road-style.js';

const linePoints=data=>['roadLines','waterLines'].reduce((sum,key)=>sum+(data[key]||[]).reduce((n,line)=>n+roadPoints(line).length,0),0);
const recordPoints=record=>record.polygons.reduce((sum,polygon)=>sum+polygon.reduce((n,ring)=>n+ring.length,0),0);
const areaPoints=data=>['waterAreas','greenAreas'].reduce((sum,key)=>sum+(data[key]||[]).reduce((n,record)=>n+recordPoints(record),0),0);
export const countMapPoints=data=>(data.buildings||[]).reduce((n,b)=>n+recordPoints(b),0)+linePoints(data)+areaPoints(data);

const simplifyRing=(ring,tolerance)=>{
  const closed=ring.length>3&&Math.hypot(ring[0][0]-ring.at(-1)[0],ring[0][1]-ring.at(-1)[1])<1e-6;
  const points=closed?ring.slice(0,-1):ring;
  const simple=simplifyPolyline(points,tolerance);
  return closed&&simple.length>=3?[...simple,simple[0]]:simple;
};
const simplifyData=(data,tolerance,minBuildingArea,maxBuildings)=>{
  const buildings=prepareBuildingLod(data.buildings,{minArea:minBuildingArea,tolerance,maxBuildings}).buildings;
  const result={...data,buildings};
  for(const key of ['roadLines','waterLines'])result[key]=(data[key]||[]).map(line=>{
    const points=simplifyPolyline(roadPoints(line),tolerance);
    return Array.isArray(line)?points:{...line,points};
  }).filter(line=>roadPoints(line).length>=2);
  for(const key of ['waterAreas','greenAreas'])result[key]=(data[key]||[]).map(record=>({...record,polygons:record.polygons.flatMap(polygon=>{
    const outer=simplifyRing(polygon[0],tolerance);
    // A surviving hole must never become an exterior ring when its exterior
    // collapses at a coarser detail level.
    return outer.length<4?[]:[[outer,...polygon.slice(1).map(ring=>simplifyRing(ring,tolerance)).filter(ring=>ring.length>=4)]];
  })})).filter(record=>record.polygons.length);
  return result;
};

export function applyMapPointBudget(data,{maxPoints=80000,minBuildingArea=1.5,maxBuildings=2500}={}) {
  const originalPoints=countMapPoints(data);
  let result=data,tolerance=.04;
  while(tolerance<=1.28){result=simplifyData(data,tolerance,minBuildingArea,maxBuildings);if(countMapPoints(result)<=maxPoints)break;tolerance*=2;}
  const points=countMapPoints(result);
  if(points>maxPoints)throw new Error(`Map geometry exceeds the ${maxPoints.toLocaleString()} point display budget. Use city overview or select a smaller area.`);
  return {data:result,stats:{originalPoints,points,tolerance}};
}
