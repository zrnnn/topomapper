# Topomapper 0.3.4

Select a city, choose 3D printing and enable **Buildings**. Automatic detail can use generalized building tiles at the zoom supported by the provider. Individual footprints are ranked at the selected print size. The city preset uses a 0.5 mm² footprint threshold and retains up to 2,500. The 3D printability filter also checks the 0.2 mm minimum feature dimension.

City building frames requiring 65–512 tiles load from the center outward in batches of 32. **Load more building tiles** extends coverage. The current coverage is available for export after each successful batch. Larger selections use the filtered Overpass fallback. The toolbar shows a larger progress bar and a throughput-based estimate for the current tile batch when enough work has completed.

## Live city checks

| Selection | Verified result |
| --- | --- |
| Nuremberg, 279 km² browser frame | Chromium downloaded a 200 × 140 mm 3MF using Mapzen elevation and OpenFreeMap footprints. The model contained named Terrain and Buildings parts, 984 printable footprints and 74,946 triangles. |
| Greater Berlin, roughly 1,718 km² | The single-query providers returned rate-limit or gateway responses. The tile route covered 238 tiles in eight batches and read 8.55 MB of decoded data. The 200 mm flat-base 3MF contained 134 printable footprints. Loading the building batches took 3.7 seconds in the test environment, excluding user interaction and model preparation. |
| Berlin, 979 km² browser frame | The coverage indicator advanced from 32/140 to 64/140 after one click. Chromium downloaded a partial flat-base 3MF with 314 printable footprints. |

The footprint counts describe features retained at print scale. Provider coverage, building heights, source generalization, network speed and chosen print dimensions affect the result.

## Regression checks

- 127 automated tests, including grouped city footprints, courtyards, a self-crossing building outline, partial coverage and tile-batch estimates.
- Production build and Chromium coverage of the six download formats, partial maps, cancellation, retry and mobile layout.

[Previous release review](https://github.com/zrnnn/topomapper/blob/v0.3.3/docs/RELEASE-REVIEW.md)
