export const MAX_PRINT_MM=300;
export const MIN_DETAIL_MM=0.2;
export const PRINT_DETAIL_MM=0.5;

export function maxModelWidth(width,height){
  return Math.floor(MAX_PRINT_MM*Math.min(1,width/height)*100)/100;
}

export function printPointBudget(width,height,maximum) {
  // Allow contouring and curved boundaries more than one vertex per feature.
  const cells=width*height/(PRINT_DETAIL_MM**2);
  return Math.min(maximum,Math.max(10000,Math.ceil(1.5*cells)));
}

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
  // Sparse source coverage and city budgets can warrant a coarser terrain
  // grid than the smallest vector feature. Size each axis independently.
  const pitch=km2>25?1:PRINT_DETAIL_MM;
  const count=mm=>1+Math.ceil(Math.min(MAX_PRINT_MM,mm)/pitch);
  const rows=count(height),cols=count(width),samples=Math.max(rows,cols);
  const metresPerDetail=MIN_DETAIL_MM*Math.sqrt(km2*1e6/(width*height));
  const minArea=!overview&&km2<1?.04:PRINT_DETAIL_MM**2;
  // A polygon with area A must have perimeter >= sqrt(4*pi*A).
  // This conservative server filter removes only certainly too-small ways;
  // exact footprint area (and relation holes) is still checked after projection.
  const minPerimeter=overview?Math.floor(Math.sqrt(4*Math.PI*minArea*km2*1e6/(width*height))):0;
  return {samples,rows,cols,minArea,minPerimeter,metresPerDetail};
}
