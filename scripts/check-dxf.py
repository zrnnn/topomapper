"""Audit the browser regression fixture with an independent CAD parser."""
from pathlib import Path
import sys

import ezdxf

drawing = ezdxf.readfile(Path(sys.argv[1]))
audit = drawing.audit()
assert not audit.errors and not audit.fixes, (audit.errors, audit.fixes)
assert drawing.dxfversion == "AC1021" and drawing.units == 4
space = drawing.modelspace()
frame, = space.query('LWPOLYLINE[layer=="FRAME"]')
points = list(frame.get_points("xy"))
assert frame.closed and len(points) == 4
assert {round(x, 3) for x, _ in points} == {0, 200}
assert {round(y, 3) for _, y in points} == {0, 140}
water = space.query('LWPOLYLINE[layer=="WATER_AREAS"]')
assert len(water) >= 2 and all(line.closed for line in water)
assert drawing.layers.get("WATER_AREAS").rgb == (180, 209, 211)
assert space.query('LWPOLYLINE[layer=="ROADS_PRIMARY"]')
assert any(t.dxf.text == 'München & <Ufer>' for t in space.query("TEXT"))
print(f"ezdxf {ezdxf.__version__} accepted {len(space)} model-space entities")
