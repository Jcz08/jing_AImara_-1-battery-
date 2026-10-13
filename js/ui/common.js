/* common.js — UI 公共辅助 */

export function el(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null || c === false) continue;
    e.append(c.nodeType ? c : document.createTextNode(c));
  }
  return e;
}

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

export function fmt(n, d = 1) {
  if (n == null) return '—';
  if (n >= 1000) return Math.round(n).toLocaleString('en-US');
  if (n >= 100) return Math.round(n).toString();
  if (n >= 10) return (Math.round(n * 10) / 10).toFixed(1);
  if (n === 0) return '0';
  return (Math.round(n * 100) / 100).toFixed(d);
}

export function fmtMs(ms) {
  if (ms >= 1000) return fmt(ms / 1000, 2) + ' s';
  return Math.round(ms) + ' ms';
}

export function pct(x, d = 1) { return (x * 100).toFixed(d) + '%'; }

/** 折叠面板 */
export function fold(summary, body, { open = false } = {}) {
  const d = el('details', { class: 'fold' });
  if (open) d.open = true;
  const s = el('summary', {}, summary);
  const b = el('div', { class: 'fold-body' }, [].concat(body));
  d.append(s, b);
  return d;
}

/** tabs: items=[{name, render(container)}], 返回容器与 tab 容器 */
export function tabs(items, initial = 0) {
  const wrap = el('div');
  const bar = el('div', { class: 'tabs' });
  const panels = items.map(() => el('div', { class: 'tab-panel' }));
  items.forEach((it, i) => {
    const t = el('div', { class: 'tab' + (i === initial ? ' active' : ''), onclick: () => activate(i) }, it.name);
    bar.append(t);
  });
  function activate(i) {
    bar.querySelectorAll('.tab').forEach((t, j) => t.classList.toggle('active', i === j));
    panels.forEach((p, j) => { p.style.display = i === j ? '' : 'none'; });
    if (!panels[i].dataset.built) {
      items[i].render(panels[i]);
      panels[i].dataset.built = '1';
    }
  }
  wrap.append(bar, ...panels);
  activate(initial);
  return wrap;
}

/** 柱状图：data=[{name, value, color, suffix}] */
export function barChart(data, { unit = '', log = false, height = 240 } = {}) {
  const wrap = el('div', { class: 'bar-chart', style: `height:${height}px` });
  const vals = data.map((d) => d.value);
  const max = Math.max(...vals);
  const min = Math.min(...vals.filter((v) => v > 0));
  const scale = log ? Math.log(max) - Math.log(min) : max;
  data.forEach((d) => {
    const h = log
      ? d.value > 0 ? (Math.log(d.value) - Math.log(min)) / scale * 78 + 18 : 2
      : d.value / max * 96;
    const bar = el('div', { class: 'bar', style: `height:${h}%;background:${d.color || 'var(--amber)'}` });
    const col = el('div', { class: 'bar-col' }, [
      el('div', { class: 'bar-val' }, fmt(d.value) + (d.suffix || unit)),
      bar,
      el('div', { class: 'bar-name' }, d.name),
    ]);
    wrap.append(col);
  });
  return wrap;
}

/** 字段着色位网格（spans 来自 protocol.l0FieldSpans，data 为字节） */
const FIELD_COLORS = {
  tag: '#58b6ff', type: '#b79bff', lat: '#3ddc84', lon: '#3ddc84',
  severity: '#ffb020', ts: '#8ad6a5', people: '#e88ee0', needs: '#ffb020',
  phrases: '#ff5c57', text: '#9db1a5', len: '#68796e',
};
export function bitGrid(data, spans) {
  const legend = el('div', { class: 'bit-legend' });
  const seen = new Set();
  spans.forEach((sp) => {
    if (!seen.has(sp.key)) {
      seen.add(sp.key);
      legend.append(el('span', { html: `<i style="background:${FIELD_COLORS[sp.key] || '#888'}"></i>${sp.zh}` }));
    }
  });
  const grid = el('div', { class: 'bitgrid' });
  let bitIndex = 0;
  for (const byte of data) {
    for (let k = 7; k >= 0; k--) {
      const b = (byte >> k) & 1;
      // 找到该位属于哪个字段
      let acc = 0, span = spans[spans.length - 1];
      for (const sp of spans) {
        if (bitIndex < acc + sp.bits) { span = sp; break; }
        acc += sp.bits;
      }
      const color = FIELD_COLORS[span.key] || '#888';
      const cell = el('div', {
        class: 'bit',
        title: `${span.zh} · 第${bitIndex + 1}位`,
        style: `background:${color}22;border-color:${color}66;color:${color}`,
      }, String(b));
      grid.append(cell);
      bitIndex++;
    }
  }
  return el('div', {}, [legend, grid]);
}

/** 大数字指标卡 */
export function metricCard(label, value, { color = '', sub = '', tag = '' } = {}) {
  return el('div', { class: 'card tight' }, [
    tag ? el('div', { style: 'margin-bottom:4px' }, [tag]) : null,
    el('div', { class: `metric ${color}` }, value),
    el('div', { class: 'metric-label' }, label),
    sub ? el('div', { class: 'tiny', style: 'margin-top:4px' }, sub) : null,
  ]);
}

/** 全局模态 */
export function modal(title, contentNode) {
  const root = document.getElementById('modal-root');
  clear(root);
  const mask = el('div', { class: 'modal-mask', onclick: closeModal });
  const close = el('button', { class: 'btn sm ghost modal-close', onclick: closeModal }, '关闭 ✕');
  const box = el('div', { class: 'modal' }, [
    el('div', { style: 'display:flex;justify-content:space-between;align-items:flex-start;gap:12px' }, [
      el('h2', { style: 'margin:0' }, title),
      close,
    ]),
    el('div', { style: 'margin-top:14px' }, contentNode),
  ]);
  root.append(mask, box);
  requestAnimationFrame(() => root.classList.add('show'));
  root.setAttribute('aria-hidden', 'false');
}
export function closeModal() {
  const root = document.getElementById('modal-root');
  root.classList.remove('show');
  root.setAttribute('aria-hidden', 'true');
  setTimeout(() => clear(root), 200);
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
