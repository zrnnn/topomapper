# Topomapper (dev)

Interactive 2D map and 3D print-model generator built with SvelteKit and MapLibre GL JS. It remains a static GitHub Pages app; no React migration or application server is required.

## Workflow

1. Search for a place and frame an area. Continue to choose **2D map** or **3D print**. Large selections display a warning before loading.
2. For 2D, choose Alpine Atlas, Urban Figureground, Midnight Blueprint, Contour Study, Shaded Landscape, or Laser Linework. Advanced layer order, colors, line widths, shading and label controls remain available. Export PNG (raster), SVG (vector with optional embedded shading), or DXF (editable outlines in millimetres).
3. For 3D, choose Landscape, City Block (flat base), or Terrain Study. Set print width, mesh quality, terrain/building/street/water/river/green layers, and advanced relief/base/embossing settings. Update the model, orbit the preview, then export the exact same fused geometry as 3MF, STL or OBJ.

### Printable model behavior

- Manifold WebAssembly fuses all selected solids in a worker. Streets, rivers, water and green areas are actual terrain-following raised geometry. Internal overlapping surfaces are removed. 3MF stores face colors; STL and OBJ are geometry-only.
- Building footprints and area multipolygons retain courtyard/island holes. Buildings use OSM height, levels × 3 m, then the adjustable fallback height. Roofs are flat; buildings extend into the terrain and have a minimum 0.4 mm visible rise. Relief height and building height exaggeration are independently controlled. These are cartographic models, not detailed architectural or survey replicas.
- Changing settings invalidates export until the new preview succeeds. Failed jobs never export a partial model. Unavailable OSM data blocks selected overlay layers; disable them for terrain-only output or reload the area. Empty mapped layers are reported.
- Mesh quality is bounded to 40–240 samples per side, print width to 50–400 mm, buildings to 3,000 and street/river input to 40,000 points. Workers have a 90-second limit and can be cancelled. Progress reports the modeling phase; network operations remain indeterminate where total work is unknown.
- 3D geometry, rendering and compression are lazy-loaded. Models are north-up, Z-up and sized in millimetres. Verify scale, minimum feature sizes, materials and support requirements in your slicer before printing. Surface colors are not a guarantee of multi-material slicing support.

## Requirements

- Node.js 22.12+ (CI uses Node 24)

## Development

```sh
npm ci
npm run dev -- --host 127.0.0.1 --port 5173
```

## Build (static)

```sh
npm run build
```

The static output is written to `build/` (GitHub Pages friendly). The app uses a base path of `/topomapper` in production builds.

## Verification

```sh
npm test
npm run build
```

Pull requests and development branches run both checks. Deployment from `main` also runs the tests first.

## Release candidate 0.1.0-rc.1

- Terrain comes from public Mapzen Terrarium tiles hosted on AWS, decoded in a Web Worker. Up to four tiles are fetched concurrently, with a 64-tile limit, request timeouts, and bounded in-memory caches.
- If tiles fail, Open-Elevation is tried using sequential 512-location batches at lower resolution. Both providers are validated before rendering. Cancellation stops background terrain processing; failures preserve the previous preview.
- Terrain samples and map overlays share Web Mercator coordinates. Selections crossing the date line or outside 85°S–85°N are rejected explicitly.
- Mobile selection frames and preview sizing are fixed. Generate stays visible, dimension fields commit on blur, layer switches support keyboards, the preview traps focus and closes with Escape, and manual preview refresh is available.
- Contours preserve boundary endpoints, are clipped to the selected shape, simplified to limit point growth, and cached independently of colors and line widths.
- 3MF creation and compression run in a worker. Meshes use outward-facing triangles and a 2 mm base; tests check closed edges and winding for rectangle, circle and hexagon terrain.
- SVG label text/font attributes are escaped; label size and line widths use millimetres. DXF declares millimetres and permits map-only exports. PNG failures no longer silently omit overlays.

### Services and attribution

Location search runs only on Search or Enter, with caching and a per-client rate limit; it is not autocomplete. It uses the public Nominatim service. Map overlays use public Overpass endpoints. These public services have no availability guarantee; larger deployments should use an appropriately provisioned search/Overpass service.

Elevation uses [Mapzen terrain tiles](https://registry.opendata.aws/terrain-tiles/), with [source credits and licence terms](https://github.com/tilezen/joerd/blob/master/docs/attribution.md). Map features are © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright); basemap cartography is © [OpenTopoMap](https://opentopomap.org/about). Preserve applicable source credits when publishing exported work. Heights are resampled and smoothed for artwork and fabrication, not survey or navigation use.

### Remaining release gates

This is a development release candidate, not a production deployment. Before tagging a stable release:

- Check exports in an independent CAD application and 3MF slicer, plus real Safari/Firefox and touch devices.
- Add project save/restore and automated end-to-end browser coverage. Expand fixtures for unusual/incomplete OSM relations and dense urban areas.
- Further split the large imperative UI module and move raster shading off the main thread. MapLibre still dominates the initial map bundle.
- The dependency audit currently retains three low-severity findings in the SvelteKit → cookie build/server chain. No high/critical findings remain after compatible updates; this deployment is static and does not run a cookie-handling server. Do not apply the audit's suggested downgrade to an obsolete SvelteKit release.

## Preview production build

```sh
npm run preview -- --host 127.0.0.1 --port 4173
```

## GitHub Pages

- Base path is `/topomapper` when `NODE_ENV=production`; adjust `paths.base` in `svelte.config.js` if the repo name changes.
- Deploy via the workflow `.github/workflows/pages.yml` (builds and publishes `build/` to GitHub Pages).
- A `.nojekyll` file in `static/` prevents GitHub Pages from ignoring underscore-prefixed files.

## Manual GitHub Pages publish (fallback)

1. Run `npm run build`
2. Publish the `build/` folder

If the repo name changes, update `paths.base` in `svelte.config.js`.

## Notes

- Main UI lives in `src/routes/+page.svelte`.
- Core app logic is in `src/lib/topomapper.js`.
- Global styles are in `src/app.css`.
- Static assets (logo/icon) are in `static/assets`.
- Contour styling includes a "Bold Every Nth" slider (0–20, default 0). Presets use fine 0.10–0.12 mm lines without bold bands; advanced emphasis remains available.
- Location results use an opaque, scrollable panel above the sidebar controls. Search runs on Search/Enter, not on every keystroke.
