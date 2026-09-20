import { createGeometry } from './geometry.js';
export function buildTerrainMesh(state, {resolution = 160, targetHeight = 10} = {}) {
if(!state.terrainData || !Number.isFinite(targetHeight) || targetHeight <= 0 || targetHeight > 200) throw new Error('Relief height must be between 0 and 200 mm.');
const {getZInterpolated, smoothPass, getClipPolygon, polygonArea, clipPolygon} = createGeometry(state);
const zScale = state.terrainData.delta > 0 ? targetHeight / state.terrainData.delta : 0;
        const baseThickness = 2.0;
        const res = Math.max(40, Math.min(400, Math.round(resolution || 160)));
        const tm = { v:[], t:[] };
        const vertexCache = new Map();
        const gridSize = res + 1;
        let heightGrid = new Float32Array(gridSize * gridSize);
        for(let r=0; r<=res; r++) {
          for(let c=0; c<=res; c++) {
            heightGrid[r * gridSize + c] = getZInterpolated(c / res, r / res);
          }
        }
        const meshSmoothPasses = 2;
        for(let i=0; i<meshSmoothPasses; i++) {
          heightGrid = smoothPass(heightGrid, gridSize, gridSize);
        }
        const polygonAreaClosed = (poly) => {
          let sum = 0;
          for(let i=0; i<poly.length; i++) {
            const a = poly[i];
            const b = poly[(i + 1) % poly.length];
            sum += a[0] * b[1] - b[0] * a[1];
          }
          return sum / 2;
        };
        const sampleHeight = (xMm, yMm) => {
          const nx = Math.max(0, Math.min(1, xMm / state.wMm));
          const ny = Math.max(0, Math.min(1, yMm / state.hMm));
          const gx = nx * res;
          const gy = ny * res;
          const c0 = Math.max(0, Math.min(res, Math.floor(gx)));
          const r0 = Math.max(0, Math.min(res, Math.floor(gy)));
          const c1 = Math.min(res, c0 + 1);
          const r1 = Math.min(res, r0 + 1);
          const tx = gx - c0;
          const ty = gy - r0;
          const h00 = heightGrid[r0 * gridSize + c0];
          const h01 = heightGrid[r0 * gridSize + c1];
          const h10 = heightGrid[r1 * gridSize + c0];
          const h11 = heightGrid[r1 * gridSize + c1];
          const top = h00 * (1 - tx) + h01 * tx;
          const bottom = h10 * (1 - tx) + h11 * tx;
          return top * (1 - ty) + bottom * ty;
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
          const v0 = [p0[0], p0[1], baseThickness + sampleHeight(p0[0], p0[1]) * zScale];
          const v1 = [p1[0], p1[1], baseThickness + sampleHeight(p1[0], p1[1]) * zScale];
          const v2 = [p2[0], p2[1], baseThickness + sampleHeight(p2[0], p2[1]) * zScale];
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
