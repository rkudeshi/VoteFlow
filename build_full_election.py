"""Builds the Full election pages (turnout by precinct and vote method for completed elections).

Live site (default): from previews/full-election-template.html writes
  dist/vf/full.css, dist/vf/full.js       page style and script
  dist/full.html                          page shell; build_routes.py copies it to /va/<locality>/<YYYY-MM>/full
  dist/post-election/geo/<slug>.json      simplified, pre-projected precinct map and polling place points
  dist/vf/full-elections.js               which localities and elections have a Full election page
Run post_election.py first to refresh dist/post-election/<slug>.json.

Preview: python3 build_full_election.py --preview <slug> OUT.html  (one self-contained page)
"""
import json, math, re, sys
from pathlib import Path

R = Path(__file__).resolve().parent
DIST = R / 'dist'
TEMPLATE = R / 'previews' / 'full-election-template.html'
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
    path = DIST / 'maps' / f'{slug}.json'
    if not path.exists():
        return None
    gj = json.loads(path.read_text())
    rings = []
    for f in gj['features']:
        g = f['geometry']
        if not g:
            continue
        polys = g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]
        rings.append((str(f['properties']['code']), f['properties'].get('name') or '', polys))
    xs = [x for _, _, ps in rings for p in ps for r in p for x, _ in r]
    ys = [y for _, _, ps in rings for p in ps for r in p for _, y in r]
    if not xs:
        return None
    lat0 = (min(ys) + max(ys)) / 2
    k = math.cos(math.radians(lat0))
    x0, x1, y0, y1 = min(xs) * k, max(xs) * k, min(ys), max(ys)
    s = W / (x1 - x0)
    proj = lambda lon, lat: ((lon * k - x0) * s, (y1 - lat) * s)
    out = {}
    for code, name, polys in rings:
        d = []
        for poly in polys:
            for ring in poly:
                pts = [proj(*p[:2]) for p in ring]
                # split the closed ring at its farthest point so both halves have distinct ends
                far = max(range(len(pts)), key=lambda i: math.dist(pts[0], pts[i]))
                pts = simplify(pts[:far + 1], 0.6)[:-1] + simplify(pts[far:], 0.6)
                if len(pts) < 4:
                    continue
                d.append('M' + 'L'.join(f'{x:.1f},{y:.1f}' for x, y in pts) + 'Z')
        out[code] = {'n': name.title(), 'd': out.get(code, {}).get('d', '') + ''.join(d)}
    return {'w': W, 'h': round((y1 - y0) * s), 'p': out, '_t': (k, x0, y1, s)}


def place_points(data, geo):
    """Project polling place points onto the map; drop geocodes that land outside the locality."""
    pts = {}
    for e in data['elections']:
        for p in e['precincts']:
            if 'ppXY' not in p or not geo:
                continue
            k, x0, y1, s = geo['_t']
            lon, lat = p['ppXY']
            x, y = (lon * k - x0) * s, (y1 - lat) * s
            if -20 < x < geo['w'] + 20 and -20 < y < geo['h'] + 20:
                pts[p['ppAddr']] = [round(x, 1), round(y, 1)]
    return pts


def parts():
    t = TEMPLATE.read_text()
    css = t[t.index('<style>') + 7:t.index('</style>')]
    body = t[t.index('</style>') + 8:t.index('<script>')]
    js = t[t.index('<script>') + 8:t.rindex('</script>')]
    head = t[:t.index('<style>')]
    return head, css, body, js


def preview(slug, dest):
    data = json.loads((DIST / 'post-election' / f'{slug}.json').read_text())
    geo = project_map(slug)
    pts = place_points(data, geo)
    for e in data['elections']:
        for p in e['precincts']:
            p.pop('ppXY', None)
            if p.get('ppAddr') in pts:
                p['ppXY'] = pts[p['ppAddr']]
    if geo:
        geo.pop('_t')
    html = TEMPLATE.read_text().replace('__TITLE__', f"{data['name']} Full Election")
    html = html.replace('/*DATA*/null', json.dumps(data, separators=(',', ':'))).replace('/*GEO*/null', json.dumps(geo, separators=(',', ':')))
    Path(dest).write_text(html)
    print('wrote', dest, f'{len(html) / 1e6:.2f} MB')


LIVE_JS = '''(async () => {
const seg = location.pathname.split('/').filter(Boolean); // va, <locality>, <YYYY-MM>, full
const slug = seg[1];
window.VF_START = seg[2];
window.VF_NAV = (id) => history.pushState(null, '', '/va/' + slug + '/' + id + '/full');
try { const t = localStorage.getItem('vf-theme'); if (t === 'dark' || t === 'light') document.documentElement.dataset.theme = t; } catch (e) {}
let DATA, G;
try {
  [DATA, G] = await Promise.all(['/post-election/' + slug + '.json', '/post-election/geo/' + slug + '.json']
    .map((u) => fetch(u).then((r) => { if (!r.ok) throw new Error(u); return r.json(); })));
} catch (e) { location.replace('/va/' + (slug || '')); return; }
const GEO = G.map, PTS = G.pts || {};
DATA.elections.forEach((e) => e.precincts.forEach((p) => { if (PTS[p.ppAddr]) p.ppXY = PTS[p.ppAddr]; }));
__CODE__
addEventListener('popstate', () => { const id = location.pathname.split('/')[3]; if (E[id]) { S.sel = id; S.cmp = prevOf(id); S.hl = null; render(); } });
})();
'''


def live():
    head, css, body, js = parts()
    code = js.replace('const DATA=/*DATA*/null, GEO=/*GEO*/null;', '')
    (DIST / 'vf' / 'full.css').write_text(css.strip() + '\n')
    (DIST / 'vf' / 'full.js').write_text(LIVE_JS.replace('__CODE__', code.strip()))
    body = body.replace('<span class="preview-chip">Preview</span>', '')
    body = body.replace('<span class="badge">VA</span><span class="brand">VoteFlow</span>',
                        '<a href="/va" style="display:flex;align-items:center;gap:10px;color:inherit;text-decoration:none"><span class="badge">VA</span><span class="brand">VoteFlow</span></a>')
    body = body.replace('href="#" target="_blank" rel="noopener">Early voting</a>', 'href="/va">Early voting</a>')
    fonts = re.findall(r'<link[^>]+>', head)
    beacon = re.search(r'<!-- Cloudflare Web Analytics -->.*?<!-- End Cloudflare Web Analytics -->', (DIST / 'index.html').read_text(), re.S)
    shell = ('<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
             '<meta name="theme-color" content="#121417"><title>Full election · VoteFlow</title>'
             '<meta name="description" content="Turnout by precinct and vote method for completed Virginia elections.">'
             + re.search(r'<link rel="icon"[^>]+>', (DIST / 'index.html').read_text()).group(0) + ''.join(fonts) +
             '<link rel="stylesheet" href="/vf/full.css"><script defer src="/vf/full.js"></script>' +
             (beacon.group(0) if beacon else '') + '</head>\n<body>' + body.strip() + '\n</body></html>\n')
    (DIST / 'full.html').write_text(shell)
    index = json.loads((DIST / 'post-election' / 'index.json').read_text())
    (DIST / 'post-election' / 'geo').mkdir(exist_ok=True)
    for slug in index:
        data = json.loads((DIST / 'post-election' / f'{slug}.json').read_text())
        geo = project_map(slug)
        pts = place_points(data, geo)
        if geo:
            geo.pop('_t')
        (DIST / 'post-election' / 'geo' / f'{slug}.json').write_text(json.dumps({'map': geo, 'pts': pts}, separators=(',', ':')))
    (DIST / 'vf' / 'full-elections.js').write_text('window.VF_FULL=' + json.dumps(index, separators=(',', ':')) + ';\n')
    print(f'wrote Full election page and maps for {len(index)} localities')


if __name__ == '__main__':
    if '--preview' in sys.argv:
        i = sys.argv.index('--preview')
        preview(sys.argv[i + 1], sys.argv[i + 2])
    else:
        live()
