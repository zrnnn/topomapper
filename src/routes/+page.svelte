<script>
  import { onMount } from 'svelte';
  import { base } from '$app/paths';
  import { DESIGN_PRESETS } from '$lib/presets';
  import { MODEL_PRESETS } from '$lib/model';

  onMount(() => {
    let cancelled = false;
    let cleanup;
    import('$lib/topomapper').then(({ initTopomapper }) => {
      if(!cancelled) cleanup = initTopomapper();
    }).catch(() => {
      const status = document.getElementById('generationStatus');
      if(status) status.textContent = 'The app could not start. Please reload this page.';
    });
    return () => { cancelled = true; cleanup?.(); };
  });
</script>

<svelte:head>
  <title>Topomapper</title>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:wght@400;600;700;800&family=JetBrains+Mono:wght@400;600&family=Space+Grotesk:wght@400;500;600;700&display=swap" />
</svelte:head>

<div id="loader" class="loader"><div class="spinner"></div><span id="loaderText">Loading...</span><progress id="loaderProgress" max="100" aria-label="Operation progress"></progress></div>

<header class="top-header">
  <a class="top-brand" href={base + '/'}>
    <img class="top-logo" src={base + '/assets/logo.png'} alt="Topomapper logo">
  </a>
</header>

<div class="sidebar">
  <div class="scroll-content">
    <div class="hero">
      <div class="hero-eyebrow">Topo Studio</div>
      <h1 class="hero-title">Your place. On paper or in 3D.</h1>
      <p class="hero-copy">Choose an area, pick 2D or 3D, then customize and export.</p>
      <div class="hero-flow">
        <span>Area</span>
        <span>2D / 3D</span>
        <span>Export</span>
      </div>
      <div class="hero-card">
        <div class="hero-card-map"></div>
        <div class="hero-card-meta">
          <div class="hero-card-title">Schloss Neuschwanstein</div>
          <div class="hero-card-sub">200 x 140 mm &middot; Contours</div>
        </div>
      </div>
    </div>

    <div class="group">
      <label class="ui-label" for="searchInp">Location Search</label>
      <div class="search-container">
        <input type="text" id="searchInp" placeholder="City, Region..." autocomplete="off">
        <button id="searchButton" class="btn-secondary" type="button">Search</button>
        <div id="suggestionBox" class="suggestions"></div>
      </div>
      <div id="searchStatus" class="status-text" role="status"></div>
    </div>

    <details class="accordion" id="advancedControls">
      <summary>
        <span>Frame & Dimensions</span>
        <span class="accordion-meta">Advanced</span>
      </summary>
      <div class="accordion-body">
        <div class="group">
          <label class="ui-label" for="shapeSel">Format</label>
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
          <span class="ui-label">Step 1 - Choose Frame</span>
          <p style="font-size:12px; color:var(--color-text-sec); margin-top:6px; line-height:1.4;">
            Fine-tune contours, colors, and map layers after the preview loads.
          </p>
        </div>
      </div>
    </details>

    <div class="sidebar-footer">
      <a href="https://github.com/zrnnn/topomapper" target="_blank" rel="noopener noreferrer">Topomapper</a>
      · Elevation: <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank" rel="noopener noreferrer">Mapzen terrain sources</a>
    </div>
  </div>
  <div class="generation-actions">
    <div id="generationPanel" class="operation-panel" data-state="idle">
      <div class="operation-head"><span id="generationIcon" class="operation-icon" aria-hidden="true">1</span><div><strong id="generationTitle">Area ready</strong><span id="generationStatus" role="status" aria-live="polite">Move the map to frame your area, then continue.</span></div><span id="generationPercent" class="operation-percent"></span></div>
      <progress id="generationProgress" max="100" hidden aria-label="Area data progress"></progress>
      <div id="generationSteps" class="operation-steps" hidden aria-label="Generation phases"><span data-phase="terrain">Elevation</span><span data-phase="map">Map layers</span><span data-phase="render">Preview</span></div>
      <div id="generationError" class="error-report" hidden role="alert"><strong id="generationErrorTitle"></strong><span id="generationErrorMessage"></span><span id="generationErrorAction" class="error-action"></span><details><summary>Technical details</summary><code id="generationErrorTechnical"></code></details></div>
    </div>
    <button id="btnGen" class="btn-main">Continue · choose output</button>
    <button id="retryGeneration" class="btn-secondary" type="button" hidden>Retry loading this area</button>
    <button id="cancelGeneration" class="btn-secondary" type="button" hidden>Cancel generation</button>
    <button id="previousPreview" class="btn-secondary" type="button" hidden>Open previous preview</button>
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

<dialog id="purposeDialog" class="purpose-dialog"><form method="dialog"><div class="section-heading"><span class="ui-label">Step 2 · What are you making?</span><button class="btn-secondary" aria-label="Cancel output choice">×</button></div><p id="areaSummary" class="control-help"></p><div class="purpose-grid"><button id="choose2d" type="button" class="purpose-card"><strong>2D map</strong><span>Paper, posters & laser work</span><small>Shaded raster · PNG · SVG · DXF · contour lines</small></button><button id="choose3d" type="button" class="purpose-card"><strong>3D print</strong><span>A physical landscape or city</span><small>Raised buildings · streets · terrain · 3MF · STL · OBJ</small></button></div></form></dialog>

<div class="modal-overlay" id="modal" role="dialog" aria-modal="true" aria-label="Preview and export" tabindex="-1">
  <div class="modal-card">
    <div class="preview-stage">
      <div class="preview-zoom-controls" aria-label="Preview zoom"><button id="previewZoomOut" class="btn-secondary" type="button" aria-label="Zoom preview out">−</button><span id="previewZoomValue" aria-live="polite">100%</span><button id="previewZoomIn" class="btn-secondary" type="button" aria-label="Zoom preview in">+</button><button id="previewZoomFit" class="btn-secondary" type="button">Fit</button></div>
      <div id="previewArea" class="mode-2d"></div>
      <div id="preview3d" class="mode-3d"></div>
      <div id="modelFeedback" class="model-feedback operation-panel mode-3d" data-state="idle"><div class="operation-head"><span class="operation-icon" aria-hidden="true">3D</span><div><strong id="modelTitle">3D model</strong><p id="modelStatus" role="status" aria-live="polite">Choose settings, then update the model.</p></div><span id="modelPercent" class="operation-percent"></span></div><progress id="modelProgress" max="100" hidden aria-label="3D model progress"></progress><div id="modelError" class="error-report" hidden role="alert"><span id="modelErrorAction" class="error-action"></span><details><summary>Technical details</summary><code id="modelErrorTechnical"></code></details></div><button id="retryModel" class="btn-secondary" hidden>Retry model</button><button id="cancelModel" class="btn-secondary" hidden>Cancel model generation</button></div>
      <div class="model-preview-controls mode-3d"><span>Drag to orbit · scroll to zoom</span><button id="resetModelView" class="btn-secondary">Reset view</button></div>
      <div class="preview-controls mode-2d">
        <button id="undoStep2" class="btn-secondary icon-button" type="button" aria-label="Undo last change" title="Undo">&#8630;</button>
        <button id="refreshPreview" class="btn-secondary preview-toggle" type="button">Auto Preview On</button>
        <button id="renderPreview" class="btn-secondary" type="button" hidden>Update preview</button>
        <button id="redoStep2" class="btn-secondary icon-button" type="button" aria-label="Redo last change" title="Redo">&#8631;</button>
      </div>
    </div>
    <div class="export-side">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <div>
          <h2 style="margin:0; font-size:24px; font-weight:800; letter-spacing:-1px;">Map Studio</h2>
          <div style="font-size:12px; color:var(--color-text-sec); margin-top:4px;">Style your layers. Export with confidence.</div>
        </div>
        <button id="closePreview" aria-label="Close preview" style="border:none;background:none;font-size:32px;cursor:pointer;color:var(--color-text-sec);">&times;</button>
      </div>
      <button id="changeOutput" class="btn-secondary">Change output · 2D / 3D</button>
      <div id="terrainSource" class="status-text"></div>
      <details class="source-details"><summary>Data sources & credits</summary><div class="status-text">Data: <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank" rel="noopener noreferrer">Mapzen terrain source credits</a> · © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>. Keep source credits with published exports.</div></details>

        <div class="stepper">
        <button class="active" data-step-target="2">Design</button>
        <button data-step-target="3">Export</button>
      </div>

      <div class="step-content active" data-step="2">
        <div id="mapDataNotice" class="notice">
          <span id="mapDataNoticeText">Map data loading...</span>
          <button type="button" id="mapDataNoticeClose" aria-label="Dismiss notification">&times;</button>
        </div>
        <div class="mode-2d">
        <div class="group">
          <div class="ui-label">Preview</div>
          <p style="font-size:12px; color:var(--color-text-sec); margin-top:6px; line-height:1.4;">
            Auto preview can be switched off to avoid performance issues while customizing.
          </p>
        </div>
        <button id="resetStep2" class="btn-secondary">Reset Design</button>
        <div class="group">
          <div class="section-heading"><span class="ui-label">Start with a style</span><span class="section-hint">Then make it yours</span></div>
          <div class="preset-grid" aria-label="Map styles">
            {#each Object.entries(DESIGN_PRESETS) as [key, preset]}
              <button type="button" class="preset-card" data-preset={key} aria-pressed={key === 'topographic'}>
                <span class="preset-art" style:background={preset.background}>
                  <svg viewBox="0 0 140 45" aria-hidden="true">
                    {#if preset.contours}
                      <g fill="none" stroke={preset.line} stroke-width="0.8">
                        <path d="M-5 40 Q20 20 35 33 T75 18 T145 5 M-5 33 Q20 13 35 26 T75 11 T145 -2 M-5 26 Q20 6 35 19 T75 4 T145 -9 M-5 47 Q20 27 35 40 T75 25 T145 12 M45 48 Q65 35 85 33 T145 19 M70 49 Q100 33 145 26"/>
                      </g>
                    {:else}
                      <g fill={key === 'blueprint' ? 'none' : preset.buildings} stroke={preset.outline} stroke-width="0.8">
                        <path d="M9 7h22v12H9z M9 25h14v13H9z M29 25h19v13H29z M39 5h14v13H39z M63 7h23v30H63z M97 5h14v15H97z M97 27h32v13H97z M118 5h13v14H118z"/>
                      </g>
                      <path d="M57 0v45 M0 22h140 M91 0v45" fill="none" stroke={preset.roads} stroke-width="0.6"/>
                    {/if}
                  </svg>
                </span>
                <span class="preset-kind">{preset.kind}</span><strong>{preset.name}</strong>
              </button>
            {/each}
          </div>
          <select id="presetSel" hidden aria-label="Design preset">
            {#each Object.entries(DESIGN_PRESETS) as [key,preset]}<option value={key}>{preset.name}</option>{/each}
          </select>
          <p id="presetDescription" class="control-help"></p>
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
          <div class="ui-label">Map layers</div>
          <p style="font-size:12px; color:var(--color-text-sec); margin-top:6px; line-height:1.4;">
            Toggle layers, adjust their appearance, or reorder them. Top layers draw above lower ones.
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
                  <button type="button" role="switch" aria-checked="false" aria-label="Place names" class="ios-switch" id="labelToggle"></button>
                </div>
              </div>
              <div class="layer-body">
                <div class="cust-row"><span style="margin:0" class="ui-label">Label Color</span><div class="color-dot" id="labelColorDot" style="background:#1E232B"><input type="color" id="labelColor" value="#1E232B"></div></div>
                <div class="cust-row"><span style="margin:0" class="ui-label">Text Background</span><button type="button" role="switch" aria-checked="false" aria-label="Label background" class="ios-switch" id="labelBgToggle"></button></div>
                <div class="cust-row"><span style="margin:0" class="ui-label">Background Color</span><div class="color-dot" id="labelBgColorDot" style="background:#F5F2EB"><input type="color" id="labelBgColor" value="#F5F2EB"></div></div>
                <div class="cust-row"><span style="margin:0" class="ui-label">Opacity (%)</span><input type="range" id="labelOpacity" min="0" max="100" step="1" value="85"><span id="labelOpacityVal" style="font-size:11px;width:46px;text-align:right;">85%</span></div>
                <div class="cust-row"><span style="margin:0" class="ui-label">Font Size (mm)</span><input type="range" id="labelSize" min="0.2" max="3" step="0.05" value="0.4"><span id="labelSizeVal" style="font-size:11px;width:56px;text-align:right;">0.40 mm</span></div>
                <div class="cust-row"><span style="margin:0" class="ui-label">Scale by Place Rank</span><button type="button" role="switch" aria-checked="false" aria-label="Scale labels by rank" class="ios-switch" id="labelScaleToggle"></button></div>
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
                <div class="cust-row"><span style="margin:0" class="ui-label">Bold</span><button type="button" role="switch" aria-checked="false" aria-label="Bold labels" class="ios-switch" id="labelBoldToggle"></button></div>
                <div class="cust-row"><span style="margin:0" class="ui-label">Italic</span><button type="button" role="switch" aria-checked="false" aria-label="Italic labels" class="ios-switch" id="labelItalicToggle"></button></div>
              </div>
            </div>
            <div class="layer-item" data-layer="buildings" draggable="true" style="margin-top:10px;">
              <div class="layer-head drag-ready">
                <div class="layer-info">
                  <span class="drag-handle" title="Drag to reorder">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 6h8M8 12h8M8 18h8"/></svg>
                  </span>
                  <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M6 9l6 6 6-6"/></svg>
                  <span>Buildings</span>
                </div>
                <div class="layer-actions">
                  <button class="layer-move" data-move="up" title="Move layer up" aria-label="Move layer up">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6l-6 6h12z"/></svg>
                  </button>
                  <button class="layer-move" data-move="down" title="Move layer down" aria-label="Move layer down">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 18l6-6H6z"/></svg>
                  </button>
                  <button type="button" role="switch" aria-checked="false" aria-label="Buildings" class="ios-switch" id="buildingToggle"></button>
                </div>
              </div>
              <div class="layer-body">
                <p id="buildingCount" class="status-text">Generate a map to load building footprints.</p>
                <div class="cust-row"><label class="ui-label" for="buildingColor">Fill color</label><input type="color" id="buildingColor" value="#ABB8AD"></div>
                <div class="cust-row"><span class="ui-label">Solid footprints</span><button type="button" class="ios-switch on" id="buildingFillToggle" role="switch" aria-checked="true" aria-label="Fill building footprints"></button></div>
                <div class="cust-row"><label class="ui-label" for="buildingOutline">Outline color</label><input type="color" id="buildingOutline" value="#65796C"></div>
                <div class="cust-row"><label class="ui-label" for="buildingWidth">Outline width (mm)</label><input type="range" id="buildingWidth" min="0" max="1" step="0.01" value="0.1"><input type="number" id="buildingWidthInput" class="width-input" min="0" max="1" step="0.01" value="0.1" aria-label="Building outline width in millimetres"></div>
                <div class="cust-row"><label class="ui-label" for="buildingOpacity">Opacity</label><input type="range" id="buildingOpacity" min="0" max="100" step="1" value="100"><span id="buildingOpacityVal" class="control-value">100%</span></div>
                <div class="cust-row"><label class="ui-label" for="buildingMinArea">Minimum footprint (mm²)</label><input type="range" id="buildingMinArea" min="0" max="5" step="0.1" value="0.5"><span id="buildingMinAreaVal" class="control-value">0.5</span></div>
                <p class="control-help">Tiny footprints are omitted and complex outlines simplified at output scale. This keeps large city maps responsive. Set 0 mm² to retain all small buildings.</p>
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
                  <button type="button" role="switch" aria-checked="false" aria-label="Roads" class="ios-switch" id="roadToggle"></button>
                </div>
              </div>
              <div class="layer-body">
                <div class="cust-row"><span style="margin:0" class="ui-label">Color</span><div class="color-dot" id="roadColorDot" style="background:#C9A75A"><input type="color" id="roadColor" value="#C9A75A"></div></div>
                <div class="cust-row"><span style="margin:0" class="ui-label">Line Width (mm)</span><input type="range" id="roadWidth" min="0.05" max="2" step="0.01" value="0.2"><input type="number" id="roadWidthInput" class="width-input" min="0.05" max="2" step="0.01" value="0.2"></div>
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
                  <button type="button" role="switch" aria-checked="false" aria-label="Rivers" class="ios-switch" id="riverToggle"></button>
                </div>
              </div>
              <div class="layer-body">
                <div class="cust-row"><span style="margin:0" class="ui-label">Line Color</span><div class="color-dot" id="riverColorDot" style="background:#7DB5D3"><input type="color" id="riverColor" value="#7DB5D3"></div></div>
                <div class="cust-row"><span style="margin:0" class="ui-label">Line Width (mm)</span><input type="range" id="riverWidth" min="0.05" max="2" step="0.01" value="0.2"><input type="number" id="riverWidthInput" class="width-input" min="0.05" max="2" step="0.01" value="0.2"></div>
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
                  <button type="button" role="switch" aria-checked="false" aria-label="water Area" class="ios-switch" id="waterAreaToggle"></button>
                </div>
              </div>
              <div class="layer-body">
                <p class="control-help">Includes lakes, reservoirs, ponds, bays, and coastal sea where a coastline crosses the selected frame.</p>
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
                  <button type="button" role="switch" aria-checked="false" aria-label="green Area" class="ios-switch" id="greenAreaToggle"></button>
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
                  <button type="button" role="switch" aria-checked="true" aria-label="Contours" class="ios-switch on" id="contourToggle"></button>
                </div>
              </div>
              <div class="layer-body">
                <div class="cust-row"><span style="margin:0" class="ui-label">Color</span><div class="color-dot" style="background:#10141B"><input type="color" id="contourColor" value="#10141B"></div></div>
                <div class="cust-row"><span style="margin:0" class="ui-label">Line Width (mm)</span><input type="range" id="contourWidth" min="0.05" max="2" step="0.01" value="0.2"><input type="number" id="contourWidthInput" class="width-input" min="0.05" max="2" step="0.01" value="0.2"></div>
                <div class="cust-row"><span style="margin:0" class="ui-label">Bold Every Nth</span><input type="range" id="contourEmphasis" min="0" max="20" step="1" value="10"><span id="contourEmphasisVal" style="font-size:11px;width:60px;text-align:right;">10th line</span></div>
                <div class="cust-row"><span style="margin:0" class="ui-label">Density</span><input type="range" id="contourDensity" min="5" max="100" step="5" value="24"><span id="contourDensityVal" style="font-size:11px;width:40px;text-align:right;">24</span></div>
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
              <button type="button" role="switch" aria-checked="false" aria-label="Layered height bands" class="ios-switch" id="pngLayerToggle"></button>
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
                <input type="range" id="pngGradOpacity" min="0" max="100" step="1" value="50">
                <span id="pngGradOpacityVal" style="font-size:11px;width:36px;text-align:right;">50%</span>
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
        </div>
        <div class="mode-3d">
          <div class="section-heading"><span class="ui-label">Choose a model preset</span><span class="section-hint">Then adjust the layers</span></div>
          <div class="model-preset-grid">{#each Object.entries(MODEL_PRESETS) as [key,preset]}<button class="preset-card" data-model-preset={key} aria-pressed={key==='landscape'}><strong>{preset.name}</strong><small>{preset.description}</small></button>{/each}</div>
          <div class="group input-grid">
            <div><label class="ui-label" for="model-width">Print width (mm)</label><input id="model-width" type="number" min="50" max="400" value="200"></div>
            <div><label class="ui-label" for="model-resolution">Mesh quality</label><select id="model-resolution"><option value="40">Draft · 40</option><option value="100">Balanced · 100</option><option value="160">Fine · 160</option><option value="240">Ultra · 240</option></select></div>
          </div>
          <div class="group"><span class="ui-label">Physical layers</span><div class="model-layer-grid">
            {#each [['terrain','Terrain relief'],['buildings','Raised buildings'],['roads','Streets'],['water','Water areas'],['green','Green areas'],['rivers','Rivers']] as [key,label]}<label class="check-row"><input id={'model-'+key} type="checkbox">{label}</label>{/each}
          </div><p class="control-help">Turning terrain off creates a flat base. Streets and area layers are raised, terrain-following geometry—not just preview colors.</p></div>
          <details class="model-advanced"><summary>Advanced model settings</summary>
            {#each [['base','Base thickness (mm)',1,10,.5,2],['relief','Terrain relief (mm)',1,80,1,12],['buildingScale','Building height multiplier',.1,10,.1,1],['roadWidth','Street width (mm)',.2,3,.1,.7],['roadRise','Street rise (mm)',.1,2,.1,.5],['areaRise','Area / river rise (mm)',.1,2,.1,.3]] as [key,label,min,max,step,value]}<div class="cust-row"><label class="ui-label" for={'model-'+key}>{label}</label><input id={'model-'+key} type="range" {min} {max} {step} {value}><output id={'model-'+key+'-value'}>{value}</output></div>{/each}
            <label class="ui-label" for="model-fallbackHeight">Missing building height (metres)</label><input id="model-fallbackHeight" type="number" min="1" max="100" value="9">
            <label class="ui-label" for="model-minBuildingArea">Minimum building footprint (mm²)</label><input id="model-minBuildingArea" type="number" min="0" max="20" step="0.1" value="0.8">
            <p class="control-help">Buildings use OSM height, then levels × 3 m, then this fallback. Roofs are flat, founded into the terrain; rise is at least 0.4 mm. Terrain relief is independently scaled. These are map models, not survey-accurate architectural replicas.</p>
          </details>
          <button id="updateModel" class="btn-main">Update 3D model</button>
        </div>
        <button id="toExport" class="btn-main" style="margin-top:6px;">Continue to Export</button>
      </div>

      <div class="step-content" data-step="3">
        <button id="backToStyle" class="btn-main">Back to Design</button>
        <div class="export-status" id="exportStatus">
          <div class="export-status-head">
            <span class="export-status-title">Export Status</span>
            <span class="export-status-label" id="exportStatusLabel">Idle</span>
          </div>
          <div class="export-timeline">
            <div class="export-step" data-export-step="prepare"><span class="export-dot"></span><span>Prepare</span></div>
            <div class="export-step" data-export-step="render"><span class="export-dot"></span><span>Render</span></div>
            <div class="export-step" data-export-step="save"><span class="export-dot"></span><span>Save</span></div>
          </div>
          <progress id="exportProgress" max="100" value="0" aria-label="Export progress"></progress>
          <div id="exportError" class="error-report" hidden role="alert"><strong id="exportErrorTitle"></strong><span id="exportErrorMessage"></span><span id="exportErrorAction" class="error-action"></span><details><summary>Technical details</summary><code id="exportErrorTechnical"></code></details><button id="retryExport" class="btn-secondary" type="button">Retry export</button></div>
        </div>
        <div class="group mode-3d">
          <span class="ui-label">Export the previewed model</span>
          <p class="control-help">A fused solid in millimetres. All selected layers share the exact preview geometry. 3MF includes surface colors; STL and OBJ are geometry-only. Your slicer and printer determine color/material support.</p>
          <label class="ui-label" for="model-format">File format</label><select id="model-format"><option value="3mf">3MF · geometry + colors</option><option value="stl">STL · universal print mesh</option><option value="obj">OBJ · general 3D mesh</option></select>
          <button id="exportModel" class="btn-main" disabled>Download model</button><p class="control-help">Inspect the result in your slicer before printing. Ultra quality and dense cities can take longer; use a small area first.</p>
        </div>
        <div class="mode-2d">
      <div class="group">
        <div class="ui-label">Laser / Vector (DXF)</div>
        <button id="btnDXF" class="btn-main">Download DXF</button>
        <button id="btnSVG" class="btn-secondary">Download SVG · sharp vector</button>
        <p class="control-help">SVG preserves fill colors and exact line widths in millimetres. DXF exports editable layer outlines, including courtyards.</p>
      </div>

      <div class="group">
        <div class="ui-label">Poster (PNG High-Res)</div>
        <label class="ui-label" for="pngResRange" style="margin-top:10px; font-size:10px;">Resolution (Long Edge)</label>
        <div class="cust-row" style="margin-bottom:8px;">
          <input type="range" id="pngResRange" min="500" max="5000" step="100" value="2000">
          <span id="pngResVal" style="font-size:12px; font-weight:700; width:60px;">2000px</span>
        </div>
        <button id="btnPNG" class="btn-main" style="color:#F5F7FB;">Save PNG</button>
      </div>
      </div>
      </div>
    </div>
  </div>
</div>
