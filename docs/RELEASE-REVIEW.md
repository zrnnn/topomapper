# Topomapper 0.3.2

Open **Export** from a 3D preview, choose a file format and select **Prepare & download**. The panel shows what the app is doing and starts the download when the printable mesh is ready. If your browser misses the automatic download, **Download again** saves the same finished file without preparing it a second time.

For multicolor printing, choose **3MF**. For a single fused mesh, choose **STL** or **OBJ**. You can still inspect the printable mesh in **3D preview** before opening Export.

## Verification

- All 121 automated checks passed and the static production site built successfully.
- Desktop Chromium downloaded a layered 3MF directly from a quick preview. The archive included terrain, roads, buildings, rivers, water and green areas. Downloading again produced identical bytes.
- Cancelling mesh preparation returned control to the user. A missing water layer produced an inline error. Both scenarios produced zero downloads. Retrying the water request preserved the loaded layers.
- A mobile Chromium viewport downloaded a terrain-only 3MF after preparing the model in Preview. The file contained only the terrain part.
- The same browser run downloaded STL, OBJ, DXF, PNG and three SVG presets. Editing contour density with automatic preview off changed the downloaded DXF.

Browser checks use fixed geographic data and simulated provider failures so results are repeatable. They exercise the production website and its real file downloads.

[Previous release review](https://github.com/zrnnn/topomapper/blob/v0.3.1/docs/RELEASE-REVIEW.md)
