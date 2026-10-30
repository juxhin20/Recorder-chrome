// Screenshot editor: pick an area, draw on it, then copy or save.
// Classic script (no modules) so it can be injected into any page and also used by shot.html.
// The page itself is never touched: everything lives in a shadow root on top of a frozen screenshot.

window.__recSnip = function snip({ img, mode, labels: L }) {
  // mode 'area': the user drags a box. 'visible': the whole viewport is pre-selected.
  // 'page': full-page image inside shot.html (the document scrolls, toolbars stay fixed).
  document.getElementById('__rec_snip')?.remove();
  const page = mode === 'page';

  const host = document.createElement('div');
  host.id = '__rec_snip';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `<style>
    :host { all: initial; }
    .wrap { position: ${page ? 'absolute' : 'fixed'}; left: 0; top: 0; z-index: 2147483647; cursor: crosshair;
            font: 500 13px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; user-select: none; }
    .wrap > img, .wrap > canvas { position: absolute; left: 0; top: 0; width: 100%; height: 100%; display: block; }
    .wrap > canvas { pointer-events: none; }
    .shade { position: absolute; inset: 0; background: rgba(0, 0, 0, .45); }
    .sel { position: absolute; display: none; outline: 1px dashed #fff; box-shadow: 0 0 0 1px rgba(0,0,0,.5), 0 0 0 99999px rgba(0, 0, 0, .45); }
    .has-sel .shade { display: none; }
    .sel.move { cursor: move; }
    .h { position: absolute; width: 8px; height: 8px; margin: -5px 0 0 -5px; background: #fff; border: 1px solid #111; box-sizing: border-box; }
    .size { position: absolute; left: 0; top: -24px; padding: 3px 7px; border-radius: 5px; background: rgba(15, 23, 42, .85); color: #fff; font-size: 11.5px; white-space: nowrap; }
    .bar { position: ${page ? 'fixed' : 'absolute'}; display: none; gap: 2px; padding: 4px; border-radius: 10px;
           background: #fff; box-shadow: 0 6px 24px rgba(0, 0, 0, .28), 0 0 0 1px rgba(0, 0, 0, .06); cursor: default; }
    .tools { flex-direction: column; }
    .ready .bar { display: flex; }
    button { all: unset; box-sizing: border-box; width: 32px; height: 32px; border-radius: 7px; display: grid; place-items: center; color: #1f2937; cursor: pointer; }
    button:hover { background: #f1f3f6; }
    button.on { background: #fee2e2; color: #ef4444; }
    button.go { width: auto; padding: 0 11px; gap: 6px; display: inline-flex; align-items: center; font-weight: 600; }
    button.go.main { background: #ef4444; color: #fff; }
    button.go.main:hover { background: #dc2626; }
    button svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
    .sep { width: 1px; height: 22px; margin: 5px 3px; background: #e3e6eb; }
    .tools .sep { width: 22px; height: 1px; margin: 3px 5px; }
    .swatch { width: 16px; height: 16px; border-radius: 4px; box-shadow: inset 0 0 0 1px rgba(0,0,0,.2); }
    .colors { position: absolute; display: none; grid-template-columns: repeat(4, 22px); gap: 6px; padding: 8px; border-radius: 10px;
              background: #fff; box-shadow: 0 6px 24px rgba(0, 0, 0, .28); cursor: default; }
    .colors.open { display: grid; }
    .colors i { width: 22px; height: 22px; border-radius: 6px; cursor: pointer; box-shadow: inset 0 0 0 1px rgba(0,0,0,.15); }
    textarea { position: absolute; margin: 0; padding: 0; border: 1px dashed currentColor; outline: none; background: transparent; resize: none;
               overflow: hidden; white-space: pre; font: 600 20px/1.25 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; min-width: 40px; }
    @media (max-width: 520px) { button.go { padding: 0 8px; } .acts .sep { display: none; } }
    .toast { position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%); padding: 10px 16px; border-radius: 10px;
             background: rgba(15, 23, 42, .92); color: #fff; font-weight: 600; pointer-events: none; z-index: 2; }
    .toast.err { background: #b91c1c; }
    .hint { position: fixed; left: 50%; top: 18px; transform: translateX(-50%); padding: 8px 14px; border-radius: 9px;
            background: rgba(15, 23, 42, .85); color: #fff; pointer-events: none; }
    .has-sel .hint { display: none; }
  </style>
  <div class="wrap">
    <img alt="">
    <canvas></canvas>
    <div class="shade"></div>
    <div class="sel"><span class="size"></span></div>
    <div class="hint"></div>
    <div class="bar tools"></div>
    <div class="bar acts"></div>
    <div class="colors"></div>
  </div>`;
  (page ? document.body : document.documentElement).append(host);

  const $ = s => root.querySelector(s);
  const wrap = $('.wrap'), shot = $('img'), cv = $('canvas'), selEl = $('.sel'), sizeEl = $('.size');
  const tools = $('.tools'), acts = $('.acts'), colorsEl = $('.colors');
  $('.hint').textContent = L.hint;

  const ICONS = {
    pen: '<path d="M4 20c2-1 3-4 5-6s4-1 5-3 0-4 2-5 3 0 4 1"/>',
    line: '<path d="M5 19L19 5"/>',
    arrow: '<path d="M5 19L19 5M10 5h9v9"/>',
    rect: '<rect x="4" y="6" width="16" height="12" rx="1"/>',
    marker: '<path d="M14 4l6 6-8 8H6v-6z"/><path d="M4 21h9"/>',
    text: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
    undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
    save: '<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/>',
    pdf: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 13h6M9 17h4"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>'
  };
  const svg = k => `<svg viewBox="0 0 24 24">${ICONS[k]}</svg>`;
  const COLORS = ['#ef4444', '#f97316', '#facc15', '#22c55e', '#06b6d4', '#2563eb', '#a855f7', '#ec4899', '#ffffff', '#94a3b8', '#334155', '#000000'];

  let tool = null, color = '#ef4444';
  const shapes = [];
  let sel = null;          // { x, y, w, h } in CSS px of the wrap
  let W = 0, H = 0, S = 1; // wrap size, image px per CSS px

  // ---------- toolbars ----------

  function btn(parent, key, title, fn, cls = '') {
    const b = document.createElement('button');
    b.className = cls;
    b.title = title;
    b.innerHTML = key ? svg(key) : '';
    b.onclick = e => { e.stopPropagation(); fn(b); };
    b.onmousedown = e => e.stopPropagation();
    parent.append(b);
    return b;
  }
  const sep = parent => parent.append(Object.assign(document.createElement('span'), { className: 'sep' }));

  const toolBtns = {};
  for (const k of ['pen', 'line', 'arrow', 'rect', 'marker', 'text']) {
    toolBtns[k] = btn(tools, k, L[k], () => setTool(tool === k ? null : k));
  }
  const colorBtn = btn(tools, null, L.color, () => {
    colorsEl.classList.toggle('open');
    const r = colorBtn.getBoundingClientRect(), w = wrap.getBoundingClientRect();
    const x = page ? r.left - 120 : r.left - w.left - 120, y = page ? r.top : r.top - w.top;
    Object.assign(colorsEl.style, { left: `${Math.max(4, x)}px`, top: `${y}px`, position: page ? 'fixed' : 'absolute' });
  });
  colorBtn.innerHTML = '<span class="swatch"></span>';
  sep(tools);
  btn(tools, 'undo', L.undo, () => { shapes.pop(); draw(); });

  for (const c of COLORS) {
    const i = document.createElement('i');
    i.style.background = c;
    i.onmousedown = e => e.stopPropagation();
    i.onclick = e => { e.stopPropagation(); color = c; paintSwatch(); colorsEl.classList.remove('open'); };
    colorsEl.append(i);
  }
  colorsEl.onmousedown = e => e.stopPropagation();
  const paintSwatch = () => { colorBtn.firstChild.style.background = color; };
  paintSwatch();

  const copyBtn = btn(acts, 'copy', L.copyKey, () => finish('copy'), 'go');
  copyBtn.insertAdjacentText('beforeend', L.copy);
  const pdfBtn = btn(acts, 'pdf', L.pdf, () => finish('pdf'), 'go');
  pdfBtn.insertAdjacentText('beforeend', 'PDF');
  const saveBtn = btn(acts, 'save', L.saveKey, () => finish('save'), 'go main');
  saveBtn.insertAdjacentText('beforeend', L.save);
  sep(acts);
  btn(acts, 'close', L.close, close);

  function setTool(k) {
    commitText();
    tool = k;
    Object.entries(toolBtns).forEach(([n, b]) => b.classList.toggle('on', n === k));
    selEl.classList.toggle('move', !k);
    wrap.style.cursor = k === 'text' ? 'text' : 'crosshair';
  }

  // ---------- layout ----------

  shot.onload = () => {
    S = page ? shot.naturalWidth / document.documentElement.clientWidth : shot.naturalWidth / innerWidth;
    if (page) S = Math.max(1, Math.min(S, window.devicePixelRatio || 1));
    W = page ? shot.naturalWidth / S : innerWidth;
    H = page ? shot.naturalHeight / S : innerHeight;
    wrap.style.width = `${W}px`;
    wrap.style.height = `${H}px`;
    cv.width = Math.round(W * S);
    cv.height = Math.round(H * S);
    if (mode !== 'area') { sel = { x: 0, y: 0, w: W, h: H }; showSel(true); }
  };
  shot.src = img;

  function showSel(ready) {
    wrap.classList.add('has-sel');
    wrap.classList.toggle('ready', !!ready);
    Object.assign(selEl.style, { display: 'block', left: `${sel.x}px`, top: `${sel.y}px`, width: `${sel.w}px`, height: `${sel.h}px` });
    sizeEl.textContent = `${Math.round(sel.w * S)} × ${Math.round(sel.h * S)}`;
    sizeEl.style.top = sel.y < 26 ? '4px' : '-24px';
    sizeEl.style.left = sel.y < 26 ? '4px' : '0';
    if (ready) placeBars();
  }

  // Lightshot layout: tools on the right of the box, actions under it; flipped inside when there is no room.
  function placeBars() {
    if (page) {
      Object.assign(tools.style, { right: '16px', top: '50%', transform: 'translateY(-50%)' });
      Object.assign(acts.style, { left: '50%', bottom: '18px', transform: 'translateX(-50%)' });
      return;
    }
    const tw = tools.offsetWidth, th = tools.offsetHeight, aw = acts.offsetWidth, ah = acts.offsetHeight, g = 8;
    let tx = sel.x + sel.w + g;
    if (tx + tw > W - 4) tx = sel.x - tw - g;
    if (tx < 4) tx = sel.x + sel.w - tw - g;
    let ty = Math.min(Math.max(4, sel.y + sel.h - th), H - th - 4);
    let ax = Math.min(Math.max(4, sel.x + sel.w - aw), W - aw - 4);
    let ay = sel.y + sel.h + g;
    if (ay + ah > H - 4) ay = sel.y - ah - g;
    if (ay < 4) ay = sel.y + sel.h - ah - g;
    // Both bars inside the box (it fills the screen): keep the tools above the actions.
    if (tx + tw > ax && tx < ax + aw && ty + th > ay - g && ty < ay + ah) ty = Math.max(4, ay - th - g);
    Object.assign(tools.style, { left: `${tx}px`, top: `${ty}px` });
    Object.assign(acts.style, { left: `${ax}px`, top: `${ay}px` });
  }

  // ---------- drawing ----------

  function drawShape(c, s) {
    c.save();
    c.strokeStyle = c.fillStyle = s.color;
    c.lineWidth = s.type === 'marker' ? 16 : 3;
    c.lineCap = s.type === 'marker' ? 'butt' : 'round';
    c.lineJoin = 'round';
    if (s.type === 'marker') c.globalAlpha = .38;
    if (s.type === 'pen' || s.type === 'marker') {
      c.beginPath();
      s.pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
      c.stroke();
    } else if (s.type === 'line' || s.type === 'arrow') {
      c.beginPath(); c.moveTo(s.x1, s.y1); c.lineTo(s.x2, s.y2); c.stroke();
      if (s.type === 'arrow') {
        const a = Math.atan2(s.y2 - s.y1, s.x2 - s.x1), len = 16;
        c.beginPath();
        c.moveTo(s.x2, s.y2);
        c.lineTo(s.x2 - len * Math.cos(a - .45), s.y2 - len * Math.sin(a - .45));
        c.lineTo(s.x2 - len * Math.cos(a + .45), s.y2 - len * Math.sin(a + .45));
        c.closePath(); c.fill();
      }
    } else if (s.type === 'rect') {
      c.strokeRect(Math.min(s.x1, s.x2), Math.min(s.y1, s.y2), Math.abs(s.x2 - s.x1), Math.abs(s.y2 - s.y1));
    } else if (s.type === 'text') {
      c.font = '600 20px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
      c.textBaseline = 'top';
      s.text.split('\n').forEach((line, i) => c.fillText(line, s.x + 1, s.y + 2 + i * 25));
    }
    c.restore();
  }

  function draw(extra) {
    const c = cv.getContext('2d');
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, cv.width, cv.height);
    c.setTransform(S, 0, 0, S, 0, 0);
    if (sel) { c.save(); c.beginPath(); c.rect(sel.x, sel.y, sel.w, sel.h); c.clip(); }
    shapes.forEach(s => drawShape(c, s));
    if (extra) drawShape(c, extra);
    if (sel) c.restore();
  }

  // ---------- text ----------

  let ta = null;
  function startText(x, y) {
    commitText();
    ta = document.createElement('textarea');
    Object.assign(ta.style, { left: `${x}px`, top: `${y}px`, color, width: '60px', height: '28px' });
    ta.rows = 1;
    const grow = () => {
      const lines = ta.value.split('\n');
      ta.style.width = `${Math.max(60, ...lines.map(l => l.length * 12 + 20))}px`;
      ta.style.height = `${lines.length * 25 + 4}px`;
    };
    ta.oninput = grow;
    ta.onmousedown = e => e.stopPropagation();
    ta.onkeydown = e => {
      e.stopPropagation();
      if (e.key === 'Escape') { ta.value = ''; commitText(); }
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitText(); }
    };
    ta.dataset.x = x; ta.dataset.y = y;
    wrap.append(ta);
    setTimeout(() => ta?.focus());
  }
  function commitText() {
    if (!ta) return;
    const t = ta;
    ta = null;
    if (t.value.trim()) shapes.push({ type: 'text', color: t.style.color, x: +t.dataset.x, y: +t.dataset.y, text: t.value });
    t.remove();
    draw();
  }

  // ---------- mouse ----------

  const pos = e => { const r = wrap.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const inSel = (x, y) => sel && x >= sel.x && y >= sel.y && x <= sel.x + sel.w && y <= sel.y + sel.h;

  // Resize handles: drag an edge or corner of the box.
  const HANDLES = { nw: [0, 0], n: [.5, 0], ne: [1, 0], e: [1, .5], se: [1, 1], s: [.5, 1], sw: [0, 1], w: [0, .5] };
  for (const [k, [fx, fy]] of Object.entries(HANDLES)) {
    const h = document.createElement('i');
    h.className = 'h';
    Object.assign(h.style, { left: `${fx * 100}%`, top: `${fy * 100}%`, cursor: `${k}-resize` });
    h.onmousedown = e => {
      e.stopPropagation(); e.preventDefault();
      commitText();
      const s0 = { ...sel };
      drag(e, (x, y) => {
        let { x: l, y: t } = s0, r = s0.x + s0.w, b = s0.y + s0.h;
        if (k.includes('w')) l = clamp(x, 0, W);
        if (k.includes('e')) r = clamp(x, 0, W);
        if (k.includes('n')) t = clamp(y, 0, H);
        if (k.includes('s')) b = clamp(y, 0, H);
        sel = { x: Math.min(l, r), y: Math.min(t, b), w: Math.abs(r - l), h: Math.abs(b - t) };
        showSel(true); draw();
      });
    };
    selEl.append(h);
  }

  function drag(e0, move, up) {
    const mm = e => move(...pos(e), e);
    const mu = e => { removeEventListener('mousemove', mm, true); removeEventListener('mouseup', mu, true); up?.(...pos(e), e); };
    addEventListener('mousemove', mm, true);
    addEventListener('mouseup', mu, true);
  }

  wrap.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    e.preventDefault();
    colorsEl.classList.remove('open');
    const [x0, y0] = pos(e);

    if (tool === 'text' && inSel(x0, y0)) { if (ta) commitText(); else startText(x0, y0); return; }
    commitText();

    if (tool && inSel(x0, y0)) {
      const s = tool === 'pen' || tool === 'marker' ? { type: tool, color, pts: [[x0, y0]] } : { type: tool, color, x1: x0, y1: y0, x2: x0, y2: y0 };
      drag(e, (x, y, ev) => {
        if (s.pts) s.pts.push([x, y]);
        else {
          s.x2 = x; s.y2 = y;
          if (ev.shiftKey && tool === 'rect') { const d = Math.max(Math.abs(x - x0), Math.abs(y - y0)); s.x2 = x0 + Math.sign(x - x0) * d; s.y2 = y0 + Math.sign(y - y0) * d; }
        }
        draw(s);
      }, () => {
        const tiny = s.pts ? s.pts.length < 2 : Math.hypot(s.x2 - s.x1, s.y2 - s.y1) < 3;
        if (!tiny) shapes.push(s);
        draw();
      });
      return;
    }

    if (!tool && inSel(x0, y0) && !page) {
      const s0 = { ...sel };
      drag(e, (x, y) => {
        sel = { ...s0, x: clamp(s0.x + x - x0, 0, W - s0.w), y: clamp(s0.y + y - y0, 0, H - s0.h) };
        showSel(true); draw();
      });
      return;
    }

    if (page) return;
    // New selection (also when clicking outside the current one, like Lightshot).
    wrap.classList.remove('ready');
    drag(e, (x, y) => {
      x = clamp(x, 0, W); y = clamp(y, 0, H);
      sel = { x: Math.min(x0, x), y: Math.min(y0, y), w: Math.abs(x - x0), h: Math.abs(y - y0) };
      showSel(false); draw();
    }, () => {
      if (!sel || sel.w < 4 || sel.h < 4) { sel = { x: 0, y: 0, w: W, h: H }; }
      showSel(true); draw();
      if (!tool) selEl.classList.add('move');
    });
  });

  // ---------- output ----------

  function render() {
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(sel.w * S));
    out.height = Math.max(1, Math.round(sel.h * S));
    const c = out.getContext('2d');
    c.drawImage(shot, Math.round(sel.x * S), Math.round(sel.y * S), out.width, out.height, 0, 0, out.width, out.height);
    c.setTransform(S, 0, 0, S, -sel.x * S, -sel.y * S);
    shapes.forEach(s => drawShape(c, s));
    return out;
  }

  function toast(msg, err) {
    const el = Object.assign(document.createElement('div'), { className: `toast${err ? ' err' : ''}`, textContent: msg });
    root.append(el);
    setTimeout(() => el.remove(), 2600);
  }

  // A4 PDF: the image fills the page width and long screenshots continue on the next pages.
  // Each page is a JPEG slice, written as a minimal PDF by hand (no library).
  async function toPdf(out) {
    const PW = 595.28, PH = 841.89;                       // A4 in points
    const sliceH = Math.max(1, Math.floor(out.width * PH / PW));
    const enc = new TextEncoder();
    const chunks = [], offsets = [];
    let size = 0;
    const put = x => { const b = typeof x === 'string' ? enc.encode(x) : x; chunks.push(b); size += b.length; };
    const obj = (n, body) => { offsets[n] = size; put(`${n} 0 obj\n`); body(); put('\nendobj\n'); };

    const pages = [];
    for (let y = 0; y < out.height; y += sliceH) {
      const h = Math.min(sliceH, out.height - y);
      const c = document.createElement('canvas');
      c.width = out.width; c.height = h;
      const x2 = c.getContext('2d');
      x2.fillStyle = '#fff'; x2.fillRect(0, 0, c.width, h);
      x2.drawImage(out, 0, y, out.width, h, 0, 0, out.width, h);
      const jpg = new Uint8Array(await (await new Promise(r => c.toBlob(r, 'image/jpeg', .92))).arrayBuffer());
      pages.push({ jpg, w: c.width, h, ph: PW * h / out.width });
    }

    put('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
    const n = pages.length, kids = pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
    obj(1, () => put('<< /Type /Catalog /Pages 2 0 R >>'));
    obj(2, () => put(`<< /Type /Pages /Kids [${kids}] /Count ${n} >>`));
    pages.forEach((p, i) => {
      const pg = 3 + i * 3, im = pg + 1, ct = pg + 2;
      const draw = `q ${PW.toFixed(2)} 0 0 ${p.ph.toFixed(2)} 0 ${(PH - p.ph).toFixed(2)} cm /Im0 Do Q`;
      obj(pg, () => put(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /XObject << /Im0 ${im} 0 R >> >> /Contents ${ct} 0 R >>`));
      obj(im, () => { put(`<< /Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpg.length} >>\nstream\n`); put(p.jpg); put('\nendstream'); });
      obj(ct, () => put(`<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`));
    });
    const xref = size, count = 3 + n * 3;
    put(`xref\n0 ${count}\n0000000000 65535 f \n`);
    for (let i = 1; i < count; i++) put(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
    put(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.onerror = () => rej(fr.error);
      fr.readAsDataURL(new Blob(chunks, { type: 'application/pdf' }));
    });
  }

  let busy = false;
  async function finish(how) {
    if (!sel || busy) return;
    commitText();
    busy = true;
    const out = render();
    try {
      if (how === 'copy') {
        const blob = new Promise(res => out.toBlob(res, 'image/png'));
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        toast(L.copied);
      } else {
        const dataUrl = how === 'pdf' ? await toPdf(out) : out.toDataURL('image/png');
        const r = await chrome.runtime.sendMessage({ cmd: 'saveShot', dataUrl, ext: how === 'pdf' ? 'pdf' : 'png' });
        if (!r?.ok) throw new Error(r?.error || 'Save failed');
        toast(L.saved);
      }
      setTimeout(close, page ? 1400 : 700);
    } catch (e) {
      busy = false;
      toast(how === 'copy' ? L.copyFail : e.message, true);
    }
  }

  function close() {
    removeEventListener('keydown', onKey, true);
    removeEventListener('wheel', noScroll, { capture: true });
    host.remove();
    if (page) window.close();
  }

  function onKey(e) {
    if (ta) return;
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === 'Escape') close();
    else if (mod && e.key.toLowerCase() === 'c' && wrap.classList.contains('ready')) finish('copy');
    else if (mod && e.key.toLowerCase() === 's' && wrap.classList.contains('ready')) finish('save');
    else if (mod && e.key.toLowerCase() === 'z') { shapes.pop(); draw(); }
    else if (mod && e.key === 'Enter') finish('save');
    else return;
    e.preventDefault(); e.stopPropagation();
  }
  const noScroll = e => e.preventDefault();
  addEventListener('keydown', onKey, true);
  if (!page) addEventListener('wheel', noScroll, { capture: true, passive: false });
};
