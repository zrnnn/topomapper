# Release verification — 20 September 2026

The final review found a coastline rendering defect. It has been corrected before publication, along with layer-control and map-loading issues.

## Corrections

- Coastal water now follows shoreline direction and the frame perimeter. Same-edge crossings retain the correct complementary area; multiple bays, sea channels and islands are covered by regression tests. Split coastline ways are joined without reversing their geographic direction, and repeated tile results are deduplicated.
- Layer dragging uses the drop position shown to the user. Undo, redo, reset and preset changes refresh arrow availability. Default contours sit above filled areas. The SVG drawing order remains the reverse of the foreground-first layer list; PNG and SVG use the same renderer.
- Map requests allow the server 15 seconds of processing within a 20-second browser deadline. A 90-second overall budget leaves room for the alternate provider and smaller-section retries. Cancelled jobs do not initiate provider retries.
- A preview-level Retry map layers button reloads the exact selected bounds and reuses cached terrain.

## Verification

- Automated coastline tests cover the original disappearing-water case in both directions, reversed frame winding, multiple bays, sea channels, island holes and split-way assembly.
- A corrected sea footprint is fused into a closed 3D mesh with the expected volume and exported as 3MF, STL and OBJ.
- Map-service tests cover HTTP failure, incomplete responses, request timeout, alternate-provider recovery and cancellation.
- The full test suite and static production build are required before publication.
- README illustrations were rendered and visually inspected. They are explanatory diagrams rather than real geographic screenshots.

## Security and remaining limitations

A pattern scan of 111 local Git blobs, including history, found no private-key headers, common credential formats or quoted credential assignments. This is a bounded scan, not an absolute guarantee that arbitrary confidential information is absent.

The dependency audit reports three low-severity findings in the SvelteKit/static-adapter/cookie chain, with no moderate, high or critical findings. The hosted application is static; no cookie-handling application server is deployed. The audit's suggested downgrade is not applied.

Public elevation, search and Overpass services can still be unavailable. The app reports failures instead of fabricating missing data. Completely offshore selections without a coastline cannot be inferred. Browser memory, geometry-size and worker-time limits still apply.

Independent slicer/CAD checks and broader Safari, Firefox and touch-device validation remain useful follow-ups; automated mesh checks do not replace a physical print test.

## Documentation and deployment

The English README explains area selection, UI controls, presets, formats, building filtering, error recovery, privacy, limitations, local development and GitHub Pages. Three illustrations show selection, 2D design and 3D printing.

The Pages workflow tests and builds on a push to main, uploads build/, and deploys with the /topomapper base path. Verify the deployment job and live site after publication.
