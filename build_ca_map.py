"""California county outlines for the /ca page: sources/ca/ca-counties.geojson (Census
cartographic boundaries, via us-atlas 3.0.1 counties-10m) → dist/ca/map.json, SVG paths in
California Albers (EPSG:3310) fitted to a 1000-wide box. Run once; the output is committed."""
import json
from pathlib import Path
from pyproj import Transformer
from shapely.geometry import shape
from shapely.ops import transform

ROOT = Path(__file__).resolve().parent
from ca_data import slug

src = json.loads((ROOT / 'sources' / 'ca' / 'ca-counties.geojson').read_text())
proj = Transformer.from_crs(4326, 3310, always_xy=True).transform
geoms = {f['properties']['name']: transform(proj, shape(f['geometry'])).simplify(900, preserve_topology=True) for f in src['features']}
x0 = min(g.bounds[0] for g in geoms.values()); y0 = min(g.bounds[1] for g in geoms.values())
x1 = max(g.bounds[2] for g in geoms.values()); y1 = max(g.bounds[3] for g in geoms.values())
W = 1000; k = W / (x1 - x0); H = round((y1 - y0) * k)


def path(g):
    polys = getattr(g, 'geoms', [g])
    out = []
    for p in polys:
        for ring in [p.exterior, *p.interiors]:
            pts = [(round((x - x0) * k, 1), round((y1 - y) * k, 1)) for x, y in ring.coords]
            out.append('M' + 'L'.join(f'{a:g} {b:g}' for a, b in pts[:-1]) + 'Z')
    return ''.join(out)


shapes = []
for name, g in sorted(geoms.items()):
    c = g.representative_point()
    shapes.append({'id': slug(name), 'd': path(g), 'cx': round((c.x - x0) * k), 'cy': round((y1 - c.y) * k)})
(ROOT / 'dist' / 'ca').mkdir(parents=True, exist_ok=True)
(ROOT / 'dist' / 'ca' / 'map.json').write_text(json.dumps({'w': W, 'h': H, 'shapes': shapes}, separators=(',', ':')))
print('Wrote dist/ca/map.json', len(shapes), 'counties', W, 'x', H)
