/* Ballots-by-day chart with planning estimates, shared by the homepage and locality pages.
 * VF.byDay(o) → { bd, barInfo }. o: { ser, refs, live, endI, T, date, reg, label, sched, gate,
 * rowDaily, st, set, tipAt }. Estimates scale reference elections' remaining days to this
 * election's pace; gate 'none' skips the open-day check (statewide). */
(function () {
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const DOWL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const parse = (s) => new Date(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  const dmd = (s) => { const d = parse(s); return DOW[d.getDay()] + ' ' + MON[d.getMonth()] + ' ' + d.getDate(); };
  const f = (n) => n == null ? '—' : Math.round(n).toLocaleString('en-US');
  const fz = (n) => !n ? '–' : Math.round(n).toLocaleString('en-US');
  const short = (n) => n >= 1e6 ? (n / 1e6).toFixed(2).replace(/0$/, '') + 'M' : n >= 1e4 ? Math.round(n / 1000) + 'K' : n >= 1000 ? (n / 1000).toFixed(1) + 'K' : String(Math.round(n));
  const pill = (cur, v) => ({ pressed: cur === v ? 'true' : 'false', bg: cur === v ? '#121417' : '#FFFFFF', fg: cur === v ? '#FFFFFF' : '#121417' });
  VF.byDay = function (o) {
    const { ser, live, endI, T, st, set, tipAt } = o;
    const eDate = parse(o.date);
    const bdView = st.bdView || 'daily', bdM = st.bdM || 'all', bdWin = st.bdWin || 'deadline';
    let lastI = -1; for (let i = 0; i < 53; i++) if (ser.e[i] != null) lastI = i;
    const dayDate = (i) => { const x = new Date(eDate); x.setDate(x.getDate() - (46 - i)); return x; };
    const act = Array.from({ length: 53 }, (_, i) => { if (ser.e[i] == null) return null; const pe = i > 0 && ser.e[i - 1] != null ? ser.e[i - 1] : 0, pmm = i > 0 && ser.m[i - 1] != null ? ser.m[i - 1] : 0; return { de: ser.e[i] - pe, dm: ser.m[i] - pmm, e: ser.e[i], m: ser.m[i] }; });
    // Prefer the source's own daily counts where it publishes them.
    if (o.rowDaily) o.rowDaily.forEach((r) => { const i = VF.idxOf(o.date, r.d); if (act[i] && r.de != null) { act[i].de = r.de; act[i].dm = r.dm; } });
    // Fairfax and Prince William publish how mail ballots came back (post vs. drop box); split each day's mail
    // returns by that day's county shares so the bars still add up to the totals shown elsewhere.
    const fx = o.fx && o.fx.p ? o.fx : null;
    if (fx) act.forEach((r, i) => { if (!r || fx.p[i] == null) return;
      const dP = Math.max(0, fx.p[i] - (i && fx.p[i - 1] != null ? fx.p[i - 1] : 0)), dB = Math.max(0, fx.b[i] - (i && fx.b[i - 1] != null ? fx.b[i - 1] : 0));
      // Where the bars are the state's daily counts (o.fxRunShare), the county's processing days don't
      // line up with them, so its running share is used instead of that day's share.
      const run = fx.p[i] + fx.b[i] > 0 ? fx.b[i] / (fx.p[i] + fx.b[i]) : 0;
      const share = o.fxRunShare ? run : dP + dB > 0 ? dB / (dP + dB) : run;
      r.dmB = Math.round(Math.max(0, r.dm) * share); r.dmP = Math.max(0, r.dm) - r.dmB; });
    const split = !!fx && act.some((r) => r && r.dmB != null);
    const hasSched = Object.keys(o.sched || {}).length > 0;
    // Open capacity in site-hours. Under the 2026 law every locality offers in-person voting every
    // day from the Sunday 16 days out (E–16) through the last Saturday (E–3); before that, assume
    // the registrar's office keeps weekday hours. Schedules that list the office replace that guess.
    const LAW0 = 30, WKND = 1.3, stdH = (dow) => dow === 0 ? 5 : 8;
    const capOf = (i) => {
      if (i > 43) return 0;
      const d = dayDate(i), dow = d.getDay(), office = dow >= 1 && dow <= 5 || i >= LAW0;
      if (o.gate === 'none') return stdH(dow);
      const sc = hasSched ? o.sched[iso(d)] : null;
      let h = sc ? sc.h || sc.n * stdH(dow) : 0;
      if (office && (!o.officeKnown || (!sc && i >= LAW0))) h += stdH(dow);
      return h;
    };
    const cap = Array.from({ length: 53 }, (_, i) => capOf(i));
    // A trailing open day with no ballots at all usually hasn't been counted yet: estimate it.
    if (live) while (lastI > 0 && act[lastI] && !act[lastI].de && !act[lastI].dm && cap[lastI] > 0 && o.refs.length) { act[lastI] = null; lastI--; }
    const refs = live ? o.refs.filter((x) => x.series && x.series.e[lastI]) : [];
    const med = (arr) => { const q = arr.slice().sort((x, y) => x - y); const L2 = q.length; return !L2 ? null : L2 % 2 ? q[(L2 - 1) / 2] : (q[L2 / 2 - 1] + q[L2 / 2]) / 2; };
    const estFor = (key, i) => { const v = refs.map((r) => { const s2 = r.series; if (s2[key][i] == null || s2[key][i - 1] == null || !s2[key][lastI]) return null; return Math.max(0, s2[key][i] - s2[key][i - 1]) * ser[key][lastI] / s2[key][lastI]; }).filter((x) => x != null); return med(v); };
    // Day-by-day medians give the shape; scale them so the remaining total matches the median
    // remaining total across reference elections (daily medians alone run low for lumpy reports).
    const estLevel = {};
    if (live && refs.length && lastI >= 0) [['e', 43], ['m', endI]].forEach(([key, end]) => {
      let sum = 0; for (let i = lastI + 1; i <= end; i++) sum += estFor(key, i) || 0;
      const whole = med(refs.map((r) => { const s2 = r.series; return s2[key][end] != null && s2[key][lastI] ? (s2[key][end] - s2[key][lastI]) * ser[key][lastI] / s2[key][lastI] : null; }).filter((x) => x != null));
      estLevel[key] = sum > 0 && whole != null ? Math.max(0, whole) / sum : 1;
    });
    // Recent level: this year's last three weekdays times how each past election's day compared with
    // those same three weekdays (median). It catches the final-week ramp (final Friday and Saturday)
    // better than season pace; backtested on every locality in Nov 2021–2025, next-day misses fell
    // from about 29% to 21%. Blended 2:1 with the pace estimate, which holds up when a locality's
    // latest days are reported late.
    const rd = (s2, i) => s2.e[i] != null && s2.e[i - 1] != null ? Math.max(0, s2.e[i] - s2.e[i - 1]) : null;
    const anc = []; for (let j = lastI; j > 0 && anc.length < 3; j--) { const dw = dayDate(j).getDay(); if (dw && dw < 6 && act[j] && refs.every((r) => rd(r.series, j) != null)) anc.push(j); }
    const ancBase = anc.reduce((a, j) => a + Math.max(0, act[j].de), 0);
    const recentE = (i) => { if (anc.length < 3 || ancBase <= 0) return null;
      const v = refs.map((r) => { const den = anc.reduce((a, j) => a + rd(r.series, j), 0), x = rd(r.series, i); return den > 0 && x != null ? x / den : null; }).filter((x) => x != null);
      return v.length ? ancBase * med(v) : null; };
    const refE = Array.from({ length: 53 }, (_, i) => { if (!(live && i > lastI && i < 46 && cap[i] > 0)) return 0;
      // A big change in open site-hours from those weekdays (satellites opening for the final days)
      // isn't in past elections' ratios, so there the pace estimate stands alone.
      const capA = anc.reduce((a, j) => a + cap[j], 0) / Math.max(1, anc.length), cr = capA > 0 ? cap[i] / capA : 1;
      const pace = (estFor('e', i) || 0) * (estLevel.e || 1), rec = cr < 0.67 || cr > 1.5 ? null : recentE(i);
      return rec == null ? pace : pace > 0 && rec > 0 ? Math.exp((Math.log(pace) + 2 * Math.log(rec)) / 3) : Math.max(pace, rec); });
    // Past elections were mostly closed on weekends, so their same-day counts can't speak for a
    // weekend this year. There, use the ballots per site-hour on the nearest weekdays before and
    // after (reported or estimated) times this day's site-hours, with weekend hours running about
    // 30% busier, as the first 2026 weekend days showed (Arlington Oct 17, Loudoun Oct 18).
    const dayIn = (j) => j <= lastI ? (act[j] ? Math.max(0, act[j].de) : 0) : refE[j];
    const rateNear = (i) => {
      const r = [];
      [-1, 1].forEach((step) => { for (let j = i + step, n = 0; j >= 0 && j <= 43 && n < 7; j += step, n++) {
        const dow = dayDate(j).getDay(); if (dow === 0 || dow === 6 || !cap[j]) continue;
        const v = dayIn(j); if (v > 0) { r.push(v / cap[j]); break; } } });
      return r.length ? r.reduce((a, b) => a + b, 0) / r.length : 0;
    };
    const plan = Array.from({ length: 53 }, (_, i) => {
      if (!live || i <= lastI || !refs.length) return null;
      let pe = refE[i], filled = false;
      if (cap[i] > 0 && i < 46) { const dw = dayDate(i).getDay(), comp = rateNear(i) * cap[i] * (dw === 0 || dw === 6 ? WKND : 1); if (pe < 0.3 * comp) { pe = comp; filled = true; } }
      const pmail = (estFor('m', i) || 0) * (estLevel.m || 1);
      const err = filled ? 0.40 : i <= 36 ? 0.21 : 0.30, errM = i <= 36 ? 0.21 : 0.30;
      return { e: pe, m: pmail, filled, cap: cap[i], eLo: pe * Math.exp(-err), eHi: pe * Math.exp(err), mLo: pmail * Math.exp(-errM), mHi: pmail * Math.exp(errM) };
    });
    const N = bdWin === 'today' ? (live ? lastI + 1 : T + 1) : endI + 1;
    const usePlan = live && bdWin !== 'today' && refs.length > 0;
    const pick3 = (o, ke, km) => bdM === 'all' ? o[ke] + o[km] : bdM === 'early' ? o[ke] : o[km];
    const BX = (i) => 60 + (i + 0.5) / N * 940;
    const bw = 940 / N * 0.72;
    const cumAct = (i) => act[i] ? (bdM === 'all' ? act[i].e + act[i].m : bdM === 'early' ? act[i].e : act[i].m) : null;
    const cumLo = [], cumHi = [], cumMid = [];
    if (usePlan) { let c = cumAct(lastI), lo = c, hi = c; for (let i = lastI + 1; i <= endI; i++) { const p = plan[i]; c += pick3(p, 'e', 'm'); lo += pick3(p, 'eLo', 'mLo'); hi += pick3(p, 'eHi', 'mHi'); cumMid[i] = c; cumLo[i] = lo; cumHi[i] = hi; } }
    let bdPeak = 1;
    if (bdView === 'daily') { for (let i = 0; i < N; i++) { if (act[i]) bdPeak = Math.max(bdPeak, pick3(act[i], 'de', 'dm')); if (usePlan && plan[i]) bdPeak = Math.max(bdPeak, pick3(plan[i], 'eHi', 'mHi')); } }
    else { for (let i = 0; i < N; i++) { const v = cumAct(i); if (v != null) bdPeak = Math.max(bdPeak, v); if (usePlan && cumHi[i]) bdPeak = Math.max(bdPeak, cumHi[i]); } }
    const bunits = [50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000];
    const btop = Math.min(...bunits.map((u) => Math.ceil(bdPeak * 1.05 / (4 * u)) * 4 * u));
    const BY = (v) => 400 - v / btop * 380;
    const bars = [], planBars = [];
    for (let i = 0; i < N; i++) { const r = act[i]; if (!r) continue; const ve = bdM === 'mail' ? 0 : r.de, vm = bdM === 'early' ? 0 : r.dm; const hE = Math.max(0, ve) / btop * 380, hM = Math.max(0, vm) / btop * 380; // corrections can be negative
      const hB = r.dmB != null && vm > 0 ? r.dmB / Math.max(1, r.dm) * hM : 0;
      bars.push({ x: (BX(i) - bw / 2).toFixed(1), w: bw.toFixed(1), yE: (400 - hE).toFixed(1), hE: hE.toFixed(1), yM: (400 - hE - hM).toFixed(1), hM: hM.toFixed(1),
        yB: (400 - hE - hM).toFixed(1), hB: hB.toFixed(1), delay: (i * 18) + 'ms' }); }
    if (usePlan) for (let i = lastI + 1; i < N; i++) { const p = plan[i]; if (!p) continue; const v = pick3(p, 'e', 'm'); if (!v) continue; const hh = v / btop * 380;
      const ve2 = bdM === 'mail' ? 0 : p.e, vm2 = bdM === 'early' ? 0 : p.m, hE2 = ve2 / btop * 380, hM2 = vm2 / btop * 380;
      planBars.push({ x: (BX(i) - bw / 2).toFixed(1), w: bw.toFixed(1), y: (400 - hh).toFixed(1), h: hh.toFixed(1),
        yE: (400 - hE2).toFixed(1), hE: hE2.toFixed(1), yM: (400 - hE2 - hM2).toFixed(1), hM: hM2.toFixed(1), hasE: hE2 > 0.5, hasM: hM2 > 0.5, cx: BX(i).toFixed(1), lo: BY(pick3(p, 'eLo', 'mLo')).toFixed(1), hi: BY(pick3(p, 'eHi', 'mHi')).toFixed(1), delay: (300 + (i - lastI) * 25) + 'ms' }); }
    const linePts = (fnv, from, to) => { let d = '', pen = false; for (let i = from; i <= to; i++) { const v = fnv(i); if (v == null) { pen = false; continue; } d += (pen ? ' L' : 'M') + BX(i).toFixed(1) + ',' + BY(v).toFixed(1); pen = true; } return d; };
    const bline = linePts(cumAct, 0, N - 1);
    const eLine = bdM === 'all' ? linePts((i) => act[i] ? act[i].e : null, 0, N - 1) : '';
    const mLine = bdM === 'all' ? linePts((i) => act[i] ? act[i].m : null, 0, N - 1) : '';
    let band = '', projLine = '';
    if (usePlan) {
      const up = [], dn = []; for (let i = lastI; i < N; i++) { const hi2 = i === lastI ? cumAct(i) : cumHi[i], lo2 = i === lastI ? cumAct(i) : cumLo[i]; up.push(BX(i).toFixed(1) + ',' + BY(hi2).toFixed(1)); dn.unshift(BX(i).toFixed(1) + ',' + BY(lo2).toFixed(1)); }
      band = 'M' + up.join(' L') + ' L' + dn.join(' L') + ' Z';
      projLine = linePts((i) => i === lastI ? cumAct(i) : i > lastI ? cumMid[i] : null, lastI, N - 1);
    }
    const rnd = (v) => v >= 1e6 ? (v / 1e6).toFixed(v >= 1e7 ? 1 : 2) + 'M' : v >= 10000 ? Math.round(v / 1000) + 'K' : v >= 1000 ? (Math.round(v / 100) / 10) + 'K' : v >= 100 ? String(Math.round(v / 10) * 10) : String(Math.round(v));
    const sumPlan = (key) => plan.reduce((acc, p) => p ? acc + p[key] : acc, 0);
    const curE = lastI >= 0 ? act[lastI].e : 0, curM = lastI >= 0 ? act[lastI].m : 0;
    const remE = sumPlan('e'), remELo = sumPlan('eLo'), remEHi = sumPlan('eHi'), remM = sumPlan('m'), remMLo = sumPlan('mLo'), remMHi = sumPlan('mHi');
    const futX = BX(lastI) + 940 / N / 2;
    const bdOpt = (label, key, curv, list) => ({ label, opts: list.map(([v, l]) => Object.assign({ label: l, pick: () => set({ [key]: v, tip: null }) }, pill(curv, v))) });
    const xs = []; for (let i = 0; i < N; i += (N > 30 ? 7 : 4)) xs.push(i);
    const bd = {
      daily: bdView === 'daily', cum: bdView !== 'daily', hasPlan: usePlan, showE: N > 46, showToday: live && N > lastI + 1,
      ctrls: [bdOpt('View', 'bdView', bdView, [['daily', 'Daily ballots'], ['cum', 'Cumulative']]), bdOpt('Method', 'bdM', bdM, [['all', 'All early'], ['early', 'In person'], ['mail', 'By mail']]),
        bdOpt('Timeline', 'bdWin', bdWin, [['today', live ? 'Through today' : 'Through same point'], ['deadline', 'Through election end']])],
      yTitle: bdView === 'daily' ? 'Ballots per day' : 'Ballots, running total',
      yt: [0, 1, 2, 3, 4].map((j) => ({ y: 400 - j * 95, ty: 404 - j * 95, l: short(btop * j / 4), stroke: j === 0 ? '#121417' : '#ECEEF2' })),
      xt: xs.map((i) => { const x = dayDate(i); return { x: BX(i).toFixed(1), l: MON[x.getMonth()] + ' ' + x.getDate() }; }),
      eX: BX(46).toFixed(1), todayX: futX.toFixed(1), todayLX: (futX - 6).toFixed(1), futX: futX.toFixed(1), futW: Math.max(0, 1000 - futX).toFixed(1), futLX: (futX + 8).toFixed(1),
      bars, plan: planBars, line: bline, eLine, mLine, band, projLine,
      hits: Array.from({ length: N }, (_, i) => ({ x: (BX(i) - 940 / N / 2).toFixed(1), w: (940 / N).toFixed(1), fill: st.tip && st.tip.kind === 'bar' && st.tip.key === i ? 'rgba(18,20,23,.06)' : 'transparent', move: (ev) => set({ tip: tipAt(ev, 'bar', i) }) })),
      // Projected final totals (reported so far plus the estimates ahead), the old planning view's
      // style: the total, its range, what is still to come, and the share of registered voters.
      chips: usePlan ? (() => {
        const pctR = (v) => (v / o.reg * 100).toFixed(1) + '%';
        const finE = curE + remE, finM = curM + remM, lo = curE + curM + remELo + remMLo, hi = curE + curM + remEHi + remMHi;
        return [
          { k: 'Early turnout, projected', v: '≈ ' + pctR(finE + finM), sub: 'Range ' + pctR(lo) + '–' + pctR(hi), sub2: pctR(curE + curM) + ' so far · of ' + f(o.reg) + ' registered', dot: '' },
          { k: 'All early, projected final', v: '≈ ' + rnd(finE + finM), sub: 'Range ' + rnd(lo) + '–' + rnd(hi), sub2: rnd(remE + remM) + ' still to come · ' + rnd(curE + curM) + ' so far', dot: '' },
          { k: 'In person, projected final', v: '≈ ' + rnd(finE), sub: 'Range ' + rnd(curE + remELo) + '–' + rnd(curE + remEHi), sub2: rnd(remE) + ' still to come · ' + rnd(curE) + ' so far', dot: '#00A37A' },
          { k: 'By mail, projected final', v: '≈ ' + rnd(finM), sub: 'Range ' + rnd(curM + remMLo) + '–' + rnd(curM + remMHi), sub2: rnd(remM) + ' still to arrive, through ' + dmd(iso(dayDate(endI))), dot: '#7C4DDB' }
        ]; })() : [],
      legend: [{ l: 'In person', bg: '#00A37A', border: '0' }, { l: split ? 'Returned by mail' : 'By mail', bg: '#7C4DDB', border: '0' }].concat(split && bdM !== 'early' ? [{ l: 'Drop box', bg: '#C4AEF6', border: '0' }] : []).concat(usePlan ? [{ l: 'Estimate · in person', bg: '#EEF8F3', border: '1.5px dashed #86D9BA' }, { l: 'Estimate · by mail', bg: '#F5F1FD', border: '1.5px dashed #C3ADF1' }, { l: 'Line = likely range', bg: '#6B7380', border: '0' }] : []),
      note: live ? (usePlan ? 'Estimates: for each past November election (' + refs.map((r) => r.label.replace('November ', '')).join(', ') + '), the ballots it added on the same day before Election Day, scaled by how 2026 compares with it so far; each bar is the middle value, adjusted so the days ahead add up to the middle of those elections’ remaining totals. In person, that is blended with a second estimate: this year’s last three weekdays times how much busier each past election got on that day compared with its own same three weekdays, which follows the rise into the final Friday and Saturday more closely. In-person estimates cover every day a site is open, including every day from ' + dmd(iso(dayDate(LAW0))) + ' through ' + dmd(iso(dayDate(43))) + ', when state law keeps every locality open' + (hasSched || o.gate === 'none' ? '' : ' (other days assumed: the registrar’s office on weekdays)') + '. Where past elections were mostly closed, as on most weekends, the in-person estimate is this year’s ballots per site-hour on the nearest weekdays, about 30% higher on weekends, times that day’s site-hours. Hover a bar for the details.' : 'Ballots added each day. Switch the timeline to see planning estimates for the days ahead.') : 'Ballots added each day, derived from the running totals.'
    };
    if (split && bdM !== 'early') bd.note += ' Mail returns are split into returned by mail and drop box using ' + (o.county || 'the county') + '’s own daily report.';
    const barInfo = (i) => {
      const dd = dayDate(i), r = act[i], p = plan[i], k5 = iso(dd), sc = live && o.sched ? o.sched[k5] : null;
      const eL = i <= 46 ? 'E–' + (46 - i) : 'E+' + (i - 46);
      const rowsB = [];
      if (r) rowsB.push({ k: 'In person', v: fz(r.de) }, ...(r.dmB != null ? [{ k: 'Returned by mail', v: fz(r.dmP) }, { k: 'Drop box', v: fz(r.dmB) }] : [{ k: 'By mail', v: fz(r.dm) }]), { k: 'Total that day', v: fz(r.de + r.dm) }, { k: 'Running total', v: f(r.e + r.m) }, { k: 'Turnout so far', v: ((r.e + r.m) / o.reg * 100).toFixed(2) + '%' });
      if (!r && p) rowsB.push({ k: 'Est. in person', v: '≈ ' + rnd(p.e) + (p.e ? ' (' + rnd(p.eLo) + '–' + rnd(p.eHi) + ')' : '') }, { k: 'Est. mail returns', v: '≈ ' + rnd(p.m) }, { k: 'Est. running total', v: '≈ ' + rnd((cumMid[i] || 0)) }, ...(p.e && o.gate !== 'none' ? [{ k: 'Site-hours open', v: rnd(p.cap) }] : []));
      // Plain-language note: the same day in past elections, scaled to this election's pace.
      let note = '';
      if (!r && p && p.filled) note = 'Past November elections had little or no in-person voting on this day, so the in-person estimate is this year’s ballots per site-hour on the nearest weekdays' + (dd.getDay() % 6 ? '' : ', plus about 30% for a weekend') + ' (about ' + rnd(p.e / p.cap) + ' an hour), times ' + (o.gate === 'none' ? 'this day’s usual hours.' : 'the ' + rnd(p.cap) + ' site-hours open' + (sc ? '.' : ' (assumed: the registrar’s office).'));
      else if (!r && p) {
        const vals = refs.map((ref) => { const s2 = ref.series; let v = 0, ok = false;
          ['e', 'm'].forEach((key) => { if (key === 'e' && !p.e) return; if (s2[key][i] != null && s2[key][i - 1] != null && s2[key][lastI]) { v += Math.max(0, s2[key][i] - s2[key][i - 1]) * ser[key][lastI] / s2[key][lastI]; ok = true; } });
          return ok ? v : null; }).filter((x) => x != null).sort((a, b) => a - b);
        if (vals.length) note = 'On this same day in ' + refs.length + ' past November elections, adjusted to this year’s pace, ' + (o.place || 'this place') + ' saw between ' + rnd(vals[0]) + ' and ' + rnd(vals[vals.length - 1]) + ' ballots. The estimate is about ' + rnd(p.e + p.m) + ', near the middle.';
      }
      return { flag: VF.flagChip(k5, o.date), kicker: eL + (r ? ' · reported' : ''), title: DOWL[dd.getDay()] + ', ' + MON[dd.getMonth()] + ' ' + dd.getDate(), sub: o.label, rows: rowsB,
        hasBadge: !r && !!p, badge: 'Estimate · not reported yet',
        note, hasList: !!(sc && sc.open.length),
        listHead: sc ? (sc.n === 1 ? '1 site open' : sc.n + ' sites open') : '',
        list: sc ? sc.open.map(([nm, hrs]) => ({ k: nm + ' (' + hrs + ')', v: '' })) : [] };
    };

    return { bd, barInfo };
  };
})();
