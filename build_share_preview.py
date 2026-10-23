"""Build the page that renders the link-preview animation (og:video) and still (og:image).

Writes .share-preview/frame.html with real turnout by locality baked in; render_share_preview.cjs
then screenshots it frame by frame into dist/share/preview.mp4 and dist/share/preview.png.
"""
import json, math
from pathlib import Path
root = Path(__file__).resolve().parent
out = root / '.share-preview'; out.mkdir(exist_ok=True)

def va():
    region = json.loads((root / 'dist/region.json').read_text())
    election = region['elections']['2026']
    geo = json.loads((root / 'dist/regional.geojson').read_text())
    pts = [p for f in geo['features'] for poly in (f['geometry']['coordinates'] if f['geometry']['type'] == 'MultiPolygon' else [f['geometry']['coordinates']]) for ring in poly for p in ring]
    lat0 = sum(p[1] for p in pts) / len(pts); k = math.cos(math.radians(lat0))
    x0, x1 = min(p[0] for p in pts) * k, max(p[0] for p in pts) * k
    y0, y1 = min(p[1] for p in pts), max(p[1] for p in pts)
    w = 1000; s = w / (x1 - x0); h = (y1 - y0) * s
    dates = sorted({r['date'] for l in election['localities'] for r in l['history']})
    shapes = []
    by_id = {l['id']: l for l in election['localities']}
    for f in geo['features']:
        loc = by_id.get(f['properties']['id'])
        if not loc: continue
        rows = {r['date']: r['total'] for r in loc['history']}
        series, last = [], 0
        for d in dates: last = rows.get(d, last); series.append(round(last / loc['registered'], 4))
        polys = f['geometry']['coordinates'] if f['geometry']['type'] == 'MultiPolygon' else [f['geometry']['coordinates']]
        d = ''.join('M' + 'L'.join(f'{(p[0]*k-x0)*s:.1f} {(y1-p[1])*s:.1f}' for p in ring[::2] + [ring[0]]) + 'Z' for poly in polys for ring in poly)
        shapes.append({'d': d, 's': series})
    return {'w': w, 'h': round(h), 'shapes': shapes, 'n': len(dates)}

def ca():
    data = json.loads((root / 'dist/ca/data.json').read_text())
    m = json.loads((root / 'dist/ca/map.json').read_text())
    i = data['cols'].index('returned') + 2
    dates = [r['d'] for r in data['reports']]
    by_id = {c['id']: c for c in data['counties']}
    shapes = []
    for sh in m['shapes']:
        c = by_id.get(sh['id'])
        if not c: continue
        rows = {r[0]: r[i] for r in c['rows']}
        series, last = [], 0
        for d in dates: last = rows.get(d, last); series.append(round(last / c['reg'], 4))
        shapes.append({'d': sh['d'], 's': series})
    return {'w': m['w'], 'h': m['h'], 'shapes': shapes, 'n': len(dates)}

data = {'va': va(), 'ca': ca()}
tpl = (root / 'share_preview.html').read_text()
(out / 'frame.html').write_text(tpl.replace('/*DATA*/null', json.dumps(data, separators=(',', ':'))))
print('wrote', out / 'frame.html', round((out / 'frame.html').stat().st_size / 1e3), 'KB')
