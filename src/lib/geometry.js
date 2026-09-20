// All geometry uses millimetres, with north at y=0.
export function simplifyPolyline(points, tolerance = 0.01) {
  if(points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while(stack.length) {
    const [start, end] = stack.pop(), a = points[start], b = points[end];
    const dx = b[0] - a[0], dy = b[1] - a[1], length2 = dx*dx + dy*dy;
    let distance2 = tolerance*tolerance, selected = -1;
    for(let i=start+1;i<end;i++) {
      const p = points[i];
      const t = length2 ? Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/length2)) : 0;
      const d = (p[0]-a[0]-t*dx)**2 + (p[1]-a[1]-t*dy)**2;
      if(d > distance2) { distance2=d; selected=i; }
    }
    if(selected !== -1) { keep[selected]=1; stack.push([start,selected],[selected,end]); }
  }
  return points.filter((_,i)=>keep[i]);
}
export function createGeometry(state) {
    function getZInterpolated(nx, ny) {
      if(!state.terrainData) return 0;
      const T = state.terrainData;
      const rFloat = ny * (T.rows-1);
      const cFloat = nx * (T.cols-1);
      const r0 = Math.floor(rFloat), r1 = Math.min(T.rows-1, r0+1);
      const c0 = Math.floor(cFloat), c1 = Math.min(T.cols-1, c0+1);
      const dr = rFloat - r0, dc = cFloat - c0;
      const h00 = T.h[r0*T.cols+c0], h01 = T.h[r0*T.cols+c1], h10 = T.h[r1*T.cols+c0], h11 = T.h[r1*T.cols+c1];
      return (h00*(1-dr)*(1-dc) + h01*(1-dr)*dc + h10*dr*(1-dc) + h11*dr*dc);
    }

    function isInShape(x, y) {
      if(['rect','din_l','din_p','sq'].includes(state.shape)) return true;
      const dx = x - state.wMm / 2;
      const dy = y - state.hMm / 2;
      if(state.shape === 'circle') return (dx*dx + dy*dy) <= (state.wMm/2) ** 2;
      if(state.shape !== 'hex') return true;
      const poly = getClipPolygon();
      return poly.every((a, i) => { const b = poly[(i + 1) % poly.length]; return (b[0]-a[0])*(y-a[1])-(b[1]-a[1])*(x-a[0]) >= -1e-8; });
    }

    function getContourLineCount() {
      const desired = Math.max(4, Math.round(state.contour.density));
      const minSpacing = 1.2;
      const maxLines = Math.max(4, Math.floor(Math.min(state.wMm, state.hMm) / minSpacing));
      const hardMax = 100;
      return Math.max(4, Math.min(desired, Math.min(maxLines, hardMax)));
    }

    function getContourLevels(minNorm = 0, maxNorm = state.terrainData?.delta ?? 0) {
      if(!state.terrainData || maxNorm <= minNorm) return [];
      const lineCount = getContourLineCount();
      const interval = (maxNorm - minNorm) / lineCount;
      return Array.from({length: lineCount - 1}, (_, i) => minNorm + interval * (i + 1));
    }

    function getShapeHeightRange() {
      if(!state.terrainData) return null;
      const { rows, cols, h, min, delta } = state.terrainData;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for(let r=0; r<rows; r++) {
        const y = (r / (rows - 1)) * state.hMm;
        for(let c=0; c<cols; c++) {
          const x = (c / (cols - 1)) * state.wMm;
          if(!isInShape(x, y)) continue;
          const z = min + h[r * cols + c];
          if(z < minZ) minZ = z;
          if(z > maxZ) maxZ = z;
        }
      }
      if(!Number.isFinite(minZ) || !Number.isFinite(maxZ)) {
        minZ = min;
        maxZ = min + delta;
      }
      return { minZ, maxZ, minNorm: minZ - min, maxNorm: maxZ - min };
    }


    function getContourSegments(level, widthMm, heightMm) {
      if(!state.terrainData) return [];
      const T = state.terrainData;
      const rows = T.rows;
      const cols = T.cols;
      const segments = [];
      const xScale = widthMm / (cols - 1);
      const yScale = heightMm / (rows - 1);
      const safeRatio = (num, den) => {
        if(den === 0) return 0.5;
        const t = num / den;
        if(!Number.isFinite(t)) return 0.5;
        return Math.max(0, Math.min(1, t));
      };

      const edgePoint = (edge, r, c, h00, h10, h11, h01) => {
        const x = c * xScale;
        const y = r * yScale;
        if(edge === 0) {
          const t = safeRatio(level - h00, h10 - h00);
          return [x + xScale * t, y];
        }
        if(edge === 1) {
          const t = safeRatio(level - h10, h11 - h10);
          return [x + xScale, y + yScale * t];
        }
        if(edge === 2) {
          const t = safeRatio(level - h11, h01 - h11);
          return [x + xScale * (1 - t), y + yScale];
        }
        const t = safeRatio(level - h01, h00 - h01);
        return [x, y + yScale * (1 - t)];
      };

      const table = {
        0: [],
        1: [[3,2]],
        2: [[2,1]],
        3: [[3,1]],
        4: [[0,1]],
        5: 'amb',
        6: [[0,2]],
        7: [[0,3]],
        8: [[0,3]],
        9: [[0,2]],
        10: 'amb',
        11: [[0,1]],
        12: [[3,1]],
        13: [[2,1]],
        14: [[3,2]],
        15: []
      };

      for(let r=0; r<rows-1; r++) {
        for(let c=0; c<cols-1; c++) {
          const h00 = T.h[r*cols + c];
          const h10 = T.h[r*cols + c + 1];
          const h01 = T.h[(r+1)*cols + c];
          const h11 = T.h[(r+1)*cols + c + 1];
          const tl = h00 >= level;
          const tr = h10 >= level;
          const br = h11 >= level;
          const bl = h01 >= level;
          const idx = (tl<<3) | (tr<<2) | (br<<1) | bl;
          if(idx === 0 || idx === 15) continue;
          const cellCenter = (h00 + h10 + h11 + h01) / 4;
          let pairs = table[idx];
          if(pairs === 'amb') {
            if(cellCenter >= level) {
              pairs = idx === 5 ? [[0,1],[2,3]] : [[0,3],[1,2]];
            } else {
              pairs = idx === 5 ? [[0,3],[1,2]] : [[0,1],[2,3]];
            }
          }
          pairs.forEach(pair => {
            const p1 = edgePoint(pair[0], r, c, h00, h10, h11, h01);
            const p2 = edgePoint(pair[1], r, c, h00, h10, h11, h01);
            segments.push([p1, p2]);
          });
        }
      }
      return segments;
    }

    function buildPolylines(segments, precision = 2) {
      const keyFor = (p) => `${p[0].toFixed(precision)},${p[1].toFixed(precision)}`;
      const endpointMap = new Map();
      const used = new Array(segments.length).fill(false);
      segments.forEach((seg, i) => {
        [0,1].forEach(end => {
          const key = keyFor(seg[end]);
          if(!endpointMap.has(key)) endpointMap.set(key, []);
          endpointMap.get(key).push({ index: i, end });
        });
      });

      const takeNext = (key) => {
        const list = endpointMap.get(key);
        if(!list) return null;
        for(const item of list) {
          if(!used[item.index]) return item;
        }
        return null;
      };

      const lines = [];
      for(let i = 0; i < segments.length; i++) {
        if(used[i]) continue;
        used[i] = true;
        const base = segments[i];
        const line = [base[0], base[1]];

        let advanced = true;
        while(advanced) {
          advanced = false;
          const tailKey = keyFor(line[line.length - 1]);
          const next = takeNext(tailKey);
          if(next && next.index !== i) {
            used[next.index] = true;
            const seg = segments[next.index];
            const nextPoint = next.end === 0 ? seg[1] : seg[0];
            line.push(nextPoint);
            advanced = true;
          }
        }

        advanced = true;
        while(advanced) {
          advanced = false;
          const headKey = keyFor(line[0]);
          const next = takeNext(headKey);
          if(next && next.index !== i) {
            used[next.index] = true;
            const seg = segments[next.index];
            const nextPoint = next.end === 0 ? seg[1] : seg[0];
            line.unshift(nextPoint);
            advanced = true;
          }
        }
        lines.push(line);
      }
      return lines;
    }

    function smoothPolyline(points, iterations) {
      if(points.length < 3 || iterations <= 0) return points;
      const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
      const isClosed = dist(points[0], points[points.length - 1]) < 0.01;
      let pts = isClosed ? points.slice(0, -1) : points.slice();

      for(let i = 0; i < iterations; i++) {
        const nextPts = isClosed ? [] : [pts[0]];
        for(let p = 0; p < pts.length - 1; p++) {
          const a = pts[p];
          const b = pts[p + 1];
          nextPts.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]]);
          nextPts.push([0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
        }
        if(isClosed) {
          const a = pts[pts.length - 1];
          const b = pts[0];
          nextPts.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]]);
          nextPts.push([0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
        }
        if(!isClosed) nextPts.push(pts[pts.length - 1]);
        pts = isClosed ? simplifyPolyline([...nextPts,nextPts[0]]).slice(0,-1) : simplifyPolyline(nextPts);
      }
      if(isClosed) pts.push(pts[0]);
      return pts;
    }


    function getShapePathD() {
      const w = state.wMm;
      const h = state.hMm;
      if(['rect','din_l','din_p','sq'].includes(state.shape)) {
        return `M 0,0 H ${w} V ${h} H 0 Z`;
      }
      if(state.shape === 'circle') {
        const r = w / 2;
        return `M ${w / 2},${h / 2} m -${r},0 a ${r},${r} 0 1,0 ${w},0 a ${r},${r} 0 1,0 -${w},0`;
      }
      if(state.shape === 'hex') {
        const r = w / 2;
        const cx = w / 2;
        const cy = h / 2;
        const pts = [];
        for(let i=0; i<6; i++) {
          const a = i * Math.PI / 3 - Math.PI / 6;
          pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
        }
        return `M ${pts[0][0]},${pts[0][1]} ` + pts.slice(1).map(p=>`L ${p[0]},${p[1]}`).join(' ') + ' Z';
      }
      return `M 0,0 H ${w} V ${h} H 0 Z`;
    }


    const polygonArea = (poly) => {
      let sum = 0;
      for(let i = 0; i < poly.length; i++) {
        sum += poly[i][0] * poly[(i + 1) % poly.length][1] - poly[(i + 1) % poly.length][0] * poly[i][1];
      }
      return sum / 2;
    };

    const getClipPolygon = () => {
      const w = state.wMm;
      const h = state.hMm;
      if(['rect','din_l','din_p','sq'].includes(state.shape)) {
        return [[0,0],[w,0],[w,h],[0,h]];
      }
      if(state.shape === 'hex') {
        const r = w / 2;
        const cx = w / 2;
        const cy = h / 2;
        const pts = [];
        for(let i=0; i<6; i++) {
          const a = i * Math.PI / 3 - Math.PI / 6;
          pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
        }
        return pts;
      }
      if(state.shape === 'circle') {
        const r = w / 2;
        const cx = w / 2;
        const cy = h / 2;
        const pts = [];
        const steps = 128;
        for(let i=0; i<steps; i++) {
          const a = (i / steps) * Math.PI * 2;
          pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
        }
        return pts;
      }
      return [[0,0],[w,0],[w,h],[0,h]];
    };

    const clipCanvasToShape = (ctx, widthPx, heightPx) => {
      const poly = getClipPolygon();
      if(!poly?.length) return;
      ctx.beginPath();
      poly.forEach((pt, idx) => {
        const x = (pt[0] / state.wMm) * widthPx;
        const y = (pt[1] / state.hMm) * heightPx;
        if(idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.clip();
    };

    const clipPolygon = (subject, clip) => {
      let output = subject.slice();
      const isInside = (pt, edgeStart, edgeEnd) => {
        return (edgeEnd[0] - edgeStart[0]) * (pt[1] - edgeStart[1]) - (edgeEnd[1] - edgeStart[1]) * (pt[0] - edgeStart[0]) >= 0;
      };
      const lineIntersection = (s, e, cp1, cp2) => {
        const dc = [cp1[0] - cp2[0], cp1[1] - cp2[1]];
        const dp = [s[0] - e[0], s[1] - e[1]];
        const n1 = cp1[0] * cp2[1] - cp1[1] * cp2[0];
        const n2 = s[0] * e[1] - s[1] * e[0];
        const denom = dc[0] * dp[1] - dc[1] * dp[0];
        if(Math.abs(denom) < 1e-9) return e;
        return [
          (n1 * dp[0] - n2 * dc[0]) / denom,
          (n1 * dp[1] - n2 * dc[1]) / denom
        ];
      };
      for(let i=0; i<clip.length; i++) {
        const cp1 = clip[i];
        const cp2 = clip[(i + 1) % clip.length];
        const input = output.slice();
        output = [];
        if(!input.length) break;
        let s = input[input.length - 1];
        input.forEach((e) => {
          if(isInside(e, cp1, cp2)) {
            if(!isInside(s, cp1, cp2)) {
              output.push(lineIntersection(s, e, cp1, cp2));
            }
            output.push(e);
          } else if(isInside(s, cp1, cp2)) {
            output.push(lineIntersection(s, e, cp1, cp2));
          }
          s = e;
        });
      }
      return output;
    };

    const clipSegmentToConvex = (p0, p1, clip) => {
      let t0 = 0;
      let t1 = 1;
      for(let i=0; i<clip.length; i++) {
        const a = clip[i];
        const b = clip[(i + 1) % clip.length];
        const edge = [b[0] - a[0], b[1] - a[1]];
        const normal = [edge[1], -edge[0]];
        const w = [p0[0] - a[0], p0[1] - a[1]];
        const denom = normal[0] * (p1[0] - p0[0]) + normal[1] * (p1[1] - p0[1]);
        const numer = -(normal[0] * w[0] + normal[1] * w[1]);
        if(Math.abs(denom) < 1e-9) {
          if(numer < 0) return null;
          continue;
        }
        const t = numer / denom;
        if(denom < 0) {
          t0 = Math.max(t0, t);
        } else {
          t1 = Math.min(t1, t);
        }
        if(t0 > t1) return null;
      }
      const c0 = [p0[0] + (p1[0] - p0[0]) * t0, p0[1] + (p1[1] - p0[1]) * t0];
      const c1 = [p0[0] + (p1[0] - p0[0]) * t1, p0[1] + (p1[1] - p0[1]) * t1];
      return [c0, c1];
    };

    const clipPolylineToPolygon = (line, clip) => {
      if(line.length < 2) return [];
      const out = [];
      let current = [];
      for(let i=0; i<line.length - 1; i++) {
        const clipped = clipSegmentToConvex(line[i], line[i + 1], clip);
        if(clipped) {
          const [c0, c1] = clipped;
          if(!current.length) {
            current.push(c0, c1);
          } else {
            const last = current[current.length - 1];
            if(Math.hypot(last[0] - c0[0], last[1] - c0[1]) > 1e-4) {
              out.push(current);
              current = [c0, c1];
            } else {
              current.push(c1);
            }
          }
        } else if(current.length) {
          out.push(current);
          current = [];
        }
      }
      if(current.length) out.push(current);
      return out;
    };

    const ensureClosed = (poly) => {
      if(poly.length < 3) return poly;
      const first = poly[0];
      const last = poly[poly.length - 1];
      if(Math.hypot(first[0] - last[0], first[1] - last[1]) > 1e-4) {
        return poly.concat([first]);
      }
      return poly;
    };


    function smoothPass(data, rows, cols) {
      const out = new Float32Array(data.length);
      for(let r=0; r<rows; r++) for(let c=0; c<cols; c++) {
        let sum=0, wSum=0;
        for(let rr=r-1; rr<=r+1; rr++) for(let cc=c-1; cc<=c+1; cc++) {
          if(rr>=0 && rr<rows && cc>=0 && cc<cols) {
            const w = (rr===r && cc===c) ? 8 : 1; sum+=data[rr*cols+cc]*w; wSum+=w;
          }
        }
        out[r*cols+c] = sum/wSum;
      }
      return out;
    }


return { getZInterpolated, isInShape, getContourLineCount, getContourLevels, getShapeHeightRange, getContourSegments, buildPolylines, smoothPolyline, getShapePathD, polygonArea, getClipPolygon, clipCanvasToShape, clipPolygon, clipSegmentToConvex, clipPolylineToPolygon, ensureClosed, smoothPass };
}
