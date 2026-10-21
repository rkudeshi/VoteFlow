/* VoteFlow page runtime.
 * Renders the design's HTML templates with Preact:
 *   {{path}}             dotted lookup into the page's renderVals() (whole-attribute holes pass raw values)
 *   <sc-for list as>     repeat children for each item ($index available)
 *   <sc-if value>        render children when the value is truthy
 *   onClick="{{fn}}"     event handlers (any on* attribute)
 *   <helmet>             <style>/<link> moved into <head>
 * Pages register with VF.page(name, Logic); templates live in /vf/templates/<name>.html.
 */
(function () {
  'use strict';
  const { h, render, Component, Fragment } = window.preact;

  /* Look settings (the "?" panel): theme (auto / light / dark) and border style (soft gray or bold
     black). Both are applied by rewriting colors as the templates render, so the templates keep
     their light-mode colors as written:
       - tc(str) rewrites every UPPERCASE #RRGGBB and rgb()/rgba() in a style string or SVG color.
       - Lowercase hex is left alone on purpose: use it for colors that must not change in dark
         mode (data ramps on maps, the brand bar). An all-digit color needs a letter to opt out,
         so the near-black is written #12141a there. */
  const pref = (k, d) => { try { return localStorage.getItem(k) || d; } catch (e) { return d; } };
  /* Theme: bold (black frames), balanced (gray frames, black selections), soft (pale frames,
     segmented toggles) or calm (soft plus a quieter palette: only the in-person/mail colors and
     the brand yellow stay colorful). Appearance: auto / light / dark. */
  const MODE = pref('vf-theme', 'auto');
  const LOOK = (() => { const v = pref('vf-look', ''); if (/^(bold|balanced|soft|calm)$/.test(v)) return v; return pref('vf-borders', 'soft') === 'bold' ? 'bold' : 'soft'; })();
  const DARK = MODE === 'dark' || (MODE === 'auto' && !!(window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches));
  const SOFT = LOOK === 'soft' || LOOK === 'calm', BAL = LOOK === 'balanced', CALM = LOOK === 'calm';
  document.documentElement.classList.toggle('vf-dark', DARK);
  document.documentElement.classList.toggle('vf-soft', SOFT);
  document.documentElement.classList.toggle('vf-balanced', BAL);
  document.documentElement.classList.toggle('vf-calm', CALM);
  document.documentElement.style.colorScheme = DARK ? 'dark' : 'light';
  // Dark mode is a soft charcoal, not black: surfaces sit in the 20–30% lightness range.
  const DARK_MAP = { FFFFFF: '33373E', E6E8EC: '2A2D33', '121417': 'ECEEF1', '4A5260': 'B3B9C3', '3A3F48': '6B727D', ECEEF2: '41464E', F1F2F5: '3B3F47',
    F5F6F8: '393D44', F8F9FB: '373B42', D3D7DE: '4D535C', DCDFE5: '484D56', E4D9FA: '4A3F68', EEEEEE: '41464E', '2A2F38': 'DADDE2', '5F6775': 'B3B9C3',
    '8A93A3': '9AA1AD', B7BCC6: '6B727D', FFD23F: 'D4AE2C', FFF6D1: '403A27', F0D27A: '75653A', '5B2FB8': 'BBA4F4', '4E2A9E': 'C9B5F6', '7C4DDB': '9D7CE8',
    '00A37A': '22BE91', '00694F': '6BD8B3', '41557F': '9DB0D6', '1B2A6B': 'B7C6EE', '121A3A': 'D0D8EE', C9CDD4: '5C626C', '7A8291': 'A6ADB8' };
  // Calm: flow-chart blues and amber, red/green status, purple labels and yellow panels go neutral.
  const CALM_MAP = { '2F6FD6': '5B6270', '3B82F6': '7A8291', '6FA6EA': 'B9BEC7', D9E4F2: 'E6E8EC', F5F9FF: 'F7F8FA', F3F8FF: 'F7F8FA', F6F8FD: 'F7F8FA', DCE3EF: 'E6E8EC',
    '4A5672': '4A5260', '5A6E8C': '5B6270', F5A524: '9AA1AD', FBEBC8: 'ECEEF2', FFFBEF: 'F7F8FA', F2C14E: 'B9BEC7', C98A0B: '5B6270', B4400F: '4A5260',
    B42318: '121417', '00694F': '121417', FDECEA: 'F1F2F5', '5B2FB8': '4A5260', '4E2A9E': '4A5260', F0592A: '121417', FFF6D1: 'FFFFFF', F0D27A: 'E6E8EC',
    '41557F': '4A5260', '1B2A6B': '121417', '121A3A': '121417', EDE6FC: 'F1F2F5', F6F2FE: 'F4F5F7', F7F4FE: 'F4F5F7', F5F1FD: 'F4F5F7', C3ADF1: 'C9CDD4', '86D9BA': 'C9CDD4', '4A8FE7': '9AA1AD', '1E3FA0': '121417' };
  const hsl = (r, g, b) => { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2; let hh = 0, ss = 0;
    if (mx !== mn) { const d = mx - mn; ss = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); hh = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; hh /= 6; } return [hh, ss, l]; };
  const rgbOf = (hh, ss, l) => { if (!ss) return [l, l, l].map((v) => Math.round(v * 255)); const q = l < 0.5 ? l * (1 + ss) : l + ss - l * ss, pp = 2 * l - q;
    const f = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? pp + (q - pp) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? pp + (q - pp) * (2 / 3 - t) * 6 : pp; }; return [f(hh + 1 / 3), f(hh), f(hh - 1 / 3)].map((v) => Math.round(v * 255)); };
  const darkRGB = (r, g, b) => {
    const [hh, ss, l] = hsl(r, g, b); let l2 = l, s2 = ss;
    if (ss < 0.12) l2 = Math.min(0.94, Math.max(0.2, 0.96 - l * 0.76));           // grays flip onto charcoal
    else if (l >= 0.85) { l2 = 0.24 + (1 - l) * 0.6; s2 = ss * 0.5; }               // pale tints → dark tints
    else if (l <= 0.3) l2 = 0.78;                                                    // dark ink → light ink
    return rgbOf(hh, s2, l2);
  };
  const memo = {};
  const darkHex = (hx) => { if (DARK_MAP[hx]) return '#' + DARK_MAP[hx]; if (memo[hx]) return memo[hx];
    const c = darkRGB(parseInt(hx.slice(0, 2), 16), parseInt(hx.slice(2, 4), 16), parseInt(hx.slice(4, 6), 16));
    return (memo[hx] = '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()); };
  const FRAME_RE = /(border(?:-top|-right|-bottom|-left)?\s*:\s*[^;"]*?)#(3A3F48|121417|D3D7DE)\b/g;
  const FRAME = SOFT ? '#EEEEEE' : BAL ? '#C3C8D0' : null;
  const tc = (v) => {
    if (typeof v !== 'string' || (!DARK && !FRAME && !CALM)) return v;
    if (FRAME) v = v.replace(FRAME_RE, '$1' + FRAME);
    if (CALM) v = v.replace(/#([0-9A-F]{6})\b/g, (m, hx) => CALM_MAP[hx] ? '#' + CALM_MAP[hx] : m);
    if (DARK) v = v.replace(/#([0-9A-F]{6})\b/g, (m, hx) => darkHex(hx))
      .replace(/rgba?\((\d+),\s*(\d+),\s*(\d+)((?:,\s*[\d.]+)?)\)/g, (m, r, g, b, a) => { const c = darkRGB(+r, +g, +b); return (a ? 'rgba(' : 'rgb(') + c.join(',') + a + ')'; });
    return v;
  };
  const COLOR_ATTRS = { style: 1, fill: 1, stroke: 1, 'stop-color': 1, color: 1 };
  /* The secret look panel, opened with "?" (Shift+/) anywhere outside a text field. */
  const LOOK_CSS = '.vf-look{position:fixed;inset:0;z-index:200;display:grid;place-items:center;background:rgba(18,20,23,.35);backdrop-filter:blur(6px)}'
    + '.vf-look>div{width:min(420px,calc(100vw - 32px));background:rgba(255,255,255,.82);backdrop-filter:blur(18px);border:1px solid rgba(255,255,255,.6);border-radius:22px;padding:22px 22px 18px;box-shadow:0 30px 60px -20px rgba(18,20,23,.5);font-family:"Hanken Grotesk",sans-serif;color:#121417}'
    + '.vf-look h2{margin:0 0 2px;font:700 18px "Unbounded",sans-serif;letter-spacing:-.02em}.vf-look p{margin:0 0 16px;color:#4A5260;font-size:14px}'
    + '.vf-look .row{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 0;border-top:1px solid rgba(18,20,23,.08)}.vf-look .row b{font-size:15px}'
    + '.vf-look .seg{display:inline-flex;gap:3px;padding:4px;border-radius:999px;background:rgba(18,20,23,.07)}'
    + '.vf-look .seg button{border:0;border-radius:999px;background:transparent;color:#4A5260;font:600 13px "Hanken Grotesk",sans-serif;padding:7px 12px;cursor:pointer}'
    + '.vf-look .seg button[aria-pressed=true]{background:#FFFFFF;color:#121417;box-shadow:0 1px 3px rgba(18,20,23,.18)}.vf-look small{display:block;margin-top:12px;color:#4A5260;font-size:12px}';
  const openLook = () => {
    if (document.querySelector('.vf-look')) return;
    const st = document.createElement('style'); st.textContent = tc(LOOK_CSS) + '.vf-look{background:rgba(10,12,15,' + (DARK ? '.55' : '.3') + ')}'; st.id = 'vf-look-css'; document.head.appendChild(st);
    const wrap = document.createElement('div'); wrap.className = 'vf-look'; wrap.setAttribute('role', 'dialog'); wrap.setAttribute('aria-label', 'Look settings');
    const row = (label, key, cur, opts) => '<div class="row"><b>' + label + '</b><span class="seg">' + opts.map(([v, t]) => '<button data-k="' + key + '" data-v="' + v + '" aria-pressed="' + (cur === v) + '">' + t + '</button>').join('') + '</span></div>';
    wrap.innerHTML = '<div><h2>Super secret mode</h2><p>Look settings for this browser.</p>'
      + row('Theme', 'vf-look', LOOK, [['bold', 'Bold'], ['balanced', 'Balanced'], ['soft', 'Soft'], ['calm', 'Calm']])
      + row('Appearance', 'vf-theme', MODE, [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']])
      + '<small>Press ? or Esc to close.</small></div>';
    const close = () => { wrap.remove(); st.remove(); };
    wrap.addEventListener('click', (ev) => { const b = ev.target.closest('button[data-k]');
      if (b) { try { localStorage.setItem(b.dataset.k, b.dataset.v); } catch (e) { /* storage off */ } location.reload(); return; }
      if (ev.target === wrap) close(); });
    document.body.appendChild(wrap); openLook.close = close;
  };
  document.addEventListener('keydown', (ev) => {
    const t = ev.target, typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
    if (ev.key === '?' && !typing) { ev.preventDefault(); if (document.querySelector('.vf-look')) openLook.close(); else openLook(); }
    else if (ev.key === 'Escape' && document.querySelector('.vf-look')) openLook.close();
  });
  if (MODE === 'auto' && window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => location.reload());

  /* <vf-combo items="{{list}}" value="{{v}}" onpick="{{fn}}" placeholder="…" search="true" label="…">
     A custom dropdown: opens the whole list on click/focus, typing filters it (search="true"),
     arrow keys + Enter pick, Escape or a click elsewhere closes. items: [{ value, text, sub }]. */
  const COMBO_CSS = `.vfc{position:relative;min-width:0}.vfc-btn{display:flex;align-items:center;gap:10px;width:100%;box-sizing:border-box;min-height:46px;padding:0 40px 0 16px;background:#FFFFFF;border:2px solid #121417;border-radius:999px;font:700 15px 'Hanken Grotesk',sans-serif;color:#121417;cursor:pointer;text-align:left;position:relative}
.vfc-btn input{flex:1;min-width:0;border:0;outline:0;background:transparent;font:inherit;color:inherit;padding:0}
.vfc-btn input::placeholder{color:#6B7380;font-weight:600}.vfc-btn:focus-within{box-shadow:0 0 0 3px #C9D2EC}
.vfc-car{position:absolute;right:16px;top:50%;width:9px;height:9px;cursor:pointer;color:#121417;border-right:2.5px solid currentColor;border-bottom:2.5px solid currentColor;transform:translateY(-70%) rotate(45deg);transition:transform .15s}
.vfc.open .vfc-car{transform:translateY(-25%) rotate(-135deg)}
.vfc-list{position:absolute;top:calc(100% + 6px);left:0;right:0;min-width:240px;z-index:90;background:#FFFFFF;border:2px solid #121417;border-radius:16px;max-height:340px;overflow-y:auto;box-shadow:0 22px 40px -24px rgba(20,32,43,.6);padding:4px}
.vfc-list::-webkit-scrollbar{width:10px}.vfc-list::-webkit-scrollbar-thumb{background:#9AA9C4;border-radius:999px;border:3px solid #FFFFFF}.vfc-list::-webkit-scrollbar-track{background:transparent}.vfc-list::-webkit-scrollbar-button{display:none;width:0;height:0}@supports not selector(::-webkit-scrollbar){.vfc-list{scrollbar-width:thin;scrollbar-color:#9AA9C4 transparent}}
.vfc-opt{display:flex;align-items:baseline;gap:10px;padding:10px 12px;border-radius:10px;cursor:pointer;font:600 15px 'Hanken Grotesk',sans-serif;color:#121417}.vfc-opt>span{flex:1;min-width:0}
.vfc-opt small{font-size:12.5px;font-weight:500;color:#4A5260;text-align:right}.vfc-opt.hi{background:#EEF1F8}.vfc-opt.on{font-weight:800;background:#F1F2F5}.vfc-opt.on.hi{background:#E6E8EC}.vfc-opt.on::after{content:"✓";font-weight:800;color:#121417}.vfc-t2{font-style:normal;font-weight:500;color:#4A5260}.vfc-opt.rec{padding:6px 12px;font-weight:500;font-size:14px;color:#2A2F38}.vfc-opt.rec small{font-style:italic}.vfc-opt.rec+.vfc-opt:not(.rec){margin-top:5px;box-shadow:0 -1px 0 #ECEEF2}
.vfc-none{padding:12px;color:#4A5260;font:500 14px 'Hanken Grotesk',sans-serif}.vfc-big .vfc-btn{min-height:52px;font-size:17px}`;
  class Combo extends Component {
    constructor(p) { super(p); this.state = { open: false, q: '', idx: 0 }; this.root = null;
      this.away = (ev) => { if (this.state.open && this.root && !this.root.contains(ev.target)) this.setState({ open: false, q: '' }); }; }
    componentDidMount() { document.addEventListener('mousedown', this.away); document.addEventListener('touchstart', this.away, { passive: true }); }
    componentWillUnmount() { document.removeEventListener('mousedown', this.away); document.removeEventListener('touchstart', this.away); }
    list() { const q = this.state.q.trim().toLowerCase(), items = this.props.items || [];
      if (!q) return items;
      return items.filter((o) => o.text.toLowerCase().includes(q)).sort((a, b) => (b.text.toLowerCase().startsWith(q) - a.text.toLowerCase().startsWith(q))); }
    pick(o) { this.setState({ open: false, q: '' }); const a = document.activeElement; if (a && this.root && this.root.contains(a)) a.blur(); if (this.props.onpick) this.props.onpick(o.value); }
    componentDidUpdate(pp, ps) { if (this.state.open && !ps.open && this.root) { const el = this.root.querySelector('.vfc-opt.on'); if (el) el.scrollIntoView({ block: 'nearest' }); } }
    render(p, st) {
      const items = this.list(), cur = (p.items || []).find((o) => o.value === p.value), search = p.search === 'true' || p.search === true;
      const idx = Math.min(st.idx, Math.max(0, items.length - 1));
      const key = (ev) => {
        if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); this.setState({ open: true, idx: Math.max(0, Math.min(items.length - 1, idx + (ev.key === 'ArrowDown' ? 1 : -1))) }); }
        else if (ev.key === 'Enter') { ev.preventDefault(); if (st.open && items[idx]) this.pick(items[idx]); else this.setState({ open: true }); }
        else if (ev.key === 'Escape') this.setState({ open: false, q: '' });
      };
      const open = () => this.setState({ open: true, idx: Math.max(0, items.findIndex((o) => o.value === p.value)) });
      const field = search
        ? h('input', { type: 'text', 'aria-label': p.label || p.placeholder, placeholder: cur && !st.open ? cur.text : p.placeholder, value: st.q, autocomplete: 'off',
            onFocus: open, onInput: (ev) => this.setState({ q: ev.target.value, open: true, idx: 0 }), onKeyDown: key })
        : h('span', { style: 'flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis' }, cur ? cur.text : p.placeholder, cur && cur.text2 ? h('em', { class: 'vfc-t2' }, ' · ' + cur.text2) : null);
      return h('div', { class: 'vfc' + (st.open ? ' open' : '') + (p.big === 'true' ? ' vfc-big' : ''), ref: (r) => { this.root = r; } },
        h('div', { class: 'vfc-btn', role: 'combobox', 'aria-expanded': st.open ? 'true' : 'false', 'aria-label': p.label || p.placeholder, tabIndex: search ? -1 : 0,
          // The whole box (arrow included) opens the list; the arrow closes it again.
          onClick: (ev) => { const car = ev.target.classList && ev.target.classList.contains('vfc-car');
            if (st.open && (car || !search)) { this.setState({ open: false, q: '' }); return; }
            if (search) { const inp = this.root && this.root.querySelector('input'); if (inp && document.activeElement !== inp) inp.focus(); }
            open(); },
          onKeyDown: search ? null : key },
          p.icon === 'search' ? h('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: '#4A5260', 'stroke-width': 2.6, 'stroke-linecap': 'round', 'aria-hidden': 'true' }, h('circle', { cx: 11, cy: 11, r: 7 }), h('path', { d: 'M20 20l-4-4' })) : null,
          field, h('span', { class: 'vfc-car', 'aria-hidden': 'true' })),
        st.open ? h('div', { class: 'vfc-list', role: 'listbox' },
          items.length ? items.map((o, i) => h('div', { role: 'option', 'aria-selected': o.value === p.value ? 'true' : 'false', class: 'vfc-opt' + (i === idx ? ' hi' : '') + (o.value === p.value ? ' on' : '') + (o.cls ? ' ' + o.cls : ''),
            onMouseDown: (ev) => { ev.preventDefault(); this.pick(o); }, onMouseEnter: () => this.setState({ idx: i }) }, h('span', null, o.text, o.text2 ? h('em', { class: 'vfc-t2' }, ' · ' + o.text2) : null), o.sub ? h('small', null, o.sub) : null))
            : h('div', { class: 'vfc-none' }, 'No match')) : null);
    }
  }
  const HOLE = /\{\{\s*([^}]+?)\s*\}\}/g;
  const WHOLE = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/;

  function lookup(scope, path) {
    if (path === 'true') return true;
    if (path === 'false') return false;
    if (path === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(path)) return +path;
    let v = scope;
    for (const k of path.split('.')) { if (v == null) return undefined; v = v[k]; }
    return v;
  }
  const str = (v) => (v == null || v === false ? '' : String(v));

  function compileValue(text) {
    const whole = text.match(WHOLE);
    if (whole) { const p = whole[1]; return (s) => lookup(s, p); }
    if (text.indexOf('{{') < 0) return () => text;
    const parts = []; let last = 0;
    text.replace(HOLE, (all, p, idx) => { parts.push(text.slice(last, idx), { p }); last = idx + all.length; return all; });
    parts.push(text.slice(last));
    return (s) => parts.map((x) => (typeof x === 'string' ? x : str(lookup(s, x.p)))).join('');
  }

  function compileChildren(node) {
    return Array.from(node.childNodes).map(compileNode).filter(Boolean);
  }
  const renderAll = (fns, s) => fns.map((f) => f(s));

  function compileNode(node) {
    if (node.nodeType === 3) {
      const t = node.nodeValue;
      if (!t.trim()) return /\n/.test(t) ? null : () => ' ';
      const v = compileValue(t.trim()), lead = /^\s/.test(t) ? ' ' : '', trail = /\s$/.test(t) ? ' ' : '';
      return (s) => lead + str(v(s)) + trail;
    }
    if (node.nodeType !== 1) return null;
    const tag = node.localName;
    if (tag === 'helmet') return null;
    if (tag === 'vf-combo') {
      const attrs = Array.from(node.attributes).map((a) => [a.name, compileValue(a.value)]);
      return (s) => { const props = {}; for (const [n, f] of attrs) props[n] = f(s); return h(Combo, props); };
    }
    if (tag === 'sc-for') {
      const list = compileValue(node.getAttribute('list') || ''), as = node.getAttribute('as') || 'item';
      const kids = compileChildren(node);
      return (s) => (list(s) || []).map((item, i) => { const sc = Object.create(s); sc[as] = item; sc.$index = i; return renderAll(kids, sc); });
    }
    if (tag === 'sc-if') {
      const cond = compileValue(node.getAttribute('value') || '');
      const kids = compileChildren(node);
      return (s) => (cond(s) ? renderAll(kids, s) : null);
    }
    const attrs = [];
    for (const a of Array.from(node.attributes)) {
      if (a.name.indexOf('hint-') === 0) continue;
      attrs.push([a.name, compileValue(a.value)]);
    }
    let kids = compileChildren(node);
    /* <select sc-options="{{list}}">: the HTML parser drops <sc-for> inside <select>, so options come from a list of {value, text}. */
    const optAttr = attrs.find(([n]) => n === 'sc-options');
    if (optAttr) {
      const list = optAttr[1];
      attrs.splice(attrs.indexOf(optAttr), 1);
      kids = [(s) => (list(s) || []).map((o) => h('option', { value: o.value }, o.text))];
    }
    return (s) => {
      const props = {};
      for (const [n, f] of attrs) {
        const v = f(s);
        if (n.indexOf('on') === 0) { if (typeof v === 'function') props[n] = v; continue; }
        props[n] = COLOR_ATTRS[n] ? tc(v) : v;
      }
      return h(tag, props, renderAll(kids, s));
    };
  }

  function compileTemplate(html) {
    const doc = new DOMParser().parseFromString('<!doctype html><body>' + html + '</body>', 'text/html');
    const helmet = doc.body.querySelector('helmet');
    if (helmet) {
      helmet.querySelectorAll('style, link').forEach((n) => {
        if (n.tagName === 'LINK' && document.head.querySelector('link[href="' + n.getAttribute('href') + '"]')) return;
        const c = document.importNode(n, true); if (c.tagName === 'STYLE') c.textContent = tc(c.textContent);
        document.head.appendChild(c);
      });
      helmet.remove();
    }
    const fns = compileChildren(doc.body);
    return (vals) => renderAll(fns, vals);
  }

  class DCLogic extends Component {
    render() { const v = this.renderVals(); return h(Fragment, null, this.constructor.__tpl(v)); }
  }

  const pages = {};
  window.DCLogic = DCLogic;
  /* The brand bar starts tall at the top of the page and slims down once you scroll. The bar is
     fixed and the page keeps a constant gap for its tall height, so slimming it never moves the
     page (a moving page used to flip the bar back and forth near the top). Two thresholds keep
     it from flickering: slim past 56px, tall again only back near the top. */
  const BAND_CSS = 'html.vf-soft [role=group]{border:1px solid #E1E5EC !important;background:#F0F2F6 !important;padding:4px;gap:3px;border-radius:999px !important}'
    + 'html.vf-soft [role=group]>button{background:transparent !important;color:#586477 !important;border-radius:999px !important;min-height:36px !important}'
    + 'html.vf-soft [role=group]>button[aria-pressed=true]{background:#FFFFFF !important;color:#121417 !important;box-shadow:0 1px 3px rgba(18,20,23,.16),0 0 0 1px rgba(18,20,23,.04)}'
    + 'html.vf-soft [role=group]>button:not([aria-pressed=true]):hover{color:#121417 !important}'
    + '.vf-band{position:fixed !important;top:0;left:0;right:0}body{padding-top:var(--vf-bandh,68px)}body.vf-full .vf-band{display:none !important}';
  { const st = document.createElement('style'); st.textContent = tc(BAND_CSS); document.head.appendChild(st); }
  const measureBand = () => {
    const b = document.querySelector('.vf-band');
    if (b && !document.body.classList.contains('vf-scrolled') && !measureBand.busy) document.documentElement.style.setProperty('--vf-bandh', b.offsetHeight + 'px');
  };
  const onScrollBand = () => {
    const y = window.scrollY, cl = document.body.classList, was = cl.contains('vf-scrolled');
    const now = was ? y > 4 : y > 56;
    if (now === was) return;
    cl.toggle('vf-scrolled', now);
    if (!now) { measureBand.busy = true; clearTimeout(measureBand.t); measureBand.t = setTimeout(() => { measureBand.busy = false; measureBand(); }, 320); }
  };
  window.addEventListener('scroll', onScrollBand, { passive: true });
  /* Gentle motion everywhere: toggle bars get a highlight that slides to the picked option;
     chart bars and lines ease to new values when a view, method or timeline changes; colors fade. */
  const ANIM_CSS = '[role=group].vf-seg{position:relative;isolation:isolate}'
    + '[role=group].vf-seg::before{content:"";position:absolute;left:var(--ix,0);top:var(--iy,0);width:var(--iw,0);height:var(--ih,0);border-radius:999px;background:#121417;z-index:-1;pointer-events:none}'
    + '[role=group].vf-seg.vf-seg-on::before{transition:left .34s cubic-bezier(.3,.9,.3,1),width .34s cubic-bezier(.3,.9,.3,1),top .34s,height .34s}'
    + 'html.vf-soft [role=group].vf-seg::before{background:#FFFFFF;box-shadow:0 1px 3px rgba(18,20,23,.16),0 0 0 1px rgba(18,20,23,.04)}'
    + 'html [role=group].vf-seg>button,html [role=group].vf-seg>button[aria-pressed]{background:transparent !important;box-shadow:none !important;transition:color .28s ease}'
    + '#byday svg rect,#compare svg rect,#where svg rect{transition:y .5s cubic-bezier(.3,.9,.3,1),height .5s cubic-bezier(.3,.9,.3,1),x .5s cubic-bezier(.3,.9,.3,1),width .5s cubic-bezier(.3,.9,.3,1),fill .3s}'
    + '#byday svg path,#byday svg polyline,#compare svg path,#bysite svg path{transition:d .55s cubic-bezier(.3,.9,.3,1)}'
    + 'svg path[fill],svg circle{transition:fill .4s ease,stroke .3s ease}'
    + '.fx-cell,.fx-heat{transition:background-color .35s ease,color .35s ease,border-color .35s ease}'
    + '#daily [style*="background"],#sameday [style*="color"]{transition:background-color .35s ease,color .35s ease}'
    + ':where(button,a,.fx-pill){transition:background-color .2s ease,color .2s ease,border-color .2s ease,box-shadow .2s ease}';
  { const st = document.createElement('style'); st.textContent = tc(ANIM_CSS); document.head.appendChild(st); }
  const syncSegs = () => {
    syncSegs.r = 0;
    document.querySelectorAll('[role=group]').forEach((g) => {
      const b = g.querySelector(':scope > button[aria-pressed="true"]');
      if (!b) { g.classList.remove('vf-seg'); return; }
      const first = !g.classList.contains('vf-seg');
      if (first) g.classList.add('vf-seg');
      g.style.setProperty('--ix', b.offsetLeft + 'px'); g.style.setProperty('--iy', b.offsetTop + 'px');
      g.style.setProperty('--iw', b.offsetWidth + 'px'); g.style.setProperty('--ih', b.offsetHeight + 'px');
      if (first) requestAnimationFrame(() => requestAnimationFrame(() => g.classList.add('vf-seg-on')));
    });
  };
  const segsSoon = () => { if (!syncSegs.r) syncSegs.r = requestAnimationFrame(syncSegs); };
  window.addEventListener('resize', segsSoon);
  document.addEventListener('DOMContentLoaded', () => { new MutationObserver(segsSoon).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-pressed'] }); segsSoon(); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(segsSoon);
  /* The section menu sticks just under the brand bar (--vf-bandnow tracks the bar's live height,
     including while it slims) and marks the group the reader is in. Links carry data-sec, the
     section ids in their group; the last group whose section has reached the menu is current. */
  let bandRO = null, bandEl = null;
  const trackBand = () => {
    const b = document.querySelector('.vf-band'); if (!b || b === bandEl || !window.ResizeObserver) return;
    if (bandRO) bandRO.disconnect(); bandEl = b;
    bandRO = new ResizeObserver(() => document.documentElement.style.setProperty('--vf-bandnow', b.getBoundingClientRect().height + 'px')); bandRO.observe(b);
  };
  const spy = () => {
    spy.r = 0; trackBand();
    const all = Array.from(document.querySelectorAll('.vf-navlink[data-sec]')); if (!all.length) return;
    // Menu entries for boxes this page doesn't have (a locality without site data, say) step aside.
    all.forEach((a) => a.classList.toggle('vf-nosec', !a.dataset.sec.split(' ').some((id) => document.getElementById(id))));
    const links = all.filter((a) => a.getClientRects().length); if (!links.length) return;
    const band = document.querySelector('.vf-band'), line = (band ? band.getBoundingClientRect().bottom : 60) + 40;
    let cur = links[0], best = -Infinity;
    links.forEach((a) => a.dataset.sec.split(' ').forEach((id) => { const el = document.getElementById(id); if (!el) return;
      const top = el.getBoundingClientRect().top; if (top <= line && top > best) { best = top; cur = a; } }));
    all.forEach((a) => { const on = a === cur; if ((a.getAttribute('aria-current') === 'true') !== on) a.setAttribute('aria-current', on ? 'true' : 'false'); });
  };
  const spySoon = () => { if (!spy.r) spy.r = requestAnimationFrame(spy); };
  window.addEventListener('scroll', spySoon, { passive: true });
  window.addEventListener('resize', spySoon);
  document.addEventListener('DOMContentLoaded', () => new MutationObserver(spySoon).observe(document.body, { childList: true, subtree: true }));
  window.addEventListener('resize', measureBand);
  window.addEventListener('load', measureBand);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(measureBand);
  document.addEventListener('DOMContentLoaded', () => { onScrollBand(); measureBand(); new MutationObserver(() => { cancelAnimationFrame(measureBand.f); measureBand.f = requestAnimationFrame(measureBand); }).observe(document.body, { childList: true, subtree: true }); });
  onScrollBand();
  /* In-page menu jumps: boxes slide in as they scroll into view, which shifts where the browser
     thinks they are. Jump to the real layout position instead, just below the sticky bar. */
  document.addEventListener('click', (ev) => {
    const a = ev.target.closest && ev.target.closest('a[href^="#"]');
    if (!a || ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey) return;
    if (a.getAttribute('href') === '#settings') { ev.preventDefault(); openLook(); return; } // footer link to the look panel
    const el = document.getElementById(a.getAttribute('href').slice(1)); if (!el) return;
    ev.preventDefault();
    let top = 0; for (let n = el; n; n = n.offsetParent) top += n.offsetTop;
    // Land below the brand bar at its slim, scrolled height (it slims as the page moves).
    const band = document.querySelector('.vf-band'), off = (band ? band.offsetHeight - (document.body.classList.contains('vf-scrolled') ? 0 : 26) : 90) + 16;
    window.scrollTo({ top: Math.max(0, top - off), behavior: 'smooth' });
    history.replaceState(null, '', a.getAttribute('href'));
  });
  { const st = document.createElement('style'); st.textContent = tc(COMBO_CSS); document.head.appendChild(st); }
  /* Calendar shading: a continuous slate scale, so every daily total gets its own shade. */
  // Lowercase hex output keeps these out of the theme rewrite; dark mode has its own scale.
  const CAL_STOPS = CALM ? (DARK ? [[0, [58, 63, 70]], [0.25, [40, 92, 74]], [0.6, [40, 150, 112]], [1, [120, 220, 180]]] : [[0, [240, 247, 244]], [0.25, [191, 233, 217]], [0.55, [79, 196, 155]], [0.8, [0, 137, 95]], [1, [0, 90, 64]]])
    : DARK ? [[0, [60, 65, 74]], [0.2, [66, 78, 104]], [0.45, [86, 110, 160]], [0.7, [124, 152, 208]], [1, [178, 199, 244]]]
    : [[0, [241, 244, 249]], [0.2, [205, 214, 230]], [0.45, [140, 158, 191]], [0.7, [65, 85, 127]], [1, [27, 42, 107]]];
  const calColor = (q) => {
    q = Math.max(0, Math.min(1, q || 0));
    let j = 1; while (j < CAL_STOPS.length - 1 && q > CAL_STOPS[j][0]) j++;
    const [qa, a] = CAL_STOPS[j - 1], [qb, b] = CAL_STOPS[j], t = (q - qa) / (qb - qa || 1);
    const c = a.map((x, k) => Math.round(x + (b[k] - x) * t));
    return { bg: '#' + c.map((x) => x.toString(16).padStart(2, '0')).join(''), fg: DARK ? (q > 0.55 ? '#12141a' : '#e9ebef') : (q > 0.5 ? '#ffffff' : '#12141a') };
  };
  /* Recently opened localities (this browser only), listed first in the locality pickers. */
  const RECENT_KEY = 'vf-recent-localities';
  const recentLocs = () => { try { const a = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); return Array.isArray(a) ? a.filter((x) => typeof x === 'string').slice(0, 5) : []; } catch (e) { return []; } };
  const addRecent = (id) => { try { localStorage.setItem(RECENT_KEY, JSON.stringify([id].concat(recentLocs().filter((x) => x !== id)).slice(0, 5))); } catch (e) { /* storage off */ } };
  /* items: the full picker list ({ value: id, text }). Returns recent entries (value 'r:<id>') to
     put first; strip the prefix with VF.unRecent when one is picked. */
  const recentItems = (items, skip) => recentLocs().filter((id) => id !== skip).map((id) => items.find((o) => o.value === id)).filter(Boolean)
    .map((o) => ({ value: 'r:' + o.value, text: o.text, sub: 'Recently viewed', cls: 'rec' }));
  /* Days that run differently: Election Day and the state holidays inside the voting window
     (Indigenous Peoples' Day, the second Monday in October, and Veterans Day, Nov 11). */
  const dayFlag = (k, eDate) => {
    if (!k) return '';
    if (k === eDate) return 'Election Day';
    const m = +k.slice(5, 7), d = +k.slice(8, 10), dow = new Date(+k.slice(0, 4), m - 1, d).getDay();
    if (m === 10 && dow === 1 && d >= 8 && d <= 14) return 'Indigenous Peoples’ Day';
    if (m === 11 && d === 11) return 'Veterans Day';
    return '';
  };
  window.VF = {
    /* Pace chips read "▲ 12% vs. …": ratio of this election to another at the same point. */
    vsText: (r) => r >= 1.95 && r <= 2.05 ? '▲ 2×' : r >= 1.5 ? '▲ ' + r.toFixed(1) + '×' : r >= 1.005 ? '▲ ' + Math.round((r - 1) * 100) + '%' : r <= 0.995 ? '▼ ' + Math.round((1 - r) * 100) + '%' : '= even',
    /* Election lines: the one being viewed leads in ink, one comparison election in mid gray,
       every other past election steps back in light gray. */
    elColor: (id, cur, cmp) => id === cur ? '#121417' : id === cmp ? '#7A8291' : '#C9CDD4',
    /* One-line section headlines that state the finding. */
    paceLine: (r, label, sameDay) => {
      const tail = sameDay ? ' at this point' : ' overall';
      if (!r || !isFinite(r)) return '';
      return (r >= 1.95 && r <= 2.05 ? 'About twice ' + label : r >= 1.5 ? r.toFixed(1) + '× ' + label : r >= 1.03 ? Math.round((r - 1) * 100) + '% ahead of ' + label
        : r <= 0.97 ? Math.round((1 - r) * 100) + '% behind ' + label : 'About even with ' + label) + tail;
    },
    /* How the gap with a comparison election moved over the past week (ratios now and 7 days ago). */
    gapLine: (rNow, rWeek, label) => {
      if (!rNow || !rWeek || !isFinite(rNow) || !isFinite(rWeek)) return '';
      const g = (r) => Math.round((r - 1) * 100), a = g(rNow), b = g(rWeek), side = (x) => Math.abs(x) + '% ' + (x >= 0 ? 'ahead of' : 'behind');
      if (Math.abs(a - b) < 3) return 'Holding steady at ' + side(a) + ' ' + label + ' over the past week';
      if (Math.sign(a) !== Math.sign(b) && a !== 0 && b !== 0) return 'Moved from ' + side(b) + ' to ' + side(a) + ' ' + label + ' this past week';
      return (Math.abs(a) > Math.abs(b) ? 'The gap widened' : 'The gap narrowed') + ' this past week: now ' + side(a) + ' ' + label + ', from ' + Math.abs(b) + '%';
    },
    /* days: [{ d: 'YYYY-MM-DD', v: ballots that day }] → { busiest, rhythm } headline strings. */
    dayLines: (days, live) => {
      const DL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'], MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const dt = (k) => new Date(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10));
      const n = (x) => Math.round(x).toLocaleString('en-US');
      const open = days.filter((x) => x.v > 0); if (!open.length) return { busiest: '', rhythm: '' };
      const top = open.reduce((a, b) => (b.v > a.v ? b : a)), td = dt(top.d);
      const avg = (xs) => xs.length ? xs.reduce((a, b) => a + b.v, 0) / xs.length : null;
      const wk = avg(open.filter((x) => { const g = dt(x.d).getDay(); return g >= 1 && g <= 5; })), sat = avg(open.filter((x) => dt(x.d).getDay() === 6));
      return { busiest: 'Busiest day' + (live ? ' so far' : '') + ': ' + DL[td.getDay()] + ', ' + MO[td.getMonth()] + ' ' + td.getDate() + ', with ' + n(top.v) + ' ballots',
        rhythm: wk ? 'Weekdays average ' + n(wk) + ' ballots' + (sat ? '; Saturdays ' + n(sat) : '') : '' };
    },
    dayFlag, flagChip: (k, eDate) => { const t = dayFlag(k, eDate); return t === 'Election Day' ? '★ Election Day' : t ? 'Holiday · ' + t : ''; },
    recentLocs, addRecent, recentItems, unRecent: (v) => (v || '').replace(/^r:/, ''),
    dark: DARK, soft: SOFT, calm: CALM, look: LOOK, tc, calColor, calLegend: [0.05, 0.2, 0.35, 0.5, 0.65, 0.8, 1].map((q) => calColor(q).bg),
    page(name, Logic) { pages[name] = Logic; },
    /* Mail ballots must arrive by noon on the 3rd day after Election Day; a weekend or
       state holiday (Veterans Day, Nov 11) moves it to the next business day. */
    deadline(eday) {
      let d = VF.addDays(eday, 3);
      const off = (iso) => { const x = new Date(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)).getDay(); return x === 0 || x === 6 || iso.slice(5) === '11-11'; };
      while (off(d)) d = VF.addDays(d, 1);
      return d;
    },
    /* "In person vs. mail" map colors: a place's in-person share of early votes minus the
       overall share. Green = leans in person, purple = leans mail, gray = near the average. */
    LEAN: ['#4e2a9e', '#8e6adf', '#cdbcf3', '#e3e6eb', '#bdebd6', '#4cc49b', '#00694f'],
    leanColor(e, m, base) {
      if (!(e + m)) return '#F1F2F5';
      const d = e / (e + m) - base, a = Math.abs(d), k = a < 0.03 ? 0 : a < 0.08 ? 1 : a < 0.15 ? 2 : 3;
      return VF.LEAN[3 + (d < 0 ? -k : k)];
    },
    /* Map shading: one continuous ramp between a light and a dark color, so every value gets its
       own shade (no bins). t runs 0..1 from the lowest value shown to the highest. Lowercase hex
       stays out of the theme rewrite; dark mode has its own ends. */
    RAMP: DARK ? { g: [[44, 66, 58], [120, 222, 186]], p: [[60, 54, 84], [196, 172, 245]] } : { g: [[227, 244, 236], [0, 85, 60]], p: [[239, 233, 252], [74, 38, 150]] },
    ramp(t, kind) {
      const [a, b] = VF.RAMP[kind === 'p' ? 'p' : 'g'], q = Math.max(0, Math.min(1, isFinite(t) ? t : 0));
      return '#' + a.map((x, k) => Math.round(x + (b[k] - x) * q).toString(16).padStart(2, '0')).join('');
    },
    rampCss(kind) { return 'linear-gradient(90deg, ' + VF.ramp(0, kind) + ', ' + VF.ramp(1, kind) + ')'; },
    leanBins() {
      return [['≥15 pts more mail', 0], ['8–15', 1], ['3–8', 2], ['near avg', 3], ['3–8', 4], ['8–15', 5], ['≥15 pts more in person', 6]].map(([l, i]) => ({ c: VF.LEAN[i], l }));
    },
    /* Series index (0 = 46 days before Election Day) of a date. */
    idxOf(eday, iso) {
      const p = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
      return 46 + Math.round((p(iso) - p(eday)) / 864e5);
    },
    /* 'YYYY-MM-DD' + n days, in local calendar terms */
    addDays(iso, n) {
      const d = new Date(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) + n);
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    },
    async mount(name, props, el) {
      const Logic = pages[name];
      const html = await fetch('/vf/templates/' + name + '.html').then((r) => r.text());
      Logic.__tpl = compileTemplate(html);
      el.innerHTML = '';
      const draw = () => render(h(Logic, props), el);
      draw();
    },
    /* URLs: /va/<locality>/<election>, /va/statewide/<election>, /va/<locality> (its elections).
       Election ids stay internal; VF.site (built into /data/site.js) maps them to URL slugs:
       year-month (2026-11), or the full date when two elections share a month. */
    site: { live: '2026', elections: [], localities: [] },
    slugOf: (eid) => (VF.site.elections.find((x) => x.id === eid) || {}).slug,
    eidOf: (s) => (VF.site.elections.find((x) => x.slug === s) || {}).id,
    stateUrl: (eid) => eid === VF.site.live || !VF.slugOf(eid) ? '/va' : '/va/statewide/' + VF.slugOf(eid),
    locUrl: (lid, eid) => '/va/' + lid + '/' + (VF.slugOf(eid) || VF.slugOf(VF.site.live)),
    placeUrl: (lid) => '/va/' + lid,
    /* Routes: / (state picker), /status, /about, /va, /va/statewide[/<date>], /va/<locality>[/<date>]; anything else is not found. */
    route(pathname) {
      const parts = pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
      const live = VF.site.live, none = { page: 'notfound', props: {} };
      if (!parts.length) return { page: 'states', props: {} };
      if (parts.length === 1 && (parts[0] === 'status' || parts[0] === 'about')) return { page: parts[0], props: {} };
      if (parts[0] !== 'va' || parts.length > 3) return none;
      if (parts.length === 1) return { page: 'home', props: { eid: live } };
      const eid = parts[2] ? VF.eidOf(parts[2]) : live;
      if (!eid) return none;
      if (parts[1] === 'statewide') return { page: 'home', props: { eid } };
      if (!VF.site.localities.includes(parts[1])) return none;
      if (parts.length === 2) return { page: 'place', props: { lid: parts[1] } };
      return { page: 'locality', props: { eid, lid: parts[1] } };
    }
  };
})();
