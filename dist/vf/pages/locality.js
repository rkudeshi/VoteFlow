class Locality extends DCLogic {
  constructor(props) {
    super(props);
    this.SRC = '/data/loc/' + props.lid + '.json';
    this.state = { narrow: window.innerWidth < 600, data: null, t: 0, now: Date.now(), eid: props.eid, method: 'all', measure: 'count', win: 'deadline', show: {}, chTick: 0, hi: null, cal: null, calM: 'early', calTick: 0, sdM: 'early', tip: null, pIdx: null, pMeasure: 'p', pMethod: 'all', pHover: null, playing: false };
  }
  componentDidMount() {
    this.clock = setInterval(() => this.setState({ now: Date.now() }), 60000);
    this.onScroll = () => { if (this.state.tip || this.state.hi != null) this.setState({ tip: null, hi: null }); };
    this.onResize = () => { const nw = window.innerWidth < 600; if (nw !== this.state.narrow) this.setState({ narrow: nw, hi: null }); };
    window.addEventListener('scroll', this.onScroll, { passive: true });
    window.addEventListener('resize', this.onResize);

    fetch(this.SRC).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }).then((data) => {
      const show = {}; data.elections.forEach((x) => { show[x.id] = true; });
      const eid = data.elections.some((x) => x.id === this.state.eid) ? this.state.eid : '2026';
      this.setState({ data, show, eid, pIdx: data.pdates.length - 1 });
      fetch('/data/va-map.json').then((r) => r.json()).then((vaMap) => this.setState({ vaMap })).catch(() => {});
      const s = performance.now();
      const step = (n) => { const t = Math.min(1, (n - s) / 1800); this.setState({ t }); if (t < 1) this.raf = requestAnimationFrame(step); };
      this.raf = requestAnimationFrame(step);
    }).catch(() => { location.replace(VF.stateUrl(this.props.eid)); });
  }
  componentDidUpdate() {
    const D = this.state.data; if (!D) return;
    const cur = D.elections.find((x) => x.id === this.state.eid);
    const path = VF.locUrl(D.id, this.state.eid);
    if (location.pathname.replace(/\/$/, '') !== path) history.replaceState(null, '', path);
    const title = D.name + (cur && this.state.eid !== '2026' ? ' · ' + cur.label : '') + ' · VoteFlow';
    if (document.title !== title) document.title = title;
  }
  componentWillUnmount() { document.body.classList.remove('vf-full'); cancelAnimationFrame(this.raf); clearInterval(this.clock); clearInterval(this.player); window.removeEventListener('scroll', this.onScroll); window.removeEventListener('resize', this.onResize); }
  tipAt(ev, kind, key) {
    const W = window.innerWidth, H = window.innerHeight;
    let x = ev.clientX + 18, y = ev.clientY + 18;
    if (x + 310 > W) x = ev.clientX - 318;
    if (y + 360 > H) y = Math.max(8, ev.clientY - 370);
    return { kind, key, x: Math.max(8, x), y };
  }
  renderVals() {
    const D = this.state.data;
    const f = (n) => n == null ? '—' : Math.round(n).toLocaleString('en-US');
    const fz = (n) => !n ? '–' : Math.round(n).toLocaleString('en-US');
    const short = (n) => n >= 1e6 ? (n / 1e6).toFixed(2).replace(/0$/, '') + 'M' : n >= 1e4 ? Math.round(n / 1000) + 'K' : n >= 1000 ? (n / 1000).toFixed(1) + 'K' : String(Math.round(n));
    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const DOWL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const parse = (s) => new Date(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
    const md = (s) => { const d = parse(s); return MON[d.getMonth()] + ' ' + d.getDate(); };
    const dmd = (s) => { const d = parse(s); return DOW[d.getDay()] + ' ' + MON[d.getMonth()] + ' ' + d.getDate(); };
    const pill = (cur, v) => ({ pressed: cur === v ? 'true' : 'false', bg: cur === v ? '#121417' : '#FFFFFF', fg: cur === v ? '#FFFFFF' : '#121417' });
    const hideTip = () => this.setState({ tip: null });

    const target = Date.UTC(2026, 10, 3, 11, 0, 0); // 6 AM Eastern (EST, UTC−5) on Nov 3
    const left = Math.max(0, target - this.state.now);
    const evStart = new Date(2026, 8, 18).getTime();
    const frac = Math.min(1, Math.max(0, (this.state.now - evStart) / (target - evStart)));
    const cdS = Math.floor(left % 6e4 / 1000);
    const cd = { label: left > 0 ? 'Election Day polls open in' : 'Polls are open', days: Math.floor(left / 864e5), h: String(Math.floor(left % 864e5 / 36e5)).padStart(2, '0'), m: String(Math.floor(left % 36e5 / 6e4)).padStart(2, '0'), s: String(cdS).padStart(2, '0'), anim: cdS % 2 ? 'fx-pa' : 'fx-pb', offset: (339.3 * frac).toFixed(1) };
    if (!D) return { loading: true, ready: false, ticker: [], tip: { on: false }, cd, band: { asOf: '…' }, hdr: { elections: [], locs: [] } };

    const e = this.state.t >= 1 ? 1 : 1 - Math.pow(2, -10 * this.state.t);
    const { eid } = this.state;
    const T = D.tIdx, TL = 'E–' + (46 - T);
    const EL = D.elections;
    const cur = EL.find((x) => x.id === eid) || EL[0];
    const live = cur.id === '2026';
    const cmpId = eid !== '2025' ? '2025' : '2024';
    const COLORS = { va: '#41557F' }; EL.forEach((x) => { COLORS[x.id] = VF.elColor(x.id, eid, cmpId); });
    if (this.recorded !== D.id) { this.recorded = D.id; VF.addRecent(D.id); }
    const L = { name: D.name, region: D.region, rankV: D.rankV, rankP: cur.rankP || D.rankP, rankR: cur.rankR || D.rankR };
    const eDate = parse(cur.date);
    // Timelines end at the legal mail deadline; a past election also shows later days that added ballots.
    let curLast = -1; if (cur.series) { const S = cur.series; for (let i = 1; i < 53; i++) if ((S.e[i] || 0) > (S.e[i - 1] || 0) || (S.m[i] || 0) > (S.m[i - 1] || 0)) curLast = i; }
    const endI = Math.min(52, live ? VF.idxOf(cur.date, VF.deadline(cur.date)) : Math.max(VF.idxOf(cur.date, VF.deadline(cur.date)), curLast));
    const typeLabel = cur.type + ' election · ' + DOWL[eDate.getDay()] + ', ' + MON[eDate.getMonth()] + ' ' + eDate.getDate() + ', ' + eDate.getFullYear();

    const elChips = EL.map((x) => { const on = x.id === eid; return { label: x.label.replace('November ', 'Nov ').replace('April 2026 special', 'Apr 2026 · special'), sub: f(x.total) + (x.final ? ' final' : ' so far'), sub2: (x.total / x.reg * 100).toFixed(1) + '% turnout',
      pressed: on ? 'true' : 'false', border: on ? '#121417' : '#D3D7DE', bg: on ? '#121417' : '#FFFFFF', fg: on ? '#FFFFFF' : '#121417',
      pick: () => this.setState({ eid: x.id, show: Object.assign({}, this.state.show, { [x.id]: true }), cal: null, hi: null, tip: null, calTick: this.state.calTick + 1, chTick: this.state.chTick + 1 }) }; });

    const tot = cur.total, k = live ? e : 1;
    // Size both hero numbers so they share one line when the card is wide enough (Unbounded 700 glyph widths, in em).
    const emW = (s) => Array.from(s).reduce((a, ch) => a + (ch === ',' || ch === '.' ? 0.3 : ch === '%' ? 1.29 : ch === '1' ? 0.52 : 0.9) - 0.04, 0);
    const heroFs = (pct, n) => 'clamp(28px, calc((100cqi - var(--hg) - 8px) / ' + (emW(pct + '%') + emW(f(n))).toFixed(2) + '), 96px)';
    const hero = { pctLbl: live ? 'turnout so far' : 'early turnout', fs: heroFs((tot / cur.reg * 100).toFixed(1), tot), live, past: !live, kicker: live ? 'Early votes cast · through ' + dmd(D.rows[D.rows.length - 1].d) : cur.label + ' · final early vote',
      votes: f(tot * k), pct: (tot / cur.reg * 100 * k).toFixed(1), reg: f(cur.reg), // A same-night dashboard count gets a quiet footnote under the in-person/mail bar.
      provNote: (() => { const pr = live ? D.rows[D.rows.length - 1] : null; if (!pr || !pr.prov) return '';
        const dal = D.rows.filter((r) => !r.prov).pop(); return dmd(pr.d) + ' is a same-night count from the ' + pr.prov + (pr.dm == null ? '; mail is through ' + dmd(dal ? dal.d : pr.d) : '') + '.'; })(),
      ip: f(cur.early * k), m: f(cur.mail * k), ipW: (cur.early / tot * 100).toFixed(1), mW: (cur.mail / tot * 100).toFixed(1),
      dateLabel: MON[eDate.getMonth()] + ' ' + eDate.getDate() + ', ' + eDate.getFullYear(), typeLabel, atT: f(cur.atT), TL, eDayLabel: DOW[eDate.getDay()] + ' ' + MON[eDate.getMonth()] + ' ' + eDate.getDate() + ', ' + eDate.getFullYear() };
    // Pace chips, newest election first. The live election compares at today's point; a past
    // election compares with the live one at today's point and with other past ones in total.
    const refOrder = ['2026', '2026-special', '2025', '2024', '2022', '2021', '2020'];
    const ref = refOrder.map((id) => EL.find((x) => x.id === id)).filter((x) => x && x.id !== eid
      && (live ? x.atT : x.id === '2026' ? cur.atT && x.atT : x.total)).slice(0, 4);
    const paceChips = ref.map((x) => { const sameDay = live || x.id === '2026';
      const ratio = sameDay ? cur.atT / x.atT : cur.total / x.total;
      return { ratio: VF.vsText(ratio), label: 'vs. ' + x.label.replace(' special', '') + (sameDay ? ' at this point' : ' overall') }; });
    const satLine = D.sat ? D.sat + (D.sat === 1 ? ' satellite site · ' : ' satellite sites · ') + (D.next === 'open' ? 'all open' : 'next open ' + dmd(D.next)) : '';

    // flow
    const reg = cur.reg, ip = cur.early, ret = cur.mail;
    const fx = D.fxMail && D.fxMail[cur.id];
    const out = cur.out != null ? cur.out : (fx && fx.sent ? Math.max(0, fx.sent - ret) : null);
    const req = out != null ? ret + out : null;
    const pc = (a, b) => (a / b * 100).toFixed(a / b < 0.1 ? 1 : 0) + '%';
    const engaged = ip + (req != null ? req : ret), none = reg - engaged;
    const noneName = live ? 'No early ballot yet' : 'Did not vote early';
    // County post/drop-box split, kept visible while the county report lags the state's newer days.
    const hasPBflow = req != null && fx && fx.post != null && fx.box != null && fx.post + fx.box > 0;
    const pbNote = hasPBflow && fx.through !== cur.through ? 'By mail vs. drop box comes from the county report through ' + dmd(fx.through) + '; the newer days are waiting on the next county report.' : '';
    // Bars view: three plain bars on one palette (green in person, purple mail, light purple drop
    // box, gray not yet), each with its total and a one-line legend.
    const vseg = (name, v, of, bg, fg) => ({ name, val: f(v), share: pc(v, of), w: Math.max(0, v / of * 100).toFixed(2), bg, fg, inside: v / of >= 0.16 ? pc(v, of) : '' });
    const cG = ['#00A37A', '#FFFFFF'], cP = ['#7C4DDB', '#FFFFFF'], cLP = ['#C4AEF6', '#121417'], cLG = ['#BFE9D9', '#121417'], cGR = ['#DCDFE5', '#121417'];
    const vrows = [{ title: 'Registered voters', total: f(reg), unit: 'registered', segs: [vseg('Voted early in person', ip, reg, ...cG), vseg(req != null ? 'Requested a mail ballot' : 'Returned a mail ballot', req != null ? req : ret, reg, ...cP), vseg(noneName, none, reg, ...cGR)] }];
    const boxShare = hasPBflow ? fx.box / (fx.post + fx.box) : 0, retBox = Math.round(ret * boxShare);
    vrows.push({ title: 'Early ballots cast', total: f(ip + ret), unit: 'ballots', segs: [vseg('In person', ip, ip + ret, ...cG)].concat(hasPBflow
      ? [vseg('By mail', ret - retBox, ip + ret, ...cP), vseg('Drop box', retBox, ip + ret, ...cLP)] : [vseg('By mail', ret, ip + ret, ...cP)]) });
    const sw = fx && fx.extras ? fx.extras.switched : null;
    if (hasPBflow && fx.sent) {
      const back = fx.post + fx.box;
      vrows.push({ title: 'Mail ballots sent', total: f(fx.sent), unit: 'mailed or emailed', segs: [vseg('Returned by mail', fx.post, fx.sent, ...cP), vseg('Drop box', fx.box, fx.sent, ...cLP)]
        .concat(sw != null ? [vseg('Voted in person instead', sw, fx.sent, ...cLG)] : [])
        .concat([vseg(live ? 'Not returned yet' : 'Never returned', Math.max(0, fx.sent - back - (sw || 0)), fx.sent, ...cGR)]) });
    } else if (req != null) {
      vrows.push({ title: 'Mail ballots requested', total: f(req), unit: 'requested', segs: [vseg('Returned', ret, req, ...cP), vseg(live ? 'Not returned yet' : 'Never returned', out, req, ...cGR)] });
    }
    const undeliv = fx && fx.extras && fx.extras.undeliverable != null ? ' ' + f(fx.extras.undeliverable) + ' mail ballots were undeliverable.' : '';
    const vb = { rows: vrows, note: hasPBflow ? 'By mail vs. drop box and mail ballots sent come from Fairfax County’s own report through ' + dmd(fx.through) + '.' + undeliv : '' };
    const fcView = this.state.flowView || 'chart';
    const fcOpts = [['chart', 'Flow chart'], ['bars', 'Bar chart']].map(([v, label]) => Object.assign({ label, pick: () => this.setState({ flowView: v }) }, pill(fcView, v)));
    const fcW = (a, b) => Math.max(1.5, Math.min(100, a / b * 100)).toFixed(1);
    const fcTot = ip + ret;
    const fcPB = hasPBflow ? fx.post + fx.box : 1;
    const fcBig = !!this.state.fcBig;
    const fc = { bigCls: fcBig ? 'fx-big' : '', tapHint: fcBig ? 'Tap to go back to the flow chart' : 'Tap the chart for big numbers',
      tap: () => { if (window.innerWidth <= 760) this.setState({ fcBig: !fcBig }); }, on: fcView === 'chart', off: fcView !== 'chart', hasReq: req != null, hasPB: !!hasPBflow, pbNote,
      total: { title: 'Total voters', val: f(reg), w: fcW(fcTot, reg), pct: pc(fcTot, reg), cap: 'have already voted early · ' + f(fcTot) + ' ballots' },
      ip: { title: 'Voted early in person', val: f(ip), w: fcW(ip, reg), pct: pc(ip, reg), cap: 'of registered voters' },
      mail: { title: req != null ? 'Requested a mail ballot' : 'Returned a mail ballot', val: f(req != null ? req : ret), w: fcW(req != null ? req : ret, reg), pct: pc(req != null ? req : ret, reg), cap: 'of registered voters' },
      ret: { title: 'Returned', val: f(ret), w: req ? fcW(ret, req) : 0, pct: req ? pc(ret, req) : '', cap: 'of mail requests' },
      out: { title: live ? 'Outstanding' : 'Never returned', val: f(out), w: req ? fcW(out || 0, req) : 0, pct: req ? pc(out || 0, req) : '', cap: 'of mail requests' },
      post: { title: 'By mail', val: hasPBflow ? f(fx.post) : '', w: hasPBflow ? fcW(fx.post, fcPB) : 0, pct: hasPBflow ? pc(fx.post, fcPB) : '', cap: 'of returned mail ballots' },
      box: { title: 'By dropbox', val: hasPBflow ? f(fx.box) : '', w: hasPBflow ? fcW(fx.box, fcPB) : 0, pct: hasPBflow ? pc(fx.box, fcPB) : '', cap: 'of returned mail ballots' } };
    // comparison
    const { method, measure, win, show, hi } = this.state;
    // Statewide 2026 for comparison, scaled to this locality's registered voters (so "% of
    // registered" is the statewide share and "Ballots" is the statewide pace at this size).
    const e26s = EL.find((x) => x.id === '2026'), S = D.state26;
    const stEl = e26s && e26s.series && S ? { id: 'va', label: 'Virginia 2026', type: 'Statewide',
      series: { e: S.e.map((v) => v == null ? null : v * e26s.series.r / S.r), m: S.m.map((v) => v == null ? null : v * e26s.series.r / S.r), r: e26s.series.r } } : null;
    const visEl = EL.filter((x) => x.series && (show[x.id] || x.id === eid)).concat(stEl && show.va !== false ? [stEl] : []);
    const val = (x, i) => { const s = x.series; if (!s || s.e[i] == null) return null; const v = method === 'all' ? s.e[i] + s.m[i] : method === 'early' ? s.e[i] : s.m[i]; return measure === 'pct' ? v / s.r * 100 : v; };
    const n = win === 'today' ? T + 1 : endI + 1;
    const e26 = EL.find((x) => x.id === '2026'), e25 = EL.find((x) => x.id === '2025');
    const projVal = (i) => { const r23 = val(e25, T), ri = val(e25, i), b = val(e26, T); return r23 && ri != null && b != null ? b * ri / r23 : null; };
    const hasProj = win !== 'today' && e25 && visEl.includes(e26) && !!val(e25, T);
    let peak = 0; visEl.forEach((x) => { for (let i = 0; i < n; i++) { const v = val(x, i); if (v != null) peak = Math.max(peak, v); } });
    if (hasProj) for (let i = T; i < n; i++) { const v = projVal(i); if (v != null) peak = Math.max(peak, v); }
    const units = measure === 'pct' ? [0.25, 0.5, 1, 2, 2.5, 5, 10, 12.5] : [250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000];
    const top = Math.min(...units.map((u) => Math.ceil(Math.max(peak, 1) * 1.04 / (8 * u)) * 8 * u));
    // Taller chart on phones; a right gutter holds the line-end election labels.
    const narrow = this.state.narrow, CB = narrow ? 1000 : 500, XR = narrow ? 830 : 905;
    const X = (i) => 60 + i / (n - 1) * (XR - 60);
    const Y = (v) => CB - v / top * (CB - 20);
    const fmtV = (v) => v == null ? '—' : measure === 'pct' ? v.toFixed(2) + '%' : f(v);
    const fmtT = (v) => measure === 'pct' ? (+v.toFixed(2)) + '%' : short(v);
    const pathOf = (fn) => { let d = ''; let pen = false; for (let i = 0; i < n; i++) { const v = fn(i); if (v == null) { pen = false; continue; } d += (pen ? ' L' : 'M') + X(i).toFixed(1) + ',' + Y(v).toFixed(1); pen = true; } return d; };
    const lines = visEl.slice().sort((a, b) => (a.id === eid) - (b.id === eid)).map((x) => ({ d: pathOf((i) => val(x, i)), color: COLORS[x.id], w: x.id === eid ? (narrow ? 10 : 6) : (narrow ? 5 : 3) }));
    // Statewide pace reads as a shaded backdrop (a filled area under its line), so it stands
    // apart from the other elections' lines instead of being one more thin line among them.
    let stArea = '';
    if (stEl && show.va !== false) { let a = -1, b = -1; for (let i = 0; i < n; i++) if (val(stEl, i) != null) { if (a < 0) a = i; b = i; }
      if (a >= 0) stArea = pathOf((i) => val(stEl, i)) + ' L' + X(b).toFixed(1) + ',' + CB + ' L' + X(a).toFixed(1) + ',' + CB + ' Z'; }
    const proj = hasProj ? pathOf((i) => i < T ? null : projVal(i)) : '';
    const yt = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((j) => ({ y: CB - j * (CB - 20) / 8, ty: CB + 4 - j * (CB - 20) / 8, l: fmtT(top * j / 8), stroke: j === 0 ? '#121417' : '#ECEEF2' }));
    const dset = win === 'today' ? [45, 40, 35, 30, 25].filter((d) => 46 - d <= T) : [40, 30, 20, 10, 0].concat(endI > 50 ? [46 - endI] : []); // skip an after-label that would crowd Election Day
    const xt = dset.map((d) => ({ x: X(46 - d).toFixed(1), l: d === 0 ? 'Election Day' : d < 0 ? (-d) + ' days after' : d + ' days' }));
    const todayX = X(T);
    const hits = Array.from({ length: n }, (_, i) => ({ x: (X(i) - (XR - 60) / (n - 1) / 2).toFixed(1), w: ((XR - 60) / (n - 1)).toFixed(1), enter: () => this.setState({ hi: i }) }));
    const hasHi = hi != null && hi < n;
    let hiRows = [], hiDots = [], hiTitle = '';
    if (hasHi) {
      const dd = new Date(eDate); dd.setDate(dd.getDate() - (46 - hi));
      hiTitle = (hi <= 46 ? 'E–' + (46 - hi) : 'E+' + (hi - 46)) + ' · ' + DOW[dd.getDay()] + ' ' + MON[dd.getMonth()] + ' ' + dd.getDate() + ', ' + dd.getFullYear();
      const base = val(cur, hi);
      visEl.forEach((x) => { const v = val(x, hi); hiRows.push({ color: COLORS[x.id], label: x.label, val: fmtV(v), rel: x.id !== eid && base != null && v ? Math.round(base / v * 100) + '%' : '' }); if (v != null) hiDots.push({ y: Y(v).toFixed(1), color: COLORS[x.id] }); });
      if (hasProj && hi > T) { const pv = projVal(hi); if (pv != null) { hiRows.unshift({ color: '#121417', label: '2026 projected', val: fmtV(pv), rel: '' }); hiDots.push({ y: Y(pv).toFixed(1), color: '#121417' }); } }
    }
    const ends = [];
    visEl.map((x) => ({ k: x.id, label: x.label, color: COLORS[x.id], cur: x.id === eid, v: (i) => val(x, i) })).forEach((L0) => { let li = -1; for (let i = 0; i < n; i++) if (L0.v(i) != null) li = i;
      const pe = hasProj && L0.k === '2026' ? projVal(n - 1) : null; if (pe != null) li = n - 1;
      if (li >= 0) ends.push({ x: X(li) + 10, y: Y(pe != null ? pe : L0.v(li)), t: L0.k === 'va' ? 'Statewide' : L0.label.replace('November ', 'Nov ').replace('April ', 'Apr ').replace(' special', ''), color: L0.color, fw: L0.cur || L0.k === 'va' ? 700 : 500 }); });
    // Spread labels that end at the same x so they don't overlap.
    const lgap = narrow ? 32 : 15;
    const groups = {}; ends.forEach((e2) => { (groups[Math.round(e2.x / 40)] = groups[Math.round(e2.x / 40)] || []).push(e2); });
    Object.values(groups).forEach((g) => { g.sort((a, b) => a.y - b.y);
      for (let i = 1; i < g.length; i++) if (g[i].y - g[i - 1].y < lgap) g[i].y = g[i - 1].y + lgap;
      const over = g[g.length - 1].y - CB; if (over > 0) { g[g.length - 1].y = CB; for (let i = g.length - 2; i >= 0; i--) if (g[i + 1].y - g[i].y < lgap) g[i].y = g[i + 1].y - lgap; } });
    ends.forEach((e2) => { e2.x = e2.x.toFixed(1); e2.y = e2.y.toFixed(1); });
    const ch = { stArea, revCls: this.state.chTick % 2 ? 'fx-ra' : 'fx-rb', fadeCls: this.state.chTick % 2 ? 'fx-fa' : 'fx-fb', todayY: narrow ? 28 : 12, ends, vb: '-20 0 1020 ' + (CB + 40), b: CB, b6: CB + 6, b26: CB + (narrow ? 40 : 26), b10: CB + 10, todayLbl: 'THROUGH ' + md(D.asOf).toUpperCase(), lines, hasProj, proj, yt, xt, hits, anim: this.state.chTick % 2 ? 'fx-a' : 'fx-b',
      todayX: todayX.toFixed(1), todayLX: (win === 'today' ? todayX - 8 : todayX + 8).toFixed(1), todayAnchor: win === 'today' ? 'end' : 'start',
      yTitle: measure === 'pct' ? 'Share of registered voters' : 'Early ballots (running total)',
      hasHi, hiX: hasHi ? X(hi).toFixed(1) : 0, hiRows, hiDots, hiTitle, tipLeft: hasHi ? ((X(hi) + 20) / 10.2).toFixed(1) : 0, tipShift: hasHi && X(hi) > 560 ? 'calc(-100% - 16px)' : '16px',
      leave: () => this.setState({ hi: null }),
      note: 'Thick black line: ' + cur.label + '; gray: ' + (EL.find((x) => x.id === cmpId) || {}).label + '; light gray: other elections.' + (stEl && show.va !== false ? ' Shaded area (“Statewide”): Virginia statewide in 2026, scaled to this locality’s registered voters.' : '') + ' Tooltip’s right column: ' + cur.label + ' as a share of that election on the same day.' + (hasProj ? ' Dotted line: where 2026 lands if it follows 2025’s pace from today.' : '') };
    const bump = { hi: null, chTick: this.state.chTick + 1 };
    const opt = (label, key, cur2, list) => ({ label, opts: list.map(([v, l]) => Object.assign({ label: l, pick: () => this.setState(Object.assign({ [key]: v }, key.startsWith('p') ? {} : bump)) }, pill(cur2, v))) });
    const ctrls = [
      opt('Method', 'method', method, [['all', 'All early'], ['early', 'In person'], ['mail', 'By mail']]),
      opt('Measure', 'measure', measure, [['count', 'Ballots'], ['pct', '% of registered']]),
      opt('Timeline', 'win', win, [['today', live ? 'Through today' : 'Through same point'], ['deadline', 'Through election end']])
    ];
    const years = EL.filter((x) => x.series).map((x) => { const on = show[x.id] || x.id === eid; return { label: (x.label).replace('November ', 'Nov ').replace('April 2026 special', 'Apr 2026'), type: x.type, color: COLORS[x.id], on, locked: x.id === eid, border: on ? COLORS[x.id] : '#D3D7DE', bg: on ? '#FFFFFF' : '#F5F6F8', op: on ? 1 : 0.6,
      toggle: () => { if (x.id !== eid) this.setState(Object.assign({ show: Object.assign({}, show, { [x.id]: !show[x.id] }) }, bump)); } }; });
    if (stEl) { const on = show.va !== false; years.unshift({ label: 'Virginia 2026', type: 'Statewide pace', color: COLORS.va, on, locked: false, border: on ? COLORS.va : '#D3D7DE', bg: on ? '#EEF1F8' : '#F5F6F8', op: on ? 1 : 0.6,
      toggle: () => this.setState(Object.assign({ show: Object.assign({}, show, { va: !on }) }, bump)) }); }

    // daily rows
    let drows = [];
    if (live) drows = D.rows.map((r) => Object.assign({}, r));
    else {
      const s = cur.series;
      for (let i = 0; i <= 52; i++) {
        if (s.e[i] == null) continue;
        const dd = new Date(eDate); dd.setDate(dd.getDate() - (46 - i));
        const pe = i > 0 && s.e[i - 1] != null ? s.e[i - 1] : 0, pmm = i > 0 && s.m[i - 1] != null ? s.m[i - 1] : 0;
        drows.push({ d: iso(dd), de: s.e[i] - pe, dm: s.m[i] - pmm, e: s.e[i], m: s.m[i] });
      }
    }
    const byDate = {}; drows.forEach((r) => { byDate[r.d] = r; });
    const satOpens = {}; D.sites.forEach((s) => { if (s.satellite) satOpens[s.firstOpen] = (satOpens[s.firstOpen] || 0) + 1; });
    const SITE_NAMES = { government_center: 'Government Center', north_county: 'North County', mt_vernon: 'Mount Vernon', burke: 'Burke Centre', centreville: 'Centreville', franconia: 'Franconia', great_falls: 'Great Falls', herndon_fortnightly: 'Herndon Fortnightly', jim_scott: 'Jim Scott', lorton: 'Lorton', mason: 'Mason', mclean: 'McLean', sully: 'Sully', thomas_jefferson: 'Thomas Jefferson', tysons_pimmit: 'Tysons-Pimmit', west_springfield: 'West Springfield', laurel_hill: 'Laurel Hill', providence: 'Providence', gerry_hyland: 'Gerry Hyland', ...(D.siteLabels || {}) };
    const keyFor = (name) => { if (D.siteKeys) return D.siteKeys[name]; const low = name.toLowerCase(); if ((low.startsWith('registrar') || low.includes('government center')) && D.id === 'fairfax-county') return 'government_center'; const ks = Object.keys(SITE_NAMES).filter((kk) => kk !== 'government_center'); return ks.find((kk) => low.includes(SITE_NAMES[kk].toLowerCase())) || ks.find((kk) => low.startsWith(SITE_NAMES[kk].toLowerCase().split(/[ -]/)[0])); };
    const wxOf = (w) => w ? w.l + ', ' + w.hi + '°/' + w.lo + '°' + (w.p >= 0.01 ? ' · ' + w.p.toFixed(2) + '″' : '') : '—';
    const isWet = (w) => !!(w && (w.wet || w.p >= 0.25 || /rain|drizzle|shower|storm/i.test(w.l)));

    // calendar
    const calM = this.state.calM;
    const dv = (r) => calM === 'all' ? r.de + r.dm : calM === 'early' ? r.de : r.dm;
    const startE = new Date(eDate); startE.setDate(startE.getDate() - 46);
    const endK = VF.addDays(cur.date, endI - 46);
    const calStart = new Date(startE); calStart.setDate(calStart.getDate() - calStart.getDay());
    const maxDay = Math.max(1, ...drows.map(dv));
    const firstK = iso(startE), eK = cur.date;
    const defaultK = live ? D.asOf : eK;
    const selK = this.state.cal || defaultK;
    const cal = [];
    for (let i = 0; i < 63; i++) {
      const d = new Date(calStart); d.setDate(calStart.getDate() + i);
      const k2 = iso(d), r = byDate[k2];
      const inWin = k2 >= firstK && k2 <= endK, isE = k2 === eK, afterE = k2 > eK;
      const sc = live ? D.sched[k2] : null;
      let bg = '#FFFFFF', fg = '#121417', border = '2px solid #ECEEF2', kText = '';
      if (r) { const v = dv(r); const q = v / maxDay; const cc = v ? VF.calColor(q) : { bg: '#FFFFFF', fg: '#121417' };
        bg = cc.bg; fg = cc.fg; border = afterE ? '2px dashed #5B2FB8' : !v ? '2px solid #D3D7DE' : '2px solid transparent'; kText = v ? f(v) : '–'; }
      else if (isE) { bg = '#FFD23F'; border = '2px solid #121417'; kText = 'Vote'; }
      else if (afterE) { bg = '#F8F9FB'; border = '2px dashed #B7BCC6'; kText = 'Mail'; }
      else if (inWin) { bg = '#F5F6F8'; border = '2px dashed #C6CBD4'; }
      if (selK === k2) border = '3px solid #121417';
      cal.push({ day: d.getDate() === 1 || k2 === firstK ? MON[d.getMonth()] + ' ' + d.getDate() : String(d.getDate()), k: kText,
        hol: isE ? '' : VF.dayFlag(k2, eK) ? (this.state.narrow ? 'Hol.' : 'Holiday') : '', holFull: VF.dayFlag(k2, eK),
        mark: this.state.narrow ? (isE ? '★' : sc ? sc.n + (satOpens[k2] ? '▲' : '') : '') : isE ? '★ Election Day' : sc ? sc.n + (sc.n === 1 ? ' site' : ' sites') + (satOpens[k2] ? ' ▲' : '') : afterE ? 'mail arriving' : '', wet: !!(r && isWet(r.w)),
        bg, fg, border, vis: inWin ? 'visible' : 'hidden', display: i >= 56 && !inWin ? 'none' : 'flex', pressed: selK === k2 ? 'true' : 'false',
        anim: this.state.calTick % 2 ? 'fx-pa' : 'fx-pb', delay: (i * 10) + 'ms', aria: dmd(k2) + (r ? ': ' + f(dv(r)) + ' ballots' : ''),
        move: (ev) => { if (inWin) this.setState({ cal: k2, tip: this.tipAt(ev, 'cal', k2) }); } });
    }
    const calInfo0 = (kk) => {
      const sd = parse(kk), sr = byDate[kk], ssc = live ? D.sched[kk] : null;
      const dayN = Math.round((sd - startE) / 864e5) + 1;
      const openList = ssc ? ssc.open.map(([nm, hrs]) => { const key = keyFor(nm); const cnt = sr && sr.site && key && sr.site[key] != null ? f(sr.site[key]) : ''; return { k: nm + ' (' + hrs + ')', v: cnt }; }) : [];
      const base = { hasList: openList.length > 0, listHead: openList.length === 1 ? '1 site open' : openList.length + ' sites open', list: openList };
      const eLabel = sd > eDate ? 'E+' + Math.round((sd - eDate) / 864e5) : 'E–' + Math.round((eDate - sd) / 864e5);
      if (sr) {
        const rows = [{ k: 'In person', v: fz(sr.de) }, { k: 'By mail', v: fz(sr.dm) }];
        if (sr.post != null) rows.push({ k: 'Post · drop box (county)', v: fz(sr.post) + ' · ' + fz(sr.box) });
        rows.push({ k: 'Total that day', v: fz(sr.de + sr.dm) }, { k: 'Running total', v: f(sr.e + sr.m) }, { k: 'Turnout so far', v: ((sr.e + sr.m) / cur.reg * 100).toFixed(2) + '%' });
        if (sr.o != null) rows.push({ k: 'Mail outstanding', v: f(sr.o) });
        if (sr.pv) rows.push({ k: 'Provisional', v: f(sr.pv) });
        if (live) rows.push({ k: 'Weather', v: wxOf(sr.w) });
        return Object.assign(base, { kicker: eLabel + ' · ' + cur.label, title: DOWL[sd.getDay()] + ', ' + md(kk), sub: live ? (ssc ? 'In-person voting open' : 'No in-person voting') : 'Derived from running totals', rows,
          listHead: base.hasList ? base.listHead + (sr.site ? ' · ballots' : '') : '' });
      }
      if (kk === eK) return Object.assign(base, { kicker: 'Election Day', title: DOWL[sd.getDay()] + ', ' + md(kk), sub: 'Polls open 6 AM – 7 PM at every precinct', rows: [] });
      if (kk > eK) return Object.assign(base, { kicker: eLabel, title: DOWL[sd.getDay()] + ', ' + md(kk), sub: 'Mail ballots postmarked by Election Day still count', rows: [{ k: 'Mail ballots due', v: dmd(VF.deadline(cur.date)) + ', noon' }] });
      return Object.assign(base, { kicker: 'Upcoming · ' + eLabel, title: DOWL[sd.getDay()] + ', ' + md(kk), sub: ssc ? 'Scheduled in-person voting' : 'No in-person voting scheduled',
        rows: [{ k: 'Satellites opening', v: satOpens[kk] ? String(satOpens[kk]) : '—' }, { k: 'Days until Election Day', v: String(Math.round((eDate - sd) / 864e5)) }] });
    };
    const pieOf = (r) => { if (!r || !(r.de + r.dm)) return { hasPie: false }; const pE = r.de / (r.de + r.dm) * 100; return { hasPie: true, pieE: pE.toFixed(1), pieRest: (100 - pE).toFixed(1), pctE: Math.round(pE) + '%', pctM: Math.round(100 - pE) + '%' }; };
    const calInfo = (k) => Object.assign(calInfo0(k), pieOf(byDate[k]), { flag: VF.flagChip(k, eK) });
    const sel = calInfo(selK);
    const calOpts = [['all', 'All'], ['early', 'In person'], ['mail', 'By mail']].map(([v, label]) => Object.assign({ label, pick: () => this.setState({ calM: v, calTick: this.state.calTick + 1 }) }, pill(calM, v)));

    // sites
    const siteTotals = {};
    // With partial coverage (days not captured), site totals would undercount, so show the latest captured day instead.
    (D.sitePartial ? [{ site: D.siteLatest }] : D.rows).forEach((r) => { if (r.site) Object.keys(r.site).forEach((kk) => { siteTotals[kk] = (siteTotals[kk] || 0) + r.site[kk]; }); });
    const asOf = parse(D.rows[D.rows.length - 1].d);
    const sites = D.sites.map((s) => {
      const fo = parse(s.firstOpen); const open = fo <= asOf || !!(siteTotals[keyFor(s.name)]); const days = Math.round((fo - asOf) / 864e5);
      const kk = keyFor(s.name); const bal = kk && siteTotals[kk] != null ? f(siteTotals[kk]) + (D.sitePartial ? ' in-person ballots on ' + dmd(D.siteThrough) : ' in-person ballots so far') : (open ? 'Per-site counts not published' : 'Opens ' + dmd(s.firstOpen));
      return { name: s.name, address: s.address, rules: s.rules, ballots: bal, status: open ? (s.satellite ? 'OPEN' : 'MAIN OFFICE') : 'IN ' + days + ' DAYS',
        chipBg: open ? '#D3F1E6' : '#E4D9FA', chipFg: open ? '#00694F' : '#4E2A9E', border: open ? '#00A37A' : '#ECEEF2', bg: open ? '#FFFFFF' : '#F8F9FB' };
    });
    const openNow = D.sites.filter((s) => parse(s.firstOpen) <= asOf).length;
    const siteSummary = D.sites.length + (D.sites.length === 1 ? ' location: ' : ' locations: ') + openNow + ' open now' + (D.next && D.next !== 'open' && D.sites.length > openNow ? ', ' + (D.sites.length - openNow) + ' more from ' + dmd(D.next) : '') + '.';
    const heatKeys = Object.keys(siteTotals);
    const heatDates = D.rows.filter((r) => r.site !== undefined).map((r) => r.d);
    let heatMax = 1; D.rows.forEach((r) => { if (r.site) Object.values(r.site).forEach((v) => { heatMax = Math.max(heatMax, v); }); });
    const heat = { has: heatKeys.length > 0, n: heatDates.length, first: heatDates.length ? dmd(heatDates[0]) : '', last: heatDates.length ? dmd(heatDates[heatDates.length - 1]) : '',
      rows: heatKeys.sort((a, b) => siteTotals[b] - siteTotals[a]).map((kk, ri) => ({ name: SITE_NAMES[kk] || kk, total: f(siteTotals[kk]),
        cells: heatDates.map((d, ci) => { const rr = D.rows.find((r) => r.d === d); const v = (rr && rr.site && rr.site[kk]) || 0; const q = v / heatMax;
          return { bg: v === 0 ? '#F1F2F5' : q < 0.25 ? '#D3F1E6' : q < 0.5 ? '#86D9BA' : q < 0.75 ? '#00A37A' : '#00694F', tip: (SITE_NAMES[kk] || kk) + ' · ' + dmd(d) + ': ' + fz(v), delay: (ri * 60 + ci * 15) + 'ms' }; }) })) };

    // daily table
    const hasPB = live && D.rows.some((r) => r.post != null);
    const shade = this.state.shade !== false;
    const maxDT = Math.max(1, ...drows.map((r) => r.de + r.dm));
    const SH = ['#FFFFFF', '#F2FAF7', '#E2F5EC', '#CDEEDF', '#B4E5D0'];
    const maxDe = Math.max(1, ...drows.map((r) => r.de)), maxDm = Math.max(1, ...drows.map((r) => r.dm));
    const lvlOf = (v, m) => { const q = v / m; return !v ? 0 : q < 0.25 ? 1 : q < 0.5 ? 2 : q < 0.75 ? 3 : 4; };
    // Dark mode gets its own (lowercase, so not rewritten) shading that keeps light text readable.
    const GSH = VF.dark ? ['transparent', '#2b4d42', '#2f604f', '#357a64', '#3e987c'] : ['transparent', '#EEF8F4', '#DDF2E9', '#C9EADD', '#B3E1CF'],
      PSH = VF.dark ? ['transparent', '#3d3658', '#4a4070', '#5a4c8a', '#6b59a6'] : ['transparent', '#F6F2FD', '#ECE5FA', '#E0D5F7', '#D3C4F3'],
      TSH = VF.dark ? ['transparent', '#3b3f47', '#454a53', '#50565f', '#5d646e'] : ['transparent', '#F4F5F7', '#ECEEF1', '#E3E6EA', '#D8DCE2'];
    const tRows = drows.slice().reverse().map((r) => {
      const sc = live ? D.sched[r.d] : null; const w = r.w;
      const heavy = !!(w && w.p >= 0.25), wetish = isWet(w), sunny = !!(w && !wetish && /clear|sun/i.test(w.l));
      const q = (r.de + r.dm) / maxDT; const lv = q < 0.02 ? 0 : q < 0.3 ? 1 : q < 0.55 ? 2 : q < 0.8 ? 3 : 4;
      const fl = VF.dayFlag(r.d, cur.date);
      return { flag: fl === 'Election Day' ? 'Election Day' : fl ? (this.state.narrow ? 'Holiday' : fl) : '', flagFull: fl, date: dmd(r.d), dateS: DOW[parse(r.d).getDay()] + ' ' + (parse(r.d).getMonth() + 1) + '/' + parse(r.d).getDate(), wxS: w ? w.hi + '°' : '', de: fz(r.de), dm: fz(r.dm), pb: r.post != null ? fz(r.post) + ' · ' + fz(r.box) : '–', day: fz(r.de + r.dm), run: f(r.e + r.m),
        pct: ((r.e + r.m) / cur.reg * 100).toFixed(2) + '%', out: fz(r.o), sites: sc ? String(sc.n) : '–', wx: w ? wxOf(w) : '',
        icoRain: wetish, icoSun: sunny, icoCloud: !!(w && !wetish && !sunny),
        wBg: heavy ? '#EEF0F3' : 'transparent', wFg: heavy ? '#121417' : '#8A93A3', wPad: '3px 10px', wW: heavy ? 700 : 500, bg: '#FFFFFF',
        deBg: shade ? GSH[lvlOf(r.de, maxDe)] : 'transparent', dmBg: shade ? PSH[lvlOf(r.dm, maxDm)] : 'transparent', dayBg: shade ? TSH[lvlOf(r.de + r.dm, maxDT)] : 'transparent' };
    });
    const narrowT = this.state.narrow;
    // Fairfax: every table from the county's absentee/early voting daily report
    const FR = live && D.fxReport, dnTab = FR ? (this.state.dnTab || 'sum') : 'sum';
    const frSel = FR ? (this.state.dnTable && FR.tables.find((x) => x.id === this.state.dnTable) ? this.state.dnTable : FR.tables[0].id) : '';
    const frT = FR ? FR.tables.find((x) => x.id === frSel) : null;
    const frKeep = frT ? frT.cols.map((_, k) => k).filter((k) => k === 0 || frT.id !== 'early' || (frT.total && frT.total[k])) : [];
    const frMax = frT ? frKeep.map((k) => Math.max(1, ...frT.rows.map((r) => r[k + 1] || 0))) : [];
    const fxr = { has: !!FR, on: dnTab === 'county', off: dnTab !== 'county', through: FR ? dmd(FR.through) : '',
      tabs: FR ? [['sum', 'Daily summary'], ['county', 'County report']].map(([v, l]) => Object.assign({ label: l, pick: () => this.setState({ dnTab: v }) }, pill(dnTab, v))) : [],
      items: FR ? FR.tables.map((x) => ({ value: x.id, text: x.title })) : [], sel: frSel, pickTable: (v) => this.setState({ dnTable: v }),
      summary: FR ? FR.summary.map(([k, v]) => ({ k, v })) : [],
      cols: frT ? frKeep.map((k) => frT.cols[k]) : [], total: frT && frT.total ? frKeep.map((k) => fz(frT.total[k])) : [],
      grid: frT ? 'minmax(100px, 1fr) repeat(' + frKeep.length + ', minmax(96px, 1fr))' : '1fr', minW: frT ? (110 + frKeep.length * 100) + 'px' : '0',
      rows: frT ? frT.rows.slice().reverse().map((r) => ({ date: dmd(r[0]), cells: frKeep.map((k, ci) => { const v = r[k + 1] || 0, q = v / frMax[ci];
        return { v: fz(v), bg: !shade || !v ? 'transparent' : q < 0.4 ? 'transparent' : q < 0.6 ? '#EEF1F8' : q < 0.8 ? '#DDE3EE' : '#C5CFE3' }; }) })) : [] };
    const downloadCsv = () => {
      const q = (v) => v == null ? '' : /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);
      const head = ['date', 'in_person_that_day', 'mail_that_day', 'total_that_day', 'in_person_running_total', 'mail_running_total', 'running_total', 'turnout_pct_of_registered', 'mail_outstanding']
        .concat(hasPB ? ['county_postal_returns', 'county_drop_box_returns'] : []).concat(live ? ['sites_open', 'weather', 'high_f', 'low_f', 'precip_in'] : []);
      if (fxr.on && frT) {  // the county report table currently shown
        const out = [['date'].concat(frKeep.map((k) => frT.cols[k])).map(q).join(',')].concat(frT.rows.map((r) => [r[0]].concat(frKeep.map((k) => r[k + 1] || 0)).map(q).join(',')));
        const url2 = URL.createObjectURL(new Blob([out.join('\n') + '\n'], { type: 'text/csv' }));
        const a2 = document.createElement('a'); a2.href = url2; a2.download = 'fairfax-county-report-' + frT.id + '.csv'; document.body.appendChild(a2); a2.click(); a2.remove(); setTimeout(() => URL.revokeObjectURL(url2), 1000);
        return;
      }
      const lines = [head.join(',')].concat(drows.map((r) => { const sc = live ? D.sched[r.d] : null, w = r.w;
        return [r.d, r.de, r.dm, (r.de || 0) + (r.dm || 0), r.e, r.m, r.e + r.m, ((r.e + r.m) / cur.reg * 100).toFixed(2), r.o]
          .concat(hasPB ? [r.post, r.box] : []).concat(live ? [sc ? sc.n : 0, w ? w.l : '', w ? w.hi : '', w ? w.lo : '', w ? w.p : ''] : []).map(q).join(','); }));
      const url = URL.createObjectURL(new Blob([lines.join('\n') + '\n'], { type: 'text/csv' }));
      const a = document.createElement('a'); a.href = url; a.download = D.id + '-' + eid + '-daily.csv'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    const fixCols = (g) => g.split(' ').map((x) => 'minmax(0, ' + x + ')').join(' '); // fixed tracks so every row lines up
    const tbl = { csv: downloadCsv, rows: tRows, hasPB, live, minW: narrowT ? (live ? '600px' : '0') : '980px',
      shadePressed: shade ? 'true' : 'false', shadeBg: shade ? '#121417' : '#FFFFFF', shadeFg: shade ? '#FFFFFF' : '#121417', toggleShade: () => this.setState({ shade: !shade }),
      grid: fixCols(narrowT ? (live ? '1.05fr 1fr 1fr 1fr 0.95fr 2.1fr' : '1.1fr 1fr 1fr 1fr 0.95fr') : live ? (hasPB ? '1fr 0.8fr 0.8fr 1fr 0.8fr 0.9fr 0.7fr 0.8fr 0.5fr 1.8fr' : '1fr 0.8fr 0.8fr 0.8fr 0.9fr 0.7fr 0.8fr 0.5fr 1.8fr') : '1.2fr 1fr 1fr 1fr 1fr 0.8fr') };

    // ---- ballots by day (+ planning)
    const { bd, barInfo } = VF.byDay({ place: D.name, ser: cur.series, live, endI, T, date: cur.date, reg: cur.reg, label: cur.label,
      refs: EL.filter((x) => ['2025', '2024', '2023', '2022', '2021'].includes(x.id)), sched: live ? D.sched : null, gate: 'sched', officeKnown: !!D.officeKnown,
      rowDaily: live && D.id === 'fairfax-county' ? D.rows : null, fx: D.fxMail && D.fxMail[cur.id] ? D.fxMail[cur.id].ser : null, st: this.state, set: (x) => this.setState(x), tipAt: (ev, k, i) => this.tipAt(ev, k, i) });

    // Same day, last time: each day of this election next to the same day before Election Day in
    // a past election (Nov 2025 by default), with that day's change and the running comparison.
    const sdOpts = EL.filter((x) => x.id !== eid && x.series);
    const sdId = sdOpts.some((x) => x.id === this.state.sdRef) ? this.state.sdRef : (sdOpts.find((x) => x.id === '2025') || sdOpts[0] || {}).id;
    const sdRefEl = sdOpts.find((x) => x.id === sdId);
    const shortEl = (x) => x.label.replace('November ', 'Nov ').replace('April 2026 special', 'Apr 2026');
    const sdM = this.state.sdM;
    const sd = { on: !!(sdRefEl && cur.series), ref: sdId, refLabel: sdRefEl ? sdRefEl.label.replace('April 2026 special', 'April 2026') : '', curLabel: cur.label, rows: [],
      curShort: shortEl(cur), refShort: sdRefEl ? shortEl(sdRefEl) : '',
      mOpts: [['all', 'All'], ['early', 'In person'], ['mail', 'By mail']].map(([v, label]) => Object.assign({ label, pick: () => this.setState({ sdM: v }) }, pill(sdM, v))),
      opts: sdOpts.map((x) => ({ value: x.id, text: x.label.replace('April 2026 special', 'April 2026'), text2: x.type })), pick: (v) => this.setState({ sdRef: v }) };
    if (sd.on) {
      const pick = (e, m) => sdM === 'early' ? e : sdM === 'mail' ? m : e + m;
      const A = cur.series, B = sdRefEl.series, tA = (i) => A.e[i] == null ? null : pick(A.e[i], A.m[i]), tB = (i) => B.e[i] == null ? null : pick(B.e[i], B.m[i]);
      const rowByDate = {}; D.rows.forEach((r) => { rowByDate[r.d] = r; });
      const pctTxt = (a, b) => !b ? (a ? 'new' : '–') : (a >= b ? '+' : '–') + Math.abs(Math.round((a / b - 1) * 100)) + '%';
      const tone = (a, b) => !b || a === b ? '#4A5260' : a > b ? '#00694F' : '#B42318';
      for (let i = 0; i <= Math.min(endI, 52); i++) {
        const a = tA(i); if (a == null) continue;
        const rowA = live ? rowByDate[VF.addDays(cur.date, i - 46)] : null; // the daily table's own counts where the source publishes them
        const b = tB(i), dA = rowA ? pick(rowA.de, rowA.dm) : a - (i ? tA(i - 1) || 0 : 0), dB = b == null ? null : b - (i && tB(i - 1) != null ? tB(i - 1) : 0);
        if (!dA && !dB && !sd.rows.length) continue; // before the first day either election had votes; later closed days stay, shown as dashes
        const kA = VF.addDays(cur.date, i - 46), kB = VF.addDays(sdRefEl.date, i - 46), flA = VF.dayFlag(kA, cur.date), flB = VF.dayFlag(kB, sdRefEl.date);
        sd.rows.unshift({ nA: dA, nB: dB, e: i <= 46 ? 'E–' + (46 - i) : 'E+' + (i - 46), dA: dmd(kA), dAs: DOW[parse(kA).getDay()] + ' ' + (parse(kA).getMonth() + 1) + '/' + parse(kA).getDate(), dB: dmd(kB), vA: fz(dA), vB: dB == null ? '—' : fz(dB),
          flA: flA && flA !== 'Election Day' ? flA : '', flB: flB && flB !== 'Election Day' ? flB : '',
          diff: dB == null ? '—' : pctTxt(dA, dB), diffFg: tone(dA, dB || 0), runA: f(a), runB: b == null ? '—' : f(b), run: b ? pctTxt(a, b) : '—', runFg: tone(a, b || 0) });
      }
      while (sd.rows.length && !sd.rows[0].nA && !sd.rows[0].nB) sd.rows.shift(); // ...through the last day of votes
      // Shade each day's ballots by volume (same muted scale as Daily numbers) so busy days stand out.
      const SDS = VF.dark ? ['transparent', '#3b3f47', '#454a53', '#50565f', '#5d646e'] : ['transparent', '#F4F5F7', '#ECEEF1', '#E3E6EA', '#D8DCE2'];
      const sdMax = Math.max(1, ...sd.rows.map((r) => Math.max(r.nA || 0, r.nB || 0)));
      const sdLvl = (v) => !v ? 0 : 1 + Math.min(3, Math.floor(v / sdMax * 4));
      sd.rows.forEach((r) => { r.bgA = SDS[sdLvl(r.nA)]; r.bgB = SDS[sdLvl(r.nB)]; });
      sd.note = (sdM === 'early' ? 'In-person ballots only. ' : sdM === 'mail' ? 'Mail ballots only; offices process mail on their own schedules, so daily counts swing. ' : 'In-person and mail ballots together. ') + 'Days line up by how many days remain before Election Day, so weekdays match. Every day from the first day of votes to the latest is listed, weekends and holidays included; a dash means no ballots that day. Green is ahead of ' + sd.refLabel + ', red is behind.';
    }
    // Fairfax: in-person ballots by site — this election site by site, and one site across years.
    const bs = { on: false };
    const FXS = D.fxMail ? Object.keys(D.fxMail).filter((y) => D.fxMail[y].sites && Object.keys(D.fxMail[y].sites).length) : [];
    if (FXS.length && D.fxMail[cur.id] && D.fxMail[cur.id].sites && Object.keys(D.fxMail[cur.id].sites).length) {
      const nm = (k) => SITE_NAMES[k] || k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      const sum = (a) => a.reduce((t, v) => t + (v || 0), 0);
      const cumOf = (a) => { let c = 0, seen = false, end = -1; a.forEach((v, i) => { if (v != null) end = i; }); return a.map((v, i) => { if (v != null) { c += v; seen = true; } return seen && i <= end ? c : null; }); };
      const W = 1000, H = 300, L = 56, R = 18, T = 14, B = 34;
      const chart = (series, from, to, hiKey, shadeClosed) => {
        let top = 1; series.forEach((x) => x.vals.forEach((v, i) => { if (i >= from && i <= to && v != null) top = Math.max(top, v); }));
        const units = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000];
        top = Math.min(...units.map((u) => Math.ceil(top * 1.05 / (4 * u)) * 4 * u));
        const X = (i) => L + (i - from) / Math.max(1, to - from) * (W - L - R), Y = (v) => H - B - v / top * (H - B - T);
        // Lines run straight across closed days (weekends, holidays) rather than breaking.
        const path = (vals) => { let d = '', pen = false; for (let i = from; i <= to; i++) { const v = vals[i]; if (v == null) continue; d += (pen ? ' L' : 'M') + X(i).toFixed(1) + ',' + Y(v).toFixed(1); pen = true; } return d; };
        const lastI = Math.max(-1, ...series.map((x) => { let k = -1; x.vals.forEach((v, i) => { if (v != null) k = i; }); return k; }));
        const closed = []; if (shadeClosed) for (let i = from; i <= Math.min(to, lastI); i++) if (series.every((x) => x.vals[i] == null)) closed.push({ x: (X(i) - (W - L - R) / (to - from + 1) / 2).toFixed(1), w: ((W - L - R) / (to - from + 1)).toFixed(1) });
        const ticks = []; for (let i = from; i <= to; i++) { const k = 46 - i; if (k % 7 === 0 || i === from) ticks.push({ x: X(i).toFixed(1), l: k === 0 ? 'Election Day' : k + ' days' }); }
        const hiI = this.state[hiKey];
        const hits = []; for (let i = from; i <= to; i++) hits.push({ x: (X(i) - (W - L - R) / (to - from + 1) / 2).toFixed(1), w: ((W - L - R) / (to - from + 1)).toFixed(1), enter: () => this.setState({ [hiKey]: i }) });
        return { closed, lines: series.map((x) => ({ d: path(x.vals), c: x.c, w: x.w })), yt: [0, 1, 2, 3, 4].map((j) => ({ y: (H - B - j * (H - B - T) / 4).toFixed(1), ty: (H - B - j * (H - B - T) / 4 + 4).toFixed(1), l: short(top * j / 4) })),
          xt: ticks, hits, hasHi: hiI != null && hiI >= from && hiI <= to, hiX: hiI != null ? X(Math.min(to, Math.max(from, hiI))).toFixed(1) : 0,
          dots: hiI != null ? series.filter((x) => x.vals[hiI] != null).map((x) => ({ y: Y(x.vals[hiI]).toFixed(1), c: x.c })) : [], vb: '0 0 ' + W + ' ' + H, base: H - B, leave: () => this.setState({ [hiKey]: null }) };
      };
      const dayLabel = (eDateStr, i) => { const d = parse(VF.addDays(eDateStr, i - 46)); return DOW[d.getDay()] + ' ' + MON[d.getMonth()] + ' ' + d.getDate(); };
      const bsView = this.state.bsView || 'daily', bsView2 = this.state.bsView2 || 'cum';
      // Hours each site was open each day (this election's published schedule), for ballots per hour.
      const hrs = {}; if (live) Object.keys(D.sched).forEach((d5) => { const i = VF.idxOf(cur.date, d5); D.sched[d5].open.forEach(([n5, sp, hh]) => { const k = keyFor(n5); if (k && hh) (hrs[k] = hrs[k] || [])[i] = hh; }); });
      const hasHrs = Object.keys(hrs).length > 0;
      const viewOpts = (key, curV, opts) => opts.map(([v, label]) => Object.assign({ label, pick: () => this.setState({ [key]: v }) }, pill(curV, v)));
      // 1) This election, site by site: the five busiest sites in color, the rest in light gray.
      const SC = ['#121417', '#00A37A', '#7C4DDB', '#D9792B', '#2F6FD6'];
      const now = D.fxMail[cur.id].sites, keys = Object.keys(now).sort((a, b) => sum(now[b]) - sum(now[a]));
      let first = 52, last = 0; keys.forEach((k) => now[k].forEach((v, i) => { if (v != null) { first = Math.min(first, i); last = Math.max(last, i); } }));
      const to1 = live ? 46 : Math.max(last, first + 1);
      const v1 = bsView === 'hour' && !hasHrs ? 'daily' : bsView;
      const perHour = (k) => now[k].map((v, i) => v != null && hrs[k] && hrs[k][i] ? Math.round(v / hrs[k][i]) : null);
      const s1 = keys.map((k, j) => ({ k, name: nm(k), c: j < 5 ? SC[j] : '#C9CDD4', w: j === 0 ? 3.5 : 2.5, raw: now[k], vals: v1 === 'cum' ? cumOf(now[k]) : v1 === 'hour' ? perHour(k) : now[k] }));
      const ch1 = chart(s1.slice().reverse(), first, to1, 'bsHi1', true);
      const h1 = this.state.bsHi1;
      // 2) One site across elections (Government Center by default).
      const allKeys = Array.from(new Set(FXS.flatMap((y) => Object.keys(D.fxMail[y].sites)))).sort((a, b) => (a === 'government_center' ? -1 : b === 'government_center' ? 1 : nm(a).localeCompare(nm(b))));
      const site = allKeys.includes(this.state.bsSite) ? this.state.bsSite : 'government_center';
      const yrs = FXS.filter((y) => D.fxMail[y].sites[site]).sort().reverse();
      const yLabel = (y) => (EL.find((x) => x.id === y) || {}).label || y;
      const s2 = yrs.map((y) => ({ y, name: yLabel(y), c: VF.elColor(y, cur.id, cmpId), w: y === cur.id ? 4 : y === cmpId ? 3 : 2, raw: D.fxMail[y].sites[site], vals: bsView2 === 'cum' ? cumOf(D.fxMail[y].sites[site]) : D.fxMail[y].sites[site] }));
      let f2 = 52; s2.forEach((x) => x.vals.forEach((v, i) => { if (v != null) f2 = Math.min(f2, i); }));
      const ch2 = chart(s2.slice().reverse(), Math.min(f2, 46), 46, 'bsHi2');
      const h2 = this.state.bsHi2;
      const fmtv = (v) => v == null ? '—' : f(v);
      Object.assign(bs, {
        on: true, viewOpts: viewOpts('bsView', v1, [['daily', 'Per day']].concat(hasHrs ? [['hour', 'Per hour']] : [], [['cum', 'Running total']])), viewOpts2: viewOpts('bsView2', bsView2, [['daily', 'Per day'], ['cum', 'Running total']]), ch1, ch2,
        legend1: s1.map((x) => ({ name: x.name, c: x.c, total: f(sum(x.raw)) })),
        legend2: s2.map((x) => ({ name: x.name.replace('November ', 'Nov ').replace('April 2026 special', 'Apr 2026'), c: x.c, total: f(sum(x.raw)) })),
        read1: h1 != null && s1.some((x) => x.raw[h1] != null) ? dayLabel(cur.date, h1) + ' · ' + s1.filter((x) => x.raw[h1] != null).slice(0, 6).map((x) => x.name + ' ' + fmtv(x.vals[h1]) + (v1 === 'hour' ? '/hr' : '')).join(' · ') : h1 != null ? dayLabel(cur.date, h1) + ' · no ballots reported' : 'Hover the chart to read each site for a day.',
        read2: h2 != null && s2.some((x) => x.vals[h2] != null) ? (46 - h2 === 0 ? 'Election Day' : (46 - h2) + ' days before Election Day') + ' · ' + s2.filter((x) => x.vals[h2] != null).map((x) => x.name.replace('November ', 'Nov ') + ' ' + fmtv(x.vals[h2])).join(' · ') : 'Hover the chart to compare elections on the same day before Election Day.',
        siteOpts: allKeys.map((k) => ({ value: k, text: nm(k) })), site, pickSite: (v) => this.setState({ bsSite: v, bsHi2: null }), siteName: nm(site),
        take: (() => { const a = s2.find((x) => x.y === cur.id), b = s2.find((x) => x.y === cmpId); if (!live || !a || !b) return '';
          let li = -1; a.raw.forEach((v, i) => { if (v != null) li = i; }); const ta = sum(a.raw.slice(0, li + 1)), tb = sum(b.raw.slice(0, li + 1));
          return tb ? nm(site) + ' is ' + (ta >= tb ? Math.round((ta / tb - 1) * 100) + '% ahead of ' : Math.round((1 - ta / tb) * 100) + '% behind ') + b.name + ' at this point' : ''; })(),
        through: 'From Fairfax County’s daily reports' + (live ? ', through ' + dmd(D.fxMail[cur.id].through) : '') + '. Lines run across days the sites were closed (shaded).' + (hasHrs ? ' Per hour divides each day’s ballots by the hours that site was scheduled to be open.' : '')
      });
    }
    // Section headlines that state the finding.
    const cmpEl = EL.find((x) => x.id === cmpId);
    const dayList = live ? D.rows.map((r) => ({ d: r.d, v: r.de + r.dm }))
      : cur.series ? cur.series.e.map((v, i) => v == null || i === 0 || cur.series.e[i - 1] == null ? null : { d: VF.addDays(cur.date, i - 46), v: v + cur.series.m[i] - cur.series.e[i - 1] - cur.series.m[i - 1] }).filter(Boolean) : [];
    const dl = VF.dayLines(dayList, live);
    const take = {
      compare: live && cmpEl && cur.series && cmpEl.series ? (() => { const A = cur.series, B = cmpEl.series; let li = -1; for (let i = 0; i < 53; i++) if (A.e[i] != null) li = i;
        const t = (S, i) => S.e[i] == null ? null : S.e[i] + S.m[i]; return li >= 7 ? VF.gapLine(t(A, li) / t(B, li), t(A, li - 7) / t(B, li - 7), cmpEl.label) : ''; })() : '',
      byday: dl.busiest, calendar: (() => { // follows the calendar's method toggle
        if (calM === 'all') return dl.rhythm;
        const S = cur.series, m = (i) => calM === 'early' ? S.e[i] : S.m[i];
        const days = live ? D.rows.map((r) => ({ d: r.d, v: dv(r) }))
          : S ? S.e.map((v, i) => v == null || i === 0 || S.e[i - 1] == null ? null : { d: VF.addDays(cur.date, i - 46), v: m(i) - m(i - 1) }).filter(Boolean) : [];
        return VF.dayLines(days, live).rhythm.replace(' ballots', calM === 'early' ? ' in-person ballots' : ' mail ballots'); })(),
      sameday: sd.on && sd.rows.length ? (() => { const last = sd.rows.filter((r) => r.nA || r.nB).slice(0, 10), up = last.filter((r) => r.diffFg === '#00694F').length; return 'Ahead of ' + sd.refLabel + ' on ' + up + ' of the last ' + last.length + ' voting days'; })() : ''
    };
    // Trend notes for the live election, written at build time from the latest data (trends.py).
    const insight = { on: live && !!D.trend, text: D.trend || '' };

    // ---- site map + table
    const hoursBy = {}; Object.keys(D.sched).forEach((d5) => { D.sched[d5].open.forEach(([nm, sp, hh]) => { if (!hoursBy[nm]) hoursBy[nm] = {}; hoursBy[nm][d5] = hh; }); });
    // A locality whose only site is the registrar's office: every in-person ballot was cast there.
    const soloE = D.sites.length === 1 && D.rows.length ? D.rows[D.rows.length - 1].e : null;
    const totAll = Object.values(siteTotals).reduce((x, y) => x + y, 0) || soloE || 0;
    const maxSite = Math.max(1, ...Object.values(siteTotals));
    const siteRows = D.sites.map((s5, i) => {
      const key = keyFor(s5.name); const tot2 = key && siteTotals[key] != null ? siteTotals[key] : soloE;
      const hrs = Object.entries(hoursBy[s5.name] || {}).filter(([d6]) => parse(d6) <= asOf).reduce((x, [, hh]) => x + hh, 0);
      const open = parse(s5.firstOpen) <= asOf || !!(key && siteTotals[key]); const days = Math.round((parse(s5.firstOpen) - asOf) / 864e5);
      return { s5, i, key, tot2, hrs, open, days };
    });
    const siteAll = !!this.state.siteAll, siteOpen = this.state.siteOpen || {};
    const siteTable = siteRows.map(({ s5, i, tot2, hrs, open, days }) => { const shown = siteAll || !!siteOpen[i]; return { n: i + 1, name: s5.name, kind: s5.satellite ? '' : 'Main office',
      status: open ? 'Open' : days === 1 ? 'In 1 day' : 'In ' + days + ' days', opens: open ? 'since ' + dmd(s5.firstOpen) : dmd(s5.firstOpen),
      chipBg: open ? '#D3F1E6' : '#EDE6FC', chipFg: open ? '#00694F' : '#4E2A9E',
      ballots: tot2 != null ? f(tot2) : '—', share: tot2 != null && totAll ? Math.round(tot2 / totAll * 100) + '%' : '—', w: tot2 != null && totAll ? (tot2 / totAll * 100).toFixed(1) : 0,
      rate: tot2 != null && hrs ? String(Math.round(tot2 / hrs)) : '—', hrs: hrs ? f(hrs) : '—',
      dotBg: open ? '#00A37A' : '#FFFFFF', dotFg: open ? '#FFFFFF' : '#5B2FB8', dotBorder: open ? '#00A37A' : '#7C4DDB',
      showDetail: shown, expanded: shown ? 'true' : 'false', caret: shown ? '▴' : '▾', rowBg: siteOpen[i] ? '#F1FAF6' : 'transparent', address: s5.address ? s5.address + (s5.approx ? ' (map position approximate)' : '') : '', url: s5.url || '', noAddr: !s5.address, rules: s5.rules, noRules: !s5.rules.length,
      rateMove: (ev) => this.setState({ tip: this.tipAt(ev, 'rate', i) }),
      toggle: () => this.setState({ siteOpen: Object.assign({}, siteOpen, { [i]: !siteOpen[i] }) }) }; });
    const scaleR = D.mapH / 1000;
    const sm = { has: D.sites.some((x) => x.xy), base: D.precincts.map((p) => p.d), sizeNote: totAll ? (D.sitePartial ? 'Circle size = in-person ballots on ' + dmd(D.siteThrough) : 'Circle size = in-person ballots so far') : (D.sites.some((x) => x.approx) ? 'Positions approximate' : ''),
      dots: siteRows.filter(({ s5 }) => s5.xy).map(({ s5, i, tot2, open }) => { const r = (tot2 ? 16 + Math.sqrt(tot2 / maxSite) * 26 : 18) * Math.max(1, scaleR * 0.9);
        return { x: s5.xy[0], y: s5.xy[1], r: r.toFixed(1), ty: (s5.xy[1] + r * 0.35).toFixed(1), fs: Math.round(r * 0.9), n: i + 1, fill: open ? '#00A37A' : '#FFFFFF', stroke: open ? '#FFFFFF' : '#7C4DDB', tc: open ? '#FFFFFF' : '#5B2FB8',
          ringCls: open ? 'fx-ring2' : '', delay: (300 + i * 70) + 'ms', move: (ev) => this.setState({ tip: this.tipAt(ev, 'site', i) }), click: () => this.setState({ siteOpen: Object.assign({}, siteOpen, { [i]: !siteOpen[i] }) }) }; }) };
    const rateInfo = (i) => { const { s5, tot2, hrs } = siteRows[i]; return { kicker: 'Ballots per hour', title: s5.name, sub: hrs ? 'In-person ballots ÷ hours this site has been scheduled open so far' : 'Hours for this site aren’t listed yet, so ballots per hour can’t be figured.', hasList: false, list: [],
      rows: [{ k: 'In-person ballots', v: tot2 != null ? f(tot2) : 'not published' }, { k: 'Scheduled hours so far', v: hrs ? f(hrs) : '—' }, { k: 'Ballots per hour', v: tot2 != null && hrs ? String(Math.round(tot2 / hrs)) : '—' }] }; };
    const siteInfo = (i) => { const { s5, tot2, hrs, open, days } = siteRows[i]; return { bg: s5.satellite ? '#F1F2F5' : '#FFFFFF', kicker: (s5.satellite ? 'Satellite site ' + (i + 1) : 'Main office') + ' · ' + (open ? 'open' : 'opens in ' + days + ' days'), title: s5.name, sub: s5.address + (s5.approx ? ' · position approximate' : ''),
      rows: [{ k: 'In-person ballots', v: tot2 != null ? f(tot2) : 'not published' }, { k: 'Scheduled hours so far', v: hrs ? f(hrs) : '—' }, { k: 'Ballots per hour', v: tot2 != null && hrs ? String(Math.round(tot2 / hrs)) : '—' }],
      hasList: true, listHead: 'Hours', list: s5.rules.slice(0, 8).map((x) => ({ k: x, v: '' })) }; };
    const siteTableNote = soloE != null ? 'All in-person early ballots so far were cast at the registrar’s office. Click the row for its address and hours.' : (Object.keys(siteTotals).length ? (D.siteSource ? 'Per-site counts from ' + D.siteSource + ' through ' + dmd(D.siteThrough) + '.' + (D.sitePartial ? ' It shows only the latest day, so site ballots are for ' + dmd(D.siteThrough) + ' alone, and days that weren’t captured have no per-site counts.' : '') + (D.siteOfficeOnly ? ' Before ' + dmd(D.sites.filter((x) => x.satellite).map((x) => x.firstOpen).sort()[0]) + ' the office was the only site open, so each day’s in-person ballots are counted there.' : '') : 'Per-site counts from the county daily report through ' + dmd(heatDates[heatDates.length - 1]) + '.') + ' Per hour uses scheduled site-hours. ' : 'This locality does not publish per-site ballot counts. ') + 'Click a row for its address and hours.';
    const siteAllToggle = () => this.setState({ siteAll: !siteAll });

    // ---- site rhythm: every site, every early-voting day
    const rhM = this.state.rhM || 'daily', rhFit = !!this.state.rhFit, rhSwap = !!this.state.rhSwap;
    const schedDates = Object.keys(D.sched).sort();
    const lastData = heatDates.length ? heatDates[heatDates.length - 1] : '';
    const allDates = []; if (schedDates.length) { const d0 = parse(schedDates[0]), d1 = parse(schedDates[schedDates.length - 1]); for (let d = new Date(d0); d <= d1; d.setDate(d.getDate() + 1)) allDates.push(iso(d)); }
    // The office leads, then sites by ballots.
    const rSites = siteRows.slice().sort((a, b) => (a.s5.satellite - b.s5.satellite) || ((b.tot2 || 0) - (a.tot2 || 0)) || a.s5.firstOpen.localeCompare(b.s5.firstOpen));
    const shortName = (s5) => { const kk = keyFor(s5.name); return kk && SITE_NAMES[kk] ? SITE_NAMES[kk] : s5.name.replace(/ (Governmental|Government|Regional|Community) .*$/, '').replace(/ Library$/, ''); };
    let rMax = 0; const rVal = {};
    rSites.forEach(({ s5, key }) => { let run = 0; rVal[s5.name] = allDates.map((d7) => {
      const h = (hoursBy[s5.name] || {})[d7] || 0; const past = d7 <= lastData;
      const rr = past ? D.rows.find((r) => r.d === d7) : null; const raw = rr && rr.site && key ? (rr.site[key] || 0) : 0; run += raw;
      const gap = !!(D.sitePartial && past && h && !(rr && rr.site));
      const v = !past || gap ? null : rhM === 'daily' ? raw : rhM === 'cum' ? run : (h ? raw / h : null);
      if (v != null) rMax = Math.max(rMax, v);
      return { v, raw, h, d: d7, past, run, gap }; }); });
    const fmtR = (v) => rhM === 'rate' ? String(Math.round(v)) : v >= 1000 ? (v / 1000).toFixed(1) + 'K' : String(Math.round(v));
    const cellOf = (s5, j, ri, ci) => { const c = rVal[s5.name][j]; let bg, fg = '#121417', border = '0', txt = '';
      if (c.gap) { bg = '#FFFFFF'; border = '1.5px dashed #C6CBD4'; txt = '?'; }
      else if (!c.past) { if (c.h) { bg = '#FFFFFF'; border = '1.5px dashed #C6CBD4'; } else bg = '#F8F9FB'; }
      else if (!c.h && !c.raw) bg = '#F1F2F5';
      else { const q = (c.v || 0) / (rMax || 1); /* lighter greens keep dark text readable */ const RG = VF.dark ? ['#2b4d42', '#2f604f', '#357a64', '#3e987c'] : ['#E3F5ED', '#C2EBDB', '#93DCC0', '#5CC9A3']; bg = !c.v ? '#F1F2F5' : RG[q < 0.25 ? 0 : q < 0.5 ? 1 : q < 0.75 ? 2 : 3]; if (!rhFit && c.v) txt = fmtR(c.v); }
      return { bg, fg, border, txt, delay: (ri * 30 + ci * 6) + 'ms',
        tip: shortName(s5) + ' · ' + dmd(c.d) + ': ' + (c.gap ? 'open, count not captured' : !c.past ? (c.h ? 'scheduled, ' + c.h + ' h' : 'closed') : !c.h && !c.raw ? 'closed' : fz(c.raw) + ' ballots' + (c.h ? ' in ' + c.h + ' h (' + Math.round(c.raw / c.h) + '/h)' : '')) }; };
    const totOf = (arr) => { const pastA = arr.filter((c) => c.past); const sum = pastA.reduce((x, c) => x + c.raw, 0); const hh = pastA.reduce((x, c) => x + c.h, 0);
      return rhM === 'rate' ? (hh && sum ? String(Math.round(sum / hh)) : '—') : sum ? f(sum) : '—'; };
    let rhHead, rhRows;
    if (!rhSwap) {
      rhHead = allDates.map((d7) => { const x = parse(d7); return { l: rhFit ? '' : DOW[x.getDay()], l2: rhFit ? '' : (x.getMonth() + 1) + '/' + x.getDate(), full: dmd(d7) }; });
      rhRows = rSites.map(({ s5 }, ri) => ({ name: shortName(s5), total: totOf(rVal[s5.name]), cells: allDates.map((_, j) => cellOf(s5, j, ri, j)) }));
    } else {
      rhHead = rSites.map(({ s5 }) => ({ l: rhFit ? '' : shortName(s5), l2: '', full: s5.name }));
      rhRows = allDates.map((d7, j) => { const pastD = d7 <= lastData; const daySum = rSites.reduce((x, { s5 }) => x + rVal[s5.name][j].raw, 0); const dayH = rSites.reduce((x, { s5 }) => x + rVal[s5.name][j].h, 0);
        return { name: dmd(d7), total: !pastD ? '' : rhM === 'rate' ? (dayH && daySum ? String(Math.round(daySum / dayH)) : '—') : rhM === 'cum' ? f(rSites.reduce((x, { s5 }) => x + rVal[s5.name][j].run, 0)) : (daySum ? f(daySum) : '—'), cells: rSites.map(({ s5 }, ri) => cellOf(s5, j, j, ri)) }; });
    }
    const nCols = rhHead.length;
    const rhOpt = (label, key, curv, list) => ({ label, opts: list.map(([v, l]) => Object.assign({ label: l, pick: () => this.setState({ [key]: v, rhTick: (this.state.rhTick || 0) + 1 }) }, pill(curv, v))) });
    const nameW = rhSwap ? 100 : 150, cellW = rhFit ? 0 : rhSwap ? 84 : 40;
    const rh = { has: Object.keys(siteTotals).length > 0 && allDates.length > 0, head: rhHead, rows: rhRows, swapped: rhSwap ? 'true' : 'false', swapBg: rhSwap ? '#121417' : '#FFFFFF', swapFg: rhSwap ? '#FFFFFF' : '#121417',
      swap: () => this.setState({ rhSwap: !rhSwap, rhTick: (this.state.rhTick || 0) + 1 }), anim: (this.state.rhTick || 0) % 2 ? 'fx-pa' : 'fx-pb',
      grid: nameW + 'px 64px repeat(' + nCols + ', minmax(' + (rhFit ? '4px' : cellW + 'px') + ', 1fr))',
      minW: rhFit ? '0' : (nameW + 64 + nCols * (cellW + 3)) + 'px', cellH: rhFit ? '20px' : '30px',
      totLabel: rhM === 'rate' ? 'Avg/hr' : 'Total',
      ctrls: [rhOpt('Metric', 'rhM', rhM, [['daily', 'Daily ballots'], ['cum', 'Cumulative ballots'], ['rate', 'Ballots/hour']].filter(([v]) => !(D.sitePartial && v === 'cum'))), rhOpt('Display', 'rhFit', rhFit, [[false, 'Readable numbers'], [true, rhSwap ? 'Fit all sites' : 'Fit all dates']])] };

    // ---- precinct maps (three)
    const P = D.precincts; const lastIdx = D.pdates.length - 1; const pIdx = this.state.pIdx == null ? lastIdx : this.state.pIdx;
    const { pMeasure } = this.state; const pHover = this.state.pHover || this.state.pPinned; // hover previews; a click pins
    const GRN = ['#f0faf6', '#d3f1e6', '#a8e3cc', '#6fcfac', '#2fb58a', '#00895f', '#005a40'], PUR = ['#f6f2fe', '#e4d9fa', '#c9b6f2', '#a98be8', '#8b63dd', '#6a3fc4', '#4a2696'];
    const pdefs = [['all', 'All early votes', (h) => h[0] + h[1], GRN, '#D3D7DE'], ['e', 'In person', (h) => h[0], GRN, '#D3D7DE'], ['m', 'By mail', (h) => h[1], PUR, '#D3D7DE']];
    const pSel0 = this.state.pSel || 'all';
    const pBase = (() => { const e7 = P.reduce((x, p) => x + p.h[pIdx][0], 0), m7 = P.reduce((x, p) => x + p.h[pIdx][1], 0); return e7 + m7 ? e7 / (e7 + m7) : 0.5; })();
    const leanMap = { id: 'lean', title: 'In person vs. mail', border: '#D3D7DE', total: Math.round(pBase * 100) + '% in person overall', bins: VF.leanBins(),
      paths: P.map((p) => { const h = p.c === pHover; return { d: p.d, fill: h ? '#FFD23F' : VF.leanColor(p.h[pIdx][0], p.h[pIdx][1], pBase), stroke: h ? '#121417' : '#FFFFFF', sw: h ? 3 : 0.7, delay: Math.round(parseFloat(p.d.slice(1)) * 0.6) + 'ms', move: (ev) => this.setState({ pHover: p.c, tip: this.tipAt(ev, 'prec', p.c) }), pin: () => this.setState({ pPinned: p.c, pHover: p.c }) }; }) };
    const pmaps = pSel0 === 'lean' ? [leanMap] : pdefs.filter(([id]) => id === pSel0).map(([id, title, get, pal, border]) => {
      const mv = (p, j) => pMeasure === 'p' ? (p.r ? get(p.h[j]) / p.r * 100 : 0) : get(p.h[j]);
      const vs = P.map((p) => mv(p, lastIdx)).sort((x, y) => x - y);
      const qs = [1, 2, 3, 4, 5, 6].map((q) => vs[Math.floor(q / 7 * (vs.length - 1))]); // 7 steps
      const bin = (v) => { let i = 0; while (i < 6 && v > qs[i]) i++; return i; };
      const fq = (v) => pMeasure === 'p' ? v.toFixed(1) + '%' : short(v);
      const sum = P.reduce((x, p) => x + get(p.h[pIdx]), 0), regSum = P.reduce((x, p) => x + p.r, 0);
      return { id, title, border, total: pMeasure === 'p' ? (sum / regSum * 100).toFixed(1) + '%' : f(sum),
        bins: pal.map((c, i) => ({ c, l: i === 0 ? '≤' + fq(qs[0]) : i === 6 ? '>' + fq(qs[5]) : fq(qs[i]) })),
        paths: P.map((p) => { const h = p.c === pHover; return { d: p.d, fill: h ? '#FFD23F' : pal[bin(mv(p, pIdx))], stroke: h ? '#121417' : '#FFFFFF', sw: h ? 3 : 0.7, delay: Math.round(parseFloat(p.d.slice(1)) * 0.6) + 'ms', move: (ev) => this.setState({ pHover: p.c, tip: this.tipAt(ev, 'prec', p.c) }), pin: () => this.setState({ pPinned: p.c, pHover: p.c }) }; }) };
    });
    const precInfo = (p) => Object.assign(pieOf({ de: p.h[pIdx][0], dm: p.h[pIdx][1] }), { kicker: 'Precinct ' + p.c, title: p.n, sub: (p.r ? (p.h[pIdx][0] + p.h[pIdx][1]) / p.r * 100 : 0).toFixed(1) + '% turnout as of ' + dmd(D.pdates[pIdx]), hasList: false, list: [],
      rows: [{ k: 'Registered', v: f(p.r) }, { k: 'In person', v: fz(p.h[pIdx][0]) + ' · ' + (p.r ? (p.h[pIdx][0] / p.r * 100).toFixed(1) : 0) + '%' }, { k: 'By mail', v: fz(p.h[pIdx][1]) + ' · ' + (p.r ? (p.h[pIdx][1] / p.r * 100).toFixed(1) : 0) + '%' }, { k: 'Total', v: fz(p.h[pIdx][0] + p.h[pIdx][1]) }] });
    const ph = P.find((p) => p.c === pHover);
    const pSel = this.state.pSel || 'all';
    const pLay = 'solo';
    const pFull = !!this.state.pFull;
    document.body.classList.toggle('vf-full', pFull); // full-screen map hides the brand bar
    const pm = {
      lay: pLay, one: true, cols: 'minmax(0, 1fr)',
      lays: [['all', 'All 3 maps'], ['one', 'One map']].map(([v, label]) => Object.assign({ label, pick: () => this.setState({ pLay: v }) }, pill(pLay, v))),
      fs: pFull ? 'position: fixed; inset: 0; z-index: 70; border-radius: 0; overflow: auto; margin: 0; translate: none !important; scale: none !important; transform: none !important; animation: none !important; box-shadow: none' : '',
      mapMax: pFull ? '78vh' : 'min(460px, 52vh)',
      fullLabel: pFull ? 'Exit full screen' : 'Full screen', fullPressed: pFull ? 'true' : 'false', fullBg: pFull ? '#121417' : '#FFFFFF', fullFg: pFull ? '#FFFFFF' : '#121417',
      toggleFull: () => this.setState({ pFull: !pFull, tip: null }),
      maps: pmaps, sel: pSel, max: lastIdx, idx: pIdx, dateLabel: dmd(D.pdates[pIdx]),
      pick: [['all', 'All'], ['e', 'In person'], ['m', 'By mail'], ['lean', 'In person vs. mail']].map(([k6, label]) => Object.assign({ label, pick: () => this.setState({ pSel: k6 }) }, pill(pSel, k6))),
      lean: pSel === 'lean', notLean: pSel !== 'lean', measureStyle: pSel === 'lean' ? 'opacity: .35; pointer-events: none' : '',
      pins: sm.dots.map((d6) => ({ x: d6.x, y: d6.y, r: (8 * Math.max(1, scaleR * 0.9)).toFixed(1), fs: Math.round(9 * Math.max(1, scaleR * 0.9)), ty: (d6.y + 3.2 * Math.max(1, scaleR * 0.9)).toFixed(1), n: d6.n, move: d6.move })),
      clear: (ev) => { if (!ev || ev.target.tagName !== 'path') this.setState({ pHover: null, pPinned: null, tip: null }); },
      leave: () => this.setState({ pHover: null, tip: null }),
      onSlide: (ev) => this.setState({ pIdx: +ev.target.value }),
      playLabel: this.state.playing ? 'Pause' : '▶ Play',
      play: () => {
        if (this.state.playing) { clearInterval(this.player); this.setState({ playing: false }); return; }
        this.setState({ playing: true, pIdx: 0 });
        this.player = setInterval(() => { const nx = (this.state.pIdx || 0) + 1; if (nx > lastIdx) { clearInterval(this.player); this.setState({ playing: false }); } else this.setState({ pIdx: nx }); }, 450);
      },
      ctrls: [opt('Measure', 'pMeasure', pMeasure, [['p', '% of registered'], ['v', 'Ballots']])],
      note: P.length + ' precincts',
      hov: ph ? precInfo(ph) : { kicker: 'Hover a precinct', title: D.name, sub: (P.reduce((x, p) => x + p.h[pIdx][0] + p.h[pIdx][1], 0) / P.reduce((x, p) => x + p.r, 0) * 100).toFixed(1) + '% turnout as of ' + dmd(D.pdates[pIdx]),
        rows: [{ k: 'Precincts', v: String(P.length) }, { k: 'In person', v: f(P.reduce((x, p) => x + p.h[pIdx][0], 0)) }, { k: 'By mail', v: f(P.reduce((x, p) => x + p.h[pIdx][1], 0)) }] }
    };

    const tp = this.state.tip;
    let tip = { on: false };
    if (tp) {
      const info = tp.kind === 'cal' ? calInfo(tp.key) : tp.kind === 'bar' ? barInfo(tp.key) : tp.kind === 'site' ? siteInfo(tp.key) : tp.kind === 'rate' ? rateInfo(tp.key) : precInfo(P.find((p) => p.c === tp.key));
      tip = Object.assign({ on: true, x: tp.x, y: tp.y }, info, { bg: info.bg || '#FFFFFF', list: (info.list || []).slice(0, 10) });
    }

    const lastRow = D.rows[D.rows.length - 1];
    const lastW = D.rows.slice().reverse().find((r) => r.w);
    const ticker0 = [
      { name: D.name + ' early votes', val: f(lastRow.e + lastRow.m), dot: '#00A37A' },
      { name: 'Registered voters', val: f(D.reg), dot: '#FFD23F' },
      { name: 'Mail outstanding', val: f(lastRow.o), dot: '#7C4DDB' },
      { name: 'Satellites', val: D.sat ? D.sat + (D.next && D.next !== 'open' ? ' · next ' + dmd(D.next) : ' open') : 'none', dot: '#00A37A' },
      { name: 'Weather ' + (lastW ? dmd(lastW.d) : ''), val: lastW ? wxOf(lastW.w) : '—', dot: '#FFD23F' }
    ];

    return {
      fc, fcOpts, vb, insight, sd, take, bs,
      hdr: { eid, lid: D.id,
        elections: EL.map((x) => ({ value: x.id, text: x.label.replace('April 2026 special', 'April 2026'), text2: x.type })),
        locs: (() => { const all = D.names.map(([id, nm]) => ({ value: id, text: nm })); return [{ value: '', text: 'All of Virginia' }].concat(VF.recentItems(all, D.id), all); })(),
        pickE: (v) => { if (v === eid) return; this.setState({ eid: v, show: Object.assign({}, this.state.show, { [v]: true }), cal: null, hi: null, tip: null, calTick: this.state.calTick + 1, chTick: this.state.chTick + 1 }); },
        pickL: (v) => { v = VF.unRecent(v); if (v === D.id) return; location.href = v ? VF.locUrl(v, eid) : VF.stateUrl(eid); } },
      where: this.state.vaMap ? { vb: '0 0 1000 ' + this.state.vaMap.h,
        // a ring around the locality so small cities are easy to spot
        ring: (() => { const nums = (this.state.vaMap.p[D.id] || '').match(/-?\d+(\.\d+)?/g) || []; if (nums.length < 2) return { on: false };
          let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9; for (let k = 0; k + 1 < nums.length; k += 2) { const x = +nums[k], y = +nums[k + 1]; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
          return { on: true, cx: ((x0 + x1) / 2).toFixed(1), cy: ((y0 + y1) / 2).toFixed(1), r: Math.max(22, Math.max(x1 - x0, y1 - y0) / 2 + 12).toFixed(1) }; })(), paths: Object.keys(this.state.vaMap.p).map((id) => ({ d: this.state.vaMap.p[id], fill: id === D.id ? '#41557F' : '#D3D7DE', stroke: id === D.id ? '#121417' : '#FFFFFF', sw: id === D.id ? 3 : 1, order: id === D.id ? 1 : 0 })).sort((a, b) => a.order - b.order) } : { vb: '0 0 1000 440', paths: [], ring: { on: false } },
      showSites: live && D.sites.length > 0, siteMany: D.sites.length > 1, showPrecincts: live && D.precincts.some((p) => p.r),
      fxr, loading: false, ready: true, backHref: VF.stateUrl(eid), L, elChips, hero, cd, paceChips, satLine, backToNow: () => this.setState({ eid: '2026', cal: null, hi: null, calTick: this.state.calTick + 1, chTick: this.state.chTick + 1 }),
      ctrls, years, ch, elLabel: cur.label, cal, sel, calOpts, calRamp: VF.calLegend, sites, siteSummary, heat, tbl, pm, tip, hideTip, bd, sm, siteTable, siteTableNote, rh, pmView: '0 0 1000 ' + D.mapH, band: { asOf: dmd(D.rows[D.rows.length - 1].d) }, siteAllToggle, siteAllPressed: siteAll ? 'true' : 'false', siteAllBg: siteAll ? '#121417' : '#FFFFFF', siteAllFg: siteAll ? '#FFFFFF' : '#121417', siteAllLabel: siteAll ? 'Collapse all addresses & hours' : 'Expand all addresses & hours',
      ticker: ticker0.concat(ticker0, ticker0)
    };
  }
}

VF.page('locality', Locality);
