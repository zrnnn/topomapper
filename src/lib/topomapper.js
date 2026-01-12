import maplibregl from 'maplibre-gl';
import JSZip from 'jszip';

export function initTopomapper() {
  // --- STATE ---
    const state = {
      wMm: 200, hMm: 140, shape: 'rect',
      contour: {
        enabled: true,
        density: 24,
        width: 0.2,
        color: '#10141B',
        smooth: 4,
        opacity: 80,
        emphasisEvery: 10
      },
      png: {
        layered: true,
        scheme: 'color',
        blend: 'normal',
        gradientOpacity: 0,
        gradientShift: 0,
        gradientScale: 100,
        reliefStrength: 0.48,
        reliefWarm: '#F3A15F',
        reliefShadow: '#0A1624'
      },
      theme: {
        preset: 'bright',
        background: '#F5F2EB',
        line: '#10141B'
      },
      mapFeatures: {
        waterAreas: { enabled: false, color: '#7DB5D3', opacity: 45 },
        rivers: { enabled: false, color: '#7DB5D3', width: 0.2, opacity: 85 },
        greenAreas: { enabled: false, color: '#7FAE8A', opacity: 15 },
        roads: { enabled: false, color: '#5B3A1C', width: 0.2, opacity: 75 },
        labels: {
          enabled: false,
          color: '#1E232B',
          size: 0.4,
          font: 'system',
          opacity: 85,
          background: { enabled: true, color: '#F5F2EB' },
          weight: 'normal',
          style: 'normal',
          scaleByRank: true
        }
      },
      layerOrder: ['labels', 'roads', 'rivers', 'water', 'green', 'contours'],
      bbox: null,
      renderBbox: null,
      terrainData: null,
      contourPaths: [],
      osmData: null,
      osmStatus: { loaded: false, error: null, tiles: 1, ignored: false },
      previewDirty: false,
      autoPreview: true,
      terrainVersion: 0,
      pngPreviewCache: { key: null, dataUrl: null }
    };

    const defaultDesign = {
      contour: {
        enabled: true,
        density: 24,
        width: 0.2,
        color: '#10141B',
        smooth: 4,
        opacity: 80,
        emphasisEvery: 10
      },
      png: {
        layered: true,
        scheme: 'color',
        blend: 'normal',
        gradientOpacity: 0,
        gradientShift: 0,
        gradientScale: 100,
        reliefStrength: 0.48,
        reliefWarm: '#F3A15F',
        reliefShadow: '#0A1624'
      },
      theme: {
        preset: 'bright',
        background: '#F5F2EB',
        line: '#10141B'
      },
      mapFeatures: {
        waterAreas: { enabled: false, color: '#7DB5D3', opacity: 45 },
        rivers: { enabled: false, color: '#7DB5D3', width: 0.2, opacity: 85 },
        greenAreas: { enabled: false, color: '#7FAE8A', opacity: 15 },
        roads: { enabled: false, color: '#5B3A1C', width: 0.2, opacity: 75 },
        labels: {
          enabled: false,
          color: '#1E232B',
          size: 0.4,
          font: 'system',
          opacity: 85,
          background: { enabled: true, color: '#F5F2EB' },
          weight: 'normal',
          style: 'normal',
          scaleByRank: true
        }
      },
      layerOrder: ['labels', 'roads', 'rivers', 'water', 'green', 'contours']
    };

    const FETCH_TIMEOUT = 12000;
    const terrainCache = new Map();
    const osmCache = new Map();
    const bboxKey = (sw, ne) => {
      if(!sw || !ne) return '';
      return `${sw.lat.toFixed(4)},${sw.lng.toFixed(4)}:${ne.lat.toFixed(4)},${ne.lng.toFixed(4)}`;
    };

    const linkAbort = (source, target) => {
      if(!source) return;
      if(source.aborted) {
        target.abort();
        return;
      }
      source.addEventListener('abort', () => target.abort(), { once: true });
    };

    const fetchJsonWithTimeout = async (url, options = {}, timeoutMs = FETCH_TIMEOUT) => {
      const controller = new AbortController();
      linkAbort(options.signal, controller);
      const { signal: _ignored, ...rest } = options;
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(url, { ...rest, signal: controller.signal });
        if(!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
      } finally {
        clearTimeout(timer);
      }
    };

    const $ = id => document.getElementById(id);
    const msg = t => { $('loaderText').innerText=t; $('loader').classList.add('active'); };
    const idle = () => $('loader').classList.remove('active');
    const refreshPreviewBtn = $('refreshPreview');
    const undoStep2Btn = $('undoStep2');
    const redoStep2Btn = $('redoStep2');
    const mapDataNotice = $('mapDataNotice');
    const mapDataNoticeText = $('mapDataNoticeText');
    const mapDataNoticeClose = $('mapDataNoticeClose');

    // --- HELPERS: SCALING & INTERPOLATION ---
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
      const qx = Math.abs(dx) / (state.wMm / 2);
      const qy = Math.abs(dy) / (state.hMm / 2);
      return qx + qy * 0.577 <= 1;
    }

    function getContourLineCount() {
      const desired = Math.max(4, Math.round(state.contour.density));
      const minSpacing = Math.max(1.2, pxToMm(state.contour.width) * 8);
      const maxLines = Math.max(4, Math.floor(Math.min(state.wMm, state.hMm) / minSpacing));
      return Math.max(4, Math.min(desired, maxLines));
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

    function parseHexColor(hex) {
      const v = hex.replace('#', '').trim();
      if(v.length === 3) {
        return {
          r: parseInt(v[0] + v[0], 16),
          g: parseInt(v[1] + v[1], 16),
          b: parseInt(v[2] + v[2], 16)
        };
      }
      if(v.length === 6) {
        return {
          r: parseInt(v.slice(0,2), 16),
          g: parseInt(v.slice(2,4), 16),
          b: parseInt(v.slice(4,6), 16)
        };
      }
      return { r: 0, g: 0, b: 0 };
    }

    function colorToRgb(color) {
      const tester = new Option().style;
      tester.color = color;
      const parsed = tester.color || '#000000';
      if(parsed.startsWith('#')) {
        return parseHexColor(parsed);
      }
      const match = parsed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
      if(match) {
        return { r: parseInt(match[1], 10), g: parseInt(match[2], 10), b: parseInt(match[3], 10) };
      }
      return { r: 0, g: 0, b: 0 };
    }

    function lerp(a, b, t) { return a + (b - a) * t; }
    function clamp(val, min, max) { return Math.min(max, Math.max(min, val)); }
    const PX_TO_MM = 0.264583;
    const pxToMm = (value) => value * PX_TO_MM;
    const clampDimensionMm = (value) => {
      const parsed = parseFloat(value);
      if(Number.isNaN(parsed)) return 200;
      return clamp(parsed, 50, 1200);
    };
    const formatWidthInput = (value) => {
      const rounded = Math.round(value * 100) / 100;
      return `${rounded}`.replace(/\.0$/, '').replace(/(\.\d)0$/, '$1');
    };
    const clampLineWidth = (value) => {
      const parsed = parseFloat(value);
      if(Number.isNaN(parsed)) return 0.2;
      return clamp(parsed, 0.1, 2);
    };
    const formatMm = (value) => `${value.toFixed(2)} mm`;
    function smoothstep(t) {
      const clamped = clamp(t, 0, 1);
      return clamped * clamped * (3 - 2 * clamped);
    }

    function getSmoothedBandColor(zNorm, boundaries, bandColors) {
      const band = findBandIndex(zNorm, boundaries);
      let color = bandColors[band];
      const lower = boundaries[band];
      const upper = boundaries[band + 1];
      const bandSpan = Math.max(upper - lower, 1e-6);
      const blendWindow = Math.min(0.04, bandSpan * 0.35);
      if(blendWindow > 0) {
        if(band > 0) {
          const t = smoothstep((zNorm - lower) / blendWindow);
          color = mixColor(bandColors[band - 1], color, t);
        }
        if(band < bandColors.length - 1) {
          const t = smoothstep((upper - zNorm) / blendWindow);
          color = mixColor(color, bandColors[band + 1], 1 - t);
        }
      }
      return { band, color };
    }

    function gradientColor(startColor, endColor, t) {
      const s = colorToRgb(startColor);
      const e = colorToRgb(endColor);
      const tt = clamp(t, 0, 1);
      return {
        r: Math.round(lerp(s.r, e.r, tt)),
        g: Math.round(lerp(s.g, e.g, tt)),
        b: Math.round(lerp(s.b, e.b, tt))
      };
    }

    const getHypsometricStops = (scheme) => {
      if(scheme === 'mono') {
        return ['#FFFFFF', '#E6E6E6', '#CCCCCC', '#B3B3B3', '#999999', '#7F7F7F', '#666666', '#4D4D4D', '#333333'];
      }
      if(scheme === 'terra') {
        return ['#1F4E5F', '#3E6F6E', '#6A8E6D', '#9CAD68', '#C9B86A', '#D5A86A', '#C98B5E', '#B16F50', '#8C5A44'];
      }
      if(scheme === 'glacier') {
        return ['#0E2A47', '#1D4C6B', '#2F6E8E', '#4D90A8', '#7BB1C2', '#A6CAD5', '#CDE1E6', '#E5EFF2', '#F4F8FA'];
      }
      const stops = [
        '#0F3E63',
        '#1F5C83',
        '#3B7EA6',
        '#6AA1C2',
        '#9EC3D9',
        '#BFD9B3',
        '#9FBE7E',
        '#CBB878',
        '#B18D5B',
        '#8E6C45'
      ];
      const waterColor = state.mapFeatures?.waterAreas?.color;
      const greenColor = state.mapFeatures?.greenAreas?.color;
      if(waterColor && greenColor) {
        stops[0] = waterColor;
        stops[1] = gradientColor(waterColor, greenColor, 0.55);
        stops[2] = greenColor;
      } else if(waterColor) {
        stops[0] = waterColor;
        stops[1] = gradientColor(waterColor, stops[2], 0.5);
      } else if(greenColor) {
        stops[0] = gradientColor(greenColor, stops[0], 0.6);
        stops[1] = greenColor;
      }
      return stops;
    };

    const getScaledGradientT = (t) => {
      const scale = Math.max(0.3, Math.min(2.0, (state.png.gradientScale ?? 100) / 100));
      const shift = Math.max(-0.8, Math.min(0.8, (state.png.gradientShift ?? 0) / 100));
      return clamp((t - 0.5) / scale + 0.5 + shift, 0, 1);
    };

    const getHypsometricBandColor = (t, scheme, bandCount) => {
      const clamped = getScaledGradientT(t);
      const bandIndex = Math.min(bandCount - 1, Math.floor(clamped * bandCount));
      const stops = getHypsometricStops(scheme);
      if(bandCount <= 1) return colorToRgb(stops[0]);
      const scaled = bandIndex / (bandCount - 1);
      const stopIndex = scaled * (stops.length - 1);
      const low = Math.floor(stopIndex);
      const high = Math.min(stops.length - 1, low + 1);
      const mixT = stopIndex - low;
      const base = gradientColor(stops[low], stops[high], mixT);
      return base;
    };

    function mixColor(base, overlay, t) {
      const tt = clamp(t, 0, 1);
      return {
        r: Math.round(lerp(base.r, overlay.r, tt)),
        g: Math.round(lerp(base.g, overlay.g, tt)),
        b: Math.round(lerp(base.b, overlay.b, tt))
      };
    }

    const reliefLight = (() => {
      const v = { x: -0.62, y: -0.48, z: 0.6 };
      const len = Math.hypot(v.x, v.y, v.z) || 1;
      return { x: v.x / len, y: v.y / len, z: v.z / len };
    })();

    function getHillshade(nx, ny, step, centerZ) {
      if(!state.terrainData) return 0.5;
      const safeStep = Math.max(1e-6, step);
      const z0 = centerZ ?? getZInterpolated(nx, ny);
      const zRight = getZInterpolated(Math.min(1, nx + safeStep), ny);
      const zDown = getZInterpolated(nx, Math.min(1, ny + safeStep));
      const dzdx = (zRight - z0) / safeStep;
      const dzdy = (zDown - z0) / safeStep;
      const relief = clamp(state.terrainData.delta / 700, 0.35, 1.25);
      const nxv = -dzdx * relief;
      const nyv = -dzdy * relief;
      const nzv = 1;
      const len = Math.hypot(nxv, nyv, nzv) || 1;
      const dot = (nxv / len) * reliefLight.x + (nyv / len) * reliefLight.y + (nzv / len) * reliefLight.z;
      const ambient = 0.36;
      const lit = Math.max(0, dot);
      return clamp(ambient + lit * (1 - ambient), 0, 1);
    }

    function applyReliefOverlay(baseColor, shade, elevationT) {
      const strength = clamp(state.png.reliefStrength ?? 0.45, 0, 1);
      if(strength <= 0) return baseColor;
      const warm = colorToRgb(state.png.reliefWarm);
      const shadow = colorToRgb(state.png.reliefShadow);
      const highlight = clamp((shade - 0.5) * 2, 0, 1) * strength;
      const shadowMix = clamp((0.5 - shade) * 2, 0, 1) * strength;
      const peakBoost = clamp((elevationT - 0.6) / 0.4, 0, 1) * (strength * 0.45);
      let color = mixColor(baseColor, warm, clamp(highlight + peakBoost, 0, 1));
      color = mixColor(color, shadow, shadowMix);
      return color;
    }

    function getLayeredPreviewDataUrl() {
      if(!state.terrainData) return null;
      const previewKey = JSON.stringify({
        terrainVersion: state.terrainVersion,
        wMm: state.wMm,
        hMm: state.hMm,
        contourDensity: state.contour.density,
        contourWidth: state.contour.width,
        scheme: state.png.scheme,
        gradientOpacity: state.png.gradientOpacity,
        gradientShift: state.png.gradientShift,
        gradientScale: state.png.gradientScale,
        reliefStrength: state.png.reliefStrength,
        reliefWarm: state.png.reliefWarm,
        reliefShadow: state.png.reliefShadow,
        waterColor: state.mapFeatures?.waterAreas?.color,
        greenColor: state.mapFeatures?.greenAreas?.color
      });
      if(state.pngPreviewCache?.key === previewKey && state.pngPreviewCache.dataUrl) {
        return state.pngPreviewCache.dataUrl;
      }
      const alpha = Math.round(255 * clamp(toUnitOpacity(state.png.gradientOpacity), 0, 1));
      const ratio = state.hMm / state.wMm;
      const target = 320;
      let w = target;
      let h = Math.max(1, Math.round(target * ratio));
      if(h > target) {
        h = target;
        w = Math.max(1, Math.round(target / ratio));
      }
      const range = getShapeHeightRange();
      if(!range) return null;
      const boundaries = [range.minNorm, ...getContourLevels(range.minNorm, range.maxNorm), range.maxNorm];
      if(boundaries.length < 2) return null;
      const bandCount = Math.max(2, boundaries.length - 1);
      const bandColors = [];
      for(let i=0; i<boundaries.length - 1; i++) {
        const midNorm = (boundaries[i] + boundaries[i + 1]) / 2;
        const height = state.terrainData.min + midNorm;
        const t = range.maxZ === range.minZ ? 0 : (height - range.minZ) / (range.maxZ - range.minZ);
        bandColors.push(getHypsometricBandColor(t, state.png.scheme, bandCount));
      }
      const cv = document.createElement('canvas');
      cv.width = w;
      cv.height = h;
      const ctx = cv.getContext('2d');
      const gradientCanvas = document.createElement('canvas');
      gradientCanvas.width = w;
      gradientCanvas.height = h;
      const gradientCtx = gradientCanvas.getContext('2d');
      const imgData = gradientCtx.createImageData(w, h);
      const data = imgData.data;
      const step = 1 / Math.max(state.terrainData.cols - 1, state.terrainData.rows - 1);
      for(let y=0; y<h; y++) {
        const ny = h === 1 ? 0 : y / (h - 1);
        for(let x=0; x<w; x++) {
          const nx = w === 1 ? 0 : x / (w - 1);
          const zNorm = getZInterpolated(nx, ny);
          const { color: bandColor } = getSmoothedBandColor(zNorm, boundaries, bandColors);
          const height = state.terrainData.min + zNorm;
          const elevationT = range.maxZ === range.minZ ? 0 : (height - range.minZ) / (range.maxZ - range.minZ);
          const shade = getHillshade(nx, ny, step, zNorm);
          const color = applyReliefOverlay(bandColor, shade, elevationT);
          const idx = (y * w + x) * 4;
          data[idx] = color.r;
          data[idx + 1] = color.g;
          data[idx + 2] = color.b;
          data[idx + 3] = alpha;
        }
      }
      gradientCtx.putImageData(imgData, 0, 0);
      ctx.save();
      ctx.globalCompositeOperation = getCanvasBlendMode(state.png.blend);
      ctx.drawImage(gradientCanvas, 0, 0);
      ctx.restore();
      const dataUrl = cv.toDataURL('image/png');
      state.pngPreviewCache = { key: previewKey, dataUrl };
      return dataUrl;
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
            if(isInShape(p1[0], p1[1]) && isInShape(p2[0], p2[1])) {
              segments.push([p1, p2]);
            }
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
        const nextPts = [];
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
        pts = nextPts;
      }
      if(isClosed) pts.push(pts[0]);
      return pts;
    }

    function projectToSvg(lat, lon) {
      const bbox = state.renderBbox || state.bbox;
      if(!bbox) return [0, 0];
      const { sw, ne } = bbox;
      const x = ((lon - sw.lng) / (ne.lng - sw.lng)) * state.wMm;
      const y = ((ne.lat - lat) / (ne.lat - sw.lat)) * state.hMm;
      return [x, y];
    }

    function pathFromCoords(coords, closePath) {
      if(!coords.length) return '';
      const d = coords.map((pt, idx) => `${idx ? 'L' : 'M'} ${pt[0].toFixed(2)} ${pt[1].toFixed(2)}`).join(' ');
      return closePath ? `${d} Z` : d;
    }

    function normalizeRing(coords) {
      if(coords.length < 3) return coords;
      const first = coords[0];
      const last = coords[coords.length - 1];
      const closed = Math.hypot(first[0] - last[0], first[1] - last[1]) < 1e-6;
      return closed ? coords : [...coords, first];
    }

    function joinLineSegments(segments, tolerance = 0.4) {
      if(!segments.length) return [];
      const remaining = segments.map(seg => seg.slice());
      const rings = [];
      const closeEnough = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= tolerance;
      while(remaining.length) {
        let ring = remaining.pop();
        let merged = true;
        while(merged) {
          merged = false;
          for(let i = remaining.length - 1; i >= 0; i--) {
            const seg = remaining[i];
            const segStart = seg[0];
            const segEnd = seg[seg.length - 1];
            const ringStart = ring[0];
            const ringEnd = ring[ring.length - 1];
            if(closeEnough(ringEnd, segStart)) {
              ring = ring.concat(seg.slice(1));
              remaining.splice(i, 1);
              merged = true;
              break;
            }
            if(closeEnough(ringEnd, segEnd)) {
              ring = ring.concat(seg.slice(0, -1).reverse());
              remaining.splice(i, 1);
              merged = true;
              break;
            }
            if(closeEnough(ringStart, segEnd)) {
              ring = seg.slice(0, -1).concat(ring);
              remaining.splice(i, 1);
              merged = true;
              break;
            }
            if(closeEnough(ringStart, segStart)) {
              ring = seg.slice(1).reverse().concat(ring);
              remaining.splice(i, 1);
              merged = true;
              break;
            }
          }
        }
        if(ring.length >= 3) {
          rings.push(normalizeRing(ring));
        }
      }
      return rings;
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

    const overpassServers = [
      'https://overpass-api.de/api/interpreter',
      'https://overpass.kumi.systems/api/interpreter',
      'https://overpass.nchc.org.tw/api/interpreter'
    ];

    const buildOverpassQuery = (bbox) => `[out:json][timeout:25];
      (
        way["natural"="water"](${bbox});
        way["water"~"sea|ocean"](${bbox});
        way["waterway"="riverbank"](${bbox});
        relation["natural"="water"](${bbox});
        relation["water"~"sea|ocean"](${bbox});
        relation["waterway"="riverbank"](${bbox});
        way["waterway"~"river|stream|canal"](${bbox});
        way["landuse"~"forest|grass|meadow|recreation_ground"](${bbox});
        way["leisure"~"park|garden"](${bbox});
        way["natural"~"wood|grassland"](${bbox});
        relation["landuse"~"forest|grass|meadow|recreation_ground"](${bbox});
        relation["leisure"~"park|garden"](${bbox});
        relation["natural"~"wood|grassland"](${bbox});
        way["highway"~"motorway|trunk|primary|secondary|tertiary|residential|unclassified|service"](${bbox});
        relation["highway"~"motorway|trunk|primary|secondary|tertiary|residential|unclassified|service"](${bbox});
        node["place"~"city|town|village|suburb|hamlet|neighbourhood"](${bbox});
        node["natural"="peak"]["name"](${bbox});
      );
      out geom;`;

    const buildEmptyOsmData = () => ({
      waterPolygons: [],
      greenPolygons: [],
      waterLines: [],
      roadLines: [],
      labels: []
    });

    const parseOverpassElements = (elements, target) => {
      const greenLanduse = new Set(['forest', 'grass', 'meadow', 'recreation_ground']);
      const greenLeisure = new Set(['park', 'garden']);
      const greenNatural = new Set(['wood', 'grassland']);
      const waterLinesSet = new Set(['river', 'stream', 'canal']);
      const waterAreaSet = new Set(['sea', 'ocean']);
      const getMidpoint = (geometry) => {
        if(!Array.isArray(geometry) || !geometry.length) return null;
        return geometry[Math.floor(geometry.length / 2)];
      };

      const toSvgCoords = (geometry) => geometry.map(p => projectToSvg(p.lat, p.lon));

      elements.forEach((el) => {
        const tags = el.tags || {};
        if(el.type === 'node' && tags.name && tags.place) {
          target.labels.push({ name: tags.name, lat: el.lat, lon: el.lon, place: tags.place, kind: 'place' });
          return;
        }
        if(el.type === 'node' && tags.name && tags.natural === 'peak') {
          target.labels.push({ name: tags.name, lat: el.lat, lon: el.lon, kind: 'peak' });
          return;
        }
        if(el.type === 'way' && Array.isArray(el.geometry)) {
          const coords = toSvgCoords(el.geometry);
          if(tags.waterway && waterLinesSet.has(tags.waterway)) {
            target.waterLines.push(coords);
            if(tags.name) {
              const mid = getMidpoint(el.geometry);
              if(mid) {
                target.labels.push({ name: tags.name, lat: mid.lat, lon: mid.lon, kind: 'river' });
              }
            }
            return;
          }
          if(tags.highway) {
            target.roadLines.push(coords);
            return;
          }
          const isWater = tags.natural === 'water' || tags.waterway === 'riverbank' || waterAreaSet.has(tags.water);
          const isGreen = greenLanduse.has(tags.landuse) || greenLeisure.has(tags.leisure) || greenNatural.has(tags.natural);
          if(isWater) {
            target.waterPolygons.push(normalizeRing(coords));
            return;
          }
          if(isGreen) {
            target.greenPolygons.push(normalizeRing(coords));
          }
          return;
        }
        if(el.type === 'relation' && Array.isArray(el.members)) {
          const relationSegments = el.members
            .filter(m => m.role === 'outer' && Array.isArray(m.geometry))
            .map(m => toSvgCoords(m.geometry));
          const relationPolys = joinLineSegments(relationSegments);
          const isWater = tags.natural === 'water' || tags.waterway === 'riverbank' || waterAreaSet.has(tags.water);
          const isGreen = greenLanduse.has(tags.landuse) || greenLeisure.has(tags.leisure) || greenNatural.has(tags.natural);
          if(isWater) {
            target.waterPolygons.push(...(relationPolys.length ? relationPolys : relationSegments.map(normalizeRing)));
          }
          if(isGreen) {
            target.greenPolygons.push(...(relationPolys.length ? relationPolys : relationSegments.map(normalizeRing)));
          }
          if(tags.highway) {
            const relationLines = el.members
              .filter(m => Array.isArray(m.geometry))
              .map(m => toSvgCoords(m.geometry));
            target.roadLines.push(...relationLines);
          }
        }
      });
    };

    const fetchOverpass = async (query) => {
      let lastError = null;
      for(const server of overpassServers) {
        try {
          return await fetchJsonWithTimeout(
            server,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: `data=${encodeURIComponent(query)}`
            }
          );
        } catch (err) {
          lastError = err;
        }
      }
      throw lastError || new Error('Overpass error');
    };

    const getTiledBboxes = (sw, ne) => {
      const midLat = (sw.lat + ne.lat) / 2;
      const midLng = (sw.lng + ne.lng) / 2;
      return [
        { sw: { lat: sw.lat, lng: sw.lng }, ne: { lat: midLat, lng: midLng } },
        { sw: { lat: sw.lat, lng: midLng }, ne: { lat: midLat, lng: ne.lng } },
        { sw: { lat: midLat, lng: sw.lng }, ne: { lat: ne.lat, lng: midLng } },
        { sw: { lat: midLat, lng: midLng }, ne: { lat: ne.lat, lng: ne.lng } }
      ];
    };

    async function fetchMapFeatures(sw, ne) {
      state.osmStatus = { loaded: false, error: null, tiles: 1, ignored: false };
      const cacheId = bboxKey(sw, ne);
      const cached = cacheId ? osmCache.get(cacheId) : null;
      if(cached?.data) {
        state.osmData = typeof structuredClone === 'function' ? structuredClone(cached.data) : JSON.parse(JSON.stringify(cached.data));
        state.osmStatus.loaded = true;
        state.osmStatus.tiles = cached.tiles ?? 1;
        updateMapDataStatus({ announce: true });
        return true;
      }
      updateMapDataStatus({ announce: true, loading: true });
      const attemptFetch = async (bboxes) => {
        const osmData = buildEmptyOsmData();
        for(const bbox of bboxes) {
          const bboxStr = `${bbox.sw.lat},${bbox.sw.lng},${bbox.ne.lat},${bbox.ne.lng}`;
          const data = await fetchOverpass(buildOverpassQuery(bboxStr));
          parseOverpassElements(data.elements || [], osmData);
        }
        const placeRank = { city: 1, town: 2, village: 3, suburb: 4, neighbourhood: 5, hamlet: 6 };
        const labelRank = { peak: 2, river: 6 };
        const unique = new Map();
        osmData.labels.forEach((label) => {
          const key = `${label.name}-${label.lat}-${label.lon}-${label.kind || label.place || 'label'}`;
          if(!unique.has(key)) unique.set(key, label);
        });
        osmData.labels = Array.from(unique.values());
        osmData.labels.sort((a, b) => {
          const rankA = a.place ? (placeRank[a.place] || 99) : (labelRank[a.kind] || 99);
          const rankB = b.place ? (placeRank[b.place] || 99) : (labelRank[b.kind] || 99);
          return rankA - rankB;
        });
        osmData.labels = osmData.labels.slice(0, 36);
        return osmData;
      };

      try {
        state.osmData = await attemptFetch([{ sw, ne }]);
        state.osmStatus.loaded = true;
        state.osmStatus.tiles = 1;
        updateMapDataStatus({ announce: true });
        if(cacheId) osmCache.set(cacheId, { data: state.osmData, tiles: state.osmStatus.tiles });
        return true;
      } catch (err) {
        try {
          const tiledBboxes = getTiledBboxes(sw, ne);
          state.osmData = await attemptFetch(tiledBboxes);
          state.osmStatus.loaded = true;
          state.osmStatus.tiles = tiledBboxes.length;
          updateMapDataStatus({ announce: true });
          if(cacheId) osmCache.set(cacheId, { data: state.osmData, tiles: state.osmStatus.tiles });
          return true;
        } catch (tileErr) {
          state.osmData = buildEmptyOsmData();
          state.osmStatus.error = 'Roads, rivers or areas could not be loaded. Please try a smaller area or retry.';
          updateMapDataStatus({ announce: true });
          return false;
        }
      }
    }

    // --- MAP & SEARCH ---
    const map = new maplibregl.Map({
      container: 'map',
      style: {
        version: 8,
        sources: {
          opentopo: {
            type: 'raster',
            tiles: [
              'https://a.tile.opentopomap.org/{z}/{x}/{y}.png',
              'https://b.tile.opentopomap.org/{z}/{x}/{y}.png',
              'https://c.tile.opentopomap.org/{z}/{x}/{y}.png'
            ],
            tileSize: 256,
            attribution: '&copy; OpenTopoMap contributors &copy; OpenStreetMap'
          }
        },
        layers: [{ id: 'opentopo', type: 'raster', source: 'opentopo' }]
      },
      center: [86.925, 27.9881],
      zoom: 12
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    map.on('load', () => {
      map.resize();
      updateVf();
    });

    const SEARCH_DEBOUNCE_MS = 350;
    const SEARCH_TIMEOUT_MS = 8000;
    let timer;
    let activeSearch = null;
    $('searchInp').addEventListener('input', (e) => {
      clearTimeout(timer);
      const val = e.target.value;
      if(val.length<3) { $('suggestionBox').style.display='none'; return; }
      timer = setTimeout(async () => {
        try {
          if(activeSearch) {
            activeSearch.abort();
          }
          activeSearch = new AbortController();
          const d = await fetchJsonWithTimeout(
            `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(val)}&limit=5`,
            { signal: activeSearch.signal },
            SEARCH_TIMEOUT_MS
          );
          const box = $('suggestionBox'); box.innerHTML='';
          if(d.length) {
            d.forEach(i => {
              const div = document.createElement('div'); div.className = 'suggestion-item';
              div.innerText = i.display_name.split(',').slice(0,3).join(',');
              div.onclick = () => { map.flyTo({ center: [Number(i.lon), Number(i.lat)], zoom: 14, essential: true }); box.style.display='none'; $('searchInp').value=div.innerText; };
              box.appendChild(div);
            });
            box.style.display='block';
          }
        } catch(e) {
          if (e.name !== 'AbortError') {
            $('suggestionBox').style.display='none';
          }
        }
      }, SEARCH_DEBOUNCE_MS);
    });

    // --- UI CONSTRUCTION ---
    document.querySelectorAll('.layer-head').forEach((head) => {
      head.onclick = (e) => {
        const item = e.currentTarget.closest('.layer-item');
        if(item?.classList.contains('dragging')) return;
        item.classList.toggle('open');
      };
    });
    document.querySelectorAll('.layer-head .ios-switch').forEach((toggle) => {
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
      });
    });

    const syncLayerOrder = (container) => {
      if(!container) return;
      const orderedItems = Array.from(container.children).filter(el => el.dataset.layer);
      state.layerOrder = orderedItems.map(el => el.dataset.layer);
      orderedItems.forEach((item, idx) => {
        const upBtn = item.querySelector('[data-move="up"]');
        const downBtn = item.querySelector('[data-move="down"]');
        if(upBtn) upBtn.disabled = idx === 0;
        if(downBtn) downBtn.disabled = idx === orderedItems.length - 1;
      });
    };

    const moveLayerItem = (item, direction) => {
      const container = item?.closest('.layer-list');
      if(!container) return;
      const siblings = Array.from(container.children).filter(el => el.dataset.layer);
      const index = siblings.indexOf(item);
      const nextIndex = index + direction;
      if(index === -1 || nextIndex < 0 || nextIndex >= siblings.length) return;
      if(direction < 0) {
        container.insertBefore(item, siblings[nextIndex]);
      } else {
        container.insertBefore(item, siblings[nextIndex].nextSibling);
      }
      syncLayerOrder(container);
      markPreviewDirty();
      pushHistoryState();
    };

    const setupLayerReorder = (container) => {
      if(!container) return;
      let draggedItem = null;
      let dragPreview = null;
      const insertIndicator = document.createElement('div');
      insertIndicator.className = 'layer-insert-indicator';
      container.appendChild(insertIndicator);
      const items = Array.from(container.querySelectorAll('[draggable="true"]'));
      items.forEach((item) => {
        let handleActive = false;
        const dragHandle = item.querySelector('.drag-handle');
        if(dragHandle) {
          dragHandle.addEventListener('pointerdown', () => { handleActive = true; });
          dragHandle.addEventListener('pointerup', () => { handleActive = false; });
          dragHandle.addEventListener('pointerleave', () => { handleActive = false; });
        }
        item.querySelectorAll('[data-move]').forEach((btn) => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const direction = btn.dataset.move === 'up' ? -1 : 1;
            moveLayerItem(item, direction);
          });
        });
        item.addEventListener('dragstart', (e) => {
          if(!handleActive) {
            e.preventDefault();
            return;
          }
          draggedItem = item;
          item.classList.add('dragging');
          insertIndicator.style.display = 'none';
          if(e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'move';
            dragPreview = item.cloneNode(true);
            dragPreview.classList.add('drag-ghost');
            dragPreview.style.width = `${item.offsetWidth}px`;
            document.body.appendChild(dragPreview);
            const handleRect = dragHandle?.getBoundingClientRect();
            const itemRect = item.getBoundingClientRect();
            const offsetX = handleRect ? handleRect.left - itemRect.left + handleRect.width / 2 : 20;
            const offsetY = handleRect ? handleRect.top - itemRect.top + handleRect.height / 2 : 20;
            e.dataTransfer.setDragImage(dragPreview, offsetX, offsetY);
          }
        });
        item.addEventListener('dragend', () => {
          item.classList.remove('dragging');
          draggedItem = null;
          handleActive = false;
          if(dragPreview) {
            dragPreview.remove();
            dragPreview = null;
          }
          insertIndicator.style.display = 'none';
        });
        item.addEventListener('dragover', (e) => {
          e.preventDefault();
          if(!draggedItem) return;
          const target = e.currentTarget;
          if(!target || target === draggedItem) return;
          const rect = target.getBoundingClientRect();
          const insertBefore = e.clientY < rect.top + rect.height / 2;
          insertIndicator.style.display = 'block';
          container.insertBefore(insertIndicator, insertBefore ? target : target.nextSibling);
        });
        item.addEventListener('drop', (e) => {
          e.preventDefault();
          if(!draggedItem || draggedItem === item) return;
          const siblings = Array.from(container.children).filter(el => el.dataset.layer);
          const draggedIndex = siblings.indexOf(draggedItem);
          const targetIndex = siblings.indexOf(item);
          if(draggedIndex < targetIndex) {
            container.insertBefore(draggedItem, item.nextSibling);
          } else {
            container.insertBefore(draggedItem, item);
          }
          syncLayerOrder(container);
          markPreviewDirty();
          pushHistoryState();
          insertIndicator.style.display = 'none';
        });
      });
      syncLayerOrder(container);
    };

    const layerStack = $('layerStack');
    setupLayerReorder(layerStack);

    const stepButtons = document.querySelectorAll('[data-step-target]');
    const stepContents = document.querySelectorAll('.step-content');
    const setStep = (step) => {
      stepButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.stepTarget === step));
      stepContents.forEach(section => section.classList.toggle('active', section.dataset.step === step));
    };
    stepButtons.forEach(btn => btn.addEventListener('click', () => setStep(btn.dataset.stepTarget)));
    const toExport = $('toExport');
    if(toExport) toExport.addEventListener('click', () => setStep('3'));
    const backToStyle = $('backToStyle');
    if(backToStyle) backToStyle.addEventListener('click', () => setStep('2'));
    if(refreshPreviewBtn) {
      refreshPreviewBtn.addEventListener('click', () => {
        if(!state.terrainData) return;
        state.autoPreview = !state.autoPreview;
        updateAutoPreviewButton();
        if(state.autoPreview && state.previewDirty) {
          renderSVG();
        }
      });
    }
    if(undoStep2Btn) {
      undoStep2Btn.addEventListener('click', () => {
        if(historyState.past.length <= 1) return;
        const current = historyState.past.pop();
        historyState.future.push(current);
        applyHistorySnapshot(historyState.past[historyState.past.length - 1]);
      });
    }
    if(redoStep2Btn) {
      redoStep2Btn.addEventListener('click', () => {
        const snapshot = historyState.future.pop();
        if(!snapshot) return;
        historyState.past.push(snapshot);
        applyHistorySnapshot(snapshot);
      });
    }
    if(mapDataNoticeClose) {
      mapDataNoticeClose.addEventListener('click', () => {
        hideMapNotice();
      });
    }
    const resetStep2Btn = $('resetStep2');
    if(resetStep2Btn) {
      resetStep2Btn.addEventListener('click', () => {
        state.contour = { ...defaultDesign.contour };
        state.png = { ...defaultDesign.png };
        state.theme = { ...defaultDesign.theme };
        state.mapFeatures = {
          waterAreas: { ...defaultDesign.mapFeatures.waterAreas },
          rivers: { ...defaultDesign.mapFeatures.rivers },
          greenAreas: { ...defaultDesign.mapFeatures.greenAreas },
          roads: { ...defaultDesign.mapFeatures.roads },
          labels: {
            ...defaultDesign.mapFeatures.labels,
            background: { ...defaultDesign.mapFeatures.labels.background }
          }
        };
        state.layerOrder = [...defaultDesign.layerOrder];
        syncUiFromState();
        markPreviewDirty();
        pushHistoryState();
      });
    }

    const presets = {
      dark: {
        background: '#141A22',
        line: '#D7E3FF',
        mapFeatures: {
          waterAreas: '#4C86A8',
          rivers: '#4C86A8',
          greenAreas: '#4E7E5A',
          roads: '#6A4322',
          labels: '#F5F7FB'
        }
      },
      bright: {
        background: '#F5F2EB',
        line: '#10141B',
        mapFeatures: {
          waterAreas: '#7DB5D3',
          rivers: '#7DB5D3',
          greenAreas: '#7FAE8A',
          roads: '#5B3A1C',
          labels: '#1E232B'
        }
      },
      grayscale: {
        background: '#1C1C1C',
        line: '#D6D6D6',
        mapFeatures: {
          waterAreas: '#5A5A5A',
          rivers: '#5A5A5A',
          greenAreas: '#444444',
          roads: '#4F3E34',
          labels: '#F2F2F2'
        }
      }
    };

    const parseColorInput = (value) => {
      const v = value.trim();
      if(!v) return null;
      const tester = new Option().style;
      tester.color = v;
      return tester.color ? tester.color : null;
    };

    const rgbToHex = (rgb) => {
      const match = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
      if(!match) return null;
      const toHex = (n) => n.toString(16).padStart(2, '0');
      return `#${toHex(parseInt(match[1], 10))}${toHex(parseInt(match[2], 10))}${toHex(parseInt(match[3], 10))}`.toUpperCase();
    };

    const toPercent = (value) => {
      const parsed = parseFloat(value);
      if(Number.isNaN(parsed)) return 0;
      return Math.min(100, Math.max(0, parsed));
    };

    const formatPercent = (value) => `${Math.round(value)}%`;
    const toUnitOpacity = (value) => Math.min(1, Math.max(0, value / 100));
    const formatSignedPercent = (value) => {
      const rounded = Math.round(value);
      return `${rounded > 0 ? '+' : ''}${rounded}%`;
    };
    const formatNthLineLabel = (value) => {
      const n = Math.max(0, Math.round(value));
      if(n <= 0) return 'Off';
      if(n === 1) return 'Every line';
      return `${n}th line`;
    };
    const getBlendMode = (mode) => {
      const allowed = ['normal', 'multiply', 'color'];
      return allowed.includes(mode) ? mode : 'normal';
    };
    const getCanvasBlendMode = (mode) => (getBlendMode(mode) === 'normal' ? 'source-over' : getBlendMode(mode));
    const updateBlendStyle = (mode) => {
      const blendMode = getBlendMode(mode);
      return blendMode === 'normal' ? '' : ` style="mix-blend-mode:${blendMode};"`;
    };

    let previewTimer = null;
    const historyState = { past: [], future: [] };
    const historyLimit = 5;
    let isRestoringHistory = false;

    const getDesignSnapshot = () => JSON.stringify({
      theme: state.theme,
      contour: state.contour,
      png: state.png,
      mapFeatures: state.mapFeatures,
      layerOrder: state.layerOrder
    });

    const updateHistoryButtons = () => {
      if(undoStep2Btn) undoStep2Btn.disabled = historyState.past.length <= 1;
      if(redoStep2Btn) redoStep2Btn.disabled = historyState.future.length === 0;
    };

    const pushHistoryState = () => {
      if(isRestoringHistory) return;
      const snapshot = getDesignSnapshot();
      const last = historyState.past[historyState.past.length - 1];
      if(snapshot === last) return;
      historyState.past.push(snapshot);
      if(historyState.past.length > historyLimit) historyState.past.shift();
      historyState.future = [];
      updateHistoryButtons();
    };

    const applyHistorySnapshot = (snapshot) => {
      if(!snapshot) return;
      isRestoringHistory = true;
      const parsed = JSON.parse(snapshot);
      state.theme = parsed.theme;
      state.contour = parsed.contour;
      state.png = parsed.png;
      state.mapFeatures = parsed.mapFeatures;
      state.layerOrder = parsed.layerOrder;
      syncUiFromState();
      isRestoringHistory = false;
      updateHistoryButtons();
    };

    const updateAutoPreviewButton = () => {
      if(!refreshPreviewBtn) return;
      const label = state.autoPreview ? 'Auto Preview On' : 'Auto Preview Off';
      const dirtyHint = !state.autoPreview && state.previewDirty ? ' - Needs Refresh' : '';
      refreshPreviewBtn.textContent = `${label}${dirtyHint}`;
      refreshPreviewBtn.classList.toggle('is-on', state.autoPreview);
      refreshPreviewBtn.disabled = !state.terrainData;
    };

    let mapNoticeTimer = null;
    const showMapNotice = (text, { sticky = false } = {}) => {
      if(!mapDataNotice || !mapDataNoticeText) return;
      mapDataNoticeText.textContent = text;
      mapDataNotice.classList.add('show');
      if(mapNoticeTimer) clearTimeout(mapNoticeTimer);
      if(!sticky) {
        mapNoticeTimer = setTimeout(() => {
          mapDataNotice.classList.remove('show');
        }, 5000);
      }
    };
    const hideMapNotice = () => {
      if(mapNoticeTimer) clearTimeout(mapNoticeTimer);
      if(mapDataNotice) mapDataNotice.classList.remove('show');
    };

    const schedulePreviewRender = () => {
      if(!state.terrainData || !state.autoPreview) return;
      if(previewTimer) clearTimeout(previewTimer);
      previewTimer = setTimeout(() => {
        previewTimer = null;
        if(state.previewDirty) {
          renderSVG();
        }
      }, 120);
    };

    const markPreviewDirty = () => {
      if(!state.terrainData) return;
      state.previewDirty = true;
      updateAutoPreviewButton();
      schedulePreviewRender();
    };

    const applyTheme = () => {
      $('previewArea').style.background = state.theme.background;
      state.contour.color = state.theme.line;
      $('contourColor').value = state.contour.color;
      $('contourColor').parentElement.style.background = state.contour.color;
      const previewBg = $('previewArea')?.querySelector('#previewBackground');
      if(previewBg) {
        previewBg.setAttribute('fill', state.theme.background);
      }
      markPreviewDirty();
    };

    const syncWaterColors = (color) => {
      state.mapFeatures.waterAreas.color = color;
      state.mapFeatures.rivers.color = color;
      $('waterAreaColor').value = color;
      $('waterAreaColorDot').style.background = color;
      $('riverColor').value = color;
      $('riverColorDot').style.background = color;
    };

    const applyPresetMapFeatures = (preset) => {
      if(!preset?.mapFeatures) return;
      syncWaterColors(preset.mapFeatures.waterAreas);
      state.mapFeatures.greenAreas.color = preset.mapFeatures.greenAreas;
      $('greenAreaColor').value = state.mapFeatures.greenAreas.color;
      $('greenAreaColorDot').style.background = state.mapFeatures.greenAreas.color;
      state.mapFeatures.roads.color = preset.mapFeatures.roads;
      $('roadColor').value = state.mapFeatures.roads.color;
      $('roadColorDot').style.background = state.mapFeatures.roads.color;
      state.mapFeatures.labels.color = preset.mapFeatures.labels;
      $('labelColor').value = state.mapFeatures.labels.color;
      $('labelColorDot').style.background = state.mapFeatures.labels.color;
    };

    const getLabelSize = (place) => {
      const base = state.mapFeatures.labels.size;
      if(!state.mapFeatures.labels.scaleByRank || !(place?.place || place?.kind)) return base;
      const scaleMap = {
        city: 3,
        town: 2.6,
        village: 2.3,
        suburb: 2.2,
        neighbourhood: 2.1,
        hamlet: 2,
        peak: 2.4,
        river: 1.8
      };
      const key = place.place || place.kind;
      return base * (scaleMap[key] || 1);
    };

    const getOverlayAlignmentStatus = () => {
      const bbox = state.renderBbox || state.bbox;
      if(!bbox || !state.terrainData) return null;
      const alignmentPoints = [
        { lat: bbox.ne.lat, lon: bbox.sw.lng, expected: [0, 0] },
        { lat: bbox.ne.lat, lon: bbox.ne.lng, expected: [state.wMm, 0] },
        { lat: bbox.sw.lat, lon: bbox.sw.lng, expected: [0, state.hMm] },
        { lat: (bbox.sw.lat + bbox.ne.lat) / 2, lon: (bbox.sw.lng + bbox.ne.lng) / 2, expected: [state.wMm / 2, state.hMm / 2] }
      ];
      let maxDelta = 0;
      alignmentPoints.forEach((pt) => {
        const [x, y] = projectToSvg(pt.lat, pt.lon);
        const dx = x - pt.expected[0];
        const dy = y - pt.expected[1];
        maxDelta = Math.max(maxDelta, Math.hypot(dx, dy));
      });
      return { ok: maxDelta <= 0.5, delta: maxDelta };
    };

    const ensureOverlayAlignment = async () => {
      if(!state.renderBbox) return;
      const alignmentStatus = getOverlayAlignmentStatus();
      if(alignmentStatus?.ok) return;
      const { sw, ne } = state.renderBbox;
      await fetchMapFeatures(sw, ne);
    };

    const updateMapDataStatus = ({ announce = false, loading = false } = {}) => {
      const alignmentStatus = getOverlayAlignmentStatus();
      const alignmentLabel = alignmentStatus ? ` | Alignment ${alignmentStatus.ok ? 'OK' : 'Check'}` : '';
      if(!announce) return;
      if(loading) {
        showMapNotice('Map data loading...', { sticky: true });
        return;
      }
      if(state.osmStatus?.loaded && state.osmData) {
        const tilesLabel = state.osmStatus.tiles > 1 ? ` | ${state.osmStatus.tiles} tiles` : '';
        showMapNotice(`Map data loaded: Water ${state.osmData.waterPolygons.length}, Rivers ${state.osmData.waterLines.length}, Roads ${state.osmData.roadLines.length}, Green ${state.osmData.greenPolygons.length}, Labels ${state.osmData.labels.length}${tilesLabel}${alignmentLabel}`);
        return;
      }
      if(state.osmStatus?.error) {
        const suffix = state.osmStatus.ignored ? ' (ignored)' : '';
        showMapNotice(`Map data missing${suffix}: ${state.osmStatus.error}${alignmentLabel}`);
      }
    };

    const syncCustomField = (value, pickerId, textId, dotId) => {
      const parsed = parseColorInput(value);
      if(!parsed) return;
      const hex = parsed.startsWith('rgb') ? rgbToHex(parsed) : parsed;
      if(hex) $(pickerId).value = hex;
      $(textId).value = value;
      $(dotId).style.background = parsed;
    };

    $('presetSel').onchange = (e) => {
      const preset = e.target.value;
      const presetConfig = presets[preset];
      state.theme.preset = preset;
      state.theme.background = presetConfig.background;
      state.theme.line = presetConfig.line;
      $('bgColorPicker').value = state.theme.background;
      $('lineColorPicker').value = state.theme.line;
      $('bgColorText').value = state.theme.background;
      $('lineColorText').value = state.theme.line;
      $('bgColorDot').style.background = state.theme.background;
      $('lineColorDot').style.background = state.theme.line;
      applyPresetMapFeatures(presetConfig);
      applyTheme();
    };

    $('bgColorPicker').oninput = (e) => {
      state.theme.background = e.target.value;
      $('bgColorDot').style.background = state.theme.background;
      $('bgColorText').value = state.theme.background;
      applyTheme();
    };
    $('lineColorPicker').oninput = (e) => {
      state.theme.line = e.target.value;
      $('lineColorDot').style.background = state.theme.line;
      $('lineColorText').value = state.theme.line;
      applyTheme();
    };
    $('bgColorText').onchange = (e) => {
      const parsed = parseColorInput(e.target.value);
      if(!parsed) return;
      state.theme.background = parsed.startsWith('rgb') ? parsed : e.target.value;
      syncCustomField(parsed, 'bgColorPicker', 'bgColorText', 'bgColorDot');
      applyTheme();
    };
    $('lineColorText').onchange = (e) => {
      const parsed = parseColorInput(e.target.value);
      if(!parsed) return;
      state.theme.line = parsed.startsWith('rgb') ? parsed : e.target.value;
      syncCustomField(parsed, 'lineColorPicker', 'lineColorText', 'lineColorDot');
      applyTheme();
    };

    $('contourColor').oninput = (e) => {
      state.contour.color = e.target.value;
      e.target.parentElement.style.background = state.contour.color;
      state.theme.line = state.contour.color;
      $('lineColorPicker').value = state.contour.color;
      $('lineColorText').value = state.contour.color;
      $('lineColorDot').style.background = state.contour.color;
      markPreviewDirty();
    };

    const setContourWidth = (value) => {
      if(value === '') return;
      const width = clampLineWidth(value);
      state.contour.width = width;
      $('contourWidth').value = width;
      $('contourWidthInput').value = formatWidthInput(width);
      markPreviewDirty();
    };
    $('contourWidth').oninput = (e) => setContourWidth(e.target.value);
    $('contourWidthInput').oninput = (e) => setContourWidth(e.target.value);
    $('contourEmphasis').oninput = (e) => {
      const raw = parseInt(e.target.value, 10);
      const val = Math.min(20, Math.max(0, Number.isNaN(raw) ? 0 : raw));
      state.contour.emphasisEvery = val;
      $('contourEmphasisVal').innerText = formatNthLineLabel(val);
      markPreviewDirty();
    };

    $('contourDensity').oninput = (e) => {
      state.contour.density = parseInt(e.target.value, 10);
      $('contourDensityVal').innerText = state.contour.density;
      markPreviewDirty();
    };

    $('contourOpacity').oninput = (e) => {
      state.contour.opacity = toPercent(e.target.value);
      $('contourOpacityVal').innerText = formatPercent(state.contour.opacity);
      markPreviewDirty();
    };

    $('contourSmooth').oninput = (e) => {
      state.contour.smooth = parseInt(e.target.value, 10);
      $('contourSmoothVal').innerText = state.contour.smooth;
      markPreviewDirty();
    };

    $('contourToggle').onclick = function() {
      state.contour.enabled = !state.contour.enabled;
      this.classList.toggle('on', state.contour.enabled);
      markPreviewDirty();
    };

    $('waterAreaToggle').onclick = function() {
      state.mapFeatures.waterAreas.enabled = !state.mapFeatures.waterAreas.enabled;
      this.classList.toggle('on', state.mapFeatures.waterAreas.enabled);
      markPreviewDirty();
    };
    $('waterAreaColor').oninput = (e) => {
      syncWaterColors(e.target.value);
      markPreviewDirty();
    };
    $('waterAreaOpacity').oninput = (e) => {
      state.mapFeatures.waterAreas.opacity = toPercent(e.target.value);
      $('waterAreaOpacityVal').innerText = formatPercent(state.mapFeatures.waterAreas.opacity);
      markPreviewDirty();
    };
    $('riverToggle').onclick = function() {
      state.mapFeatures.rivers.enabled = !state.mapFeatures.rivers.enabled;
      this.classList.toggle('on', state.mapFeatures.rivers.enabled);
      markPreviewDirty();
    };
    $('riverColor').oninput = (e) => {
      syncWaterColors(e.target.value);
      markPreviewDirty();
    };
    const setRiverWidth = (value) => {
      if(value === '') return;
      const width = clampLineWidth(value);
      state.mapFeatures.rivers.width = width;
      $('riverWidth').value = width;
      $('riverWidthInput').value = formatWidthInput(width);
      markPreviewDirty();
    };
    $('riverWidth').oninput = (e) => setRiverWidth(e.target.value);
    $('riverWidthInput').oninput = (e) => setRiverWidth(e.target.value);
    $('riverOpacity').oninput = (e) => {
      state.mapFeatures.rivers.opacity = toPercent(e.target.value);
      $('riverOpacityVal').innerText = formatPercent(state.mapFeatures.rivers.opacity);
      markPreviewDirty();
    };
    $('greenAreaToggle').onclick = function() {
      state.mapFeatures.greenAreas.enabled = !state.mapFeatures.greenAreas.enabled;
      this.classList.toggle('on', state.mapFeatures.greenAreas.enabled);
      markPreviewDirty();
    };
    $('greenAreaColor').oninput = (e) => {
      state.mapFeatures.greenAreas.color = e.target.value;
      $('greenAreaColorDot').style.background = state.mapFeatures.greenAreas.color;
      markPreviewDirty();
    };
    $('greenAreaOpacity').oninput = (e) => {
      state.mapFeatures.greenAreas.opacity = toPercent(e.target.value);
      $('greenAreaOpacityVal').innerText = formatPercent(state.mapFeatures.greenAreas.opacity);
      markPreviewDirty();
    };
    $('roadToggle').onclick = function() {
      state.mapFeatures.roads.enabled = !state.mapFeatures.roads.enabled;
      this.classList.toggle('on', state.mapFeatures.roads.enabled);
      markPreviewDirty();
    };
    $('roadColor').oninput = (e) => {
      state.mapFeatures.roads.color = e.target.value;
      $('roadColorDot').style.background = state.mapFeatures.roads.color;
      markPreviewDirty();
    };
    const setRoadWidth = (value) => {
      if(value === '') return;
      const width = clampLineWidth(value);
      state.mapFeatures.roads.width = width;
      $('roadWidth').value = width;
      $('roadWidthInput').value = formatWidthInput(width);
      markPreviewDirty();
    };
    $('roadWidth').oninput = (e) => setRoadWidth(e.target.value);
    $('roadWidthInput').oninput = (e) => setRoadWidth(e.target.value);
    $('roadOpacity').oninput = (e) => {
      state.mapFeatures.roads.opacity = toPercent(e.target.value);
      $('roadOpacityVal').innerText = formatPercent(state.mapFeatures.roads.opacity);
      markPreviewDirty();
    };
    $('labelToggle').onclick = function() {
      state.mapFeatures.labels.enabled = !state.mapFeatures.labels.enabled;
      this.classList.toggle('on', state.mapFeatures.labels.enabled);
      markPreviewDirty();
    };
    $('labelColor').oninput = (e) => {
      state.mapFeatures.labels.color = e.target.value;
      $('labelColorDot').style.background = state.mapFeatures.labels.color;
      markPreviewDirty();
    };
    $('labelBgToggle').onclick = function() {
      state.mapFeatures.labels.background.enabled = !state.mapFeatures.labels.background.enabled;
      this.classList.toggle('on', state.mapFeatures.labels.background.enabled);
      markPreviewDirty();
    };
    $('labelBgColor').oninput = (e) => {
      state.mapFeatures.labels.background.color = e.target.value;
      $('labelBgColorDot').style.background = state.mapFeatures.labels.background.color;
      markPreviewDirty();
    };
    $('labelOpacity').oninput = (e) => {
      state.mapFeatures.labels.opacity = toPercent(e.target.value);
      $('labelOpacityVal').innerText = formatPercent(state.mapFeatures.labels.opacity);
      markPreviewDirty();
    };
    $('labelSize').oninput = (e) => {
      state.mapFeatures.labels.size = parseFloat(e.target.value);
      $('labelSizeVal').innerText = formatMm(state.mapFeatures.labels.size);
      markPreviewDirty();
    };
    $('labelScaleToggle').onclick = function() {
      state.mapFeatures.labels.scaleByRank = !state.mapFeatures.labels.scaleByRank;
      this.classList.toggle('on', state.mapFeatures.labels.scaleByRank);
      markPreviewDirty();
    };
    $('labelFont').onchange = (e) => {
      state.mapFeatures.labels.font = e.target.value;
      markPreviewDirty();
    };
    $('labelBoldToggle').onclick = function() {
      state.mapFeatures.labels.weight = state.mapFeatures.labels.weight === 'bold' ? 'normal' : 'bold';
      this.classList.toggle('on', state.mapFeatures.labels.weight === 'bold');
      markPreviewDirty();
    };
    $('labelItalicToggle').onclick = function() {
      state.mapFeatures.labels.style = state.mapFeatures.labels.style === 'italic' ? 'normal' : 'italic';
      this.classList.toggle('on', state.mapFeatures.labels.style === 'italic');
      markPreviewDirty();
    };
    const buildHypsometricPreview = (scheme) => {
      const stops = getHypsometricStops(scheme);
      const step = 100 / stops.length;
      const segments = stops.map((color, idx) => {
        const start = (idx * step).toFixed(2);
        const end = ((idx + 1) * step).toFixed(2);
        return `${color} ${start}%, ${color} ${end}%`;
      });
      return `linear-gradient(90deg, ${segments.join(', ')})`;
    };

    const updateGradientPreview = () => {
      $('pngGradientPreview').style.background = buildHypsometricPreview(state.png.scheme);
    };

    const updatePngRangeInfo = () => {
      const range = getShapeHeightRange();
      if(!range) {
        $('pngRangeInfo').innerText = 'Range: --';
        return;
      }
      $('pngRangeInfo').innerText = `Range: ${Math.round(range.minZ)} m - ${Math.round(range.maxZ)} m`;
    };

    $('pngResRange').oninput = (e) => { $('pngResVal').innerText = e.target.value + 'px'; };

    $('pngLayerToggle').onclick = function() {
      state.png.layered = !state.png.layered;
      this.classList.toggle('on', state.png.layered);
      $('pngLayerOptions').style.display = state.png.layered ? 'block' : 'none';
      updateGradientPreview();
      updatePngRangeInfo();
      markPreviewDirty();
    };

    $('pngScheme').onchange = (e) => {
      state.png.scheme = e.target.value;
      updateGradientPreview();
      if(state.png.layered) markPreviewDirty();
    };
    $('pngBlendMode').onchange = (e) => {
      state.png.blend = getBlendMode(e.target.value);
      if(state.png.layered) markPreviewDirty();
    };
    $('pngGradOpacity').oninput = (e) => {
      state.png.gradientOpacity = toPercent(e.target.value);
      $('pngGradOpacityVal').innerText = formatPercent(state.png.gradientOpacity);
      if(state.png.layered) markPreviewDirty();
    };
    $('pngGradShift').oninput = (e) => {
      state.png.gradientShift = parseFloat(e.target.value);
      $('pngGradShiftVal').innerText = formatSignedPercent(state.png.gradientShift);
      if(state.png.layered) markPreviewDirty();
    };
    $('pngGradScale').oninput = (e) => {
      state.png.gradientScale = parseFloat(e.target.value);
      $('pngGradScaleVal').innerText = formatPercent(state.png.gradientScale);
      if(state.png.layered) markPreviewDirty();
    };

    $('shapeSel').onchange = (e) => {
      state.shape = e.target.value;
      $('dimH').disabled = ['sq','circle','hex','din_l','din_p'].includes(state.shape);
      updateVf();
    };
    ['dimW','dimH'].forEach(id => $(id).oninput = updateVf);

    const syncUiFromState = () => {
      $('presetSel').value = state.theme.preset;
      $('bgColorText').value = state.theme.background;
      $('lineColorText').value = state.theme.line;
      $('bgColorDot').style.background = state.theme.background;
      $('lineColorDot').style.background = state.theme.line;
      $('bgColorPicker').value = state.theme.background;
      $('lineColorPicker').value = state.theme.line;
      $('contourToggle').classList.toggle('on', state.contour.enabled);
      $('contourColor').value = state.contour.color;
      $('contourColor').parentElement.style.background = state.contour.color;
      $('contourWidth').value = state.contour.width;
      $('contourWidthInput').value = formatWidthInput(state.contour.width);
      $('contourEmphasis').value = state.contour.emphasisEvery ?? 0;
      $('contourEmphasisVal').innerText = formatNthLineLabel(state.contour.emphasisEvery);
      $('contourDensity').value = state.contour.density;
      $('contourDensityVal').innerText = state.contour.density;
      $('contourOpacity').value = state.contour.opacity;
      $('contourOpacityVal').innerText = formatPercent(state.contour.opacity);
      $('contourSmooth').value = state.contour.smooth;
      $('contourSmoothVal').innerText = state.contour.smooth;
      $('waterAreaToggle').classList.toggle('on', state.mapFeatures.waterAreas.enabled);
      $('waterAreaColor').value = state.mapFeatures.waterAreas.color;
      $('waterAreaColorDot').style.background = state.mapFeatures.waterAreas.color;
      $('waterAreaOpacity').value = state.mapFeatures.waterAreas.opacity;
      $('waterAreaOpacityVal').innerText = formatPercent(state.mapFeatures.waterAreas.opacity);
      $('riverToggle').classList.toggle('on', state.mapFeatures.rivers.enabled);
      $('riverColor').value = state.mapFeatures.rivers.color;
      $('riverColorDot').style.background = state.mapFeatures.rivers.color;
      $('riverWidth').value = state.mapFeatures.rivers.width;
      $('riverWidthInput').value = formatWidthInput(state.mapFeatures.rivers.width);
      $('riverOpacity').value = state.mapFeatures.rivers.opacity;
      $('riverOpacityVal').innerText = formatPercent(state.mapFeatures.rivers.opacity);
      $('greenAreaToggle').classList.toggle('on', state.mapFeatures.greenAreas.enabled);
      $('greenAreaColor').value = state.mapFeatures.greenAreas.color;
      $('greenAreaColorDot').style.background = state.mapFeatures.greenAreas.color;
      $('greenAreaOpacity').value = state.mapFeatures.greenAreas.opacity;
      $('greenAreaOpacityVal').innerText = formatPercent(state.mapFeatures.greenAreas.opacity);
      $('roadToggle').classList.toggle('on', state.mapFeatures.roads.enabled);
      $('roadColor').value = state.mapFeatures.roads.color;
      $('roadColorDot').style.background = state.mapFeatures.roads.color;
      $('roadWidth').value = state.mapFeatures.roads.width;
      $('roadWidthInput').value = formatWidthInput(state.mapFeatures.roads.width);
      $('roadOpacity').value = state.mapFeatures.roads.opacity;
      $('roadOpacityVal').innerText = formatPercent(state.mapFeatures.roads.opacity);
      $('labelToggle').classList.toggle('on', state.mapFeatures.labels.enabled);
      $('labelColor').value = state.mapFeatures.labels.color;
      $('labelColorDot').style.background = state.mapFeatures.labels.color;
      $('labelBgToggle').classList.toggle('on', state.mapFeatures.labels.background.enabled);
      $('labelBgColor').value = state.mapFeatures.labels.background.color;
      $('labelBgColorDot').style.background = state.mapFeatures.labels.background.color;
      $('labelOpacity').value = state.mapFeatures.labels.opacity;
      $('labelOpacityVal').innerText = formatPercent(state.mapFeatures.labels.opacity);
      $('labelSize').value = state.mapFeatures.labels.size;
      $('labelSizeVal').innerText = formatMm(state.mapFeatures.labels.size);
      $('labelScaleToggle').classList.toggle('on', state.mapFeatures.labels.scaleByRank);
      $('labelFont').value = state.mapFeatures.labels.font;
      $('labelBoldToggle').classList.toggle('on', state.mapFeatures.labels.weight === 'bold');
      $('labelItalicToggle').classList.toggle('on', state.mapFeatures.labels.style === 'italic');
      $('pngScheme').value = state.png.scheme;
      $('pngBlendMode').value = state.png.blend;
      $('pngGradOpacity').value = state.png.gradientOpacity;
      $('pngGradOpacityVal').innerText = formatPercent(state.png.gradientOpacity);
      $('pngGradShift').value = state.png.gradientShift;
      $('pngGradShiftVal').innerText = formatSignedPercent(state.png.gradientShift);
      $('pngGradScale').value = state.png.gradientScale;
      $('pngGradScaleVal').innerText = formatPercent(state.png.gradientScale);
      $('pngLayerToggle').classList.toggle('on', state.png.layered);
      $('pngLayerOptions').style.display = state.png.layered ? 'block' : 'none';
      if(layerStack) {
        state.layerOrder.forEach((key) => {
          const item = layerStack.querySelector(`[data-layer="${key}"]`);
          if(item) layerStack.appendChild(item);
        });
      }
      updateGradientPreview();
      applyTheme();
      updateAutoPreviewButton();
    };
    syncUiFromState();
    pushHistoryState();
    updateHistoryButtons();

    const step2Content = document.querySelector('.step-content[data-step="2"]');
    if(step2Content) {
      step2Content.querySelectorAll('input, select').forEach((control) => {
        control.addEventListener('change', () => {
          pushHistoryState();
        });
      });
      step2Content.addEventListener('click', (event) => {
        if(event.target?.classList?.contains('ios-switch')) {
          pushHistoryState();
        }
      });
    }

    function updateVf() {
      state.wMm = clampDimensionMm($('dimW').value); state.hMm = clampDimensionMm($('dimH').value);
      $('dimW').value = state.wMm;
      $('dimH').value = state.hMm;
      if(['sq','circle','hex'].includes(state.shape)) { state.hMm = state.wMm; $('dimH').value = state.wMm; }
      if(state.shape === 'din_l') { state.hMm = Math.round(state.wMm / 1.414); $('dimH').value = state.hMm; }
      if(state.shape === 'din_p') { state.hMm = Math.round(state.wMm * 1.414); $('dimH').value = state.hMm; }

      const winW = window.innerWidth, winH = window.innerHeight;
      const sideW = document.querySelector('.sidebar')?.offsetWidth || 400;
      const headerH = document.querySelector('.top-header')?.offsetHeight || 0;
      const pad = 24;
      const availW = Math.max(0, winW - sideW - pad * 2);
      const availH = Math.max(0, winH - headerH - pad * 2);
      const cx = sideW + pad + availW / 2;
      const cy = headerH + pad + availH / 2;
      const ratio = state.hMm / state.wMm;
      const targetW = availW * 0.78, targetH = availH * 0.78;
      let pxW, pxH;
      if(targetW*ratio <= targetH) { pxW=targetW; pxH=pxW*ratio; } else { pxH=targetH; pxW=pxH/ratio; }
      const hw = pxW/2, hh = pxH/2;
      let d = '';
      if(['rect','din_l','din_p','sq'].includes(state.shape)) d = `M ${cx-hw},${cy-hh} H ${cx+hw} V ${cy+hh} H ${cx-hw} Z`;
      else if(state.shape === 'circle') d = `M ${cx},${cy} m -${hw},0 a ${hw},${hw} 0 1,0 ${pxW},0 a ${hw},${hw} 0 1,0 -${pxW},0`;
      else if(state.shape === 'hex') {
        const r = hw, pts = [];
        for(let i=0;i<6;i++){ const a = i*Math.PI/3 - Math.PI/6; pts.push([cx+r*Math.cos(a), cy+r*Math.sin(a)]); }
        d = `M ${pts[0][0]},${pts[0][1]} ` + pts.slice(1).map(p=>`L ${p[0]},${p[1]}`).join(' ') + ' Z';
      }
      $('vfHole').setAttribute('d', d); $('vfOutline').setAttribute('d', d);
      $('vfBadge').style.left = cx+'px';
      $('vfBadge').style.top = (cy+hh)+'px';
      $('vfBadge').innerText = `${state.wMm} x ${state.hMm} mm`;
      const sw = map.unproject([cx - hw, cy + hh]);
      const ne = map.unproject([cx + hw, cy - hh]);
      state.bbox = { sw: { lat: sw.lat, lng: sw.lng }, ne: { lat: ne.lat, lng: ne.lng } };
      if(state.terrainData) {
        updatePngRangeInfo();
        markPreviewDirty();
      }
      updateMapDataStatus();
    }
    window.addEventListener('resize', () => { map.resize(); updateVf(); });
    map.on('move', updateVf);
    map.on('zoom', updateVf);
    map.on('resize', updateVf);
    setTimeout(updateVf,500);

    // --- GENERATION PIPELINE ---
    $('btnGen').onclick = async () => {
      msg('Fetching Elevation Data...');
      if(state.bbox) {
        state.renderBbox = {
          sw: { ...state.bbox.sw },
          ne: { ...state.bbox.ne }
        };
      }
      const {sw, ne} = state.bbox;
      await fetchTerrain(sw, ne);
      msg('Fetching Map Features...');
      const mapOk = await fetchMapFeatures(sw, ne);
      if(!state.terrainData) {
        renderSVG();
        idle();
        $('modal').classList.add('open');
        alert('Elevation data unavailable. Try a smaller area or try again.');
        return;
      }
      if(!mapOk) {
        idle();
        const proceed = confirm('Map data (roads, rivers, water/green areas) could not be loaded.\n\nProceed without map data?\nCancel to pick another area.');
        if(!proceed) {
          return;
        }
        state.osmStatus.ignored = true;
        updateMapDataStatus();
      }
      await ensureOverlayAlignment();
      renderSVG();
      idle();
      setStep('2');
      $('modal').classList.add('open');
    };

    async function fetchTerrain(sw, ne) {
      try {
        const cacheId = bboxKey(sw, ne);
        const cached = cacheId ? terrainCache.get(cacheId) : null;
        if(cached) {
          state.terrainData = cached;
          state.terrainVersion += 1;
          state.pngPreviewCache = { key: null, dataUrl: null };
          return;
        }
        const rows = 120;
        const cols = rows;
        const locs=[];
        const dLat = (ne.lat - sw.lat) / (rows - 1);
        const dLon = (ne.lng - sw.lng) / (cols - 1);
        for(let r=0;r<rows;r++) {
          const lat = ne.lat - r * dLat;
          for(let c=0;c<cols;c++) {
            locs.push({ latitude: lat, longitude: sw.lng + c * dLon });
          }
        }
        const j = await fetchJsonWithTimeout(
          'https://api.open-elevation.com/api/v1/lookup',
          {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({locations:locs})}
        );
        let h = j.results.map(x=>x.elevation);
        // Smooth based on detail: higher detail keeps more variation.
        const smoothPasses = 4;
        for(let i=0; i<smoothPasses; i++) h = smoothPass(h, rows, cols);
        let min=Infinity, max=-Infinity; h.forEach(v => { if(v<min) min=v; if(v>max) max=v; });
        state.terrainData = { rows, cols, h: h.map(z=>z-min), min, max, delta: max-min };
        state.terrainVersion += 1;
        state.pngPreviewCache = { key: null, dataUrl: null };
        if(cacheId) terrainCache.set(cacheId, state.terrainData);
      } catch(e) {
        state.terrainData = null;
        state.pngPreviewCache = { key: null, dataUrl: null };
      }
    }

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

    function buildSvgMarkup({ includeBackground = true, includeGradient = true, includeFrame = true } = {}) {
      const {wMm, hMm} = state;
      let svg = `<svg id="prevSvg" width="${wMm}mm" height="${hMm}mm" viewBox="0 0 ${wMm} ${hMm}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">`;
      const clipPathD = getShapePathD();
      svg += `<defs><clipPath id="shapeClip"><path d="${clipPathD}"/></clipPath></defs>`;
      svg += `<g clip-path="url(#shapeClip)">`;
      if(includeBackground) {
        svg += `<rect id="previewBackground" width="100%" height="100%" fill="${state.theme.background}"/>`;
      }
      if(includeGradient && state.png.layered && state.terrainData) {
        const previewUrl = getLayeredPreviewDataUrl();
        if(previewUrl) {
          const blendMode = state.png.blend || 'normal';
          const blendStyle = updateBlendStyle(blendMode);
          svg += `<image href="${previewUrl}" x="0" y="0" width="${wMm}" height="${hMm}" preserveAspectRatio="none"${blendStyle} />`;
        }
      }

      const layers = {
        green: () => {
          if(!state.osmData || !state.mapFeatures.greenAreas.enabled || !state.osmData.greenPolygons.length) return '';
          let out = `<g id="greenAreas" fill="${state.mapFeatures.greenAreas.color}" fill-opacity="${toUnitOpacity(state.mapFeatures.greenAreas.opacity)}">`;
          state.osmData.greenPolygons.forEach((poly) => {
            const d = pathFromCoords(poly, true);
            if(d) out += `<path d="${d}"/>`;
          });
          return out + `</g>`;
        },
        water: () => {
          if(!state.osmData || !state.mapFeatures.waterAreas.enabled || !state.osmData.waterPolygons.length) return '';
          let out = `<g id="waterAreas" fill="${state.mapFeatures.waterAreas.color}" fill-opacity="${toUnitOpacity(state.mapFeatures.waterAreas.opacity)}">`;
          state.osmData.waterPolygons.forEach((poly) => {
            const d = pathFromCoords(poly, true);
            if(d) out += `<path d="${d}"/>`;
          });
          return out + `</g>`;
        },
        rivers: () => {
          if(!state.osmData || !state.mapFeatures.rivers.enabled || !state.osmData.waterLines.length) return '';
          let out = `<g id="rivers" stroke="${state.mapFeatures.rivers.color}" stroke-width="${state.mapFeatures.rivers.width}px" stroke-opacity="${toUnitOpacity(state.mapFeatures.rivers.opacity)}" fill="none" stroke-linecap="round" stroke-linejoin="round">`;
          state.osmData.waterLines.forEach((line) => {
            const d = pathFromCoords(line, false);
            if(d) out += `<path d="${d}"/>`;
          });
          return out + `</g>`;
        },
        roads: () => {
          if(!state.osmData || !state.mapFeatures.roads.enabled || !state.osmData.roadLines.length) return '';
          let out = `<g id="roads" stroke="${state.mapFeatures.roads.color}" stroke-width="${state.mapFeatures.roads.width}px" stroke-opacity="${toUnitOpacity(state.mapFeatures.roads.opacity)}" fill="none" stroke-linecap="round" stroke-linejoin="round">`;
          state.osmData.roadLines.forEach((line) => {
            const d = pathFromCoords(line, false);
            if(d) out += `<path d="${d}"/>`;
          });
          return out + `</g>`;
        },
        contours: () => {
          state.contourPaths = [];
          if(!state.contour.enabled) return '';
          if(!state.terrainData || state.terrainData.delta <= 0) {
            const cx = wMm / 2;
            const cy = hMm / 2;
            return `<text x="${cx}" y="${cy}" text-anchor="middle" font-family="SF Pro Text, Segoe UI, Roboto, sans-serif" font-size="6" fill="#9AA3B2">Elevation data missing. Try generating again.</text>`;
          }
          const levels = getContourLevels();
          const emphasisEvery = Math.max(0, Math.round(state.contour.emphasisEvery || 0));
          let out = `<g id="contours" stroke="${state.contour.color}" stroke-opacity="${toUnitOpacity(state.contour.opacity)}" fill="none" stroke-linecap="round" stroke-linejoin="round">`;
          levels.forEach((level, idx) => {
            const segments = getContourSegments(level, wMm, hMm);
            if(!segments.length) return;
            const polylines = buildPolylines(segments);
            const isBold = emphasisEvery > 0 && ((idx + 1) % emphasisEvery === 0);
            const lineWidth = state.contour.width * (isBold ? 2 : 1);
            polylines.forEach(line => {
              const smoothed = state.contour.smooth ? smoothPolyline(line, state.contour.smooth) : line;
              if(smoothed.length < 2) return;
              state.contourPaths.push(smoothed);
              const path = smoothed.map((pt, idx) => `${idx ? 'L' : 'M'} ${pt[0].toFixed(2)} ${pt[1].toFixed(2)}`).join(' ');
              out += `<path d="${path}" stroke-width="${lineWidth}px" />`;
            });
          });
          return out + `</g>`;
        },
        labels: () => {
          if(!state.osmData || !state.mapFeatures.labels.enabled || !state.osmData.labels.length) return '';
          const fontFamilies = {
            system: 'Inter, SF Pro Text, Segoe UI, Roboto, sans-serif',
            serif: 'Merriweather, Georgia, Times New Roman, serif',
            mono: '"Roboto Mono", "SF Mono", Menlo, Consolas, monospace',
            rounded: 'Nunito, "Arial Rounded MT Bold", "Trebuchet MS", sans-serif',
            condensed: '"Roboto Condensed", "Arial Narrow", "Helvetica Neue Condensed", sans-serif',
            display: '"Bebas Neue", "Impact", "Haettenschweiler", "Franklin Gothic Heavy", sans-serif'
          };
          const fontFamily = fontFamilies[state.mapFeatures.labels.font] || fontFamilies.system;
          const haloEnabled = state.mapFeatures.labels.background.enabled;
          const haloColor = state.mapFeatures.labels.background.color || state.theme.background;
          const fontWeight = state.mapFeatures.labels.weight || 'normal';
          const fontStyle = state.mapFeatures.labels.style || 'normal';
          let out = `<g id="placeLabels" font-family="${fontFamily}" text-anchor="middle" fill="${state.mapFeatures.labels.color}" fill-opacity="${toUnitOpacity(state.mapFeatures.labels.opacity)}" paint-order="stroke" font-weight="${fontWeight}" font-style="${fontStyle}">`;
          state.osmData.labels.forEach((place) => {
            const [x, y] = projectToSvg(place.lat, place.lon);
            const size = getLabelSize(place);
            const stroke = haloEnabled ? ` stroke="${haloColor}" stroke-width="0.6"` : ' stroke="none" stroke-width="0"';
            out += `<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" font-size="${size.toFixed(2)}mm"${stroke}>${place.name}</text>`;
          });
          return out + `</g>`;
        }
      };

      state.layerOrder.slice().reverse().forEach((key) => {
        if(layers[key]) {
          svg += layers[key]();
        }
      });

      svg += `</g>`;
      if(includeFrame) {
        svg += `<rect x="0.5" y="0.5" width="${wMm - 1}" height="${hMm - 1}" fill="none" stroke="rgba(36,48,65,0.6)" stroke-width="0.5" />`;
      }
      svg += `</svg>`;
      return svg;
    }

    function renderSVG() {
      const svg = buildSvgMarkup({ includeBackground: true, includeGradient: true, includeFrame: true });
      $('previewArea').innerHTML = svg;
      updatePngRangeInfo();
      state.previewDirty = false;
      updateAutoPreviewButton();
    }

    const polygonArea = (poly) => {
      let sum = 0;
      for(let i = 0; i < poly.length - 1; i++) {
        sum += poly[i][0] * poly[i + 1][1] - poly[i + 1][0] * poly[i][1];
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
        const steps = 48;
        for(let i=0; i<steps; i++) {
          const a = (i / steps) * Math.PI * 2;
          pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
        }
        return pts;
      }
      return [[0,0],[w,0],[w,h],[0,h]];
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

    $('btnDXF').onclick = () => {
      buildSvgMarkup({ includeBackground: false, includeGradient: false, includeFrame: true });
      let dxf = "0\nSECTION\n2\nHEADER\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n";
      const rgbToAci = ({ r, g, b }) => {
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        if(max < 40) return 7;
        if(max - min < 20 && max > 200) return 7;
        if(r >= g && r >= b) {
          if(g > 200 && b < 120) return 2;
          if(b > 200 && g < 120) return 6;
          return 1;
        }
        if(g >= r && g >= b) {
          if(b > 200) return 4;
          return 3;
        }
        if(b >= r && b >= g) return 5;
        return 7;
      };
      const writePolyline = (layer, pts, color, forceClosed = null) => {
        if(pts.length < 2) return;
        const first = pts[0];
        const last = pts[pts.length - 1];
        const closed = forceClosed ?? (Math.hypot(first[0] - last[0], first[1] - last[1]) < 0.01);
        const outPts = closed ? pts.slice(0, -1) : pts;
        const rgb = colorToRgb(color);
        const aci = rgbToAci(rgb);
        const trueColor = (rgb.r << 16) + (rgb.g << 8) + rgb.b;
        dxf += `0\nLWPOLYLINE\n8\n${layer}\n62\n${aci}\n420\n${trueColor}\n90\n${outPts.length}\n70\n${closed ? 1 : 0}\n`;
        outPts.forEach(p => dxf += `10\n${p[0].toFixed(4)}\n20\n${(state.hMm - p[1]).toFixed(4)}\n`);
      };
      const writeText = (layer, text, x, y, height, color) => {
        if(!text) return;
        const rgb = colorToRgb(color);
        const aci = rgbToAci(rgb);
        const trueColor = (rgb.r << 16) + (rgb.g << 8) + rgb.b;
        const safeText = String(text).replace(/[\r\n\t]+/g, ' ').trim();
        if(!safeText) return;
        dxf += `0\nTEXT\n8\n${layer}\n62\n${aci}\n420\n${trueColor}\n10\n${x.toFixed(4)}\n20\n${(state.hMm - y).toFixed(4)}\n40\n${height.toFixed(4)}\n1\n${safeText}\n50\n0\n`;
      };
      if(!state.contourPaths.length) {
        alert('Generate contours first.');
        return;
      }
      const clipPoly = getClipPolygon();
      if(polygonArea(clipPoly) < 0) clipPoly.reverse();
      if(state.contour.enabled) {
        state.contourPaths.forEach(path => {
          clipPolylineToPolygon(path, clipPoly).forEach(seg => writePolyline('CONTOURS', seg, state.contour.color, false));
        });
      }
      if(state.osmData) {
        if(state.mapFeatures.greenAreas.enabled) {
          state.osmData.greenPolygons.forEach(poly => {
            const clipped = clipPolygon(poly, clipPoly);
            if(clipped.length >= 3) writePolyline('GREEN_AREAS', ensureClosed(clipped), state.mapFeatures.greenAreas.color, true);
          });
        }
        if(state.mapFeatures.waterAreas.enabled) {
          state.osmData.waterPolygons.forEach(poly => {
            const clipped = clipPolygon(poly, clipPoly);
            if(clipped.length >= 3) writePolyline('WATER_AREAS', ensureClosed(clipped), state.mapFeatures.waterAreas.color, true);
          });
        }
        if(state.mapFeatures.rivers.enabled) {
          state.osmData.waterLines.forEach(line => {
            clipPolylineToPolygon(line, clipPoly).forEach(seg => writePolyline('RIVERS', seg, state.mapFeatures.rivers.color, false));
          });
        }
        if(state.mapFeatures.roads.enabled) {
          state.osmData.roadLines.forEach(line => {
            clipPolylineToPolygon(line, clipPoly).forEach(seg => writePolyline('ROADS', seg, state.mapFeatures.roads.color, false));
          });
        }
        if(state.mapFeatures.labels.enabled && state.osmData.labels?.length) {
          state.osmData.labels.forEach((place) => {
            const [x, y] = projectToSvg(place.lat, place.lon);
            const inside = clipPolygon([[x, y], [x + 0.01, y], [x + 0.01, y + 0.01]], clipPoly).length;
            if(!inside) return;
            writeText('LABELS', place.name, x, y, getLabelSize(place), state.mapFeatures.labels.color);
          });
        }
      }
      writePolyline('FRAME', ensureClosed(clipPoly), state.contour.color, true);
      dxf += "0\nENDSEC\n0\nEOF";
      save(new Blob([dxf], {type:'application/dxf'}), 'Topomapper.dxf');
    };

    function findBandIndex(value, boundaries) {
      if(value <= boundaries[0]) return 0;
      if(value >= boundaries[boundaries.length - 1]) return boundaries.length - 2;
      let lo = 0;
      let hi = boundaries.length - 2;
      while(lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);
        if(value < boundaries[mid]) {
          hi = mid - 1;
        } else if(value >= boundaries[mid + 1]) {
          lo = mid + 1;
        } else {
          return mid;
        }
      }
      return Math.max(0, Math.min(boundaries.length - 2, lo));
    }

    function drawSvgOnCanvas(ctx, svgMarkup, w, h) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          ctx.drawImage(img, 0, 0, w, h);
          resolve();
        };
        img.onerror = reject;
        img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgMarkup)));
      });
    }

    function buildHeightMap(w, h) {
      const T = state.terrainData;
      if(!T) return null;
      const cols = T.cols;
      const rows = T.rows;
      if(cols < 2 || rows < 2) {
        const fallback = T.h[0] ?? 0;
        return new Float32Array(w * h).fill(fallback);
      }
      const maxCol = Math.max(0, cols - 2);
      const maxRow = Math.max(0, rows - 2);
      const colIndex = new Int32Array(w);
      const colT = new Float32Array(w);
      for(let x=0; x<w; x++) {
        const nx = w === 1 ? 0 : x / (w - 1);
        const cFloat = nx * (cols - 1);
        const c0 = Math.min(maxCol, Math.max(0, Math.floor(cFloat)));
        colIndex[x] = c0;
        colT[x] = cFloat - c0;
      }
      const rowIndex = new Int32Array(h);
      const rowT = new Float32Array(h);
      for(let y=0; y<h; y++) {
        const ny = h === 1 ? 0 : y / (h - 1);
        const rFloat = ny * (rows - 1);
        const r0 = Math.min(maxRow, Math.max(0, Math.floor(rFloat)));
        rowIndex[y] = r0;
        rowT[y] = rFloat - r0;
      }
      const heightMap = new Float32Array(w * h);
      for(let y=0; y<h; y++) {
        const r0 = rowIndex[y];
        const r1 = r0 + 1;
        const ty = rowT[y];
        const rowOffset0 = r0 * cols;
        const rowOffset1 = r1 * cols;
        for(let x=0; x<w; x++) {
          const c0 = colIndex[x];
          const c1 = c0 + 1;
          const tx = colT[x];
          const h00 = T.h[rowOffset0 + c0];
          const h01 = T.h[rowOffset0 + c1];
          const h10 = T.h[rowOffset1 + c0];
          const h11 = T.h[rowOffset1 + c1];
          const top = h00 * (1 - tx) + h01 * tx;
          const bottom = h10 * (1 - tx) + h11 * tx;
          heightMap[y * w + x] = top * (1 - ty) + bottom * ty;
        }
      }
      return heightMap;
    }

    function exportLayeredPng() {
      if(!state.terrainData) {
        alert('Generate contours first.');
        return;
      }
      const alpha = Math.round(255 * clamp(toUnitOpacity(state.png.gradientOpacity), 0, 1));
      const e = +$('pngResRange').value;
      const r = state.hMm / state.wMm;
      const w = state.wMm >= state.hMm ? e : Math.round(e / r);
      const h = state.wMm >= state.hMm ? Math.round(e * r) : e;
      const cv = document.createElement('canvas');
      cv.width = w;
      cv.height = h;
      const ctx = cv.getContext('2d');
      ctx.fillStyle = state.theme.background;
      ctx.fillRect(0, 0, w, h);

      const range = getShapeHeightRange();
      if(!range) {
        alert('Elevation data missing.');
        return;
      }
      const boundaries = [range.minNorm, ...getContourLevels(range.minNorm, range.maxNorm), range.maxNorm];
      if(boundaries.length < 2) {
        alert('Contour range too small for height band export.');
        return;
      }
      const bandCount = Math.max(2, boundaries.length - 1);
      const bandColors = [];
      for(let i=0; i<boundaries.length - 1; i++) {
        const midNorm = (boundaries[i] + boundaries[i + 1]) / 2;
        const height = state.terrainData.min + midNorm;
        const t = range.maxZ === range.minZ ? 0 : (height - range.minZ) / (range.maxZ - range.minZ);
        bandColors.push(getHypsometricBandColor(t, state.png.scheme, bandCount));
      }

      const heightMap = buildHeightMap(w, h);
      if(!heightMap) {
        alert('Elevation data missing.');
        return;
      }
      const imgData = ctx.createImageData(w, h);
      const data = imgData.data;
      const stepX = w > 1 ? 1 / (w - 1) : 1;
      const stepY = h > 1 ? 1 / (h - 1) : 1;
      const relief = clamp(state.terrainData.delta / 700, 0.35, 1.25);
      const ambient = 0.36;
      for(let y=0; y<h; y++) {
        const rowOffset = y * w;
        const rowOffsetDown = (y + 1 < h ? (y + 1) : y) * w;
        for(let x=0; x<w; x++) {
          const idx = rowOffset + x;
          const zNorm = heightMap[idx];
          const { color: bandColor } = getSmoothedBandColor(zNorm, boundaries, bandColors);
          const height = state.terrainData.min + zNorm;
          const elevationT = range.maxZ === range.minZ ? 0 : (height - range.minZ) / (range.maxZ - range.minZ);
          const zRight = heightMap[rowOffset + (x + 1 < w ? x + 1 : x)];
          const zDown = heightMap[rowOffsetDown + x];
          const dzdx = (zRight - zNorm) / stepX;
          const dzdy = (zDown - zNorm) / stepY;
          const nxv = -dzdx * relief;
          const nyv = -dzdy * relief;
          const nzv = 1;
          const len = Math.hypot(nxv, nyv, nzv) || 1;
          const dot = (nxv / len) * reliefLight.x + (nyv / len) * reliefLight.y + (nzv / len) * reliefLight.z;
          const lit = Math.max(0, dot);
          const shade = clamp(ambient + lit * (1 - ambient), 0, 1);
          const color = applyReliefOverlay(bandColor, shade, elevationT);
          const pixel = idx * 4;
          data[pixel] = color.r;
          data[pixel + 1] = color.g;
          data[pixel + 2] = color.b;
          data[pixel + 3] = alpha;
        }
      }
      ctx.putImageData(imgData, 0, 0);
      const overlaySvg = buildSvgMarkup({ includeBackground: false, includeGradient: false, includeFrame: true });
      drawSvgOnCanvas(ctx, overlaySvg, w, h)
        .then(() => cv.toBlob(b => save(b, 'Topomapper_Layered.png')))
        .catch(() => cv.toBlob(b => save(b, 'Topomapper_Layered.png')));
    }

    $('btnPNG').onclick = () => {
      if(state.png.layered) {
        exportLayeredPng();
        return;
      }
      const e = +$('pngResRange').value, r = state.hMm/state.wMm;
      const w = state.wMm >= state.hMm ? e : Math.round(e/r), h = state.wMm >= state.hMm ? Math.round(e*r) : e;
      const s = buildSvgMarkup({ includeBackground: true, includeGradient: true, includeFrame: true });
      const img = new Image(), cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      img.onload = () => { const ctx = cv.getContext('2d'); ctx.fillStyle=state.theme.background; ctx.fillRect(0,0,w,h); ctx.drawImage(img,0,0,w,h); cv.toBlob(b => save(b, 'Topomapper.png')); };
      img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(s)));
    };

    $('btn3MF').onclick = async () => {
      if(!state.terrainData) {
        alert('Generate contours first.');
        return;
      }
      msg('Generating Assembly...'); await new Promise(r=>setTimeout(r,100));
      const zip = new JSZip(), targetH = +$('targetH').value;
      let zScale = state.terrainData && state.terrainData.delta > 0 ? targetH / state.terrainData.delta : 1;
      const objs = []; let objId = 1;

      // 1. Terrain Mesh (Watertight)
      const res = 220, tm = { v:[], t:[] }, idxMap = new Map();
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
      const isIn = (x, y) => isInShape(x, y);
      for(let r=0;r<=res;r++) for(let c=0;c<=res;c++) {
        const x=c/res*state.wMm, y=r/res*state.hMm; if(!isIn(x,y)) continue;
        const z=2.0 + (heightGrid[r * gridSize + c] * zScale);
        idxMap.set(`${r},${c}`, {t: tm.v.push([x,y,z])-1, b: tm.v.push([x,y,0])-1 });
      }
      for(let r=0;r<res;r++) for(let c=0;c<res;c++) {
        const tl=idxMap.get(`${r},${c}`), tr=idxMap.get(`${r},${c+1}`), bl=idxMap.get(`${r+1},${c}`), br=idxMap.get(`${r+1},${c+1}`);
        if(tl&&tr&&bl&&br) {
          tm.t.push([tl.t,bl.t,tr.t],[tr.t,bl.t,br.t]);
          tm.t.push([tl.b,tr.b,bl.b],[tr.b,br.b,bl.b]);
          if(!idxMap.get(`${r-1},${c}`)) tm.t.push([tl.t,tr.t,tl.b],[tl.b,tr.t,tr.b]);
          if(!idxMap.get(`${r+1},${c}`)) tm.t.push([bl.t,bl.b,br.t],[br.t,bl.b,br.b]);
          if(!idxMap.get(`${r},${c-1}`)) tm.t.push([tl.t,tl.b,bl.t],[bl.t,bl.b,tl.t]);
          if(!idxMap.get(`${r},${c+1}`)) tm.t.push([tr.t,br.t,tr.b],[tr.b,br.t,br.b]);
        }
      }
      objs.push({id:objId++, name:'Terrain', mesh:tm});

      let resXml='', buildXml='';
      objs.forEach(o => {
        let vS='', tS=''; o.mesh.v.forEach(v=> vS+=`<vertex x="${v[0].toFixed(3)}" y="${v[1].toFixed(3)}" z="${v[2].toFixed(3)}" />`);
        o.mesh.t.forEach(t=> tS+=`<triangle v1="${t[0]}" v2="${t[1]}" v3="${t[2]}" />`);
        resXml += `<object id="${o.id}" name="${o.name}" type="model"><mesh><vertices>${vS}</vertices><triangles>${tS}</triangles></mesh></object>`;
        buildXml += `<item objectid="${o.id}" />`;
      });
      const xml = `<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xml:lang="en" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources>${resXml}</resources><build>${buildXml}</build></model>`;
      zip.file("3D/3dmodel.model", xml);
      zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`);
      zip.folder("_rels").file(".rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rel1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" Target="3D/3dmodel.model"/></Relationships>`);
      save(await zip.generateAsync({type:"blob"}), 'Topomapper_Terrain.3mf');
      idle();
    };

    window.closeModal = () => $('modal').classList.remove('open');
    function save(b, n) { const a=document.createElement('a'); a.href=URL.createObjectURL(b); a.download=n; a.click(); }
}
