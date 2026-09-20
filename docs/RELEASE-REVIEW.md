# Topomapper 0.2.0 release verification — 20 September 2026

This review records the implementation and verification completed for the stable 0.2.0 release.

## Performance changes

- Whole-city overviews use prepared OpenFreeMap vector tiles for areas, waterways, roads and place labels. Zoom follows output dimensions and extent; at most 16 tiles load, with three concurrent downloads. Buildings remain an optional detailed Overpass stage.
- Terrain appears before optional overlays. Validated stages publish in order: water/green areas, rivers, roads, buildings. Map parsing, polygon clipping and simplification run in a worker.
- API errors are classified. Size failures can subdivide into at most 16 sections; quota failures, outages and timeouts cannot trigger subdivision storms. Browser request deadlines leave room beyond the server processing timeout.
- Decoded download streams are bounded before JSON/PBF parsing: 8 MB per Overpass response, 4 MB per vector tile and 24 MB across map layers. Only geometry passing the combined 60,000/120,000-point budget reaches the interface. A rejected later layer cannot restore unbounded raw geometry.
- Geographic responses and terrain tiles use a 24-hour cache, independent of colors and output dimensions where the source query is unchanged. Browser persistence is bounded to 64 MB/128 entries; worker memory caching is bounded to 32 MB/64 entries. Cache failure is nonfatal.
- A shared five-minute area-generation deadline reserves time for the preview. Printable-model preparation is a separate explicit operation with its own three-minute limit. Public service availability is not guaranteed.
- The 2D preview is a canvas at twice its viewport dimensions. Pan and zoom reuse the canvas; PNG/SVG/DXF exports retain their independent export path.
- Quick 3D previews skip Boolean fusion and refresh after settings change. Preparing a printable model performs fusion and validation; downloads cannot use quick-preview geometry. A prepared solid can be reused for unchanged settings.
- Workers are reused when idle, while cancellation terminates active work. The modeling engine initializes once per reused worker. GPU arrays and terrain buffers are transferred rather than copied between threads.
- Layer availability, API errors and heavy-data warnings remain inside the interface. Loading details expose source, bytes, stage timings and retained points.

## Streamlined setup and provider follow-up

- Replaced the modal purpose chooser with an inline sidebar setup: 2D/3D choice, per-layer on/off switches, one Load selected layers action, and area-sensitive warnings. City source detail is automatic. An empty selection cannot start a request.
- Unrequested layers skip their Overpass statements and pipeline stages. Shared vector tiles still contain multiple layers, but unused layers are not decoded or published. Terrain-off selections use a flat base without requesting elevations. Both 2D and 3D presets respect requested-layer availability.
- Consolidated central step navigation, zoom/Fit, Layers, preview Tools and live progress into one responsive toolbar. Removed duplicate sidebar step navigation and floating preview controls.
- Increased the total load budget from 2 to 5 minutes; terrain and individual map stages can use up to 100 seconds within that budget. Overpass processing/request limits are 30/45 seconds. Byte and geometry limits are unchanged.
- Non-Russian public Overpass providers are ranked using rolling successful-request timings within the active worker; custom endpoints stay first and maps.mail.ru stays last. Ranking creates no extra probe traffic and is not a universal fastest-server guarantee.
- Added Mapterhorn as the second terrain provider, before Open-Elevation, using its documented 512-pixel Terrarium WebP tiles and globally available zoom levels. Source credits are linked in the interface and README.
- Reviewed public worldwide providers, regional coverage, key-based alternatives, and export licensing. Kumi is a Private.coffee alias, not an independent mirror. Maptoolkit free service was excluded because it disallows print materials/data extraction. References are in the README.
- A small live check returned HTTP 429 from Private.coffee and HTTP 406 from FOSSGIS, so that check cannot establish a speed winner. Mapterhorn returned a valid WebP response (121,656 bytes) with wildcard CORS. Public API limits remain possible and are reported inline.
- All 17 automated test files pass, including added selection/query filtering, terrain-only zero-overlay requests, 512-pixel decoding, fallback order, quota-message retention and provider-priority tests. Production build passes with existing dependency warnings.
- Browser verification covered empty-selection prevention, terrain-only generation with overlay controls unavailable, water-only generation with no elevation, zoom/Fit, 2D/3D switching, and Export navigation. The flat water model prepared a validated 7,356-triangle solid. Desktop and 390 × 844 layouts were checked; mobile showed no horizontal overflow and retained usable preview space. No warnings or errors were recorded in the isolated verification tab. Startup now keeps Continue disabled until its handlers are ready; the inline layer panel hides redundant sidebar status controls while retaining the central status bar.

## Verification

### Earth studio visual refresh

- Added a muted charcoal/peat/sage UI palette, Manrope interface typography and IBM Plex Mono detail text, plus an original SVG contour mark and matching favicon.
- Presentation changes are isolated in `src/theme.css`, header markup, branding assets and the 3D viewer background color. Map presets, export colors, data processing, controls and workflow logic are unchanged.
- Reviewed area selection and preview layouts at desktop size and 390 × 844 mobile size, including live loading and 2D/3D switching. Primary, secondary and muted text samples measured at least 5:1 contrast on their tested panel backgrounds. Reduced-motion preferences remain respected.

### Workspace progress and navigation

- Added a central status bar to both workspaces, with real streamed download bytes, provider/cache/mirror details, processing stages and elapsed time. Unknown transfer totals are explicitly labeled; stage percentages are not time estimates.
- Added centered Select area / 2D preview / 3D preview / Export navigation with current-step highlighting and native disabled states/reasons. Active exports lock navigation; returning to selection preserves the loaded preview.
- Progress byte accounting, mirror feedback, activity priority/context and workflow availability are covered by the current 17-file suite. The static production build passes with the documented dependency warnings.
- Production-browser checks covered terrain loading, 3D-to-2D switching, returning to area selection, opening export, and a PNG download. The activity bar showed saving progress and controls re-enabled after completion. No new console errors were recorded for this production-build check.

- Automated regression coverage includes bounded streamed responses, failure classification, worker reuse/cancellation, city tile count limits, vector-water island holes and tile-edge clipping, successful-stage caching across dimension changes, retention of bounded earlier stages after an oversized later layer, and prevention of quick-preview export.
- Existing geometry, coastline, building, relief scaling and 3MF/STL/OBJ export tests remain applicable.
- A live Munich overview with bounds 48.08–48.22° N / 11.48–11.69° E loaded four level-11 vector tiles, approximately 0.4 MB, and about 24,000 retained points. The map-layer pipeline took approximately 0.32 seconds in the test environment; the memory-cached repeat took 0.05 seconds with zero new download bytes. These are observations, not latency guarantees, and exclude terrain and browser rendering.
- Production-browser checks exercised a 41.75 km² Munich selection: quick 3D preview, explicit preparation of a validated 12,880-triangle solid, switching to a 2D canvas, 2× backing dimensions, click-drag navigation and Fit reset. Final details can vary with source updates.
- The final browser build also displayed a quick 3D preview for a 100.51 km² Munich selection. Its sidebar reported 0.4 seconds for map layers, 0.64 MB downloaded and 32,725 retained points; no browser console warnings or errors were recorded in that check. This timing excludes terrain and model rendering.
- Coverage also checks that a stale asynchronous canvas render cannot overwrite a newer selection. Existing large-chunk and Manifold browser-externalization build warnings remain.

## Retained safety and geometry behavior

Buildings default off above 25 km² for 3D and 80 km² for 2D; minor streets default off above 40 km². Normal layer switches can enable heavier detail; inline warnings explain the additional risk. Road classes retain proportional widths. Terrain relief defaults to physically scaled 100%, adjustable from 10% to 500%. Three-dimensional footprint components smaller than 0.2 mm in either X or Y are omitted.

Vector data is generalized. Tile boundaries are clipped and polygon holes retained; detailed Overpass coastline recovery remains a fallback. Printable models are checked as fused solids. Quick preview surface placement may differ slightly on steep terrain because it uses a lighter terrain mesh; the prepared preview shows the final geometry.

## Security and deployment

The earlier bounded credential scan found no common secret formats. This performance pass adds public map/tile requests and bounded browser caches, not credentials or an application server. The dependency audit still reports three low-severity findings in the SvelteKit/static-adapter/cookie chain; no forced downgrade was applied.

The static build remains compatible with GitHub Pages at `/topomapper/`. The release is published by pushing the verified tree to `main`; the Pages workflow then runs its own test/build/deploy sequence. Independent slicer/CAD checks, physical prints, and broader browser/touch testing remain useful follow-ups.
