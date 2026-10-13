/* bench-view.js — 实测基准：在当前设备上现算的对比数据 */
import { el, fold, clear, fmt, fmtMs, pct, barChart, metricCard } from './common.js';
import { runBenchmark } from '../bench.js';
import { ENERGY_MODEL } from '../energy.js';

export function renderBench(root) {
  let result = null;

  root.append(
    el('div', {}, [
      el('div', { class: 'kicker' }, 'Chapter 05 · 实测基准 / Benchmarks'),
      el('h1', {}, '不用“据说”，用你这台机器现算'),
      el('p', { class: 'lead' }, [
        '基准在',
        el('b', {}, '你的浏览器、你的设备'),
        '上实时生成：随机构造数百条求救报文，逐条测量字节数、编解码耗时，再做 300 次网络模拟。结果可导出 JSON 复核。',
      ]),
    ]),
  );

  const countSel = el('select', { style: 'width:auto' }, [
    el('option', { value: '100' }, '100 条（快速）'),
    el('option', { value: '300', selected: '' }, '300 条（推荐）'),
    el('option', { value: '1000' }, '1000 条（更稳）'),
  ]);
  const progress = el('div', { class: 'progress', style: 'margin-top:10px' }, [el('div', {})]);
  const runBtn = el('button', { class: 'btn green' }, '▶ 运行基准测试');
  const out = el('div', {});

  const ctrl = el('div', { class: 'card', style: 'margin-top:18px' }, [
    el('div', { style: 'display:flex;align-items:center;gap:14px;flex-wrap:wrap' }, [
      el('label', { class: 'tiny', style: 'display:flex;align-items:center;gap:8px' }, ['样本数 ', countSel]),
      runBtn,
    ]),
    progress,
  ]);

  runBtn.addEventListener('click', async () => {
    runBtn.disabled = true;
    const n = parseInt(countSel.value, 10);
    const r = await runBenchmark({
      count: n,
      onProgress: (p) => { progress.firstChild.style.width = pct(p, 0); },
    });
    progress.firstChild.style.width = '100%';
    runBtn.disabled = false;
    result = r;
    render(out, r);
  });

  root.append(ctrl, out,
    el('div', { class: 'nav-row' }, [
      el('a', { class: 'btn ghost', href: '#/network' }, '← 上一章：弱网实验室'),
      el('a', { class: 'btn', href: '#/offline' }, '下一章：离线与自足 →'),
    ]),
  );
}

function render(root, r) {
  clear(root);
  const s = r.sizes;
  const chart = el('div', { class: 'card', style: 'margin-top:16px' }, [
    el('h2', {}, [
      '平均报文体积（字节，对数刻度）',
      el('span', { class: 'tag measured', style: 'margin-left:10px' }, '实测·n=' + r.count),
    ]),
    barChart([
      { name: 'JSON', value: s.json.mean, color: '#ffb020' },
      ...(s.gzip ? [{ name: 'gzip', value: s.gzip.mean, color: '#b79bff' }] : []),
      { name: '单体位打包', value: s.mono.mean, color: '#58b6ff' },
      { name: '三层合计', value: s.layers.mean, color: '#3ddc84' },
      { name: 'L2 详情', value: s.l2.mean, color: '#2e9e63' },
      { name: 'L1 定位', value: s.l1.mean, color: '#3a8bc4' },
      { name: 'L0 信标', value: s.l0.mean, color: '#2b7a4e' },
    ], { log: true, unit: ' B' }),
    el('p', { class: 'tiny' },
      `JSON 是三层协议的 ${r.ratios.jsonVsLayered.toFixed(2)}×，是 L0 信标的 ${r.ratios.jsonVsL0.toFixed(1)}×。${s.gzip ? 'gzip 虽压缩了文本，但短报文摊不平流头与字典，且仍是不可分割的整块。' : ''}`),
  ]);

  const f1 = (x) => x.toFixed(1);
  const fi = (x) => Math.round(x);
  const sizeRows = [
    ['编码', '均值(B)', '中位(B)', '最小', '最大', 'vs JSON'],
    ['JSON', f1(s.json.mean), f1(s.json.median), fi(s.json.min), fi(s.json.max), '1.00×'],
    ...(s.gzip ? [['gzip', f1(s.gzip.mean), f1(s.gzip.median), fi(s.gzip.min), fi(s.gzip.max), (s.json.mean / s.gzip.mean).toFixed(2) + '×']] : []),
    ['单体位打包', f1(s.mono.mean), f1(s.mono.median), fi(s.mono.min), fi(s.mono.max), (s.json.mean / s.mono.mean).toFixed(2) + '×'],
    ['三层合计', f1(s.layers.mean), f1(s.layers.median), fi(s.layers.min), fi(s.layers.max), (s.json.mean / s.layers.mean).toFixed(2) + '×'],
    ['　L0 信标', f1(s.l0.mean), f1(s.l0.median), fi(s.l0.min), fi(s.l0.max), (s.json.mean / s.l0.mean).toFixed(1) + '×'],
    ['　L1 定位', f1(s.l1.mean), f1(s.l1.median), fi(s.l1.min), fi(s.l1.max), '—'],
    ['　L2 详情', f1(s.l2.mean), f1(s.l2.median), fi(s.l2.min), fi(s.l2.max), '—'],
    ['L2 动态Huffman（含表头）', f1(s.l2dyn.mean), f1(s.l2dyn.median), fi(s.l2dyn.min), fi(s.l2dyn.max), '—'],
  ];
  const sizeTable = table(sizeRows);

  const timeRows = [
    ['编码/解码', '编码中位耗时', '解码中位耗时'],
    ['JSON', r.encMs.json.median.toFixed(4) + ' ms', r.decMs.json.median.toFixed(4) + ' ms'],
    ...(r.encMs.gzip ? [['gzip（原生）', r.encMs.gzip.median.toFixed(3) + ' ms', '—']] : []),
    ['单体位打包', r.encMs.mono.median.toFixed(4) + ' ms', r.decMs.mono.median.toFixed(4) + ' ms'],
    ['三层协议', r.encMs.layered.median.toFixed(4) + ' ms', r.decMs.layered.median.toFixed(4) + ' ms'],
  ];
  const timeTable = table(timeRows);

  const mc = r.network.mc;
  const netCards = el('div', { class: 'grid cols-4' }, [
    metricCard('首个可行动情报提速', r.ratios.ttfa.toFixed(1) + '×', { color: 'green', tag: el('span', { class: 'tag measured' }, '实测·MC300') }),
    metricCard('B 的 L0 窗口成功率', pct(mc.layered.l0.successRate), { color: 'green', tag: el('span', { class: 'tag measured' }, '实测') }),
    metricCard('A 的 JSON 窗口成功率', pct(mc.json.successRate), { color: mc.json.successRate > .9 ? 'amber' : 'red', tag: el('span', { class: 'tag measured' }, '实测') }),
    metricCard('A 完整送达 p95', fmtMs(mc.json.p95), { color: 'amber', sub: 'B 的 L0 p95：' + fmtMs(mc.layered.l0.p95), tag: el('span', { class: 'tag measured' }, '实测') }),
  ]);

  const energyRows = [
    ['', 'A · JSON', 'B · L0', 'B · 三层完整'],
    ['无线电在线（均值）', fmtMs(mc.json.meanMs), fmtMs(mc.layered.l0.meanMs), fmtMs(mc.layered.l2.meanMs)],
    ['能量（radio 0.8W + screen 0.4W）', r.energy.json.total.toFixed(2) + ' J', r.energy.l0.total.toFixed(2) + ' J', r.energy.full.total.toFixed(2) + ' J'],
  ];
  const energyTable = el('div', {}, [
    table(energyRows),
    el('p', { class: 'tiny', style: 'margin-top:8px' }, [
      el('span', { class: 'tag measured' }, '时间=实测'),
      ' ',
      el('span', { class: 'tag model' }, '焦耳=模型估算'),
      ' 功耗系数是公开文献的数量级估计（详见第 6 章），设备不同绝对值不同，但方案间的倍数关系由实测字节数与时间直接决定。',
    ]),
  ]);

  const exportBtn = el('button', {
    class: 'btn ghost', style: 'margin-top:16px',
    onclick: () => {
      const blob = new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = '1percent-battery-benchmark.json';
      a.click();
    },
  }, '⬇ 导出本次结果 JSON（可复现）');

  root.append(
    netCards,
    chart,
    el('div', { class: 'grid cols-2', style: 'margin-top:16px' }, [
      el('div', { class: 'card' }, [el('h2', {}, '字节数明细'), sizeTable]),
      el('div', { class: 'card' }, [el('h2', {}, '编解码耗时（旧设备相关性）'), timeTable,
        el('p', { class: 'tiny', style: 'margin-top:10px' }, '全部编码都在亚毫秒级（原生 JSON 由浏览器引擎加速，仍最快；自研位打包约 0.02ms，旧手机上也不是瓶颈）。决定生死的差距在字节与信道，不在 CPU。')]),
    ]),
    el('div', { class: 'card', style: 'margin-top:16px' }, [
      el('h2', {}, ['能量账（默认灾后 2G 控制信道：600bps / 丢包 30% / RTT 1.5s）',
        el('span', { class: 'tag measured', style: 'margin-left:10px' }, '实测时间'),
        el('span', { class: 'tag model', style: 'margin-left:6px' }, '模型焦耳')]),
      energyTable,
    ]),
    exportBtn,
    el('div', { class: 'note-box', style: 'margin-top:16px' }, [
      el('b', {}, '结论：'),
      `在 ${r.count} 条随机报文上，1% 协议把一条完整求救报文的平均体积压到 JSON 的 ${(1 / r.ratios.jsonVsLayered * 100).toFixed(0)}%，而真正决定生死的 L0 信标只有 ${(1 / r.ratios.jsonVsL0 * 100).toFixed(1)}%——同样的 1% 电量，能发出约 ${r.ratios.jsonVsL0.toFixed(0)} 次求救，或让情报到达提速 ${r.ratios.ttfa.toFixed(1)} 倍。`,
    ]),
  );
}

function table(rows) {
  const t = el('table', { style: 'font-size:12.5px' });
  rows.forEach((r, i) => {
    const tr = el('tr');
    r.forEach((c, j) => {
      const cell = el(i === 0 ? 'th' : 'td', { class: j > 0 ? 'num' : '' }, String(c));
      if (i > 0 && j === 1 && typeof r[0] === 'string' && r[0].includes('L0')) cell.style.color = 'var(--green)';
      tr.append(cell);
    });
    t.append(tr);
  });
  return t;
}
