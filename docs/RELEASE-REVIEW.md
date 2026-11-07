# Topomapper 0.3.0

DXF drawings now open in CAD with named, colored layers at their selected physical size. SVG keeps editable Inkscape layers and embedded terrain shading. The 3MF export groups printable features into named parts for filament assignment. STL and OBJ retain the fused exterior. Changing contour density takes effect on the next download even when Auto Preview is off.

## Export verification

These results are from the production build under `/topomapper/` on 7 November 2026. The browser used fixed map responses with sloping terrain, a lake with an island, roads crossing water, a river, buildings, green areas and an accented place name containing XML punctuation.

| Format | Application and result |
| --- | --- |
| DXF | ezdxf 1.4.5 rejected the 0.2.0 browser download at its first polyline. The 0.3.0 download passed with zero errors and zero automatic fixes. FreeCAD 1.1.4 read 124 polylines and one text entity as AutoCAD 2007 in millimetres. Checks cover the 200 × 140 mm frame, closed lake and island rings, road class, water color and label text. |
| SVG | Inkscape 1.4.2 opened and rendered contour, building and shaded downloads at 756 × 529 pixels at its default DPI. Chromium parsed the standalone SVG documents. The prior general opening failure did not reproduce with ordinary 0.2.0 labels. The writer now strips invalid XML characters and uses the SVG 1.1 image reference for embedded shading. |
| PNG | The 2000 × 1400 pixel download decoded successfully in Pillow. |
| 3MF | Bambu Studio 2.8.2.61 imported terrain, green areas, water, rivers, roads and buildings as six aligned parts. Assigning terrain and overlays to two PLA filaments in an A1 0.4 mm project produced five filament changes. The slicer reported 81.33 g and 1.02 g used by the two filaments, both used on the object. This was a software slice. The download leaves printer and spool selection to the maker. |
| STL and OBJ | FreeCAD reopened both as one closed solid without non-manifold edges, measuring 200 × 140 × 7.526 mm. The STL writer removed ten triangles that collapsed at binary file precision. The OBJ retained its indexed surface. |

Automated model checks cover closed parts, pairwise intersections, assembled volume, terrain-only and flat-base models, and elevation-source credits. The production browser check downloads all six formats through the interface. GitHub Pages runs that check and the independent DXF audit before deployment.

## Loading and performance

Timings below are single local Chromium runs with deterministic map responses. They describe browser work on this machine. Public API latency, mobile CPU speed and the density of real map features will change these numbers. The heap figures are sampled page JavaScript memory through DXF download and exclude workers, GPU memory and native browser allocations.

| Selection | Cold load | Cached load | SVG download | DXF download | Sampled page heap |
| --- | ---: | ---: | ---: | ---: | ---: |
| Neighborhood, 1.18 km² | 582 ms | 212 ms | 306 ms, 110 KB | 674 ms, 319 KB | 15 MiB |
| City, 301.99 km² | 660 ms | 283 ms | 1357 ms, 198 KB | 304 ms, 360 KB | 24 MiB |

The initial area view fetched the map renderer. The 3D renderer, modeling engine and DXF library load on demand. DXF uses the shared clipped contour cache. Successful Overpass stages cache their validated response bytes without serializing the parsed map back to JSON.

Desktop and 390 × 844 pixel Chromium checks covered generation, preview navigation and downloads. Cancelling an active load returned the UI to the area workflow. When all roads providers returned HTTP 503, terrain and completed layers remained available. Retrying restored the roads. Automated tests also exercise rate limits, timeouts, cancellation and stale preview results.

## Dependency and privacy checks

Compatible dependency updates cleared the three high-severity entries found during the audit. Six low-severity build-tooling entries remain. npm recommends a breaking framework upgrade to clear them. The application deploys as static files.

Custom-provider connection and query errors identify the host and failure category. The persistent cache already used SHA-256 request keys in 0.2.0. Regression tests now cover private URL paths and query tokens in cache keys and provider diagnostics.
