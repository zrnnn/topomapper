import {PRINT_DETAIL_MM} from './area-plan.js';
import { createGeometry } from './geometry.js';
const rectangular=shape=>['rect','sq','din_l','din_p'].includes(shape);
export function meshResolution(state,setting){
  if(setting!==600)return Math.max(40,Math.min(400,Math.round(setting)||160));
  const target=Math.ceil(Math.max(state.wMm,state.hMm)/PRINT_DETAIL_MM);
  return Math.max(40,Math.min(target,rectangular(state.shape)?600:240));
}

export function createTerrainSurface(state,{resolution=160,targetHeight=10,base=2}={}){
  if(!state.terrainData || !Number.isFinite(targetHeight) || targetHeight<0 || targetHeight>100000){
    throw new Error('Calculated relief height is outside the supported range.');
  }
  const {getZInterpolated,smoothPass}=createGeometry(state);
  const scale=state.terrainData.delta>0?targetHeight/state.terrainData.delta:0;
  const res=meshResolution(state,resolution);
  const step=Math.max(state.wMm,state.hMm)/res;
  const isRectangle=rectangular(state.shape);
  const cols=isRectangle?(scale?Math.ceil(state.wMm/step)+1:2):res+1;
  const rows=isRectangle?(scale?Math.ceil(state.hMm/step)+1:2):res+1;
  const stepX=state.wMm/(cols-1),stepY=state.hMm/(rows-1);
  let grid=new Float32Array(rows*cols);
  if(scale){
    for(let r=0;r<rows;r++)for(let c=0;c<cols;c++)grid[r*cols+c]=getZInterpolated(c/(cols-1),r/(rows-1));
    for(let i=0;i<2;i++)grid=smoothPass(grid,rows,cols);
  }
  const heightAt=(x,y)=>{
    const gx=Math.max(0,Math.min(cols-1,x/stepX));
    const gy=Math.max(0,Math.min(rows-1,y/stepY));
    const c=Math.min(cols-2,Math.floor(gx)),r=Math.min(rows-2,Math.floor(gy));
    const u=gx-c,v=gy-r,i=r*cols+c;
    // Interpolate the same diagonal and planes that the surface is meshed with.
    const relief=u+v<=1
      ? grid[i]*(1-u-v)+grid[i+1]*u+grid[i+cols]*v
      : grid[i+cols+1]*(u+v-1)+grid[i+cols]*(1-u)+grid[i+1]*(1-v);
    return base+relief*scale;
  };
  return {rows,cols,stepX,stepY,heightAt};
}

function rectangularTerrain(surface){
  const {rows,cols,stepX,stepY,heightAt}=surface;
  const v=[],t=[];
  for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
    const a=r*cols+c;
    v.push([stepX*c,stepY*r,heightAt(stepX*c,stepY*r)]);
    if(c+1<cols && r+1<rows)t.push([a,a+1,a+cols],[a+1,a+cols+1,a+cols]);
  }
  // A flat base needs only a rim and a centre. Walk its boundary once.
  const rim=[];
  for(let c=0;c<cols;c++)rim.push(c);
  for(let r=1;r<rows;r++)rim.push(r*cols+cols-1);
  for(let c=cols-2;c>=0;c--)rim.push((rows-1)*cols+c);
  for(let r=rows-2;r>0;r--)rim.push(r*cols);
  const centre=v.push([stepX*(cols-1)/2,stepY*(rows-1)/2,0])-1,first=v.length;
  for(const a of rim)v.push([v[a][0],v[a][1],0]);
  for(let i=0;i<rim.length;i++){
    const j=(i+1)%rim.length,a=rim[i],b=rim[j];
    t.push([a,first+i,first+j],[a,first+j,b],[first+j,first+i,centre]);
  }
  return {v,t,surface};
}

export function buildTerrainMesh(state, options={}){
  const surface=createTerrainSurface(state,options);
  if(rectangular(state.shape))return rectangularTerrain(surface);
        const {getClipPolygon, polygonArea, clipPolygon} = createGeometry(state);
        const res=surface.cols-1;
        const tm = { v:[], t:[], surface };
        const vertexCache = new Map();
        const polygonAreaClosed = (poly) => {
          let sum = 0;
          for(let i=0; i<poly.length; i++) {
            const a = poly[i];
            const b = poly[(i + 1) % poly.length];
            sum += a[0] * b[1] - b[0] * a[1];
          }
          return sum / 2;
        };
        const vertexKey = (v) => `${v[0].toFixed(3)},${v[1].toFixed(3)},${v[2].toFixed(3)}`;
        const getVertexIndex = (v) => {
          const key = vertexKey(v);
          const existing = vertexCache.get(key);
          if(existing !== undefined) return existing;
          const idx = tm.v.push(v.map(n => Number(n.toFixed(3)))) - 1;
          vertexCache.set(key, idx);
          return idx;
        };
        const addTri = (a, b, c) => {
          const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
          const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
          const cx = ab[1] * ac[2] - ab[2] * ac[1];
          const cy = ab[2] * ac[0] - ab[0] * ac[2];
          const cz = ab[0] * ac[1] - ab[1] * ac[0];
          const area2 = Math.hypot(cx, cy, cz);
          if(area2 < 1e-6) return;
          const ia = getVertexIndex(a);
          const ib = getVertexIndex(b);
          const ic = getVertexIndex(c);
          if(ia === ib || ib === ic || ia === ic) return;
          tm.t.push([ia, ib, ic]);
        };
        const addTopTri = (p0, p1, p2) => {
          const v0 = [p0[0], p0[1], surface.heightAt(p0[0], p0[1])];
          const v1 = [p1[0], p1[1], surface.heightAt(p1[0], p1[1])];
          const v2 = [p2[0], p2[1], surface.heightAt(p2[0], p2[1])];
          addTri(v0, v1, v2);
        };
        const addBottomTri = (p0, p1, p2) => {
          addTri([p0[0], p0[1], 0], [p1[0], p1[1], 0], [p2[0], p2[1], 0]);
        };

        const clipPoly = getClipPolygon();
        if(polygonArea(clipPoly) < 0) clipPoly.reverse();
        const clipCcw = polygonAreaClosed(clipPoly) < 0 ? clipPoly.slice().reverse() : clipPoly.slice();
        const triangulateTop = (poly) => {
          if(!poly || poly.length < 3) return;
          const ordered = polygonAreaClosed(poly) < 0 ? poly.slice().reverse() : poly;
          for(let i=1; i<ordered.length-1; i++) {
            addTopTri(ordered[0], ordered[i], ordered[i + 1]);
          }
        };
        const triangulateBottom = (poly) => {
          if(!poly || poly.length < 3) return;
          const ordered = polygonAreaClosed(poly) < 0 ? poly.slice().reverse() : poly;
          for(let i=1; i<ordered.length-1; i++) {
            addBottomTri(ordered[0], ordered[i + 1], ordered[i]);
          }
        };

        for(let r=0; r<res; r++) {
          const y0 = (r / res) * state.hMm;
          const y1 = ((r + 1) / res) * state.hMm;
          for(let c=0; c<res; c++) {
            const x0 = (c / res) * state.wMm;
            const x1 = ((c + 1) / res) * state.wMm;
            const triA = [[x0, y0], [x1, y0], [x0, y1]];
            const triB = [[x1, y0], [x1, y1], [x0, y1]];
            triangulateTop(clipPolygon(triA, clipCcw));
            triangulateTop(clipPolygon(triB, clipCcw));
          }
        }

        const edgeKey = (a, b) => (a < b ? `${a},${b}` : `${b},${a}`);
        const edgeCount = new Map();
        tm.t.forEach((tri) => {
          const [a, b, c] = tri;
          [ [a, b], [b, c], [c, a] ].forEach(([u, v]) => {
            const key = edgeKey(u, v);
            const edge = edgeCount.get(key) || { count: 0, a: u, b: v };
            edge.count++; edgeCount.set(key, edge);
          });
        });
        const boundaryEdges = [];
        edgeCount.forEach(({count,a,b}) => { if(count === 1) boundaryEdges.push([a,b]); });

        for(let r=0; r<res; r++) {
          const y0 = (r / res) * state.hMm;
          const y1 = ((r + 1) / res) * state.hMm;
          for(let c=0; c<res; c++) {
            const x0 = (c / res) * state.wMm;
            const x1 = ((c + 1) / res) * state.wMm;
            const triA = [[x0, y0], [x1, y0], [x0, y1]];
            const triB = [[x1, y0], [x1, y1], [x0, y1]];
            triangulateBottom(clipPolygon(triA, clipCcw));
            triangulateBottom(clipPolygon(triB, clipCcw));
          }
        }

        boundaryEdges.forEach(([a, b]) => {
          const top0 = tm.v[a];
          const top1 = tm.v[b];
          const bottom0 = [top0[0], top0[1], 0];
          const bottom1 = [top1[0], top1[1], 0];
          addTri(top0, bottom0, bottom1);
          addTri(top0, bottom1, top1);
        });


return tm;
}
