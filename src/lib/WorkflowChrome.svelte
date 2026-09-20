<script>
  export let preview=false;
</script>
<div class="workspace-toolbar" aria-label="Map workspace controls">
<div class="workspace-toolbar-row">
<nav class="workspace-nav" aria-label="Map workflow">
  <button type="button" data-workspace-step="area" aria-current="step"><span>1</span> Select area</button>
  <div class="workspace-preview-group"><button type="button" data-workspace-step="2d" disabled><span>2</span> 2D preview</button><button type="button" data-workspace-step="3d" disabled>3D preview</button></div>
  <button type="button" data-workspace-step="export" disabled><span>3</span> Export</button>
</nav>
<div class="workspace-tools" aria-label="Map navigation">
{#if preview}
<button id="changeOutput" type="button" class="btn-secondary">Layers</button>
<div class="workspace-zoom" aria-label="Preview zoom"><button id="previewZoomOut" type="button" aria-label="Zoom preview out">−</button><span id="previewZoomValue" aria-live="polite">100%</span><button id="previewZoomIn" type="button" aria-label="Zoom preview in">+</button><button id="previewZoomFit" type="button" title="Reset zoom and position">Fit</button></div>
<details class="workspace-more mode-2d"><summary title="Preview tools">Tools</summary><div class="workspace-tools-panel"><button id="undoStep2" class="btn-secondary" type="button">Undo</button><button id="refreshPreview" class="btn-secondary" type="button">Auto Preview On</button><button id="renderPreview" class="btn-secondary" type="button" hidden>Update preview</button><button id="redoStep2" class="btn-secondary" type="button">Redo</button><button id="resetStep2" class="btn-secondary" type="button">Reset design</button></div></details>
{:else}
<div class="workspace-zoom" aria-label="Area zoom"><button data-map-zoom="out" type="button" aria-label="Zoom map out">−</button><span>Map</span><button data-map-zoom="in" type="button" aria-label="Zoom map in">+</button></div>
{/if}
</div>
</div>
<section class="workspace-activity" data-activity-state="idle" aria-label="Current activity">
  <div class="workspace-activity-heading"><strong data-activity-title role="status">Ready to select an area</strong><span data-activity-value></span></div>
  <progress data-activity-progress max="100" value="0" aria-label="Current operation progress"></progress>
  <p data-activity-detail>Choose a location and frame your map, then continue.</p>
</section>
</div>
