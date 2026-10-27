"""Prepare map shapes for the per-place link previews (og:image / og:video).

Writes .share-preview/places.json: each state's locality shapes in one projection, plus every
Virginia locality's precincts in that same projection. render_share_preview.cjs turns it into
dist/share/<state>/<id>.mp4 and .png; build_routes.py points each place's pages at them.
"""
import json, math
from pathlib import Path
root = Path(__file__).resolve().parent
out = root / '.share-preview'; out.mkdir(exist_ok=True)

def rings(geom):
    polys = geom['coordinates'] if geom['type'] == 'MultiPolygon' else [geom['coordinates']]
    return [ring for poly in polys for ring in poly]

def path(rs, proj, tol):
    parts = []
    for ring in rs:
        pts = [proj(p) for p in ring]
        keep = [pts[0]]
        for p in pts[1:]:
            if abs(p[0] - keep[-1][0]) + abs(p[1] - keep[-1][1]) >= tol: keep.append(p)
        if len(keep) < 3: continue
        dec = 2 if tol < 0.05 else 1
        parts.append('M' + 'L'.join(f'{x:.{dec}f} {y:.{dec}f}' for x, y in keep) + 'Z')
    return ''.join(parts)

def bbox(rs, proj):
    pts = [proj(p) for r in rs for p in r]
    return [min(p[0] for p in pts), min(p[1] for p in pts), max(p[0] for p in pts), max(p[1] for p in pts)]

def va():
    region = json.loads((root / 'dist/region.json').read_text())
    geo = json.loads((root / 'dist/regional.geojson').read_text())
    pts = [p for f in geo['features'] for r in rings(f['geometry']) for p in r]
    k = math.cos(math.radians(sum(p[1] for p in pts) / len(pts)))
    x0, x1 = min(p[0] for p in pts) * k, max(p[0] for p in pts) * k
    y0, y1 = min(p[1] for p in pts), max(p[1] for p in pts)
    s = 1000 / (x1 - x0)
    proj = lambda p: ((p[0] * k - x0) * s, (y1 - p[1]) * s)
    shapes = [{'id': f['properties']['id'], 'd': path(rings(f['geometry']), proj, 0.15)} for f in geo['features']]
    manifest = json.loads((root / 'dist/map-manifest.json').read_text())
    places = []
    geo_by_id = {f['properties']['id']: f for f in geo['features']}
    for loc in region['names']:
        f = geo_by_id.get(loc['id'])
        if not f: continue
        box = bbox(rings(f['geometry']), proj)
        tol = max(box[2] - box[0], box[3] - box[1]) / 700
        precincts = []
        entry = manifest.get(loc['id'])
        if entry:
            pg = json.loads((root / 'dist' / entry['file']).read_text())
            precincts = [d for d in (path(rings(p['geometry']), proj, tol) for p in pg['features'] if p.get('geometry')) if d]
        places.append({'state': 'va', 'id': loc['id'], 'name': loc['name'], 'box': box, 'precincts': precincts})
    return {'w': 1000, 'h': round((y1 - y0) * s), 'shapes': shapes, 'label': 'Virginia'}, places

def ca():
    data = json.loads((root / 'dist/ca/data.json').read_text())
    m = json.loads((root / 'dist/ca/map.json').read_text())
    by_id = {s['id']: s for s in m['shapes']}
    places = []
    for c in data['counties']:
        sh = by_id.get(c['id'])
        if not sh: continue
        nums = [float(v) for v in sh['d'].replace('M', ' ').replace('L', ' ').replace('Z', ' ').split()]
        xs, ys = nums[0::2], nums[1::2]
        places.append({'state': 'ca', 'id': c['id'], 'name': c['name'], 'box': [min(xs), min(ys), max(xs), max(ys)], 'precincts': []})
    return {'w': m['w'], 'h': m['h'], 'shapes': [{'id': s['id'], 'd': s['d']} for s in m['shapes']], 'label': 'California'}, places

va_state, va_places = va()
ca_state, ca_places = ca()
(out / 'places.json').write_text(json.dumps({'states': {'va': va_state, 'ca': ca_state}, 'places': va_places + ca_places}, separators=(',', ':')))
print(len(va_places), 'Virginia +', len(ca_places), 'California places,', round((out / 'places.json').stat().st_size / 1e6, 1), 'MB')
