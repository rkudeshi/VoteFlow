/* Homepage: pick a state. Each box shows the state's latest headline numbers and its map. */
class States extends DCLogic {
  constructor(props) { super(props); this.state = { va: null, ca: null, caMap: null }; }
  componentDidMount() {
    document.title = 'VoteFlow · Early voting by state';
    const get = (u) => fetch(u).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }).catch(() => null);
    get('/data/home-' + VF.site.live + '.json').then((va) => this.setState({ va }));
    Promise.all([get('/ca/data.json'), get('/ca/map.json')]).then(([ca, caMap]) => this.setState({ ca, caMap }));
  }
  renderVals() {
    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dmd = (s) => { const d = new Date(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)); return DOW[d.getDay()] + ' ' + MON[d.getMonth()] + ' ' + d.getDate(); };
    const f = (n) => Math.round(n).toLocaleString('en-US');
    const spread = (xs) => { const lo = Math.min(...xs), hi = Math.max(...xs); return (v) => hi > lo ? (v - lo) / (hi - lo) : 0.5; };
    const { va, ca, caMap } = this.state;
    const boxes = [];
    {
      const b = { href: '/va', name: 'Virginia', code: 'VA', places: '133 counties and cities', ready: !!va, wait: !va, cta: 'Open Virginia →', vb: '0 0 1000 440', shapes: [] };
      if (va) {
        const last = va.rows[va.rows.length - 1], tot = last.e + last.m, q = spread(va.locs.map((o) => o.p));
        Object.assign(b, { kicker: 'Early votes cast · through ' + dmd(va.asOf), big: f(tot), bigL: 'early ballots cast', pct: (tot / va.reg * 100).toFixed(1) + '%', pctL: 'turnout so far',
          note: f(last.e) + ' in person · ' + f(last.m) + ' by mail', shapes: va.locs.map((o) => ({ d: o.d, fill: VF.ramp(q(o.p), 'g') })) });
      }
      boxes.push(b);
    }
    {
      const b = { href: '/ca', name: 'California', code: 'CA', places: '58 counties', ready: !!(ca && caMap), wait: !(ca && caMap), cta: 'Open California →', vb: '0 0 1000 1154', shapes: [] };
      if (ca && caMap) {
        const T = ca.total[ca.total.length - 1], ix = (k) => ca.cols.indexOf(k) + 1, ret = T[ix('returned')], iss = T[ix('issued')];
        const ip = ix('inperson') ? T[ix('inperson')] || 0 : 0, cast = ret + ip, reg = ca.reg || iss;
        const rate = {}; ca.counties.forEach((c) => { const r = c.rows[c.rows.length - 1]; rate[c.id] = r[ix('returned')] / r[ix('issued')]; });
        const q = spread(Object.values(rate));
        Object.assign(b, { vb: '0 0 ' + caMap.w + ' ' + caMap.h, kicker: 'Ballots cast · through ' + dmd(ca.asOf), big: f(cast), bigL: 'ballots cast', pct: (cast / reg * 100).toFixed(1) + '%', pctL: 'turnout so far',
          note: f(ret) + ' by mail · ' + f(ip) + ' in person', shapes: caMap.shapes.map((s) => ({ d: s.d, fill: VF.ramp(q(rate[s.id]), 'g') })) });
      }
      boxes.push(b);
    }
    return { band: {}, boxes };
  }
}
VF.page('states', States);
