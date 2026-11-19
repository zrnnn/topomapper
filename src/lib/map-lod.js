import {ringBounds,simplifyPolyline} from './geometry.js';
import {prepareBuildingLod,limitCityFootprints} from './buildings.js';
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
const spans=(ring,minSize,both)=>{
  if(!minSize)return true;
  const {minX,minY,maxX,maxY}=ringBounds(ring);
  return (both?Math.min:Math.max)(maxX-minX,maxY-minY)>=minSize;
};
const simplifyData=(data,tolerance,minBuildingArea,maxBuildings,minSize)=>{
  const buildings=prepareBuildingLod(data.buildings,{minArea:minBuildingArea,minDimension:minSize,tolerance,maxBuildings}).buildings;
  const result={...data,buildings};
  for(const key of ['roadLines','waterLines'])result[key]=(data[key]||[]).map(line=>{
    const points=simplifyPolyline(roadPoints(line),tolerance);
    return Array.isArray(line)?points:{...line,points};
  }).filter(line=>roadPoints(line).length>=2 && spans(roadPoints(line),minSize,false));
  for(const key of ['waterAreas','greenAreas'])result[key]=(data[key]||[]).map(record=>({...record,polygons:record.polygons.flatMap(polygon=>{
    const outer=simplifyRing(polygon[0],tolerance);
    // A surviving hole must never become an exterior ring when its exterior
    // collapses at a coarser detail level.
    return outer.length<4||!spans(outer,minSize,true)?[]:[[outer,...polygon.slice(1).map(ring=>simplifyRing(ring,tolerance)).filter(ring=>ring.length>=4 && spans(ring,minSize,true))]];
  })})).filter(record=>record.polygons.length);
  return result;
};

export function applyMapPointBudget(data,{maxPoints=80000,minBuildingArea=1.5,maxBuildings=2500,fitBuildings=false,minSize=0}={}) {
  const originalPoints=countMapPoints(data);
  let result=data,tolerance=Math.max(.04,minSize/2);
  for(;;){
    result=simplifyData(data,tolerance,minBuildingArea,maxBuildings,minSize);
    if(countMapPoints(result)<=maxPoints || tolerance>=1.28)break;
    tolerance=Math.min(1.28,tolerance*2);
  }
  let omittedForBudget=0;
  if(fitBuildings && countMapPoints(result)>maxPoints){
    const available=maxPoints-areaPoints(result)-linePoints(result);
    const buildings=limitCityFootprints(result.buildings,available,maxBuildings);
    omittedForBudget=result.buildings.length-buildings.length;
    result={...result,buildings};
  }
  const points=countMapPoints(result);
  if(points>maxPoints)throw new Error(`Map geometry exceeds the ${maxPoints.toLocaleString()} point display budget. Use city overview or select a smaller area.`);
  return {data:result,stats:{originalPoints,points,tolerance,omittedForBudget}};
}
