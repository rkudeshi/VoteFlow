"""Builds the standalone post-election preview page for one locality.

Inlines dist/post-election/<slug>.json and a simplified, pre-projected copy of the
locality's precinct map into previews/post-election-template.html.
Usage: python3 previews/build_post_election_preview.py fairfax-county OUT.html
"""
import json, math, sys
from pathlib import Path

R = Path(__file__).resolve().parent.parent
W = 1000  # map width in SVG units


def simplify(pts, tol):
    """Douglas-Peucker on projected points."""
    if len(pts) < 4:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        (x1, y1), (x2, y2) = pts[a], pts[b]
        dx, dy = x2 - x1, y2 - y1
        n = math.hypot(dx, dy) or 1e-9
        best, idx = 0, None
        for i in range(a + 1, b):
            d = abs(dy * (pts[i][0] - x1) - dx * (pts[i][1] - y1)) / n
            if d > best:
                best, idx = d, i
        if idx is not None and best > tol:
            keep[idx] = True
            stack += [(a, idx), (idx, b)]
    return [p for p, k in zip(pts, keep) if k]


def project_map(slug):
    gj = json.loads((R / 'dist' / 'maps' / f'{slug}.json').read_text())
    rings = []
    for f in gj['features']:
        g = f['geometry']
        polys = g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]
        rings.append((f['properties']['code'], f['properties']['name'], polys))
    xs = [x for _, _, ps in rings for p in ps for r in p for x, _ in r]
    ys = [y for _, _, ps in rings for p in ps for r in p for _, y in r]
    lat0 = (min(ys) + max(ys)) / 2
    k = math.cos(math.radians(lat0))
    x0, x1, y0, y1 = min(xs) * k, max(xs) * k, min(ys), max(ys)
    s = W / (x1 - x0)
    H = round((y1 - y0) * s)
    proj = lambda lon, lat: ((lon * k - x0) * s, (y1 - lat) * s)
    out = {}
    for code, name, polys in rings:
        d = []
        for poly in polys:
            for ring in poly:
                pts = [proj(*p) for p in ring]
                # split the closed ring at its farthest point so both halves have distinct ends
                far = max(range(len(pts)), key=lambda i: math.dist(pts[0], pts[i]))
                pts = simplify(pts[:far + 1], 0.6)[:-1] + simplify(pts[far:], 0.6)
                if len(pts) < 4:
                    continue
                d.append('M' + 'L'.join(f'{x:.1f},{y:.1f}' for x, y in pts) + 'Z')
        out[code] = {'n': name.title(), 'd': ''.join(d)}
    return {'w': W, 'h': H, 'k': k, 'x0': x0, 'y1': y1, 's': s, 'p': out}


def main(slug, dest):
    data = json.loads((R / 'dist' / 'post-election' / f'{slug}.json').read_text())
    geo = project_map(slug)
    for e in data['elections']:
        for p in e['precincts']:
            if 'ppXY' in p:
                lon, lat = p['ppXY']
                p['ppXY'] = [round((lon * geo['k'] - geo['x0']) * geo['s'], 1), round((geo['y1'] - lat) * geo['s'], 1)]
    for key in ('k', 'x0', 'y1', 's'):
        geo.pop(key)
    html = (R / 'previews' / 'post-election-template.html').read_text()
    html = html.replace('/*DATA*/null', json.dumps(data, separators=(',', ':'))).replace('/*GEO*/null', json.dumps(geo, separators=(',', ':')))
    Path(dest).write_text(html)
    print('wrote', dest, f'{len(html) / 1e6:.2f} MB')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
