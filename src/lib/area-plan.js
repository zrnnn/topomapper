export function areaPlan(bounds) {
  const {sw,ne}=bounds;
  const km2=Math.abs((ne.lat-sw.lat)*111.32*(ne.lng-sw.lng)*111.32*Math.cos((ne.lat+sw.lat)*Math.PI/360));
  return {km2,large:km2>25,sections:km2>400?16:km2>25?4:1};
}
export function splitArea(bounds,sections) {
  const side=Math.sqrt(sections),result=[];
  for(let y=0;y<side;y++)for(let x=0;x<side;x++)result.push({sw:{lat:bounds.sw.lat+(bounds.ne.lat-bounds.sw.lat)*y/side,lng:bounds.sw.lng+(bounds.ne.lng-bounds.sw.lng)*x/side},ne:{lat:bounds.sw.lat+(bounds.ne.lat-bounds.sw.lat)*(y+1)/side,lng:bounds.sw.lng+(bounds.ne.lng-bounds.sw.lng)*(x+1)/side}});
  return result;
}

export function detailPlan(bounds,width=200,height=140,overview=false) {
  const {km2}=areaPlan(bounds);
  const base=km2<1?256:km2>25?128:160;
  const samples=Math.max(96,Math.min(320,Math.round(base*Math.max(width,height)/200/16)*16));
  const minArea=overview?1.5:km2<1?.05:.5;
  // A polygon with area A must have perimeter >= sqrt(4*pi*A).
  // This conservative server filter removes only certainly too-small ways;
  // exact footprint area (and relation holes) is still checked after projection.
  const minPerimeter=overview?Math.floor(Math.sqrt(4*Math.PI*minArea*km2*1e6/(width*height))):0;
  return {samples,minArea,minPerimeter};
}
