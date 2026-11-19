# Topomapper 0.4.1

## Fixes

- Canceling a new area during elevation loading keeps the previous map and its export settings. Retrying a failed area uses its original frame.
- Editing a location search clears suggestions and cancels the old request. The 3D Fit control considers the full model height and the zoom display follows the mouse wheel.
- Detail tiles are cropped and projected directly into print coordinates. Each new layer uses the remaining point budget and leaves completed layer geometry intact. The loader retries malformed polygons individually and reports omissions.
- Large jumps between close elevation samples trigger a provider fallback. A tile in the Kyoto test contained an erroneous patch below −4,800 m and previously produced a 525 mm relief on a 300 mm map. The corrected export used Mapterhorn, with 27.8 mm of relief, 22 building footprints and 635 road lines. The source notice reports the coarser 142 × 142 elevation grid.

## Verification

- 142 automated checks passed, with regression cases for a cropped tile, malformed polygon, dense buildings and damaged elevation.
- Desktop and phone Chromium tests covered the six download formats, layer removal, partial coverage, cancellation and retries. A canceled replacement map preserved the original 200 × 140 mm SVG and its water layer.
- The CAD reader accepted the multilayer DXF without repairs. Independent mesh checks covered the material parts and fused STL. Bambu Studio generated toolpaths for the 300 mm Lucerne map with terrain, water, green areas, rivers and roads.
- Live test areas covered the Matterhorn, Lake Lucerne, eastern Kyoto, San Francisco Bay and 238 building tiles across Greater Berlin. Coordinates were fixed for reproducibility. The terrain and feature downloads used the live providers.

[Previous release review](https://github.com/zrnnn/topomapper/blob/v0.4.0/docs/RELEASE-REVIEW.md)
