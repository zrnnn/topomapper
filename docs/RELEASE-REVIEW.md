# Topomapper 0.4.0

Set the frame size once for a print up to **300 × 300 mm**. It carries through to the 3D model, SVG, and the physical dimensions embedded in the PNG. Choose SVG for editable artwork, DXF for cutting paths and named CAD layers, or 3MF for a multipart print.

Print detail targets **0.5 mm terrain spacing** on rectangular models. The layer loader keeps a finer **0.2 mm working threshold** for vector geometry and scales point budgets to the output size. Terrain uses the available source pixels on each axis. A source or mesh limit can still produce coarser detail. In city frames, batches of building tiles continue automatically under the same time and download budget. Each completed batch can be exported.

## Real places tested

| Selection | Download checked |
| --- | --- |
| Matterhorn, 300 × 300 mm | Mapzen returned 564 × 564 elevation samples. The smoothed print-detail mesh at 100% relief had a 236.30 mm elevation range, 108,926 triangles and a closed surface. Bambu Studio generated toolpaths at full size. |
| Greater Berlin, 300 × 250 mm | A roughly 1,718 km² frame loaded all 238 building tiles automatically. It downloaded 8.55 MB, retained 2,500 footprints and exported 2,495 printable building records. One test machine took 4.1 seconds for the data and 10.5 seconds to prepare the printable geometry. Bambu Studio sliced the full-size city model. |
| Lake Lucerne and the Reuss, 300 × 300 mm | The 3MF held separate base, water, rivers, green areas and road parts. The loader retained 658 road lines, three river lines, 11 water records and 40 green records. The DXF contained primary, secondary, tertiary, residential and service roads on separate layers. |
| San Francisco Bay, 300 × 300 mm | The selected water and road layers produced 19 water records and 258 road lines. The SVG and 3MF both retained the coastal water. |

Geocoding was fixed to the test coordinates. Terrain, footprints, waterways and streets came from live providers. Counts refer to retained records at print scale. Tile pieces can represent sections of the same real feature. Coverage and timings will vary.

## Independent file checks

- The desktop and mobile Chromium workflow passed all six file formats, presets, a disabled water layer, partial coverage, cancellation and retry. Removing water changed both the SVG groups and the exported PNG pixels.
- PNG print density reproduced the intended 300 mm dimensions. The Matterhorn, Lucerne and San Francisco PNGs agreed with independently rasterized SVGs at more than 99.7% of pixels within 15 levels per color channel.
- FreeCAD 1.1.4 opened the multilayer, lakeside and coastal DXFs. The independent ezdxf 1.4.5 audit accepted the multilayer fixture without repairs. A shaded-only Matterhorn DXF contained its cutting frame. The interface explains how to add vector geometry or download the shading.
- All tested 3MF parts had positive enclosed volume and two incident triangles per edge. FreeCAD opened the fused STL as a solid and Assimp read the OBJ. Bambu Studio 2.9.1 sliced the full-size Lucerne model on an H2S profile. After assigning water and rivers to a second filament, its G-code reported extrusion for both spools.
- 137 automated checks passed, along with the static production build. Timeout, quota and access errors give recovery actions. Browser image decoding and PNG encoding have explicit deadlines. Physical prints were outside this review.

[Previous release review](https://github.com/zrnnn/topomapper/blob/v0.3.5/docs/RELEASE-REVIEW.md)
