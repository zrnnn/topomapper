# Topomapper 0.3.3

A missing map layer now produces an inline coverage warning. You can download a 3D model with the terrain and features that loaded, or use **Retry map layers** to request the missing details. The same warning appears for affected visible layers in 2D exports.

While overlays are loading, choose **Use loaded layers & open Export** to stop waiting and use the latest completed layers. A retry keeps their geometry, including successful empty layers. Direct 3D downloads skip the extra display buffers for drawing the printable mesh. The printable geometry still goes through the solid and material-volume checks.

## Verification

- All 123 automated checks passed. They include grouped and empty layers, retrying with a provider that continues to fail, and mesh validation.
- Desktop Chromium downloaded a 3MF after a simulated water timeout. Inspection found terrain, green areas, rivers, roads and buildings. A retry fetched only water, cleared the warning and restored the water part in the next download.
- A mobile-sized Chromium window stopped a stalled roads request and downloaded a terrain-only 3MF. When the retry hit a simulated provider rate limit, the source summary reported the limit and a terrain STL still downloaded. These checks also exercised a 3D viewer without a graphics context.
- An invalid print width produced an error and zero downloads. Cancelling printable model preparation also produced zero downloads.
- Browser checks exercised SVG, DXF, PNG, 3MF, STL and OBJ with fixed map responses.

[Previous release review](https://github.com/zrnnn/topomapper/blob/v0.3.2/docs/RELEASE-REVIEW.md)
