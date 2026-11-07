# Topomapper 0.3.1

Multicolor 3MF parts now follow the local terrain surface with up to 1 mm of inlay. A thin base keeps at least 0.2 mm of ground material underneath. Roads, buildings and other raised features keep their height above ground.

Automatic map loading can use VersaTiles when OpenFreeMap fails. Selections that exceed the full-detail tile limit can use lower-resolution overlays. Long, narrow frames reduce elevation tile resolution to stay within 64 tiles per provider. The loader preserves usable layers after partial failures and can recover from malformed responses and damaged cache entries.

## Verification

- All 121 automated tests passed, including inlay depth on slopes, a 150,000-vertex footprint, interrupted road geometry and download limits.
- Chromium exercised timeout and gateway failures, retried the missing water layer and downloaded SVG, DXF, PNG, STL, OBJ and 3MF. A mobile viewport also exported a terrain-only 3MF.
- Inkscape 1.4.2 rendered the contour, building and shaded SVG samples. ezdxf 1.4.5 audited both DXF samples with zero errors and zero repairs.
- Bambu Studio sliced the multicolor sample using two assigned filaments. The verification covered the digital toolpaths.

[Previous release review](https://github.com/zrnnn/topomapper/blob/v0.3.0/docs/RELEASE-REVIEW.md)
