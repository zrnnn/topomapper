# Topomapper 0.4.2

## Building heights

Building roofs use the lowest point where the footprint meets the smoothed terrain. The roof keeps the mapped or estimated rise at the selected print scale. A nearby hillside no longer raises the roof, and the multiplier works below the old minimum rise of 0.4 mm. The City block preset starts at 1× building height.

The quick preview and printable mesh follow the same rule. A regression test checks the roof height on a slope in the preview and the serialized 3MF. Another checks that a small height still responds to the multiplier and the missing-height setting. [OpenStreetMap building-height definition](https://wiki.openstreetmap.org/wiki/Key:height#Height_of_buildings)

## 3MF colors

Each named layer includes a default material and explicit face colors. Filament slots follow the map palette. Terrain, green areas, water, roads and buildings use five colors, with rivers sharing the water slot. The package now uses an absolute model-part path so strict 3MF readers can open it.

An independent lib3mf 2.5.0 reader opened a downloaded 3MF in strict mode without warnings and verified the color of every triangle. Bambu Studio 2.9.1 imported the unmodified map, retained the named part assignments and produced toolpaths for all five slots with matching test filaments configured.

## Verification

- 144 automated tests and the production build passed.
- Desktop and mobile Chromium verified all six export formats. The independent DXF audit passed.
- A 200 × 140 mm map of the Neuschwanstein area used live terrain and map layers. The 3MF contained six colored parts and 17 building records. Bambu Studio successfully sliced this model.

[Previous release review](https://github.com/zrnnn/topomapper/blob/v0.4.1/docs/RELEASE-REVIEW.md)
