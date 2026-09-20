# Topomapper

Create printable maps and 3D landscape models from places around the world, directly in your browser.

[Open Topomapper](https://zrnnn.github.io/topomapper/)

See the [release verification notes](docs/RELEASE-REVIEW.md) for tested behavior and remaining limitations.

## What can I make?

- Paper maps and posters with terrain shading, contour lines, buildings, roads and water.
- SVG and DXF artwork for vector editing, CAD and laser preparation.
- 3D terrain and city models with raised buildings and selected map layers, downloadable as 3MF, STL or OBJ.

No account or API key is required. Internet access is needed to search for places and download elevation and map data. Rendering and file generation run in your browser.

## Step 1: Choose an area

Type a place in **Location Search**, then press **Enter** or **Search**. Select a result and move or zoom the map until the frame covers your desired area.

Open **Frame & Dimensions** to adjust the output width, height and shape. Dimensions describe the final output in millimetres. Map zoom controls how much real-world geography fits into that output.

Choose **Continue · choose output**, then **2D map** or **3D print**. Large selections display a warning. Start with a small neighbourhood when you want detailed buildings.

![Illustrated area selection workflow](docs/images/01-area.svg)

*The three illustrations in this guide explain the workflow; they are not screenshots or real geographic data.*

## Step 2: Design a 2D map

Choose a preset in the **Design** tab:

| Preset | Suggested use |
| --- | --- |
| Alpine Atlas | Balanced topographic maps |
| Urban Figureground | Buildings and urban layout |
| Midnight Blueprint | Dark building-map artwork |
| Contour Study | Minimal elevation linework |
| Shaded Landscape | Shaded raster posters |
| Laser Linework | Vector outlines for CAD or laser preparation |

Under **Map Layers**, toggle contours, buildings, roads, rivers, water areas, green areas and place names. Expand a layer to change its appearance. Move layers with arrows or drag handles; layers at the top draw above those below. Presets place contour lines above area fills. Transparent fills reveal lower layers; terrain shading stays at the bottom. The same order is used for the 2D preview, PNG and SVG. DXF contains editable linework; its appearance depends on your CAD application. In 3D, physical height and camera position determine visibility.

Line widths use millimetres. **Bold Every Nth** emphasizes selected contours; 0 disables emphasis. Adjust density and smoothing to balance detail and readability.

Zoom the preview with the mouse wheel or **− / + / Fit**. Preview zoom does not change export dimensions. Turn **Auto Preview** off while making several expensive changes, then choose **Update preview**. Undo and redo apply to design changes.

![Illustrated 2D design workflow](docs/images/02-design.svg)

### Large building datasets

**Minimum footprint (mm²)** removes buildings that would be too small in the final output. A 1 × 1 mm footprint has an area of 1 mm². Complex outlines are simplified, and dense selections retain up to 2,500 of the largest buildings. The interface reports omissions.

A threshold of 0 disables the small-footprint filter, but the count limit and outline simplification still apply. Neighbouring buildings are not merged into city blocks.

### Export a 2D map

Choose **Continue to Export** or the **Export** tab.

| Format | Purpose | Output |
| --- | --- | --- |
| PNG | Paper, posters and image editing | Raster image; higher resolution uses more memory |
| SVG | Vector editing and scalable artwork | Vector paths, with optional embedded raster shading |
| DXF | CAD and laser preparation | Editable linework in millimetres, not a shaded image |

Check laser paths in your machine software. When printing paper maps, use the intended scale rather than automatic page fitting.

## Step 3: Create a 3D print

Choose **Landscape model** for terrain with map layers, **City block** for a flat base, or **Terrain study** for terrain alone.

Set print width and mesh quality, then select terrain, buildings, streets, water areas, rivers and green areas. Advanced controls include base thickness, relief height, building-height scale, fallback height, minimum building footprint, and raised-layer dimensions.

Choose **Update model**. Drag to orbit, scroll or use **− / +** to zoom, and choose **Reset view** to restore the camera. Rebuild after changing settings before exporting.

![Illustrated 3D printing workflow](docs/images/03-print.svg)

| Format | Contents |
| --- | --- |
| 3MF | Geometry, millimetre units and face colors |
| STL | Geometry only; choose millimetres when importing |
| OBJ | Geometry only; confirm scale in the receiving application |

Selected layers are fused into a solid. Water and green areas are raised surfaces, not automatically carved channels. Buildings use mapped height, then floor count × 3 metres, then your fallback height. Roofs are flat. Terrain relief and building exaggeration have separate controls.

Inspect scale, minimum features, supports and colors in your slicer. Face colors do not guarantee automatic multi-material slicing. These are simplified cartographic models, not survey data or detailed architectural replicas.

## Loading and troubleshooting

Loading panels show elevation, map layers and preview stages. Model generation and export show their current operation. Percentages describe workflow progress, not time remaining.

- **Request failed or timed out:** retry, check your connection or select a smaller area.
- **Elevation unavailable:** the app tries a lower-resolution fallback source.
- **Map layers missing:** terrain-only work may remain available. Use **Retry map layers** inside the preview to reload the same area. The app tries an alternate service and smaller sections automatically, with a total map-loading limit of 90 seconds. For 3D, disable unavailable overlays to generate terrain only.
- **Selection too detailed:** increase the minimum building footprint, lower mesh quality, disable dense layers or choose a smaller area.
- **Model/export failure:** follow the displayed action and inspect technical details. The previous successful result is preserved.

Generation can be cancelled. Export before closing or reloading: project save/restore is not implemented.

## Coverage and limitations

Water Areas includes lakes, reservoirs, ponds, basins, lagoons and bays. Rivers is a separate layer. Multipolygons can retain courtyard and island holes.

Coastal sea/ocean areas are derived from directed shorelines, including same-edge crossings, multiple bays and island holes. Fully offshore frames without shoreline cannot be inferred from the current data source. Incomplete or inconsistent source geometry may require a smaller selection.

Other limits include 40–240 mesh samples per side, 50–400 mm 3D print width, 2,500 retained buildings, geometry-size limits and a 90-second worker timeout. Large requests can still exceed browser capacity. Building heights and map coverage vary by location.

## Data, privacy and credits

Search terms are sent to public Nominatim. Map bounds are sent to Overpass. Elevation tile requests go to the Mapzen source; the fallback sends sample coordinates to Open-Elevation. These services receive normal request information, including your IP address.

The app also loads basemap tiles from OpenTopoMap and fonts from Google Fonts. These providers receive normal browser requests. The app has no account system or application backend. Public services have no availability guarantee.

Map features are © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright). Basemap cartography is © [OpenTopoMap](https://opentopomap.org/about). Elevation uses [Mapzen terrain tiles](https://registry.opendata.aws/terrain-tiles/) with [source credits and licence terms](https://github.com/tilezen/joerd/blob/master/docs/attribution.md). Preserve applicable credits when sharing exports.

## Development

Requires Node.js 22.12 or later; CI uses Node 24.

```sh
npm ci
npm run dev -- --host 127.0.0.1
```

To test and preview the production build:

```sh
npm test
npm run build
npm run preview -- --host 127.0.0.1 --port 4173
```

Open http://127.0.0.1:4173/topomapper/ for the production preview.

## GitHub Pages

The static build is written to `build/`; the production base path is `/topomapper`. Set the repository's Pages source to **GitHub Actions**.

A push to `main` runs tests and builds the site, then deploys the Pages artifact. Check the deployment job and the published URL after release. Development branches and pull requests run verification without deploying Pages.

If the repository name changes, update the base path in `svelte.config.js`.

## Code layout

- `src/routes/+page.svelte`: interface
- `src/lib/topomapper.js`: map selection, 2D design and export
- `src/lib/model*.js`: 3D workflow, geometry and export
- `src/lib/terrain*.js`: elevation processing
- `src/app.css`: shared styling
- `tests/`: geometry, worker and stability checks
- `legacy/`: historical implementation, not the current app

See [LICENSE](LICENSE) for the project licence.
