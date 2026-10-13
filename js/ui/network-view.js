/* network-view.js — 弱网实验室：参数可调的蒙特卡洛对比与时间轴 */
import { el, fold, clear, fmt, fmtMs, pct, metricCard } from './common.js';
import { state, messageWithTs } from '../state.js';
import { encodeJSON, encodeLayers } from '../protocol.js';
import { monteCarlo, analyticExpectedMs, oneRun, PROFILES } from '../network.js';
import { energyCost, ENERGY_MODEL } from '../energy.js';

export function renderNetwork(root) {
  const msg = messageWithTs();
  const cfg = state.network;
  let windowMs = 30000;
  // 原位重渲染：清空当前章节容器后重建，绝不追加第二份页面
  const rerender = () => { clear(root); renderNetwork(root); };

  root.append(
    el('div', {}, [
      el('div', { class: 'kicker' }, 'Chapter 04 · 弱网实验室 / Network Lab'),
      el('h1', {}, '30 秒黄金窗口里，谁先把情报送到？'),
      el('p', { class: 'lead' }, [
        '受损网络不是“慢一点”，而是',
        el('b', {}, '丢包、等待、重传'),
        '的乘积。每条参数都可拖动，点击运行后做 300 次蒙特卡洛模拟（固定种子，可复现），并与解析期望值交叉验证。',
      ]),
    ]),
  );

  const ctrl = el('div', { class: 'card', style: 'margin-top:18px' }, [
    el('h2', {}, '信道参数'),
    el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' },
      PROFILES.map((p) => el('span', {
        class: 'chip' + (cfg.bps === p.bps && cfg.loss === p.loss ? ' on amber' : ''),
        onclick: () => { Object.assign(cfg, { bps: p.bps, loss: p.loss, rtt: p.rtt }); rerender(); },
      }, p.name))),
  ]);

  const result = el('div', {});

  const bpsVal = val('bps', cfg.bps >= 1000 ? (cfg.bps / 1000) + ' kbps' : cfg.bps + ' bps');
  const lossVal = val('loss', pct(cfg.loss, 0));
  const rttVal = val('rtt', cfg.rtt + ' ms');
  const winVal = val('window', '30 s');
  const psVal = val('ps', cfg.packetSize + ' B');

  ctrl.append(
    range('带宽 bps', cfg.bps, [100, 300, 600, 1200, 2400, 9600, 50000, 200000], (v) => { cfg.bps = v; bpsVal.textContent = v >= 1000 ? (v / 1000) + ' kbps' : v + ' bps'; }, bpsVal),
    range('单包丢包率', cfg.loss, [0, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5], (v) => { cfg.loss = v; lossVal.textContent = pct(v, 0); }, lossVal),
    range('停等往返 RTT', cfg.rtt, [100, 300, 600, 1000, 1500, 2500], (v) => { cfg.rtt = v; rttVal.textContent = v + ' ms'; }, rttVal),
    range('包载荷', cfg.packetSize, [16, 24, 32, 64, 128], (v) => { cfg.packetSize = v; psVal.textContent = v + ' B'; }, psVal),
    range('黄金窗口', windowMs, [10000, 15000, 30000, 60000, 120000], (v) => { windowMs = v; winVal.textContent = v / 1000 + ' s'; }, winVal),
    el('button', { class: 'btn green', style: 'margin-top:10px', onclick: () => run() }, '▶ 运行 300 次蒙特卡洛'),
  );

  root.append(ctrl, result,
    el('div', { style: 'margin-top:18px' }, [
      fold('模型与公式（口径说明）', [
        el('p', {}, [
          el('b', {}, '发送时间：'),
          '每个包耗时 = 传输（包字节×8/带宽）+ 停等往返 RTT；丢包后整包重传，每包期望发送次数 1/(1−p)。',
        ]),
        el('p', {}, [
          el('b', {}, '策略 A：'),
          'JSON 整包，N 个包全部到达才完整可解析，少一个包都不能行动。',
        ]),
        el('p', {}, [
          el('b', {}, '策略 B：'),
          'L0/L1/L2 独立确认，L0 到达即“可行动”（知道有 SOS、严重度与数百米区域）。',
        ]),
        el('p', { class: 'tiny' }, '模型为停等式 ARQ，刻意简单透明；真实协议有滑动窗口、前向纠错等，但它们只会进一步强化“先到达小而关键的层”的结论。'),
      ]),
    ]),
    el('div', { class: 'nav-row' }, [
      el('a', { class: 'btn ghost', href: '#/lab' }, '← 上一章：编码实验室'),
      el('a', { class: 'btn', href: '#/bench' }, '下一章：实测基准 →'),
    ]),
  );

  run();

  function run() {
    clear(result);
    const m = messageWithTs();
    const jsonBytes = encodeJSON(m);
    const layers = encodeLayers(m);
    const mc = monteCarlo({ jsonBytes: jsonBytes.length, layers, cfg, runs: 300, windowMs });
    const analytic = {
      json: analyticExpectedMs(jsonBytes.length, cfg),
      l0: analyticExpectedMs(layers.l0.length, cfg),
      l2: analyticExpectedMs(layers.total, cfg),
    };
    const single = oneRun(jsonBytes.length, layers, cfg, 20261013);

    const ttfa = mc.json.meanMs / mc.layered.l0.meanMs;
    const eJson = energyCost(mc.json.meanMs, 0, false);
    const eL0 = energyCost(mc.layered.l0.meanMs, 0, false);

    const cards = el('div', { class: 'grid cols-4', style: 'margin-top:18px' }, [
      metricCard('A · JSON 完整送达（均值）', fmtMs(mc.json.meanMs), { color: 'amber', sub: `p50 ${fmtMs(mc.json.p50)} · p95 ${fmtMs(mc.json.p95)}` }),
      metricCard('B · L0 可行动（均值）', fmtMs(mc.layered.l0.meanMs), { color: 'green', sub: `p50 ${fmtMs(mc.layered.l0.p50)} · p95 ${fmtMs(mc.layered.l0.p95)}` }),
      metricCard('情报到达提速', ttfa.toFixed(1) + '×', { color: 'green', sub: '均值 TTFA 之比' }),
      metricCard('窗口内成功率', pct(mc.layered.l0.successRate) + ' vs ' + pct(mc.json.successRate), {
        color: mc.layered.l0.successRate > mc.json.successRate ? 'green' : 'amber',
        sub: `B 的 L0 对 A 的整包（${windowMs / 1000}s）`,
      }),
    ]);

    const table = el('div', { class: 'card', style: 'margin-top:16px' }, [
      el('h2', {}, '300 次模拟统计'),
      tableHTML([
        ['', 'A · JSON 整包', 'B · L0 信标', 'B · L1 定位', 'B · L2 完整'],
        ['字节数', jsonBytes.length + ' B', layers.l0.length + ' B', layers.l0.length + layers.l1.length + ' B', layers.total + ' B'],
        ['均值时间', fmtMs(mc.json.meanMs), fmtMs(mc.layered.l0.meanMs), fmtMs(mc.layered.l1.meanMs), fmtMs(mc.layered.l2.meanMs)],
        ['p50', fmtMs(mc.json.p50), fmtMs(mc.layered.l0.p50), fmtMs(mc.layered.l1.p50), fmtMs(mc.layered.l2.p50)],
        ['p95', fmtMs(mc.json.p95), fmtMs(mc.layered.l0.p95), fmtMs(mc.layered.l1.p95), fmtMs(mc.layered.l2.p95)],
        ['解析期望（交叉验证）', fmtMs(analytic.json), fmtMs(analytic.l0), '—', fmtMs(analytic.l2)],
        ['无线电能量（不含屏）', eJson.radio.toFixed(2) + ' J', eL0.radio.toFixed(2) + ' J', '—', '—'],
      ]),
    ]);

    const tl = el('div', { class: 'card', style: 'margin-top:16px' }, [
      el('h2', {}, '一次代表性时间轴（固定种子）'),
      el('p', { class: 'tiny' }, '每一竖线是一次发送尝试；L0/L1/L2 与 JSON 完成点标出；红色虚线为黄金窗口。'),
      timelineSVG(single, jsonBytes.length, layers, cfg, windowMs),
    ]);

    const note = el('div', { class: 'note-box', style: 'margin-top:16px' }, [
      el('b', {}, '读法：'),
      `丢包率越高，A 与 B 的差距越呈非线性放大——A 有 ${Math.ceil(jsonBytes.length / cfg.packetSize)} 个包，所有包都成功的概率是 (1−p)^N；B 的 L0 只有 1 个包。这就是“把关键信息做小”的统计学意义。`,
    ]);

    result.append(cards, tl, table, note);
  }
}

function val(id, t) { return el('span', { class: 'tag measured', style: 'margin-left:auto' }, t); }
function range(label, value, options, onChange, valEl) {
  const idx = Math.max(0, options.indexOf(value));
  const input = el('input', { type: 'range', min: 0, max: options.length - 1, value: idx, step: 1 });
  input.addEventListener('input', () => {
    const v = options[parseInt(input.value, 10)];
    onChange(v);
  });
  return el('label', { class: 'field' }, [
    el('div', { style: 'display:flex;align-items:center' }, [el('span', {}, label), valEl]),
    input,
  ]);
}

function tableHTML(rows) {
  const t = el('table');
  rows.forEach((r, i) => {
    const tr = el('tr');
    r.forEach((c, j) => tr.append(el(i === 0 ? 'th' : 'td', { class: j > 0 ? 'num' : '' }, String(c))));
    t.append(tr);
  });
  return t;
}

function timelineSVG(single, jsonBytes, layers, cfg, windowMs) {
  const ns = 'http://www.w3.org/2000/svg';
  const W = 1060, H = 230, padL = 120, padR = 30, padT = 30, padB = 40;
  const tMax = Math.min(windowMs * 1.6, Math.max(single.json.timeMs, single.layered.l2Ms, windowMs) * 1.1);
  const x = (t) => padL + (t / tMax) * (W - padL - padR);

  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'timeline');

  // 轴
  const axis = document.createElementNS(ns, 'line');
  axis.setAttribute('x1', padL); axis.setAttribute('y1', H - padB); axis.setAttribute('x2', W - padR); axis.setAttribute('y2', H - padB);
  axis.setAttribute('class', 'tl-axis');
  svg.append(axis);
  // 刻度
  for (let t = 0; t <= tMax; t += Math.ceil(tMax / 8 / 1000) * 1000) {
    const g = document.createElementNS(ns, 'g');
    const l = document.createElementNS(ns, 'line');
    l.setAttribute('x1', x(t)); l.setAttribute('y1', H - padB); l.setAttribute('x2', x(t)); l.setAttribute('y2', H - padB + 5);
    l.setAttribute('class', 'tl-axis');
    const tx = document.createElementNS(ns, 'text');
    tx.setAttribute('x', x(t)); tx.setAttribute('y', H - padB + 20); tx.setAttribute('text-anchor', 'middle');
    tx.setAttribute('class', 'tl-label'); tx.textContent = (t / 1000).toFixed(0) + 's';
    g.append(l, tx); svg.append(g);
  }

  const lanes = [
    { y: 60, name: 'A · JSON', events: single.json.events, end: single.json.timeMs, color: '#ffb020' },
    { y: 130, name: 'B · 1% 三层', events: single.layered.events, end: single.layered.l2Ms, color: '#3ddc84' },
  ];
  lanes.forEach((lane) => {
    const label = document.createElementNS(ns, 'text');
    label.setAttribute('x', 12); label.setAttribute('y', lane.y + 5);
    label.setAttribute('class', 'tl-label'); label.setAttribute('fill', '#e7efe9');
    label.textContent = lane.name;
    svg.append(label);
    lane.events.forEach((e) => {
      const line = document.createElementNS(ns, 'line');
      line.setAttribute('x1', x(e.atMs)); line.setAttribute('y1', lane.y - 12);
      line.setAttribute('x2', x(e.atMs)); line.setAttribute('y2', lane.y + 12);
      line.setAttribute('stroke', e.lost ? '#ff5c57' : (e.layer ? { L0: '#3ddc84', L1: '#58b6ff', L2: '#b79bff' }[e.layer] : '#ffb020'));
      line.setAttribute('stroke-width', e.lost ? '1' : '2.4');
      line.setAttribute('opacity', e.lost ? '.55' : '1');
      svg.append(line);
    });
  });

  // 标记点（JSON 完成点常贴近黄金窗口，标签向左展开避免重叠）
  const markers = [
    { t: single.layered.l0Ms, y: 130, c: '#3ddc84', label: 'L0 可行动', right: true },
    { t: single.layered.l2Ms, y: 130, c: '#b79bff', label: 'L2 完整', right: true },
    { t: single.json.timeMs, y: 60, c: '#ffb020', label: 'JSON 完整', right: false },
  ];
  markers.forEach((m) => {
    const dot = document.createElementNS(ns, 'circle');
    dot.setAttribute('cx', x(m.t)); dot.setAttribute('cy', m.y); dot.setAttribute('r', 5);
    dot.setAttribute('fill', m.c);
    const tx = document.createElementNS(ns, 'text');
    tx.setAttribute('x', x(m.t) + (m.right ? 8 : -8));
    tx.setAttribute('y', m.y - 10);
    tx.setAttribute('text-anchor', m.right ? 'start' : 'end');
    tx.setAttribute('class', 'tl-label'); tx.setAttribute('fill', m.c);
    tx.textContent = `${m.label} ${(m.t / 1000).toFixed(1)}s`;
    svg.append(dot, tx);
  });

  // 黄金窗口
  const win = document.createElementNS(ns, 'line');
  win.setAttribute('x1', x(windowMs)); win.setAttribute('y1', 20); win.setAttribute('x2', x(windowMs)); win.setAttribute('y2', H - padB);
  win.setAttribute('class', 'tl-marker');
  svg.append(win);
  const wt = document.createElementNS(ns, 'text');
  wt.setAttribute('x', x(windowMs) + 4); wt.setAttribute('y', 18); wt.setAttribute('class', 'tl-label'); wt.setAttribute('fill', '#ff5c57');
  wt.textContent = '黄金窗口 ' + windowMs / 1000 + 's';
  svg.append(wt);

  return svg;
}
