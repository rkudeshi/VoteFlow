/* VoteFlow California: /ca (statewide) and /ca/<county> (one county), one page and one template
 * (/vf/templates/ca.html). Data: /ca/data.json (ca_data.py) and /ca/map.json (build_ca_map.py).
 *
 * The state posts one cumulative report a day, covering through 11:59 PM the day before it posts.
 * "Added" is always the change between two consecutive saved reports; when a report date is
 * missing the next change spans the gap. Drops (county corrections) stay negative. */
class CaPage extends DCLogic {
  constructor(props) {
    super(props);
    this.state = { data: null, map: null, now: Date.now(), view: 'add', sel: null, mapM: 'rate', hover: null, sortKey: 'reg', sortDir: -1, miniTip: null, all: false, q: '', rhythmAll: false, narrow: window.innerWidth < 600 };
  }
  componentDidMount() {
    this.clock = setInterval(() => this.setState({ now: Date.now() }), 60000);
    this.onResize = () => { const nw = window.innerWidth < 600; if (nw !== this.state.narrow) this.setState({ narrow: nw }); };
    window.addEventListener('resize', this.onResize);
    Promise.all(['/ca/data.json', '/ca/map.json'].map((u) => fetch(u).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })))
      .then(([data, map]) => {
        const c = this.props.cid && data.counties.find((x) => x.id === this.props.cid);
        if (this.props.cid && !c) { location.replace('/ca'); return; }
        document.title = (c ? c.name + ', California' : 'California early voting') + ' · VoteFlow';
        this.setState({ data, map });
      }).catch(() => this.setState({ failed: true }));
  }
  componentWillUnmount() { clearInterval(this.clock); window.removeEventListener('resize', this.onResize); }

  renderVals() {
    const D = this.state.data, M = this.state.map, S = this.state;
    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const DOWL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const parse = (s) => new Date(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
    const md = (s) => { const d = parse(s); return MON[d.getMonth()] + ' ' + d.getDate(); };
    const dmd = (s) => { const d = parse(s); return DOW[d.getDay()] + ' ' + MON[d.getMonth()] + ' ' + d.getDate(); };
    const f = (n) => n == null ? '—' : Math.round(n).toLocaleString('en-US');
    const sg = (n) => n == null ? '—' : (n > 0 ? '+' : n < 0 ? '−' : '') + f(Math.abs(n));
    const short = (n) => { const a = Math.abs(n), s = n < 0 ? '−' : ''; return s + (a >= 1e6 ? (a / 1e6).toFixed(a >= 1e7 ? 1 : 2).replace(/\.?0+$/, '') + 'M' : a >= 1e4 ? Math.round(a / 1000) + 'K' : a >= 1000 ? (a / 1000).toFixed(1).replace(/\.0$/, '') + 'K' : String(Math.round(a))); };
    const pct = (a, b, k = 1) => b ? (a / b * 100).toFixed(k) : '0';
    const pill = (cur, v) => ({ pressed: cur === v ? 'true' : 'false', bg: cur === v ? '#121417' : '#FFFFFF', fg: cur === v ? '#FFFFFF' : '#121417' });

    // Countdown to polls opening, 7 AM Pacific (PST, UTC−8) on Nov 3.
    const target = Date.UTC(2026, 10, 3, 15, 0, 0), left = Math.max(0, target - S.now);
    const mailStart = new Date(2026, 9, 5).getTime(); // ballots go out 29 days before Election Day
    const frac = Math.min(1, Math.max(0, (S.now - mailStart) / (target - mailStart)));
    const box = { big: Math.ceil(left / 864e5), small: Math.ceil(left / 864e5) === 1 ? 'day left' : 'days left', offset: (339.3 * frac).toFixed(1), title: 'Election Day · Tue Nov 3', sub: 'Polls open 7 AM to 8 PM Pacific' };
    if (!left) Object.assign(box, { big: '✓', small: 'polls open' });

    const base = { band: {}, box, ready: false, loading: !S.failed, failed: !!S.failed, find: { items: [] }, isCounty: !!this.props.cid, isState: !this.props.cid };
    if (!D || !M) return base;

    const C = D.cols, ix = (k) => C.indexOf(k) + 1;
    const I = { issued: ix('issued'), ret: ix('returned'), acc: ix('accepted') };
    const METH = [
      { k: 'mail', label: 'Mail', c: '#7C4DDB', ks: ['mail'] },
      { k: 'dropbox', label: 'Drop box', c: '#2F6FD6', ks: ['dropbox'] },
      { k: 'dropoff', label: 'Drop-off location', c: '#00A37A', ks: ['dropoff'] },
      { k: 'votecenter', label: 'Vote center', c: '#00694F', ks: ['votecenter'] },
      { k: 'other', label: 'Fax or other', c: '#8A93A3', ks: ['fax', 'other'] }
    ];
    const mv = (row, m) => m.ks.reduce((a, k) => a + (row[ix(k)] || 0), 0);
    const county = this.props.cid ? D.counties.find((x) => x.id === this.props.cid) : null;
    const rows = county ? county.rows : D.total;
    const last = rows[rows.length - 1], prev = rows.length > 1 ? rows[rows.length - 2] : null;
    const where = county ? county.name : 'California';
    const T = D.total[D.total.length - 1];
    const stRate = T[I.ret] / T[I.issued];

    // ----- Hero
    const ret = last[I.ret], iss = last[I.issued], acc = last[I.acc];
    const weekAgo = rows.find((r) => r[0] === addDays(last[0], -7));
    const segs = METH.map((m) => ({ ...m, v: mv(last, m) })).filter((m) => m.v > 0 || m.k === 'mail' || m.k === 'dropbox');
    const heroSegs = segs.map((m) => ({ c: m.c, w: (m.v / ret * 100).toFixed(2), label: m.label, v: f(m.v), p: pct(m.v, ret) }));
    const chips = [];
    if (prev) chips.push({ b: sg(ret - prev[I.ret]), t: 'in the latest report (' + md(last[0]) + ')' });
    if (weekAgo) chips.push({ b: sg(ret - weekAgo[I.ret]), t: 'over the past week' });
    if (county) { const d = (ret / iss - stRate) * 100; chips.push({ b: (d >= 0 ? '▲ ' : '▼ ') + Math.abs(d).toFixed(1) + ' pts', t: (d >= 0 ? 'above' : 'below') + ' the statewide rate' }); }
    chips.push({ b: pct(acc, ret) + '%', t: 'of returned ballots accepted so far' });
    const hero = {
      kicker: 'Mail ballots returned · ' + (county ? county.short : 'Statewide') + ' · through ' + dmd(last[0]).toUpperCase(),
      pct: pct(ret, iss), votes: f(ret), iss: f(iss), segs: heroSegs, chips,
      fs: S.narrow ? 'clamp(36px, 11vw, 56px)' : 'clamp(44px, 4.6vw, 66px)'
    };

    // ----- Flow (where ballots stand)
    const notRet = iss - ret, pending = Math.max(0, ret - acc);
    const flow = {
      iss: f(iss), ret: f(ret), retP: pct(ret, iss), notRet: f(notRet), notRetP: pct(notRet, iss),
      acc: f(acc), accP: pct(acc, ret), pend: f(pending), pendP: pct(pending, ret),
      reg: D.reg ? f(county ? county.reg : D.reg) : '', regLabel: D.regLabel || '',
      retW: Math.max(2, ret / iss * 100).toFixed(1), notRetW: Math.max(2, notRet / iss * 100).toFixed(1), accW: Math.max(2, acc / Math.max(ret, 1) * 100).toFixed(1), pendW: Math.max(2, pending / Math.max(ret, 1) * 100).toFixed(1)
    };

    // ----- Ballots added by report (calendar days from the day after the first report to Election Day)
    const first = rows[0][0], eday = D.election.date;
    const byDate = {}; rows.forEach((r, i) => { byDate[r[0]] = i; });
    // On a phone the chart stops at the latest report so the bars stay readable.
    const endDay = S.narrow ? last[0] : eday;
    const days = []; for (let d = addDays(first, 1); d <= endDay; d = addDays(d, 1)) days.push(d);
    const adds = days.map((d) => {
      const i = byDate[d];
      if (i == null || i === 0) return { d, has: false };
      const a = rows[i], b = rows[i - 1], gap = Math.round((parse(a[0]) - parse(b[0])) / 864e5);
      return { d, has: true, gap, tot: a[I.ret] - b[I.ret], acc: a[I.acc] - b[I.acc], run: a[I.ret], parts: METH.map((m) => ({ ...m, v: mv(a, m) - mv(b, m) })) };
    });
    const have = adds.filter((x) => x.has);
    const view = S.view;
    const W = 1000, H = S.narrow ? 560 : 300, padL = S.narrow ? 120 : 64, padB = S.narrow ? 56 : 34, padT = 16, cw = (W - padL - 8) / days.length;
    const maxV = view === 'add' ? Math.max(1, ...have.map((x) => x.parts.reduce((a, p) => a + Math.max(0, p.v), 0))) : Math.max(1, ...have.map((x) => x.run));
    const minV = view === 'add' ? Math.min(0, ...have.map((x) => x.parts.reduce((a, p) => a + Math.min(0, p.v), 0))) : 0;
    const step = niceStep((maxV - minV) / 4), top = Math.ceil(maxV / step) * step, bot = minV < -0.03 * maxV ? Math.floor(minV / step) * step : 0; // a stray −1 shouldn't add a whole negative band
    const y = (v) => padT + (top - v) / (top - bot) * (H - padT - padB);
    const ticks = []; for (let v = bot; v <= top + 1e-9; v += step) ticks.push({ y: y(v).toFixed(1), ty: (y(v) + 4).toFixed(1), l: short(v) });
    const lastIdx = days.indexOf(last[0]);
    const sel = S.sel && adds.find((x) => x.d === S.sel && x.has) ? S.sel : last[0];
    const bars = [], xl = [], pts = [];
    adds.forEach((a, k) => {
      const x = padL + k * cw;
      if (S.narrow ? k % 3 === 0 : parse(a.d).getDay() === 1 || k === 0) xl.push({ x: (x + cw / 2).toFixed(1), l: md(a.d) });
      if (!a.has) return;
      let up = 0, dn = 0;
      const rects = view === 'add' ? a.parts.filter((p) => p.v).map((p) => {
        const v0 = p.v > 0 ? up : dn, v1 = v0 + p.v; if (p.v > 0) up = v1; else dn = v1;
        const ya = y(Math.max(v0, v1)), yb = y(Math.min(v0, v1));
        return { x: (x + cw * 0.14).toFixed(1), y: ya.toFixed(1), w: (cw * 0.72).toFixed(1), h: Math.max(0.5, yb - ya).toFixed(1), c: p.c };
      }) : [];
      if (view === 'run') pts.push({ x: (x + cw / 2).toFixed(1), y: y(a.run).toFixed(1), on: a.d === sel });
      bars.push({ rects, on: a.d === sel, hx: x.toFixed(1), hw: cw.toFixed(1), op: a.d === sel || !S.sel ? 1 : 0.55, pick: () => this.setState({ sel: a.d }), gap: a.gap > 1, gx: (x + cw / 2).toFixed(1), gy: (y(view === 'add' ? Math.max(0, a.tot) : a.run) - 6).toFixed(1) });
    });
    const sa = adds.find((x) => x.d === sel);
    const selPanel = sa ? {
      kicker: sa.gap > 1 ? md(addDays(sa.d, 1 - sa.gap)) + '–' + md(sa.d) + ' · ' + sa.gap + ' days' : DOWL[parse(sa.d).getDay()],
      title: md(sa.d), sub: 'Report covering through ' + dmd(sa.d) + (posted(D, sa.d) ? ', posted ' + posted(D, sa.d) + ' PT' : ''),
      tot: sg(sa.tot), rows: sa.parts.filter((p) => p.v || p.k === 'mail' || p.k === 'dropbox').map((p) => ({ k: p.label, v: sg(p.v), c: p.c }))
        .concat([{ k: 'Accepted', v: sg(sa.acc), c: '#121417' }, { k: 'Returned so far', v: f(sa.run), c: 'transparent' }])
    } : null;
    const wk = have.filter((a) => a.gap === 1 && [1, 2, 3, 4, 5].includes(parse(a.d).getDay())), we = have.filter((a) => a.gap === 1 && [0, 6].includes(parse(a.d).getDay()));
    const avg = (xs) => xs.length ? xs.reduce((s, a) => s + a.tot, 0) / xs.length : null;
    const big = have.length ? have.reduce((a, b) => (b.tot > a.tot ? b : a)) : null;
    const chart = {
      view: [['add', 'Added per report'], ['run', 'Running total']].map(([v, l]) => ({ label: l, ...pill(view, v), pick: () => this.setState({ view: v }) })),
      ticks, bars, xl, zero: y(0).toFixed(1), W, H, padL, vb: '0 0 1000 ' + H, fs: S.narrow ? 30 : 12, ax: padL - 8, bottom: H - padB, ly: H - 10, plotH: H - padT - padB, narrow: S.narrow, todayX: lastIdx >= 0 && !S.narrow ? (padL + (lastIdx + 1) * cw).toFixed(1) : null, edX: (padL + (days.length - 1) * cw).toFixed(1), edW: cw.toFixed(1),
      futX: lastIdx >= 0 ? (padL + (lastIdx + 1) * cw).toFixed(1) : W, futW: lastIdx >= 0 ? (W - 8 - padL - (lastIdx + 1) * cw).toFixed(1) : 0,
      legend: view === 'run' ? [] : METH.filter((m) => have.some((a) => a.parts.find((p) => p.k === m.k).v)).map((m) => ({ c: m.c, l: m.label })),
      note: view === 'run' ? 'The line is the running total of returned ballots in each report.' : 'Each bar is the change from one report to the next, so it shows when counties logged ballots, which can trail when voters returned them.',
      firstNote: 'The first saved report (through ' + md(first) + ') already held ' + f(rows[0][I.ret]) + ' returned ballots, so daily changes start the day after.',
      sel: selPanel, hasSel: !!selPanel, isLine: view === 'run', line: pts.map((p) => p.x + ',' + p.y).join(' '),
      area: pts.length ? 'M' + pts[0].x + ',' + y(0).toFixed(1) + ' L' + pts.map((p) => p.x + ',' + p.y).join(' L') + ' L' + pts[pts.length - 1].x + ',' + y(0).toFixed(1) + ' Z' : '', dots: pts
    };
    const take = {
      byday: big ? 'Biggest report so far: ' + dmd(big.d).replace(/^(\w+) /, (m, d) => DOWL[DOW.indexOf(d)] + ', ') + ', with ' + sg(big.tot) + ' ballots' : '',
      rhythm: wk.length && we.length ? 'Weekday reports average ' + sg(avg(wk)) + '; weekend reports ' + sg(avg(we)) : ''
    };

    // ----- Reporting rhythm (statewide page): each county's adds per report, shaded within the county
    const rd = D.total.slice(1).map((r) => r[0]).slice(-10);
    const rhythmRows = D.counties.slice().sort((a, b) => (b.reg || 0) - (a.reg || 0)).map((c) => {
      const cells = rd.map((d) => { const i = c.rows.findIndex((r) => r[0] === d); return i > 0 ? c.rows[i][I.ret] - c.rows[i - 1][I.ret] : null; });
      const mx = Math.max(1, ...cells.filter((v) => v != null));
      const totR = c.rows[c.rows.length - 1][I.ret];
      return { name: c.short, href: '/ca/' + c.id, type: c.type, cells: cells.map((v, k) => {
        const d = rd[k];
        const q = v == null ? 0 : Math.max(0, v) / mx;
        return { v: v == null ? '' : v < 0 ? '−' + short(-v) : short(v), bg: v == null ? '#F5F6F8' : v < 0 ? '#FDECEA' : v === 0 ? '#F1F2F5' : VF.ramp(q, 'p'), fg: v != null && q > 0.55 ? (VF.dark ? '#12141a' : '#ffffff') : v < 0 ? '#B42318' : '#121417', t: c.short + ' · ' + md(d) + ': ' + (v == null ? 'no report' : sg(v)) };
      }), quiet: cells.filter((v) => v === 0).length, share: totR };
    });
    // Quietest report: the one where the fewest counties logged any new returns.
    const active = rd.map((d, k) => ({ d, n: rhythmRows.filter((r) => r.cells[k].v && r.cells[k].v !== '0').length }));
    const quiet = active.length ? active.reduce((a, b) => (b.n < a.n ? b : a)) : null;
    const rhythm = {
      heads: rd.map((d) => ({ l: DOW[parse(d).getDay()], d: md(d) })), cols: '150px repeat(' + rd.length + ', minmax(52px, 1fr))',
      rows: S.rhythmAll ? rhythmRows : rhythmRows.slice(0, 15), allLabel: S.rhythmAll ? 'Show fewer' : 'Show all 58', toggle: () => this.setState({ rhythmAll: !S.rhythmAll }),
      take: quiet && quiet.n < 58 ? 'Quietest report: ' + dmd(quiet.d) + ', when only ' + quiet.n + ' of 58 counties added ballots' : 'Every county added ballots in every report shown'
    };

    // ----- Map
    const latestAdd = (c) => { const r = c.rows, n = r.length; return n > 1 ? r[n - 1][I.ret] - r[n - 2][I.ret] : 0; };
    const MEAS = {
      rate: { label: 'Return rate', v: (c) => { const r = c.rows[c.rows.length - 1]; return r[I.ret] / r[I.issued] * 100; }, fmt: (v) => v.toFixed(1) + '%', kind: 'g' },
      returned: { label: 'Ballots returned', v: (c) => c.rows[c.rows.length - 1][I.ret], fmt: short, kind: 'g', log: true },
      latest: { label: 'Latest report', v: (c) => latestAdd(c) / c.rows[c.rows.length - 1][I.issued] * 100, fmt: (v) => v.toFixed(2) + '%', kind: 'g' },
      dropbox: { label: 'Drop box share', v: (c) => { const r = c.rows[c.rows.length - 1]; return r[ix('dropbox')] / Math.max(1, r[I.ret]) * 100; }, fmt: (v) => v.toFixed(0) + '%', kind: 'p' }
    };
    const meas = MEAS[S.mapM];
    const vals = D.counties.map((c) => ({ c, v: meas.v(c) }));
    const tr = (v) => meas.log ? Math.log10(Math.max(1, v)) : v;
    const lo = Math.min(...vals.map((x) => tr(x.v))), hi = Math.max(...vals.map((x) => tr(x.v)));
    const hovId = S.hover || (county && county.id);
    const shapes = M.shapes.map((s, k) => {
      const o = vals.find((x) => x.c.id === s.id);
      const t = hi > lo ? (tr(o.v) - lo) / (hi - lo) : 0.5;
      return { d: s.d, fill: VF.ramp(t, meas.kind), stroke: '#FFFFFF', sw: 1.2, delay: (k * 8) + 'ms',
        move: () => { if (S.hover !== s.id) this.setState({ hover: s.id }); }, go: () => { location.href = '/ca/' + s.id; } };
    });
    // The paths never reorder (reordering made Preact repaint every county); the outline is its own path on top.
    const hlShape = hovId && M.shapes.find((s) => s.id === hovId);
    const hc = hovId && D.counties.find((c) => c.id === hovId);
    const sideOf = (c) => {
      const r = c ? c.rows[c.rows.length - 1] : T, p = c ? c.rows[c.rows.length - 2] : D.total[D.total.length - 2];
      const rank = c ? D.counties.slice().sort((a, b) => MEAS.rate.v(b) - MEAS.rate.v(a)).findIndex((x) => x.id === c.id) + 1 : null;
      return { kicker: c ? c.type + ' county' : 'Statewide', title: c ? c.name : 'California', sub: (pct(r[I.ret], r[I.issued])) + '% returned' + (rank ? ' · #' + rank + ' of 58' : ''),
        rows: [['Registered voters', f(c ? c.reg : D.reg)], ['Ballots issued', f(r[I.issued])], ['Returned', f(r[I.ret])], ['Latest report', p ? sg(r[I.ret] - p[I.ret]) : '—'], ['Drop box', pct(r[ix('dropbox')], r[I.ret], 0) + '%'], ['Mail', pct(r[ix('mail')], r[I.ret], 0) + '%'], ['Accepted', pct(r[I.acc], r[I.ret]) + '%']].map(([k, v]) => ({ k, v })),
        href: c ? '/ca/' + c.id : '', hasLink: !!c && c.id !== this.props.cid, hint: c ? '' : 'Hover or tap a county on the map to see its numbers here.' };
    };
    const map = {
      opts: Object.entries(MEAS).map(([k, m]) => ({ label: m.label, ...pill(S.mapM, k), pick: () => this.setState({ mapM: k }) })),
      shapes, vb: '0 0 ' + M.w + ' ' + M.h, ramp: VF.rampCss(meas.kind),
      lo: meas.fmt(meas.log ? Math.pow(10, lo) : lo), hi: meas.fmt(meas.log ? Math.pow(10, hi) : hi),
      leave: () => this.setState({ hover: null }), side: sideOf(hc), hl: hlShape ? hlShape.d : '', hasHl: !!hlShape
    };
    const topRate = vals.slice().sort((a, b) => MEAS.rate.v(b.c) - MEAS.rate.v(a.c));
    const byType = {}; D.counties.forEach((c) => { const r = c.rows[c.rows.length - 1]; const o = byType[c.type] || (byType[c.type] = { i: 0, r: 0, n: 0 }); o.i += r[I.issued]; o.r += r[I.ret]; o.n++; });
    take.map = 'Highest return rate: ' + topRate[0].c.name + ', at ' + MEAS.rate.v(topRate[0].c).toFixed(1) + '%';
    take.types = Object.entries(byType).sort((a, b) => b[1].r / b[1].i - a[1].r / a[1].i).map(([k, o]) => k + ' counties ' + (o.r / o.i * 100).toFixed(1) + '%').join(' · ');

    // ----- County table
    const sumRow = (c) => {
      const r = c.rows[c.rows.length - 1], n = c.rows.length, wa = c.rows.find((x) => x[0] === addDays(r[0], -7));
      return { c, reg: c.reg, issued: r[I.issued], ret: r[I.ret], rate: r[I.ret] / r[I.issued], latest: n > 1 ? r[I.ret] - c.rows[n - 2][I.ret] : null, week: wa ? r[I.ret] - wa[I.ret] : null,
        drop: r[ix('dropbox')] / Math.max(1, r[I.ret]), mail: r[ix('mail')] / Math.max(1, r[I.ret]), pend: r[I.ret] - r[I.acc], accr: r[I.acc] / Math.max(1, r[I.ret]) };
    };
    const COLS = [['name', 'County', 'left'], ['reg', 'Registered', 'right'], ['issued', 'Ballots issued', 'right'], ['rate', 'Returned', 'right'], ['week', 'Past week', 'right'], ['drop', 'Drop box', 'right'], ['mail', 'Mail', 'right'], ['accr', 'Accepted', 'right'], ['pend', 'Not yet accepted', 'right']];
    let list = D.counties.map(sumRow);
    const q = S.q.trim().toLowerCase();
    if (q) list = list.filter((o) => o.c.name.toLowerCase().includes(q));
    const sk = S.sortKey, dir = S.sortDir;
    list.sort((a, b) => sk === 'name' ? a.c.name.localeCompare(b.c.name) * dir : ((a[sk] ?? -1e15) - (b[sk] ?? -1e15)) * dir);
    const maxRate = Math.max(...D.counties.map((c) => sumRow(c).rate));
    const shown = S.all || q ? list : list.slice(0, 15);
    const table = {
      cols: COLS.map(([k, l, al]) => ({ label: l, align: al, arrow: sk === k ? (dir < 0 ? '↓' : '↑') : '', pick: () => this.setState({ sortKey: k, sortDir: sk === k ? -dir : k === 'name' ? 1 : -1 }) })),
      rows: shown.map((o) => ({ href: '/ca/' + o.c.id, name: o.c.name, type: o.c.type, reg: f(o.reg), issued: f(o.issued), p: (o.rate * 100).toFixed(1), v: f(o.ret), w: (o.rate / maxRate * 100).toFixed(1),
        week: sg(o.week), drop: (o.drop * 100).toFixed(0) + '%', mail: (o.mail * 100).toFixed(0) + '%', accr: (o.accr * 100).toFixed(1) + '%', pend: f(o.pend), on: county && o.c.id === county.id ? '#FFF6D1' : 'transparent' })),
      allLabel: S.all ? 'Show fewer' : 'Show all 58', toggle: () => this.setState({ all: !S.all }), regLabel: D.regLabel || 'report of registration', onSearch: (ev) => this.setState({ q: ev.target.value }),
      count: q ? list.length + ' of 58 counties' : 'Showing ' + shown.length + ' of 58',
      quick: [['name', 'A–Z'], ['reg', 'Size'], ['rate', 'Return rate']].map(([k, l]) => ({ label: l, ...pill(sk, k), pick: () => this.setState({ sortKey: k, sortDir: k === 'name' ? 1 : -1 }) }))
    };

    // ----- Every report (county page and statewide)
    const flagged = new Set((D.corrections || []).filter((x) => x.county === (county && county.id)).map((x) => x.d));
    const reports = rows.map((r, i) => {
      const p = i ? rows[i - 1] : null, gap = p ? Math.round((parse(r[0]) - parse(p[0])) / 864e5) : 0;
      return { d: dmd(r[0]), posted: posted(D, r[0]) || '—', ret: f(r[I.ret]), add: p ? sg(r[I.ret] - p[I.ret]) + (gap > 1 ? ' (' + gap + ' days)' : '') : 'first saved',
        mail: p ? sg(r[ix('mail')] - p[ix('mail')]) : f(r[ix('mail')]), drop: p ? sg(r[ix('dropbox')] - p[ix('dropbox')]) : f(r[ix('dropbox')]),
        inper: p ? sg(r[ix('dropoff')] + r[ix('votecenter')] - p[ix('dropoff')] - p[ix('votecenter')]) : f(r[ix('dropoff')] + r[ix('votecenter')]),
        acc: f(r[I.acc]), pend: f(r[I.ret] - r[I.acc]), rate: pct(r[I.ret], r[I.issued]) + '%', flag: flagged.has(r[0]) ? 'Includes a county correction (a count went down)' : '' };
    }).reverse();

    // ----- Header bits
    const items = D.counties.slice().sort((a, b) => a.name.localeCompare(b.name)).map((c) => ({ value: c.id, text: c.name, sub: c.type }));
    const best = (fn) => D.counties.reduce((a, b) => (fn(b) > fn(a) ? b : a), D.counties[0]);
    const jumps = [['#1 in size', best((c) => c.reg || 0), null], ['#1 return rate', best(MEAS.rate.v), (c) => MEAS.rate.v(c).toFixed(1) + '%']]
      .map(([k, c, v]) => ({ k, name: c.short, v: v ? v(c) : '', href: '/ca/' + c.id }));
    // Top-right map: hover shows the county and its return rate; click opens it.
    const mt = S.miniTip;
    const miniShapes = M.shapes.map((s, k) => {
      const c = D.counties.find((x) => x.id === s.id), hot = mt && mt.id === s.id;
      return { d: s.d, fill: hot || (county && s.id === county.id) ? '#ffd23f' : county ? '#C9CDD4' : VF.ramp((MEAS.rate.v(c) - MEAS.rate.v(topRate[57].c)) / (MEAS.rate.v(topRate[0].c) - MEAS.rate.v(topRate[57].c)), 'g'),
        stroke: hot ? '#121417' : '#FFFFFF', delay: (k * 10) + 'ms', go: () => { location.href = '/ca/' + s.id; },
        move: (ev) => this.setState({ miniTip: { id: s.id, x: ev.clientX, y: ev.clientY } }) };
    });
    const tc = mt && D.counties.find((x) => x.id === mt.id);
    const miniTip = tc ? { on: true, name: tc.name, sub: MEAS.rate.v(tc).toFixed(1) + '% returned · ' + f(tc.rows[tc.rows.length - 1][I.ret]) + ' ballots',
      x: Math.min(mt.x + 16, window.innerWidth - 250) + 'px', y: (mt.y + 18) + 'px' } : { on: false };
    const rank = county ? D.counties.slice().sort((a, b) => (b.reg || 0) - (a.reg || 0)).findIndex((c) => c.id === county.id) + 1 : 0;

    return {
      ...base, loading: false, ready: true, title: county ? county.name : 'California',
      subline: county ? county.type + ' county · #' + rank + ' of 58 by registered voters' : '', miniTip, miniLeave: () => this.setState({ miniTip: null }),
      find: { items, pick: (v) => { location.href = '/ca/' + v; } }, jumps, mini: { shapes: miniShapes, vb: map.vb, w: S.narrow ? 130 : county ? 190 : 240 },
      hero, flow, chart, take, rhythm, map, table, reports, where,
      upd: 'Each report covers through 11:59 PM Pacific the day before it posts. Latest: through ' + dmd(D.asOf) + (posted(D, D.asOf) ? ', posted ' + posted(D, D.asOf) + ' PT' : '') + '.',
      notes: county ? '' : 'California mails every active registered voter a ballot. Issued counts each voter once. Returned counts ballots voters sent back, by how they returned them; accepted is the subset the county has checked and accepted. Ballots cast in person at vote centers and polling places are not in these counts.',
      back: county ? { href: '/ca', l: 'All of California' } : null
    };
  }
}
function addDays(iso, n) { return VF.addDays(iso, n); }
function niceStep(raw) { const p = Math.pow(10, Math.floor(Math.log10(Math.max(1, raw)))), m = raw / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p; }
function posted(D, d) {
  const r = (D.reports || []).find((x) => x.d === d); if (!r || !r.published) return '';
  const m = r.published.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/); if (!m) return '';
  const h = +m[4], dd = new Date(+m[1], +m[2] - 1, +m[3]);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dd.getDay()] + ' ' + (h % 12 || 12) + ':' + m[5] + ' ' + (h < 12 ? 'AM' : 'PM');
}
VF.page('ca', CaPage);

/* /ca/about: California's About page; only the "data through" line is live. */
class CaAbout extends DCLogic {
  constructor(props) { super(props); this.state = { asOf: null }; }
  componentDidMount() {
    document.title = 'About California · VoteFlow';
    fetch('/ca/data.json').then((r) => r.json()).then((d) => this.setState({ asOf: d.asOf })).catch(() => {});
  }
  renderVals() {
    const a = this.state.asOf, d = a && new Date(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10));
    return { band: {}, miniTip: { on: false }, through: d ? d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : '…' };
  }
}
VF.page('ca-about', CaAbout);
