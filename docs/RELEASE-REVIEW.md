# Topomapper 0.3.5

For whole cities, use Automatic with Buildings enabled. Topomapper builds road and building geometry locally and gives tagged landmarks, known heights and tall tile features priority within the printable footprint budget. Dense building layers can drop lower-priority outlines when the combined map reaches its point limit.

For individual landmarks, choose Detailed OpenStreetMap and a 3D selection up to 1 km². Printable ground-level sections with mapped heights can give a building multiple roof levels. Uncovered wings keep their original footprint. Unmapped roofs, façades and elevated structures remain simplified.

Automatic mode can enrich matching footprints in NYC frames up to 0.5 km² with the city’s published roof heights. One request can read up to 400 city records and has a five-second deadline. Ambiguous matches keep their existing height. A failed city request leaves the building layer available for export. [City building footprints](https://data.cityofnewyork.us/d/5zhs-2jue)

## Provider coverage

The Europe and North America endpoints of the Dresel service answered live browser-origin queries in Nuremberg and Manhattan. Eligible interior frames can use the regional endpoint alongside the existing worldwide fallbacks. The two extracts share one operator. Seven additional global service presets accept a personal API key. Endpoint construction, key clearing and fallback are covered by tests. Authenticated accounts at those seven providers were unavailable for live tests. [Regional service](https://ovp.dresel.systems/) · [OSM provider directory](https://wiki.openstreetmap.org/wiki/Overpass_API#Public_Overpass_API_instances)

## Live model checks

| Selection | Map data received | 3MF result |
| --- | --- | --- |
| Cologne Cathedral neighbourhood | 117 building records, including 64 mapped sections, and 30 road lines | Base, Roads and Buildings, 12,128 triangles |
| Midtown Manhattan | 34 footprint records, three matched city roof heights, and five road lines | Base, Roads and Buildings, with NYC attribution |
| Tokyo Station neighbourhood | 11 footprint records and 16 road lines from worldwide tiles | Base, Roads and Buildings, 7,318 triangles |
| Nuremberg city frame | 25 tiles, 1.35 MB decoded, 605 printable buildings | Base and Buildings, 52,324 triangles |

The Nuremberg flat-base test took 0.72 seconds to load footprints on the first run and 0.12 seconds from cache. Preparing its 3MF took 5.37 seconds on the test machine. These timings exclude terrain download and depend on the network, selection and device.

## Regression checks

133 automated checks passed. The production build and Chromium checks cover SVG, DXF, PNG, STL, OBJ and multipart 3MF downloads, partial data, retry, cancellation, mobile layout and clearing a personal key when switching providers. The live city 3MF archives were reopened programmatically. They have not been physically printed as part of this release.

[Previous release review](https://github.com/zrnnn/topomapper/blob/v0.3.4/docs/RELEASE-REVIEW.md)
