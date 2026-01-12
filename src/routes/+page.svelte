<script>
  import { onMount } from 'svelte';
  import { base } from '$app/paths';

  onMount(async () => {
    const { initTopomapper } = await import('$lib/topomapper');
    initTopomapper();
  });
</script>

<svelte:head>
  <title>Topomapper</title>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:wght@400;600;700;800&family=JetBrains+Mono:wght@400;600&family=Space+Grotesk:wght@400;500;600;700&display=swap" />
</svelte:head>

<div id="loader" class="loader"><div class="spinner"></div><span id="loaderText">Loading...</span></div>

<header class="top-header">
  <a class="top-brand" href={base + '/'}>
    <img class="top-logo" src="/assets/logo.png" alt="Topomapper logo">
  </a>
</header>

<div class="sidebar">
  <div class="scroll-content">
    <div class="group">
      <label class="ui-label" for="searchInp">Location Search</label>
      <div class="search-container">
        <input type="text" id="searchInp" placeholder="City, Region..." autocomplete="off">
        <div id="suggestionBox" class="suggestions"></div>
      </div>
    </div>

    <div class="group">
      <label class="ui-label" for="shapeSel">Format & Dimension</label>
      <select id="shapeSel" style="margin-bottom:12px;">
        <option value="rect">Rectangle</option>
        <option value="din_l">DIN Landscape</option>
        <option value="din_p">DIN Portrait</option>
        <option value="sq">Square</option>
        <option value="circle">Circle</option>
        <option value="hex">Hexagon</option>
      </select>
      <div class="input-grid">
        <div><label class="ui-label" for="dimW">Width (mm)</label><input type="number" id="dimW" value="200"></div>
        <div><label class="ui-label" for="dimH">Height (mm)</label><input type="number" id="dimH" value="140"></div>
      </div>
    </div>

    <div class="group">
      <span class="ui-label">Step 1 · Choose Frame</span>
      <p style="font-size:12px; color:var(--color-text-sec); margin-top:6px; line-height:1.4;">
        Contour styling, color presets, and map feature layers are adjusted in the preview panel after generation.
      </p>
    </div>

    <button id="btnGen" class="btn-main">Generate Preview</button>
    <div class="sidebar-footer">
      © <a href="https://github.com/topomapper" target="_blank" rel="noopener noreferrer">Topomapper</a>
    </div>
  </div>
</div>

<div class="viewport">
  <div id="map"></div>
  <div class="viewfinder-wrapper">
    <svg id="vfSvg" width="100%" height="100%">
      <defs><mask id="vfMask"><rect width="100%" height="100%" fill="white"/><path id="vfHole" fill="black"/></mask></defs>
      <rect width="100%" height="100%" class="vf-mask" mask="url(#vfMask)"/>
      <path id="vfOutline" class="vf-stroke" />
    </svg>
    <div id="vfBadge" class="vf-badge">200 x 140 mm</div>
  </div>
</div>

<div class="modal-overlay" id="modal">
  <div class="modal-card">
    <div class="preview-stage">
      <div id="previewArea"></div>
      <div class="preview-controls">
        <button id="undoStep2" class="btn-secondary icon-button" type="button" aria-label="Undo last change" title="Undo">&#8630;</button>
        <button id="refreshPreview" class="btn-secondary preview-toggle" type="button">Auto Preview On</button>
        <button id="redoStep2" class="btn-secondary icon-button" type="button" aria-label="Redo last change" title="Redo">&#8631;</button>
      </div>
    </div>
    <div class="export-side">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <div>
          <h2 style="margin:0; font-size:24px; font-weight:800; letter-spacing:-1px;">Preview & Export</h2>
          <div style="font-size:12px; color:var(--color-text-sec); margin-top:4px;">Step 2: Choose Design · Step 3: Export Design</div>
        </div>
        <button on:click={() => window.closeModal?.()} style="border:none;background:none;font-size:32px;cursor:pointer;color:var(--color-text-sec);">&times;</button>
      </div>

      <div class="stepper">
        <button class="active" data-step-target="2">Step 2 · Choose Design</button>
        <button data-step-target="3">Step 3 · Export Design</button>
      </div>

      <div class="step-content active" data-step="2">
        <div id="mapDataNotice" class="notice">
          <span id="mapDataNoticeText">Map data loading...</span>
          <button type="button" id="mapDataNoticeClose" aria-label="Dismiss notification">&times;</button>
        </div>
        <div class="group">
          <div class="ui-label">Preview</div>
          <p style="font-size:12px; color:var(--color-text-sec); margin-top:6px; line-height:1.4;">
            Auto preview can be switched off to avoid performance issues while customizing.
          </p>
        </div>
        <button id="resetStep2" class="btn-secondary">Reset Design</button>
        <div class="group">
          <label class="ui-label" for="presetSel">Design Preset</label>
          <select id="presetSel" style="margin-top:6px;">
            <option value="dark">Dark (Negative)</option>
            <option value="bright">Bright (Positive)</option>
            <option value="grayscale">Greyscale (Mono)</option>
          </select>
          <div id="designColors" style="margin-top:12px;">
            <div class="cust-row">
              <span style="margin:0" class="ui-label">Background</span>
              <div class="color-dot" id="bgColorDot" style="background:#141A22"><input type="color" id="bgColorPicker" value="#141A22"></div>
              <input type="text" id="bgColorText" placeholder="#141A22 or rgb(20,26,34)" style="flex:1">
            </div>
            <div class="cust-row">
              <span style="margin:0" class="ui-label">Contour Lines</span>
              <div class="color-dot" id="lineColorDot" style="background:#D7E3FF"><input type="color" id="lineColorPicker" value="#D7E3FF"></div>
              <input type="text" id="lineColorText" placeholder="#D7E3FF or rgb(215,227,255)" style="flex:1">
            </div>
          </div>
        </div>

        <div class="group">
          <div class="ui-label">Layer Stack (Drag to Reorder)</div>
          <p style="font-size:12px; color:var(--color-text-sec); margin-top:6px; line-height:1.4;">
            Grab the handle or use the arrows to move layers. Items higher in the list render above the ones below.
          </p>
          <div id="layerStack" class="layer-list">
            <div class="layer-item" data-layer="labels" draggable="true">
              <div class="layer-head drag-ready">
                <div class="layer-info">
                  <span class="drag-handle" title="Drag to reorder">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 6h8M8 12h8M8 18h8"/></svg>
                  </span>
                  <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M6 9l6 6 6-6"/></svg>
                  <span>Place Names</span>
                </div>
                <div class="layer-actions">
                  <button class="layer-move" data-move="up" title="Move layer up" aria-label="Move layer up">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6l-6 6h12z"/></svg>
                  </button>
                  <button class="layer-move" data-move="down" title="Move layer down" aria-label="Move layer down">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 18l6-6H6z"/></svg>
                  </button>
                  <div class="ios-switch" id="labelToggle"></div>
                </div>
              </div>
              <div class="layer-body">
                <div class="cust-row"><span style="margin:0" class="ui-label">Label Color</span><div class="color-dot" id="labelColorDot" style="background:#1E232B"><input type="color" id="labelColor" value="#1E232B"></div></div>
                <div class="cust-row"><span style="margin:0" class="ui-label">Text Background</span><div class="ios-switch" id="labelBgToggle"></div></div>
                <div class="cust-row"><span style="margin:0" class="ui-label">Background Color</span><div class="color-dot" id="labelBgColorDot" style="background:#F5F2EB"><input type="color" id="labelBgColor" value="#F5F2EB"></div></div>
                <div class="cust-row"><span style="margin:0" class="ui-label">Opacity (%)</span><input type="range" id="labelOpacity" min="0" max="100" step="1" value="85"><span id="labelOpacityVal" style="font-size:11px;width:46px;text-align:right;">85%</span></div>
                <div class="cust-row"><span style="margin:0" class="ui-label">Font Size (mm)</span><input type="range" id="labelSize" min="0.2" max="3" step="0.05" value="0.4"><span id="labelSizeVal" style="font-size:11px;width:56px;text-align:right;">0.40 mm</span></div>
                <div class="cust-row"><span style="margin:0" class="ui-label">Scale by Place Rank</span><div class="ios-switch" id="labelScaleToggle"></div></div>
                <div class="cust-row"><span style="margin:0" class="ui-label">Typeface</span>
                  <select id="labelFont">
                    <option value="system" selected>System Sans</option>
                    <option value="serif">Serif</option>
                    <option value="mono">Mono</option>
                    <option value="rounded">Rounded</option>
                    <option value="condensed">Condensed</option>
                    <option value="display">Display</option>
                  </select>
                </div>
                <div class="cust-row"><span style="margin:0" class="ui-label">Bold</span><div class="ios-switch" id="labelBoldToggle"></div></div>
                <div class="cust-row"><span style="margin:0" class="ui-label">Italic</span><div class="ios-switch" id="labelItalicToggle"></div></div>
              </div>
            </div>
            <div class="layer-item" data-layer="roads" draggable="true" style="margin-top:10px;">
              <div class="layer-head drag-ready">
                <div class="layer-info">
                  <span class="drag-handle" title="Drag to reorder">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 6h8M8 12h8M8 18h8"/></svg>
                  </span>
                  <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M6 9l6 6 6-6"/></svg>
                  <span>Roads</span>
                </div>
                <div class="layer-actions">
                  <button class="layer-move" data-move="up" title="Move layer up" aria-label="Move layer up">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6l-6 6h12z"/></svg>
                  </button>
                  <button class="layer-move" data-move="down" title="Move layer down" aria-label="Move layer down">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 18l6-6H6z"/></svg>
                  </button>
                  <div class="ios-switch" id="roadToggle"></div>
                </div>
              </div>
              <div class="layer-body">
                <div class="cust-row"><span style="margin:0" class="ui-label">Color</span><div class="color-dot" id="roadColorDot" style="background:#C9A75A"><input type="color" id="roadColor" value="#C9A75A"></div></div>
                <div class="cust-row"><span style="margin:0" class="ui-label">Line Width (px)</span><input type="range" id="roadWidth" min="0.1" max="2" step="0.05" value="0.2"><input type="number" id="roadWidthInput" class="width-input" min="0.1" max="2" step="0.05" value="0.2"></div>
                <div class="cust-row"><span style="margin:0" class="ui-label">Opacity (%)</span><input type="range" id="roadOpacity" min="0" max="100" step="1" value="75"><span id="roadOpacityVal" style="font-size:11px;width:46px;text-align:right;">75%</span></div>
              </div>
            </div>
            <div class="layer-item" data-layer="rivers" draggable="true" style="margin-top:10px;">
              <div class="layer-head drag-ready">
                <div class="layer-info">
                  <span class="drag-handle" title="Drag to reorder">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 6h8M8 12h8M8 18h8"/></svg>
                  </span>
                  <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M6 9l6 6 6-6"/></svg>
                  <span>Rivers</span>
                </div>
                <div class="layer-actions">
                  <button class="layer-move" data-move="up" title="Move layer up" aria-label="Move layer up">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6l-6 6h12z"/></svg>
                  </button>
                  <button class="layer-move" data-move="down" title="Move layer down" aria-label="Move layer down">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 18l6-6H6z"/></svg>
                  </button>
                  <div class="ios-switch" id="riverToggle"></div>
                </div>
              </div>
              <div class="layer-body">
                <div class="cust-row"><span style="margin:0" class="ui-label">Line Color</span><div class="color-dot" id="riverColorDot" style="background:#7DB5D3"><input type="color" id="riverColor" value="#7DB5D3"></div></div>
                <div class="cust-row"><span style="margin:0" class="ui-label">Line Width (px)</span><input type="range" id="riverWidth" min="0.1" max="2" step="0.05" value="0.2"><input type="number" id="riverWidthInput" class="width-input" min="0.1" max="2" step="0.05" value="0.2"></div>
                <div class="cust-row"><span style="margin:0" class="ui-label">Opacity (%)</span><input type="range" id="riverOpacity" min="0" max="100" step="1" value="85"><span id="riverOpacityVal" style="font-size:11px;width:46px;text-align:right;">85%</span></div>
              </div>
            </div>
            <div class="layer-item" data-layer="water" draggable="true" style="margin-top:10px;">
              <div class="layer-head drag-ready">
                <div class="layer-info">
                  <span class="drag-handle" title="Drag to reorder">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 6h8M8 12h8M8 18h8"/></svg>
                  </span>
                  <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M6 9l6 6 6-6"/></svg>
                  <span>Water Areas</span>
                </div>
                <div class="layer-actions">
                  <button class="layer-move" data-move="up" title="Move layer up" aria-label="Move layer up">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6l-6 6h12z"/></svg>
                  </button>
                  <button class="layer-move" data-move="down" title="Move layer down" aria-label="Move layer down">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 18l6-6H6z"/></svg>
                  </button>
                  <div class="ios-switch" id="waterAreaToggle"></div>
                </div>
              </div>
              <div class="layer-body">
                <div class="cust-row"><span style="margin:0" class="ui-label">Fill</span><div class="color-dot" id="waterAreaColorDot" style="background:#7DB5D3"><input type="color" id="waterAreaColor" value="#7DB5D3"></div></div>
                <div class="cust-row"><span style="margin:0" class="ui-label">Opacity (%)</span><input type="range" id="waterAreaOpacity" min="0" max="100" step="1" value="45"><span id="waterAreaOpacityVal" style="font-size:11px;width:46px;text-align:right;">45%</span></div>
              </div>
            </div>
            <div class="layer-item" data-layer="green" draggable="true" style="margin-top:10px;">
              <div class="layer-head drag-ready">
                <div class="layer-info">
                  <span class="drag-handle" title="Drag to reorder">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 6h8M8 12h8M8 18h8"/></svg>
                  </span>
                  <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M6 9l6 6 6-6"/></svg>
                  <span>Green Areas</span>
                </div>
                <div class="layer-actions">
                  <button class="layer-move" data-move="up" title="Move layer up" aria-label="Move layer up">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6l-6 6h12z"/></svg>
                  </button>
                  <button class="layer-move" data-move="down" title="Move layer down" aria-label="Move layer down">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 18l6-6H6z"/></svg>
                  </button>
                  <div class="ios-switch" id="greenAreaToggle"></div>
                </div>
              </div>
              <div class="layer-body">
                <div class="cust-row"><span style="margin:0" class="ui-label">Fill</span><div class="color-dot" id="greenAreaColorDot" style="background:#7FAE8A"><input type="color" id="greenAreaColor" value="#7FAE8A"></div></div>
                <div class="cust-row"><span style="margin:0" class="ui-label">Opacity (%)</span><input type="range" id="greenAreaOpacity" min="0" max="100" step="1" value="15"><span id="greenAreaOpacityVal" style="font-size:11px;width:46px;text-align:right;">15%</span></div>
              </div>
            </div>
            <div class="layer-item open" data-layer="contours" draggable="true" style="margin-top:10px;">
              <div class="layer-head drag-ready">
                <div class="layer-info">
                  <span class="drag-handle" title="Drag to reorder">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 6h8M8 12h8M8 18h8"/></svg>
                  </span>
                  <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M6 9l6 6 6-6"/></svg>
                  <span>Contour Lines</span>
                </div>
                <div class="layer-actions">
                  <button class="layer-move" data-move="up" title="Move layer up" aria-label="Move layer up">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6l-6 6h12z"/></svg>
                  </button>
                  <button class="layer-move" data-move="down" title="Move layer down" aria-label="Move layer down">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 18l6-6H6z"/></svg>
                  </button>
                  <div class="ios-switch on" id="contourToggle"></div>
                </div>
              </div>
              <div class="layer-body">
                <div class="cust-row"><span style="margin:0" class="ui-label">Color</span><div class="color-dot" style="background:#10141B"><input type="color" id="contourColor" value="#10141B"></div></div>
                <div class="cust-row"><span style="margin:0" class="ui-label">Line Width (px)</span><input type="range" id="contourWidth" min="0.1" max="2" step="0.05" value="0.2"><input type="number" id="contourWidthInput" class="width-input" min="0.1" max="2" step="0.05" value="0.2"></div>
                <div class="cust-row"><span style="margin:0" class="ui-label">Density</span><input type="range" id="contourDensity" min="5" max="250" step="5" value="24"><span id="contourDensityVal" style="font-size:11px;width:40px;text-align:right;">24</span></div>
          <div class="cust-row"><span style="margin:0" class="ui-label">Opacity (%)</span><input type="range" id="contourOpacity" min="0" max="100" step="1" value="80"><span id="contourOpacityVal" style="font-size:11px;width:46px;text-align:right;">80%</span></div>
                <div class="cust-row"><span style="margin:0" class="ui-label">Smoothing</span><input type="range" id="contourSmooth" min="0" max="5" step="1" value="4"><span id="contourSmoothVal" style="font-size:11px;width:40px;text-align:right;">4</span></div>
              </div>
            </div>
          </div>
        </div>
        <div class="group">
          <div class="ui-label">Hypsometric Fill (PNG)</div>
          <div class="layer-item" style="padding: 12px 14px; display:flex; flex-direction:column; gap:10px;">
            <div class="toggle-row">
              <span style="font-weight:600; font-size:14px;">Layered Height Bands</span>
              <div class="ios-switch" id="pngLayerToggle"></div>
            </div>
            <p style="font-size:11px; color:var(--color-text-sec); margin:0; line-height:1.4;">
              Fills each contour band with stepped colors and hillshade based on the lowest/highest points in the frame.
            </p>
            <div id="pngLayerOptions" style="display:none;">
              <div class="cust-row">
                <label class="ui-label" for="pngScheme" style="margin:0">Color Scheme</label>
                <select id="pngScheme">
                  <option value="color" selected>Topographic Color</option>
                  <option value="mono">Topographic Mono</option>
                  <option value="terra">Terra Warm</option>
                  <option value="glacier">Glacier Cool</option>
                </select>
              </div>
              <div class="cust-row">
                <label class="ui-label" for="pngBlendMode" style="margin:0">Blend Mode</label>
                <select id="pngBlendMode">
                  <option value="normal" selected>Normal</option>
                  <option value="multiply">Multiply</option>
                  <option value="color">Color</option>
                </select>
              </div>
              <div class="cust-row">
                <label class="ui-label" for="pngGradOpacity" style="margin:0">Fill Opacity (%)</label>
                <input type="range" id="pngGradOpacity" min="0" max="100" step="1" value="0">
                <span id="pngGradOpacityVal" style="font-size:11px;width:36px;text-align:right;">0%</span>
              </div>
              <div class="cust-row">
                <label class="ui-label" for="pngGradShift" style="margin:0">Gradient Shift (%)</label>
                <input type="range" id="pngGradShift" min="-80" max="80" step="1" value="0">
                <span id="pngGradShiftVal" style="font-size:11px;width:44px;text-align:right;">0%</span>
              </div>
              <div class="cust-row">
                <label class="ui-label" for="pngGradScale" style="margin:0">Gradient Scale (%)</label>
                <input type="range" id="pngGradScale" min="30" max="200" step="1" value="100">
                <span id="pngGradScaleVal" style="font-size:11px;width:44px;text-align:right;">100%</span>
              </div>
              <div class="gradient-preview" id="pngGradientPreview"></div>
              <div class="info-pill" id="pngRangeInfo" style="margin-top:10px;">Range: --</div>
            </div>
          </div>
        </div>
        <button id="toExport" class="btn-main" style="margin-top:6px;">Continue to Export</button>
      </div>

      <div class="step-content" data-step="3">
        <button id="backToStyle" class="btn-main" style="background:#3A3A3C;">Back to Design</button>
        <div class="group" style="margin-top:20px;">
        <div class="ui-label">3D Print (3MF Terrain)</div>
        <p style="font-size:13px; color:var(--color-text-sec); margin-bottom:12px; line-height:1.5;">
          Creates a watertight relief mesh based on elevation data. Contours remain 2D for vector exports.
        </p>
        <div class="input-grid">
           <div><label class="ui-label" for="socketMm">Socket (mm)</label><input type="text" id="socketMm" value="2.0" disabled></div>
           <div><label class="ui-label" for="targetH">Relief Hub</label><input type="number" id="targetH" value="10"></div>
        </div>
        <button id="btn3MF" class="btn-main" style="margin-top:10px;">Download 3MF</button>
      </div>

      <div class="group">
        <div class="ui-label">Laser / Vector (DXF)</div>
        <button id="btnDXF" class="btn-main" style="background:#3A3A3C;">Download DXF</button>
      </div>

      <div class="group">
        <div class="ui-label">Poster (PNG High-Res)</div>
        <label class="ui-label" for="pngResRange" style="margin-top:10px; font-size:10px;">Resolution (Long Edge)</label>
        <div class="cust-row" style="margin-bottom:8px;">
          <input type="range" id="pngResRange" min="500" max="8000" step="100" value="2000">
          <span id="pngResVal" style="font-size:12px; font-weight:700; width:60px;">2000px</span>
        </div>
        <button id="btnPNG" class="btn-main" style="background:#2B3440; color:#F5F7FB;">Save PNG</button>
      </div>
      </div>
    </div>
  </div>
</div>
