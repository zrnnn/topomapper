import * as maplibregl from 'maplibre-gl';
import { createGeometry } from './geometry.js';
import { latitudeY, validateBounds } from './terrain.js';
import { runWorker } from './worker-client.js';
import { escapeXml } from './xml.js';
import { parseBuildings, parseAreas, clipBuildings, buildingPath, prepareBuildingLod, coastlineAreas } from './buildings.js';
import { DESIGN_PRESETS, applyDesignPreset } from './presets.js';

import {initModelWorkflow} from './model-workflow.js';
import {describeError,terrainProgress} from './operation-status.js';

export function initTopomapper() {
  // --- STATE ---
    const state = {
      wMm: 200, hMm: 140, shape: 'rect',
      contour: {
        enabled: true,
        density: 40,
        width: 0.2,
        color: '#000000',
        smooth: 4,
        opacity: 100,
        emphasisEvery: 10
      },
      png: {
        layered: false,
        scheme: 'color',
        blend: 'normal',
        gradientOpacity: 50,
        gradientShift: 0,
        gradientScale: 100,
        reliefStrength: 0.48,
        reliefWarm: '#F3A15F',
        reliefShadow: '#0A1624'
      },
      theme: {
        preset: 'bright',
        background: '#FFFFFF',
        line: '#000000'
      },
      mapFeatures: {
        buildings: {enabled:true,color:'#ABB8AD',outline:'#65796C',width:0.1,opacity:100,filled:true,minArea:0.5,maxCount:2500},
        waterAreas: { enabled: true, color: '#7A7A7A', opacity: 100 },
        rivers: { enabled: true, color: '#7A7A7A', width: 0.2, opacity: 100 },
        greenAreas: { enabled: false, color: '#7FAE8A', opacity: 15 },
        roads: { enabled: true, color: '#4A4A4A', width: 0.2, opacity: 100 },
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
      layerOrder: ['labels', 'buildings', 'roads', 'rivers', 'water', 'green', 'contours'],
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

    const { getZInterpolated, isInShape, getContourLineCount, getContourLevels, getShapeHeightRange, getContourSegments, buildPolylines, smoothPolyline, getShapePathD, polygonArea, getClipPolygon, clipCanvasToShape, clipPolygon, clipSegmentToConvex, clipPolylineToPolygon, ensureClosed, smoothPass } = createGeometry(state);
    applyDesignPreset(state,'topographic');
    const defaultDesign = structuredClone({contour:state.contour,png:state.png,theme:state.theme,mapFeatures:state.mapFeatures,layerOrder:state.layerOrder});

    let disposed = false;
    let activeJob = null;
    let exportBusy = false;
    const lifetime = new AbortController();
    const cachePut = (cache, key, value) => {
      if(cache.size >= 8 && !cache.has(key)) cache.delete(cache.keys().next().value);
      cache.set(key, value);
    };
    const FETCH_TIMEOUT = 12000;
    const terrainCache = new Map();
    const osmCache = new Map();
    const bboxKey = (sw, ne) => {
      if(!sw || !ne) return '';
      return `${sw.lat.toFixed(6)},${sw.lng.toFixed(6)}:${ne.lat.toFixed(6)},${ne.lng.toFixed(6)}`;
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
    const msg = t => { $('loaderText').innerText=typeof t==='string'?t:t.detail; if(typeof t==='object') $('loaderProgress').value=t.percent; else $('loaderProgress').removeAttribute('value'); $('loader').classList.add('active'); };
    const idle = () => $('loader').classList.remove('active');
    const refreshPreviewBtn = $('refreshPreview');
    const undoStep2Btn = $('undoStep2');
    const redoStep2Btn = $('redoStep2');
    const mapDataNotice = $('mapDataNotice');
    const mapDataNoticeText = $('mapDataNoticeText');
    const mapDataNoticeClose = $('mapDataNoticeClose');
    const exportStatus = $('exportStatus');
    const exportStatusLabel = $('exportStatusLabel');
    const exportProgress = $('exportProgress');
    const exportError = $('exportError');
    const exportStatusSteps = exportStatus ? Array.from(exportStatus.querySelectorAll('[data-export-step]')) : [];
    const exportPhaseOrder = ['prepare', 'render', 'save'];
    const exportPhaseLabels = {
      prepare: 'Preparing',
      render: 'Rendering',
      save: 'Saving',
      done: 'Complete'
    };
    let exportStatusTimer = null;
    const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const setExportStatus = (phase, label) => {
      if(!exportStatus) return;
      exportStatus.classList.add('active');
      exportStatus.classList.toggle('done', phase === 'done');
      exportStatus.classList.remove('error');
      exportError.hidden = true;
      const labelText = exportPhaseLabels[phase] ?? 'Working';
      exportStatusLabel.innerText = label ? `${label} · ${labelText}` : labelText;
      const currentIndex = exportPhaseOrder.indexOf(phase);
      exportProgress.value = phase==='prepare'?12:phase==='render'?55:phase==='save'?88:phase==='done'?100:0;
      exportStatusSteps.forEach((step) => {
        const stepIndex = exportPhaseOrder.indexOf(step.dataset.exportStep);
        if(phase === 'done') {
          step.classList.add('is-done');
          step.classList.remove('is-active');
          return;
        }
        step.classList.toggle('is-active', stepIndex === currentIndex);
        step.classList.toggle('is-done', stepIndex > -1 && currentIndex > stepIndex);
      });
    };
    const clearExportStatus = () => {
      if(!exportStatus) return;
      if(exportStatusTimer) {
        clearTimeout(exportStatusTimer);
        exportStatusTimer = null;
      }
      exportStatus.classList.remove('active', 'done', 'error');
      exportError.hidden = true;
      exportStatusLabel.innerText = 'Idle';
      exportStatusSteps.forEach(step => step.classList.remove('is-active', 'is-done'));
    };
    const runExportFlow = async (label, task) => {
      if(!task || exportBusy || activeJob) return;
      if(exportStatusTimer) {
        clearTimeout(exportStatusTimer);
        exportStatusTimer = null;
      }
      exportBusy = true;
      setExportStatus('prepare', label);
      const onSave = async () => {
        setExportStatus('save', label);
        await nextFrame();
      };
      const controls = Array.from(document.querySelectorAll('#modal input, #modal select, #modal button'));
      const disabled = controls.map(el => el.disabled);
      controls.forEach(el => el.disabled = true);
      try {
        await nextFrame();
        setExportStatus('render', label);
        await task(onSave);
        setExportStatus('done', label);
        exportStatusTimer = setTimeout(clearExportStatus, 2200);
      } catch(error) {
        const report=describeError(error,'export');
        exportStatus.classList.remove('done'); exportStatus.classList.add('error');
        exportStatusLabel.textContent = `${label} · ${report.title}`;
        exportProgress.value=0; exportError.hidden=false;
        $('exportErrorTitle').textContent=report.title;
        $('exportErrorMessage').textContent=report.message;
        $('exportErrorAction').textContent=report.action;
        $('exportErrorTechnical').textContent=report.technical;
        $('retryExport').onclick=()=>runExportFlow(label,task);
      } finally {
        idle();
        exportBusy = false;
        controls.forEach((el,i) => el.disabled = disabled[i]);
      }
    };

    // --- HELPERS: SCALING & INTERPOLATION ---
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

    const colorCache = new Map();
    function parseCssColor(color) {
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

    function colorToRgb(color) {
      if(!colorCache.has(color)) cachePut(colorCache, color, parseCssColor(color));
      return colorCache.get(color);
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
      return clamp(parsed, 0.05, 2);
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
      const previewEl = $('previewArea');
      const previewW = previewEl?.clientWidth || 0;
      const previewH = previewEl?.clientHeight || 0;
      const base = Math.min(previewW, previewH);
      let target = base ? Math.round(base * 0.4) : 320;
      target = clamp(target, 180, 360);
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

    function projectToSvg(lat, lon) {
      const bbox = state.renderBbox || state.bbox;
      if(!bbox) return [0, 0];
      const { sw, ne } = bbox;
      const x = ((lon - sw.lng) / (ne.lng - sw.lng)) * state.wMm;
      const y = ((latitudeY(lat) - latitudeY(ne.lat)) / (latitudeY(sw.lat) - latitudeY(ne.lat))) * state.hMm;
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

    function joinLineSegments(segments, tolerance = 0.4, close = true) {
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
        if(ring.length >= (close ? 3 : 2)) {
          rings.push(close ? normalizeRing(ring) : ring);
        }
      }
      return rings;
    }

    const overpassServers = [
      'https://overpass-api.de/api/interpreter',
      'https://overpass.kumi.systems/api/interpreter',
      'https://overpass.nchc.org.tw/api/interpreter'
    ];

    const OVERPASS_REQUEST_TIMEOUT_MS = 12000;
    const OSM_TOTAL_TIMEOUT_MS = 20000;
    const buildOverpassQuery = (bbox) => `[out:json][maxsize:33554432][timeout:25];
      (
        way["building"]["building"!="no"](${bbox});
        relation["building"]["building"!="no"](${bbox});
        way["natural"="water"](${bbox});
        way["natural"~"bay|coastline"](${bbox});
        way["water"~"lake|reservoir|pond|basin|lagoon|sea|ocean"](${bbox});
        way["landuse"~"reservoir|basin"](${bbox});
        way["waterway"="riverbank"](${bbox});
        relation["natural"="water"](${bbox});
        relation["natural"="bay"](${bbox});
        relation["water"~"lake|reservoir|pond|basin|lagoon|sea|ocean"](${bbox});
        relation["landuse"~"reservoir|basin"](${bbox});
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
      buildings: [], waterAreas: [], greenAreas: [], coastlineLines: [],
      waterPolygons: [],
      greenPolygons: [],
      waterLines: [],
      roadLines: [],
      labels: []
    });

    const parseOverpassElements = (elements, target) => {
      const ids=new Set(target.buildings.map(building=>building.id));
      for(const building of parseBuildings(elements,projectToSvg)) if(!ids.has(building.id)) {target.buildings.push(building);ids.add(building.id);}

      const greenLanduse = new Set(['forest', 'grass', 'meadow', 'recreation_ground']);
      const greenLeisure = new Set(['park', 'garden']);
      const greenNatural = new Set(['wood', 'grassland']);
      const waterLinesSet = new Set(['river', 'stream', 'canal']);
      const waterAreaSet = new Set(['sea','ocean','lake','reservoir','pond','basin','lagoon']);
      const isWaterArea=t=>t.natural==='water'||t.natural==='bay'||t.waterway==='riverbank'||waterAreaSet.has(t.water)||['reservoir','basin'].includes(t.landuse);
      for(const [key,predicate] of [['waterAreas',isWaterArea],['greenAreas',t=>greenLanduse.has(t.landuse)||greenLeisure.has(t.leisure)||greenNatural.has(t.natural)]]) {
        const seen=new Set(target[key].map(f=>f.id));
        for(const area of parseAreas(elements,projectToSvg,predicate))if(!seen.has(area.id)){target[key].push(area);seen.add(area.id);}
      }
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
          if(tags.natural==='coastline'){target.coastlineLines.push(coords);return;}
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
          const isWater = isWaterArea(tags);
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
          const isWater = isWaterArea(tags);
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

    const fetchOverpass = async (query, signal) => {
      let lastError = null;
      for(const server of overpassServers) {
        if(signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
        try {
          const response = await fetchJsonWithTimeout(
            server,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: `data=${encodeURIComponent(query)}`,
              signal
            },
            OVERPASS_REQUEST_TIMEOUT_MS
          );
          if(response.remark || !Array.isArray(response.elements)) throw new Error('Map data service returned incomplete data. Try a smaller area or retry.');
          return response;
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

    async function fetchMapFeatures(sw, ne, signal) {
      state.osmStatus = { loaded: false, error: null, tiles: 1, ignored: false };
      const cacheId = `${bboxKey(sw, ne)}:${state.wMm}:${state.hMm}:mercator`;
      const cached = cacheId ? osmCache.get(cacheId) : null;
      if(cached?.data) {
        state.osmData = typeof structuredClone === 'function' ? structuredClone(cached.data) : JSON.parse(JSON.stringify(cached.data));
        state.osmStatus.loaded = true;
        state.osmStatus.tiles = cached.tiles ?? 1;
        updateMapDataStatus({ announce: true });
        return true;
      }
      updateMapDataStatus({ announce: true, loading: true });
      const controller = new AbortController();
      linkAbort(signal, controller);
      const timeoutId = setTimeout(() => controller.abort(), OSM_TOTAL_TIMEOUT_MS);
      const attemptFetch = async (bboxes) => {
        const osmData = buildEmptyOsmData();
        for(const bbox of bboxes) {
          if(controller.signal.aborted) {
            throw new DOMException('Aborted', 'AbortError');
          }
          const bboxStr = `${bbox.sw.lat},${bbox.sw.lng},${bbox.ne.lat},${bbox.ne.lng}`;
          const section=bboxes.indexOf(bbox)+1;
          showGenerationStatus({phase:'map',percent:62+Math.round(section/bboxes.length*27),title:'Loading map layers',detail:`Requesting buildings, roads and water · section ${section} of ${bboxes.length}`});
          const data = await fetchOverpass(buildOverpassQuery(bboxStr), controller.signal);
          parseOverpassElements(data.elements || [], osmData);
        }
        if(osmData.coastlineLines.length) {
          // Coastlines are commonly split into many OSM ways. Join them before clipping,
          // otherwise internal way endpoints cannot be closed against the output frame.
          const joined=joinLineSegments(osmData.coastlineLines,.02,false);
          const clipped=joined.flatMap(line=>clipPolylineToPolygon(line,getClipPolygon()));
          osmData.waterAreas.push(...coastlineAreas(clipped,getClipPolygon()));
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
        if(cacheId) cachePut(osmCache, cacheId, { data: state.osmData, tiles: state.osmStatus.tiles });
        return true;
      } catch (err) {
        if(controller.signal.aborted) {
          state.osmData = buildEmptyOsmData();
          state.osmStatus.error = 'Map data request timed out. Try again or proceed without map data.';
          updateMapDataStatus({ announce: true });
          return false;
        }
        try {
          const tiledBboxes = getTiledBboxes(sw, ne);
          state.osmData = await attemptFetch(tiledBboxes);
          state.osmStatus.loaded = true;
          state.osmStatus.tiles = tiledBboxes.length;
          updateMapDataStatus({ announce: true });
          if(cacheId) cachePut(osmCache, cacheId, { data: state.osmData, tiles: state.osmStatus.tiles });
          return true;
        } catch (tileErr) {
          if(controller.signal.aborted) {
            state.osmData = buildEmptyOsmData();
            state.osmStatus.error = 'Map data request timed out. Try again or proceed without map data.';
            updateMapDataStatus({ announce: true });
            return false;
          }
          state.osmData = buildEmptyOsmData();
          state.osmStatus.error = 'Roads, rivers or areas could not be loaded. Please try a smaller area or retry.';
          updateMapDataStatus({ announce: true });
          return false;
        }
      } finally {
        clearTimeout(timeoutId);
      }
    }

    // --- MAP & SEARCH ---
    const DEFAULT_LOCATION = {
      name: 'Schloss Neuschwanstein, Germany',
      center: [10.7498, 47.5576],
      zoom: 13
    };
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
      center: DEFAULT_LOCATION.center,
      zoom: DEFAULT_LOCATION.zoom
    });

    const searchInput = $('searchInp');
    if(searchInput) searchInput.value = DEFAULT_LOCATION.name;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    map.on('load', () => {
      map.resize();
      updateVf();
    });

    let timer;
    let activeSearch = null;
    let lastSearchAt = 0;
    const searchCache = new Map();
    const search = async () => {
      const val = searchInput.value.trim();
      const box = $('suggestionBox');
      if(val.length < 3 || activeSearch || activeJob) return;
      const cached = searchCache.get(val.toLowerCase());
      if(!cached && Date.now() - lastSearchAt < 1100) return;
      activeSearch = new AbortController();
      $('searchButton').disabled = true;
      $('searchStatus').textContent = 'Searching…';
      try {
        lastSearchAt = Date.now();
        const results = cached || await fetchJsonWithTimeout(
          'https://nominatim.openstreetmap.org/search?format=json&q=' + encodeURIComponent(val) + '&limit=5',
          {signal:activeSearch.signal}, 8000
        );
        if(disposed) return;
        cachePut(searchCache, val.toLowerCase(), results);
        box.replaceChildren();
        results.forEach(item => {
          const button = document.createElement('button');
          button.type = 'button'; button.className = 'suggestion-item';
          button.textContent = item.display_name.split(',').slice(0,3).join(',');
          button.onclick = () => {
            // Apply the result immediately so Continue can never capture a half-finished fly animation.
            map.jumpTo({center:[Number(item.lon),Number(item.lat)],zoom:14});
            updateVf();
            box.style.display='none'; searchInput.value=button.textContent;
            $('searchStatus').textContent = '';
          };
          box.appendChild(button);
        });
        box.style.display = results.length ? 'block' : 'none';
        $('searchStatus').textContent = results.length ? 'Choose a location below.' : 'No matches. Try a nearby city or move the map.';
      } catch(error) {
        if(!disposed) $('searchStatus').textContent = 'Search unavailable. You can still move and zoom the map.';
      } finally {
        activeSearch = null;
        if(!disposed) $('searchButton').disabled = false;
      }
    };
    $('searchButton').onclick = search;
    searchInput.addEventListener('keydown', event => { if(event.key === 'Enter') { event.preventDefault(); search(); } });
    searchInput.addEventListener('input', () => { $('suggestionBox').style.display='none'; });

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
    $('renderPreview').onclick = () => { if(state.terrainData) renderSVG(); };
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
          buildings: { ...defaultDesign.mapFeatures.buildings },
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
    const historyLimit = 30;
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
      $('renderPreview').hidden = state.autoPreview || !state.previewDirty;
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

    const updateMapDataStatus = ({ announce = false, loading = false } = {}) => {
      if(disposed) return;
      if(!announce) return;
      if(loading) {
        showMapNotice('Map data loading...', { sticky: true });
        return;
      }
      if(state.osmStatus?.loaded && state.osmData) {
        const tilesLabel = state.osmStatus.tiles > 1 ? ` | ${state.osmStatus.tiles} tiles` : '';
        showMapNotice(`Map data loaded: Buildings ${state.osmData.buildings.length}, Water areas ${state.osmData.waterAreas.length}, Rivers ${state.osmData.waterLines.length}, Roads ${state.osmData.roadLines.length}, Green areas ${state.osmData.greenAreas.length}, Labels ${state.osmData.labels.length}${tilesLabel}`);
        return;
      }
      if(state.osmStatus?.error) {
        const suffix = state.osmStatus.ignored ? ' (ignored)' : '';
        showMapNotice(`Map data missing${suffix}: ${state.osmStatus.error}`, { sticky: true });
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

    const selectPreset = key => {
      applyDesignPreset(state,key);
      syncUiFromState();
      pushHistoryState();
    };
    $('presetSel').onchange = event => selectPreset(event.target.value);
    document.querySelectorAll('[data-preset]').forEach(button=>button.addEventListener('click',()=>selectPreset(button.dataset.preset)));

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
    $('contourWidthInput').onchange = (e) => setContourWidth(e.target.value);
    $('contourEmphasis').oninput = (e) => {
      const raw = parseInt(e.target.value, 10);
      const val = Math.min(20, Math.max(0, Number.isNaN(raw) ? 0 : raw));
      state.contour.emphasisEvery = val;
      $('contourEmphasisVal').innerText = formatNthLineLabel(val);
      markPreviewDirty();
    };

    $('contourDensity').oninput = (e) => {
      state.contour.density = parseInt(e.target.value, 10);
      $('contourDensityVal').innerText = getContourLineCount();
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

    $('buildingToggle').onclick = function() {
      state.mapFeatures.buildings.enabled=!state.mapFeatures.buildings.enabled;
      this.classList.toggle('on',state.mapFeatures.buildings.enabled);markPreviewDirty();
    };
    $('buildingFillToggle').onclick = function() {
      state.mapFeatures.buildings.filled=!state.mapFeatures.buildings.filled;
      this.classList.toggle('on',state.mapFeatures.buildings.filled);markPreviewDirty();
    };
    for(const [id,key] of [['buildingColor','color'],['buildingOutline','outline']]) $(id).oninput=event=>{state.mapFeatures.buildings[key]=event.target.value;markPreviewDirty();};
    const setBuildingWidth=value=>{
      if(value==='') return;
      const width=Math.max(0,Math.min(1,Number(value)||0));
      state.mapFeatures.buildings.width=width;
      $('buildingWidth').value=width;$('buildingWidthInput').value=width;syncSliders();markPreviewDirty();
    };
    $('buildingWidth').oninput=event=>setBuildingWidth(event.target.value);
    $('buildingWidthInput').onchange=event=>setBuildingWidth(event.target.value);
    $('buildingOpacity').oninput=event=>{
      state.mapFeatures.buildings.opacity=toPercent(event.target.value);
      $('buildingOpacityVal').textContent=state.mapFeatures.buildings.opacity+'%';markPreviewDirty();
    };
    $('buildingMinArea').oninput=event=>{
      state.mapFeatures.buildings.minArea=Math.max(0,Math.min(5,Number(event.target.value)||0));
      $('buildingMinAreaVal').textContent=state.mapFeatures.buildings.minArea.toFixed(1);buildingCache.data=null;markPreviewDirty();
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
    $('riverWidthInput').onchange = (e) => setRiverWidth(e.target.value);
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
    $('roadWidthInput').onchange = (e) => setRoadWidth(e.target.value);
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
    ['dimW','dimH'].forEach(id => $(id).onchange = () => {
      state[id === 'dimW' ? 'wMm' : 'hMm'] = clampDimensionMm($(id).value);
      $(id).value = state[id === 'dimW' ? 'wMm' : 'hMm'];
      updateVf();
    });

    const syncUiFromState = () => {
      document.querySelectorAll('[data-preset]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.preset===state.theme.preset)));
      $('presetDescription').textContent=DESIGN_PRESETS[state.theme.preset]?.description || 'Custom design';
      const buildings=state.mapFeatures.buildings;
      $('buildingToggle').classList.toggle('on',buildings.enabled);
      $('buildingFillToggle').classList.toggle('on',buildings.filled);
      $('buildingColor').value=buildings.color;
      $('buildingOutline').value=buildings.outline;
      $('buildingWidth').value=buildings.width;
      $('buildingWidthInput').value=buildings.width;
      $('buildingOpacity').value=buildings.opacity;
      $('buildingOpacityVal').textContent=buildings.opacity+'%';
      $('buildingMinArea').value=buildings.minArea;
      $('buildingMinAreaVal').textContent=buildings.minArea.toFixed(1);

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
      $('contourDensityVal').innerText = getContourLineCount();
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
      syncSliders();
    };
    function syncSliders() {
      document.querySelectorAll('input[type="range"]').forEach(input=>{
        const min=Number(input.min)||0,max=Number(input.max)||100,value=Number(input.value);
        input.style.setProperty('--range-progress',((value-min)/(max-min)*100)+'%');
        input.setAttribute('aria-valuetext',input.id.toLowerCase().includes('width')?value.toFixed(2)+' millimetres':input.value);
      });
    }
    document.querySelectorAll('input[type="range"]').forEach(input=>{
      const row=input.closest('.cust-row');
      if(!input.getAttribute('aria-label')&&!input.labels?.length) input.setAttribute('aria-label',row?.querySelector('.ui-label')?.textContent||input.id);
      input.addEventListener('input',syncSliders);
    });

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
      if(disposed) return;
      if(['sq','circle','hex'].includes(state.shape)) { state.hMm = state.wMm; $('dimH').value = state.wMm; }
      if(state.shape === 'din_l') { state.hMm = Math.round(state.wMm / 1.414); $('dimH').value = state.hMm; }
      if(state.shape === 'din_p') { state.hMm = Math.round(state.wMm * 1.414); $('dimH').value = state.hMm; }

      const winW = window.innerWidth, winH = window.innerHeight;
      const sidebar = document.querySelector('.sidebar').getBoundingClientRect();
      const headerH = document.querySelector('.top-header')?.offsetHeight || 0;
      const pad = 16;
      const mobile = winW <= 980;
      const left = mobile ? pad : sidebar.right + pad;
      const top = headerH + pad;
      const right = winW - pad;
      const bottom = mobile ? sidebar.top - pad : winH - pad;
      const availW = Math.max(1, right - left);
      const availH = Math.max(1, bottom - top);
      const cx = left + availW / 2;
      const cy = top + availH / 2;
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
    window.addEventListener('resize', () => { map.resize(); updateVf(); }, {signal:lifetime.signal});
    const frameObserver = new ResizeObserver(updateVf);
    frameObserver.observe(document.querySelector('.sidebar'));
    map.on('move', updateVf);
    map.on('zoom', updateVf);
    map.on('resize', updateVf);
    const frameTimer = setTimeout(updateVf,500);

    // --- GENERATION PIPELINE ---
    const generationPhases=['terrain','map','render'];
    const showGenerationStatus = value => {
      const update=typeof value==='string'?{detail:value}:value;
      const phase=update.phase||(/map|building|road|water/i.test(update.detail)?'map':'terrain');
      $('generationPanel').dataset.state=update.state||'loading';
      $('generationTitle').textContent=update.title||(phase==='terrain'?'Loading elevation':phase==='map'?'Loading map layers':'Preparing preview');
      $('generationStatus').textContent=update.detail;
      $('generationError').hidden=true; $('retryGeneration').hidden=true; $('generationSteps').hidden=false;
      const current=generationPhases.indexOf(phase);
      $('generationSteps').querySelectorAll('[data-phase]').forEach((el,index)=>{
        el.classList.toggle('active',index===current&&update.state!=='success');
        el.classList.toggle('done',index<current||update.state==='success');
      });
      if(Number.isFinite(update.percent)){$('generationProgress').value=update.percent;$('generationPercent').textContent=`${Math.round(update.percent)}%`;}
      else {$('generationProgress').removeAttribute('value');$('generationPercent').textContent='';}
    };
    const showGenerationError = error => {
      const report=describeError(error,'area'), cancelled=report.kind==='cancelled';
      showGenerationStatus({phase:'terrain',state:cancelled?'idle':'error',title:report.title,detail:report.message});
      $('generationSteps').hidden=true; $('generationError').hidden=cancelled;
      $('generationErrorTitle').textContent=report.title; $('generationErrorMessage').textContent=report.message;
      $('generationErrorAction').textContent=report.action; $('generationErrorTechnical').textContent=report.technical;
      $('retryGeneration').hidden=cancelled;
    };
    const openPreview = () => {
      if(lastFrame) {
        Object.assign(state,lastFrame);
        $('dimW').value=state.wMm; $('dimH').value=state.hMm; $('shapeSel').value=state.shape;
        $('dimH').disabled=['sq','circle','hex','din_l','din_p'].includes(state.shape);
        if(outputMode==='2d')renderSVG();
      }
      $('modal').classList.add('open');
      document.querySelector('.sidebar').inert = true;
      document.querySelector('.viewport').inert = true;
      $('modal').dataset.mode=outputMode;
      if(outputMode==='3d')modelWorkflow.open();
      syncPreviewZoom();
      $('closePreview').focus();
    };
    $('previousPreview').onclick = () => { if(state.terrainData) openPreview(); };
    $('cancelGeneration').onclick = () => activeJob?.abort();
    let outputMode='2d',reuseArea=false,lastRequestedMode='2d';
    const modelWorkflow=initModelWorkflow(state,{save,runExportFlow,signal:lifetime.signal});
    let previewScale=1, cameraZoom=1;
    const syncPreviewZoom=()=>{
      if(outputMode==='2d') {
        const artwork=$('previewArea').firstElementChild;
        if(artwork) artwork.style.transform=`scale(${previewScale})`;
        $('previewZoomValue').textContent=`${Math.round(previewScale*100)}%`;
      } else $('previewZoomValue').textContent=`${Math.round(cameraZoom*100)}%`;
    };
    const zoomPreview=direction=>{
      if(outputMode==='3d'){cameraZoom=Math.max(.35,Math.min(4,cameraZoom*(direction>0?1.2:1/1.2)));modelWorkflow.zoom(direction);}
      else previewScale=Math.max(.5,Math.min(5,previewScale*(direction>0?1.2:1/1.2)));
      syncPreviewZoom();
    };
    $('previewZoomIn').onclick=()=>zoomPreview(1);
    $('previewZoomOut').onclick=()=>zoomPreview(-1);
    $('previewZoomFit').onclick=()=>{previewScale=1;cameraZoom=1;modelWorkflow.resetView();syncPreviewZoom();};
    $('previewArea').addEventListener('wheel',event=>{if(outputMode!=='2d')return;event.preventDefault();zoomPreview(event.deltaY<0?1:-1);},{passive:false,signal:lifetime.signal});
    function chooseOutput(reuse=false) {
      reuseArea=reuse;
      if(!reuse){map.stop();updateVf();}
      const b=reuse?state.renderBbox:state.bbox;
      const km2=b?Math.abs((b.ne.lat-b.sw.lat)*111.32*(b.ne.lng-b.sw.lng)*111.32*Math.cos((b.ne.lat+b.sw.lat)*Math.PI/360)):0;
      $('areaSummary').textContent=`Selected area: ${km2.toFixed(2)} km². ${km2>25?'Large area: dense buildings and streets can be slow or exceed browser limits. A smaller area is recommended for 3D.':'Choose a purpose, then customize its presets and layers.'}`;
      $('purposeDialog').showModal();
    }
    $('btnGen').onclick=()=>chooseOutput(false);
    $('changeOutput').onclick=()=>chooseOutput(true);
    for(const mode of ['2d','3d'])$('choose'+mode).onclick=()=>{
      $('purposeDialog').close();
      if(reuseArea){outputMode=mode;previewScale=1;cameraZoom=1;$('modal').dataset.mode=mode;setStep('2');if(mode==='3d')modelWorkflow.open();else renderSVG();syncPreviewZoom();}
      else void generateArea(mode);
    };
    $('retryGeneration').onclick=()=>void generateArea(lastRequestedMode);
    async function generateArea(mode) {
      if(activeJob || exportBusy || disposed) return;
      lastRequestedMode=mode;
      previewScale=1; cameraZoom=1;
      const controller = new AbortController();
      activeJob = controller;
      const previous = { terrainData: state.terrainData, osmData: state.osmData, osmStatus: state.osmStatus, renderBbox: state.renderBbox };
      const controls = Array.from(document.querySelectorAll('.sidebar input, .sidebar select, #btnGen, #previousPreview, #searchButton, .maplibregl-ctrl-group button'));
      const disabled = controls.map(el => el.disabled);
      controls.forEach(el => el.disabled = true);
      const interactions = [map.dragPan, map.scrollZoom, map.boxZoom, map.doubleClickZoom, map.touchZoomRotate, map.keyboard];
      const enabled = interactions.map(control => control.isEnabled());
      interactions.forEach(control => control.disable());
      $('cancelGeneration').hidden = false;
      $('generationProgress').hidden=false;
      showGenerationStatus({phase:'terrain',percent:3,title:'Loading elevation',detail:'Connecting to the primary terrain source…'});
      $('suggestionBox').style.display='none';
      try {
        updateVf();
        const bounds = structuredClone(state.bbox);
        validateBounds(bounds);
        const key = bboxKey(bounds.sw, bounds.ne);
        const terrain = terrainCache.get(key) || await runWorker('terrain', bounds, {
          signal: controller.signal, progress: value => { if(!disposed) showGenerationStatus(terrainProgress(value)); }
        });
        if(controller.signal.aborted || disposed) throw new DOMException('Cancelled', 'AbortError');
        cachePut(terrainCache, key, terrain);
        state.renderBbox = bounds;
        state.terrainData = terrain;
        state.terrainVersion++;
        state.pngPreviewCache = {key:null,dataUrl:null};
        showGenerationStatus({phase:'map',percent:62,title:'Loading map layers',detail:'Terrain is ready. Loading buildings, roads, water and green areas…'});
        const mapOk = await fetchMapFeatures(bounds.sw, bounds.ne, controller.signal);
        if(controller.signal.aborted || disposed) throw new DOMException('Cancelled', 'AbortError');
        state.osmStatus.ignored = !mapOk;
        outputMode=mode;modelWorkflow.invalidate();
        showGenerationStatus({phase:'render',percent:94,title:'Preparing preview',detail:outputMode==='3d'?'Opening the 3D workspace…':'Rendering the 2D artwork…'});
        if(outputMode==='2d')renderSVG();
        setStep('2');
        showGenerationStatus({phase:'render',percent:100,state:mapOk?'success':'warning',title:mapOk?'Area ready':'Terrain ready with missing layers',detail:terrain.source+(mapOk?' · Map layers loaded.':' · Map overlays unavailable; terrain-only work remains available.')});
        $('retryGeneration').hidden=mapOk;
        lastFrame={wMm:state.wMm,hMm:state.hMm,shape:state.shape};
        $('terrainSource').textContent = mapOk ? terrain.source : `${terrain.source} · Map overlays unavailable. Close the preview and retry to load buildings, roads and water.`;
        $('terrainSource').classList.toggle('error',!mapOk);
        openPreview();
      } catch(error) {
        Object.assign(state, previous);
        state.terrainVersion++;
        state.pngPreviewCache = {key:null,dataUrl:null};
        if(!disposed) {
          if(state.terrainData) renderSVG();
          showGenerationError(error);
        }
      } finally {
        activeJob = null;
        if(!disposed) {
          controls.forEach((el,i) => el.disabled = disabled[i]);
          interactions.forEach((control,i) => { if(enabled[i]) control.enable(); });
          $('cancelGeneration').hidden = true;
          $('generationProgress').hidden=['idle','error'].includes($('generationPanel').dataset.state);
          $('previousPreview').hidden = !state.terrainData;
          $('btnGen').textContent = 'Continue · choose output';
          updateMapDataStatus();
          idle();
        }
      }
    };

    let lastFrame = null;
    let contourCache = {key:null, groups:[]};
    let buildingCache={data:null,key:null,buildings:[],stats:{original:0,shown:0,omitted:0,simplified:0}};
    function visibleBuildings() {
      const style=state.mapFeatures.buildings,key=[state.wMm,state.hMm,state.shape,style.minArea,style.maxCount].join(':');
      if(buildingCache.data!==state.osmData||buildingCache.key!==key) {
        const prepared=prepareBuildingLod(clipBuildings(state.osmData?.buildings||[],getClipPolygon()),{minArea:style.minArea,tolerance:.06,maxBuildings:style.maxCount});
        buildingCache={data:state.osmData,key,...prepared};
      }
      return buildingCache.buildings;
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
        buildings: () => {
          const style=state.mapFeatures.buildings;
          if(!style.enabled) return '';
          return `<g id="buildings" fill="${style.filled?style.color:'none'}" stroke="${style.width>0?style.outline:'none'}" stroke-width="${style.width}" opacity="${toUnitOpacity(style.opacity)}" fill-rule="evenodd" stroke-linejoin="miter">`+
            visibleBuildings().map(building=>`<path d="${buildingPath(building)}"/>`).join('')+'</g>';
        },
        green: () => {
          if(!state.osmData || !state.mapFeatures.greenAreas.enabled || !state.osmData.greenAreas.length) return '';
          let out = `<g id="greenAreas" fill-rule="evenodd" fill="${state.mapFeatures.greenAreas.color}" fill-opacity="${toUnitOpacity(state.mapFeatures.greenAreas.opacity)}">`;
          state.osmData.greenAreas.forEach((area) => {
            const d = buildingPath(area);
            if(d) out += `<path d="${d}"/>`;
          });
          return out + `</g>`;
        },
        water: () => {
          if(!state.osmData || !state.mapFeatures.waterAreas.enabled || !state.osmData.waterAreas.length) return '';
          let out = `<g id="waterAreas" fill-rule="evenodd" fill="${state.mapFeatures.waterAreas.color}" fill-opacity="${toUnitOpacity(state.mapFeatures.waterAreas.opacity)}">`;
          state.osmData.waterAreas.forEach((area) => {
            const d = buildingPath(area);
            if(d) out += `<path d="${d}"/>`;
          });
          return out + `</g>`;
        },
        rivers: () => {
          if(!state.osmData || !state.mapFeatures.rivers.enabled || !state.osmData.waterLines.length) return '';
          let out = `<g id="rivers" stroke="${state.mapFeatures.rivers.color}" stroke-width="${state.mapFeatures.rivers.width}" stroke-opacity="${toUnitOpacity(state.mapFeatures.rivers.opacity)}" fill="none" stroke-linecap="round" stroke-linejoin="round">`;
          state.osmData.waterLines.forEach((line) => {
            const d = pathFromCoords(line, false);
            if(d) out += `<path d="${d}"/>`;
          });
          return out + `</g>`;
        },
        roads: () => {
          if(!state.osmData || !state.mapFeatures.roads.enabled || !state.osmData.roadLines.length) return '';
          let out = `<g id="roads" stroke="${state.mapFeatures.roads.color}" stroke-width="${state.mapFeatures.roads.width}" stroke-opacity="${toUnitOpacity(state.mapFeatures.roads.opacity)}" fill="none" stroke-linecap="round" stroke-linejoin="round">`;
          state.osmData.roadLines.forEach((line) => {
            const d = pathFromCoords(line, false);
            if(d) out += `<path d="${d}"/>`;
          });
          return out + `</g>`;
        },
        contours: () => {
          state.contourPaths = [];
          if(!state.contour.enabled) return '';
          if(state.terrainData?.delta === 0) return '';
          if(!state.terrainData) {
            const cx = wMm / 2;
            const cy = hMm / 2;
            return `<text x="${cx}" y="${cy}" text-anchor="middle" font-family="SF Pro Text, Segoe UI, Roboto, sans-serif" font-size="6" fill="#9AA3B2">Elevation data missing. Try generating again.</text>`;
          }
          const key = [state.terrainVersion,wMm,hMm,state.shape,state.contour.density,state.contour.smooth].join(':');
          if(contourCache.key !== key) {
            const clip = getClipPolygon();
            const groups = getContourLevels().map(level =>
              buildPolylines(getContourSegments(level,wMm,hMm)).flatMap(line =>
                clipPolylineToPolygon(smoothPolyline(line,state.contour.smooth),clip)
              )
            );
            contourCache = {key,groups};
          }
          const emphasisEvery = Math.max(0,Math.round(state.contour.emphasisEvery || 0));
          let out = `<g id="contours" stroke="${state.contour.color}" stroke-opacity="${toUnitOpacity(state.contour.opacity)}" fill="none" stroke-linecap="round" stroke-linejoin="round">`;
          contourCache.groups.forEach((paths,index) => {
            const lineWidth = state.contour.width * (emphasisEvery > 0 && (index+1)%emphasisEvery === 0 ? 2 : 1);
            paths.forEach(path => {
              state.contourPaths.push(path);
              const d=path.map((pt,i)=>`${i?'L':'M'} ${pt[0].toFixed(2)} ${pt[1].toFixed(2)}`).join(' ');
              out += `<path d="${d}" stroke-width="${lineWidth}" />`;
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
          let out = `<g id="placeLabels" font-family="${escapeXml(fontFamily)}" text-anchor="middle" fill="${state.mapFeatures.labels.color}" fill-opacity="${toUnitOpacity(state.mapFeatures.labels.opacity)}" paint-order="stroke" font-weight="${fontWeight}" font-style="${fontStyle}">`;
          state.osmData.labels.forEach((place) => {
            const [x, y] = projectToSvg(place.lat, place.lon);
            const size = getLabelSize(place);
            const stroke = haloEnabled ? ` stroke="${haloColor}" stroke-width="0.6"` : ' stroke="none" stroke-width="0"';
            out += `<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" font-size="${size.toFixed(2)}"${stroke}>${escapeXml(place.name)}</text>`;
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
        svg += `<path d="${clipPathD}" fill="none" stroke="#6b7280" stroke-width="0.2" />`;
      }
      svg += `</svg>`;
      return svg;
    }

    function renderSVG() {
      if(disposed) return;
      const svg = buildSvgMarkup({ includeBackground: true, includeGradient: true, includeFrame: true });
      $('previewArea').innerHTML = svg;
      syncPreviewZoom();
      const buildings=visibleBuildings();
      const stats=buildingCache.stats;
      $('buildingCount').textContent=state.osmStatus.loaded ? `${buildings.length.toLocaleString()} shown${stats.omitted?` · ${stats.omitted.toLocaleString()} tiny/dense footprints omitted`:''}${stats.simplified?` · ${stats.simplified.toLocaleString()} vertices simplified`:''} · ${buildings.filter(b=>b.height.estimated).length.toLocaleString()} estimated heights` : 'Building data unavailable. Regenerate to retry.';
      updatePngRangeInfo();
      state.previewDirty = false;
      updateAutoPreviewButton();
    }

    $('btnSVG').onclick = async()=>runExportFlow('SVG',async onSave=>{
      const svg=buildSvgMarkup({includeBackground:true,includeGradient:true,includeFrame:false});
      await onSave();save(new Blob([svg],{type:'image/svg+xml'}),'Topomapper.svg');
    });

    $('btnDXF').onclick = async () => {
      if(!state.terrainData && !state.osmData) return;
      await runExportFlow('DXF', async (onSave) => {
        buildSvgMarkup({ includeBackground: false, includeGradient: false, includeFrame: true });
        let dxf = "0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1015\n9\n$INSUNITS\n70\n4\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n";
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
          outPts.forEach(p => dxf += `10\n${p[0].toFixed(6)}\n20\n${(state.hMm - p[1]).toFixed(6)}\n`);
        };
        const writeText = (layer, text, x, y, height, color) => {
          if(!text) return;
          const rgb = colorToRgb(color);
          const aci = rgbToAci(rgb);
          const trueColor = (rgb.r << 16) + (rgb.g << 8) + rgb.b;
          const safeText = String(text).replace(/[\r\n\t]+/g, ' ').trim();
          if(!safeText) return;
          dxf += `0\nTEXT\n8\n${layer}\n62\n${aci}\n420\n${trueColor}\n10\n${x.toFixed(6)}\n20\n${(state.hMm - y).toFixed(6)}\n40\n${height.toFixed(6)}\n1\n${safeText}\n50\n0\n`;
        };
        const clipPoly = getClipPolygon();
        if(polygonArea(clipPoly) < 0) clipPoly.reverse();
        if(state.contour.enabled) {
          state.contourPaths.forEach(path => {
            clipPolylineToPolygon(path, clipPoly).forEach(seg => writePolyline('CONTOURS', seg, state.contour.color, false));
          });
        }
        if(state.osmData) {
          if(state.mapFeatures.buildings.enabled) visibleBuildings().forEach(building=>building.polygons.forEach(polygon=>polygon.forEach(ring=>writePolyline('BUILDINGS',ring,state.mapFeatures.buildings.outline,true))));
          if(state.mapFeatures.greenAreas.enabled) {
            clipBuildings(state.osmData.greenAreas,clipPoly).forEach(area=>area.polygons.forEach(polygon=>polygon.forEach(ring=>writePolyline('GREEN_AREAS',ring,state.mapFeatures.greenAreas.color,true))));
          }
          if(state.mapFeatures.waterAreas.enabled) {
            clipBuildings(state.osmData.waterAreas,clipPoly).forEach(area=>area.polygons.forEach(polygon=>polygon.forEach(ring=>writePolyline('WATER_AREAS',ring,state.mapFeatures.waterAreas.color,true))));
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
        if(onSave) await onSave();
        save(new Blob([dxf], {type:'application/dxf'}), 'Topomapper.dxf');
      });
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
        img.onerror = () => reject(new Error('SVG could not be rendered. Check the design and retry.'));
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

    const buildLayeredGradientCanvas = (w, h, alpha) => {
      if(!state.terrainData) return { canvas: null, error: 'data' };
      if(alpha <= 0) return { canvas: null, error: null };
      const range = getShapeHeightRange();
      if(!range) return { canvas: null, error: 'data' };
      const boundaries = [range.minNorm, ...getContourLevels(range.minNorm, range.maxNorm), range.maxNorm];
      if(boundaries.length < 2) return { canvas: null, error: 'range' };
      const bandCount = Math.max(2, boundaries.length - 1);
      const bandColors = [];
      for(let i=0; i<boundaries.length - 1; i++) {
        const midNorm = (boundaries[i] + boundaries[i + 1]) / 2;
        const height = state.terrainData.min + midNorm;
        const t = range.maxZ === range.minZ ? 0 : (height - range.minZ) / (range.maxZ - range.minZ);
        bandColors.push(getHypsometricBandColor(t, state.png.scheme, bandCount));
      }

      const heightMap = buildHeightMap(w, h);
      if(!heightMap) return { canvas: null, error: 'data' };
      const cv = document.createElement('canvas');
      cv.width = w;
      cv.height = h;
      const ctx = cv.getContext('2d');
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
      return { canvas: cv, error: null };
    };

    async function exportLayeredPng(onSave) {
      if(!state.terrainData) {
        throw new Error('Generate terrain before exporting.');
      }
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

      const maxEdge = Math.max(w, h);
      const targetEdge = Math.min(maxEdge, 1600);
      const scale = maxEdge > 0 ? targetEdge / maxEdge : 1;
      const gradW = Math.max(1, Math.round(w * scale));
      const gradH = Math.max(1, Math.round(h * scale));
      const alpha = Math.round(255 * clamp(toUnitOpacity(state.png.gradientOpacity), 0, 1));
      const gradientResult = buildLayeredGradientCanvas(gradW, gradH, alpha);
      if(gradientResult.error === 'data') {
        throw new Error('Elevation data missing.');
      }
      if(gradientResult.error === 'range') {
        throw new Error('Contour range too small for height band export.');
      }
      if(gradientResult.canvas) {
        ctx.save();
        clipCanvasToShape(ctx, w, h);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.globalCompositeOperation = getCanvasBlendMode(state.png.blend);
        ctx.drawImage(gradientResult.canvas, 0, 0, w, h);
        ctx.restore();
      }

      const overlaySvg = buildSvgMarkup({ includeBackground: false, includeGradient: false, includeFrame: false });
      try {
        await drawSvgOnCanvas(ctx, overlaySvg, w, h);
      } catch (e) {
        throw new Error('Could not render map overlays. No partial PNG was saved.');
      }
      if(onSave) await onSave();
      await new Promise((resolve, reject) => {
        cv.toBlob((b) => {
          if(!b) { reject(new Error('PNG encoding failed. Try a lower resolution.')); return; }
          save(b, 'Topomapper_Layered.png');
          resolve();
        });
      });
    }

    const exportSvgPng = async (onSave) => {
      const e = +$('pngResRange').value;
      const r = state.hMm / state.wMm;
      const w = state.wMm >= state.hMm ? e : Math.round(e / r);
      const h = state.wMm >= state.hMm ? Math.round(e * r) : e;
      const s = buildSvgMarkup({ includeBackground: true, includeGradient: true, includeFrame: false });
      const img = new Image();
      const cv = document.createElement('canvas');
      cv.width = w;
      cv.height = h;
      await new Promise((resolve, reject) => {
        img.onload = () => {
          const ctx = cv.getContext('2d');
          ctx.fillStyle = state.theme.background;
          ctx.fillRect(0, 0, w, h);
          clipCanvasToShape(ctx, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          resolve();
        };
        img.onerror = reject;
        img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(s)));
      });
      if(onSave) await onSave();
      await new Promise((resolve, reject) => {
        cv.toBlob((b) => {
          if(!b) { reject(new Error('PNG encoding failed. Try a lower resolution.')); return; }
          save(b, 'Topomapper.png');
          resolve();
        });
      });
    };

    $('btnPNG').onclick = async () => {
      if(state.png.layered) {
        if(!state.terrainData) {
          alert('Generate contours first.');
          return;
        }
        await runExportFlow('PNG', exportLayeredPng);
        return;
      }
      await runExportFlow('PNG', exportSvgPng);
    };

    const closePreview = () => {
      if(exportBusy) return;
      $('modal').classList.remove('open');
      document.querySelector('.sidebar').inert = false;
      document.querySelector('.viewport').inert = false;
      $('previousPreview').focus();
    };
    $('closePreview').onclick = closePreview;
    document.addEventListener('keydown', event => {
      if($('purposeDialog').open)return;
      if(!$('modal').classList.contains('open')) return;
      if(event.key === 'Escape') closePreview();
      if(event.key === 'Tab') {
        const focusable = Array.from($('modal').querySelectorAll('button, input, select, a[href], [tabindex="0"]')).filter(el => !el.disabled && el.getClientRects().length);
        const first=focusable[0],last=focusable.at(-1);
        if(event.shiftKey && document.activeElement===first) { event.preventDefault(); last?.focus(); }
        else if(!event.shiftKey && document.activeElement===last) { event.preventDefault(); first?.focus(); }
      }
    }, {signal:lifetime.signal});
    function save(b, n) {
      if(!b || b.size === 0) throw new Error('The export was empty. Please retry.');
      const a=document.createElement('a'), url=URL.createObjectURL(b);
      a.href=url; a.download=n; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
    }
    const syncSwitchAccessibility = () => document.querySelectorAll('.ios-switch').forEach(el => el.setAttribute('aria-checked',String(el.classList.contains('on'))));
    const switchObserver = new MutationObserver(syncSwitchAccessibility);
    document.querySelectorAll('.ios-switch').forEach(el => {
      switchObserver.observe(el,{attributes:true,attributeFilter:['class']});
      el.addEventListener('click',()=>queueMicrotask(()=>{if(!disposed) pushHistoryState();}));
    });
    syncSwitchAccessibility();
    document.querySelectorAll('.layer-head .layer-info').forEach(el => {
      el.tabIndex=0; el.setAttribute('role','button');
      el.setAttribute('aria-label','Expand '+el.textContent.trim()+' options');
      el.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();el.click();}});
    });
    return () => {
      modelWorkflow.dispose();
      disposed = true; activeJob?.abort(); activeSearch?.abort(); lifetime.abort();
      clearTimeout(timer); clearTimeout(frameTimer); clearTimeout(exportStatusTimer); clearTimeout(previewTimer); clearTimeout(mapNoticeTimer);
      frameObserver.disconnect(); switchObserver.disconnect(); map.remove();
    };
}
