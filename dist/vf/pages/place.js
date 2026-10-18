/* Locality page: one row per election, each linking to that election's page for the locality. */
class Place extends DCLogic {
  constructor(props) {
    super(props);
    this.state = { data: null };
  }
  componentDidMount() {
    fetch('/data/loc/' + this.props.lid + '.json').then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }).then((data) => {
      this.setState({ data });
      document.title = data.name + ' elections · VoteFlow';
    }).catch(() => { location.replace('/'); });
  }
  renderVals() {
    const D = this.state.data;
    const f = (n) => n == null ? '—' : Math.round(n).toLocaleString('en-US');
    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const md = (s) => MON[+s.slice(5, 7) - 1] + ' ' + +s.slice(8, 10) + ', ' + s.slice(0, 4);
    const all = D ? D.names.map(([id, nm]) => ({ value: id, text: nm })) : [];
    const base = { lid: this.props.lid, locs: VF.recentItems(all, this.props.lid).concat(all), band: { asOf: '' },
      pickL: (v) => { v = VF.unRecent(v); if (v && v !== this.props.lid) location.href = VF.placeUrl(v); } };
    if (!D) return Object.assign(base, { ready: false, name: '…', rows: [] });
    const pct = (x) => x.reg ? x.total / x.reg * 100 : null;
    const past = D.elections.filter((x) => x.final && pct(x) != null);
    const top = Math.max(...D.elections.map((x) => pct(x) || 0)) || 1;
    const best = past.length ? past.reduce((a, b) => (pct(b) > pct(a) ? b : a)) : null;
    const live = D.elections.find((x) => x.id === VF.site.live);
    const cur = live || D.elections[0];
    return Object.assign(base, {
      ready: true, name: D.name, region: D.region, reg: f(D.reg), regRank: D.rankR ? '#' + D.rankR + ' of 133 localities by size' : '',
      best: best ? { p: pct(best).toFixed(1) + '%', label: best.label + ' · ' + f(best.total) + ' early ballots' } : { p: '—', label: '' },
      now: { v: f(cur.total), sub: (live ? 'ballots cast so far for ' : 'ballots cast in ') + cur.label + '.', label: cur.label, href: VF.locUrl(D.id, cur.id) },
      rows: D.elections.map((x) => {
        const p = pct(x);
        return { label: x.label, date: md(x.date), type: x.type, early: f(x.early), mail: f(x.mail), total: f(x.total), reg: f(x.reg), live: !x.final,
          p: p == null ? '—' : p.toFixed(1) + '%', w: p == null ? '0%' : (p / top * 100).toFixed(1) + '%', c: x.final ? '#00A37A' : '#7C4DDB', href: VF.locUrl(D.id, x.id) };
      })
    });
  }
}
VF.page('place', Place);
