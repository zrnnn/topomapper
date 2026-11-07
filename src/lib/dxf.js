import {DxfWriter, Units, LWPolylineFlags, TextHorizontalAlignment, point2d, point3d} from '@tarikjabiri/dxf';

export function createMapDrawing(heightMm) {
  const drawing = new DxfWriter();
  drawing.setUnits(Units.Millimeters);
  drawing.setVariable('$ACADVER', {1: 'AC1021'});
  const layers = new Set();
  function layer(name, color) {
    if (!layers.has(name)) {
      const record = drawing.addLayer(name, 7, 'Continuous');
      record.trueColor = parseInt(color.slice(1), 16);
      layers.add(name);
    }
    return name;
  }
  function writePolyline(name, points, color, forceClosed) {
    if (points.length < 2) return;
    const first = points[0], last = points.at(-1);
    const repeated = first[0] === last[0] && first[1] === last[1];
    const closed = forceClosed ?? repeated;
    const vertices = closed && repeated ? points.slice(0, -1) : points;
    if (vertices.length < (closed ? 3 : 2)) return;
    drawing.addLWPolyline(vertices.map(([x,y]) => ({point: point2d(x, heightMm-y)})), {
      layerName: layer(name, color), flags: closed ? LWPolylineFlags.Closed : 0
    });
  }
  function writeText(name, text, x, y, height, color) {
    const value = String(text).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
    if (!value) return;
    const at = point3d(x, heightMm-y, 0);
    drawing.addText(at, height, value, {layerName: layer(name, color),
      horizontalAlignment: TextHorizontalAlignment.Center, secondAlignmentPoint: at});
  }
  return {writePolyline, writeText, serialize: () => drawing.stringify()};
}
