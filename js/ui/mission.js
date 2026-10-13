/* mission.js — 绝境终端：在 1% 电量与受损窄带下发送求救报文 */
import { el, fold, clear, fmt, fmtMs, pct } from './common.js';
import { state, loadScenario, messageWithTs } from '../state.js';
import { SCENARIOS, PHRASES, NEEDS, MSG_TYPES, SEVERITY } from '../phrasebook.js';
import {
  encodeJSON, encodeLayers, decodeL0, mergeL1, mergeL2,
} from '../protocol.js';
import { oneRun, PROFILES } from '../network.js';
import { energyCost, ENERGY_MODEL } from '../energy.js';

let animTimer = null;

export function renderMission(root) {
  const m = state.message;
  // 原位重渲染：取消在途动画 → 清空当前章节容器 → 重新构建（绝不追加第二份页面）
  const rerender = () => {
    if (animTimer) { cancelAnimationFrame(animTimer); animTimer = null; }
    clear(root);
    renderMission(root);
  };

  const head = el('div', {}, [
    el('div', { class: 'kicker' }, 'Chapter 02 · 绝境终端 / The Last Window'),
    el('h1', {}, '1% 电量，一条必须送达的消息'),
    el('p', { class: 'lead' }, [
      '选择一个场景，按下发送。屏幕上同时跑两套策略：',
      el('b', {}, '常规 App 的 JSON 整包'),
      '与',
      el('b', { style: 'color:var(--green)' }, '1% 三层协议'),
      '。信道按真实窄带模型模拟（丢包、停等重传、往返时延），接收端每收到一层信息就多一分行动能力。',
    ]),
  ]);

  /* ---------- 场景选择 ---------- */
  const scGrid = el('div', { class: 'grid cols-3' });
  SCENARIOS.forEach((sc) => {
    const card = el('div', {
      class: 'card scenario-card' + (state.scenarioId === sc.id ? ' selected' : ''),
      onclick: () => { loadScenario(sc.id); rerender(); },
    }, [
      el('div', { class: 'tag' }, `Scenario ${sc.id.toUpperCase()}`),
      el('h3', { style: 'margin:6px 0 2px' }, sc.title),
      el('div', { class: 'tiny en' }, sc.titleEn),
      el('p', { class: 'tiny', style: 'margin-top:6px' }, sc.desc),
    ]);
    scGrid.append(card);
  });

  /* ---------- 报文表单 ---------- */
  const form = el('div', { class: 'card', style: 'margin-top:16px' });
  form.append(el('h2', {}, '求救报文'));

  const coordRow = el('div', { class: 'row' });
  const latIn = el('input', { type: 'number', step: '0.0001', value: m.lat });
  const lonIn = el('input', { type: 'number', step: '0.0001', value: m.lon });
  const peopleIn = el('input', { type: 'number', min: '1', max: '127', value: m.people });
  const sevSel = el('select', {}, SEVERITY.map((s) => el('option', { value: s.id, selected: s.id === m.severity ? '' : false }, s.zh)));
  coordRow.append(
    el('label', { class: 'field' }, [el('span', {}, '纬度 latitude'), latIn]),
    el('label', { class: 'field' }, [el('span', {}, '经度 longitude'), lonIn]),
    el('label', { class: 'field' }, [el('span', {}, '人数 people'), peopleIn]),
    el('label', { class: 'field' }, [el('span', {}, '严重度 severity'), sevSel]),
  );

  const typeChips = el('div', { style: 'margin:12px 0 4px; display:flex; gap:8px; flex-wrap:wrap' },
    MSG_TYPES.map((t) => el('span', {
      class: 'chip' + (m.type === t.id ? ' on amber' : ''),
      onclick: (e) => { m.type = t.id; e.target.parentElement.querySelectorAll('.chip').forEach((c, i) => c.classList.toggle('on', MSG_TYPES[i].id === t.id)); },
    }, `${t.zh} ${t.en}`)));

  const needChips = el('div', { style: 'display:flex; gap:8px; flex-wrap:wrap; margin:8px 0 4px' },
    NEEDS.map((n) => el('span', {
      class: 'chip' + (m.needs[n.id] ? ' on' : ''),
      onclick: (e) => {
        m.needs[n.id] = m.needs[n.id] ? 0 : 1;
        e.target.classList.toggle('on', !!m.needs[n.id]);
      },
    }, n.zh)));

  const phraseChips = el('div', { style: 'display:flex; gap:8px; flex-wrap:wrap; margin:8px 0 4px' },
    PHRASES.map((p) => el('span', {
      class: 'chip blue' + (m.phrases.includes(p.id) ? ' on' : ''),
      title: p.en,
      onclick: (e) => {
        if (m.phrases.includes(p.id)) m.phrases = m.phrases.filter((x) => x !== p.id);
        else m.phrases.push(p.id);
        e.target.classList.toggle('on');
      },
    }, `${p.id}·${p.zh}`)));

  const textIn = el('textarea', { class: 'mono' }, m.text);
  textIn.addEventListener('input', () => { m.text = textIn.value; });

  const readInputs = () => {
    m.lat = parseFloat(latIn.value) || 0;
    m.lon = parseFloat(lonIn.value) || 0;
    m.people = Math.max(0, Math.min(127, parseInt(peopleIn.value, 10) || 0));
    m.severity = parseInt(sevSel.value, 10);
    m.text = textIn.value;
  };

  form.append(
    coordRow,
    el('div', { class: 'tiny', style: 'margin-top:6px' }, '报文类型'), typeChips,
    el('div', { class: 'tiny', style: 'margin-top:10px' }, '物资需求（每个 1 位）'), needChips,
    el('div', { class: 'tiny', style: 'margin-top:10px' }, '协议短语（共享词典，勾选即只占 1 个标志位）'), phraseChips,
    el('label', { class: 'field', style: 'margin-top:12px' }, [el('span', {}, '自由文本（UTF-8 → 静态 Huffman）'), textIn]),
  );

  /* ---------- 网络与预算 ---------- */
  const cfg = state.network;
  const ctrl = el('div', { class: 'card', style: 'margin-top:16px' }, [
    el('h2', {}, '信道与能量预算'),
    el('div', { style: 'display:flex; gap:8px; flex-wrap:wrap' },
      PROFILES.map((p) => el('span', {
        class: 'chip' + (cfg.bps === p.bps ? ' on amber' : ''),
        onclick: () => {
          Object.assign(cfg, { bps: p.bps, loss: p.loss, rtt: p.rtt });
          rerender();
        },
      }, p.name))),
    slider('带宽 bps', cfg.bps, [100, 300, 600, 1200, 2400, 9600, 50000, 200000], (v) => { cfg.bps = v; }, (v) => v >= 1000 ? (v / 1000) + ' kbps' : v + ' bps'),
    slider('丢包率', cfg.loss, [0, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5], (v) => { cfg.loss = v; }, (v) => pct(v, 0)),
    slider('往返超时 RTT', cfg.rtt, [100, 300, 600, 1000, 1500, 2500], (v) => { cfg.rtt = v; }, (v) => v + ' ms'),
    slider('可支配通信能量（1%≈410J 的一部分）', state.budgetJ, [5, 10, 15, 30, 60, 120, 410], (v) => { state.budgetJ = v; }, (v) => v + ' J'),
  ]);

  const battery = el('div', { class: 'battery-meter', style: 'margin-top:16px' }, [
    el('span', { class: 'tiny', style: 'min-width:80px' }, '剩余电量'),
    el('div', { class: 'battery-shell' }, [el('div', { class: 'battery-fill', id: 'mission-battery-fill' })]),
    el('span', { class: 'battery-pct', id: 'mission-battery-pct' }, '1%'),
  ]);

  const runBtn = el('button', {
    class: 'btn primary', style: 'margin-top:18px',
    onclick: () => { readInputs(); run(root); },
  }, '⚡ 发送：两种策略同屏对比');
  const reseedBtn = el('button', { class: 'btn ghost', style: 'margin-top:18px', onclick: () => { readInputs(); run(root, Math.floor(Math.random() * 1e9)); } }, '换一个随机信道');

  const stage = el('div', { id: 'mission-stage' });

  root.append(head, scGrid, form, ctrl, battery,
    el('div', { style: 'display:flex; gap:10px; flex-wrap:wrap' }, [runBtn, reseedBtn]),
    stage,
    el('div', { class: 'nav-row' }, [
      el('a', { class: 'btn ghost', href: '#/intro' }, '← 上一章：序章'),
      el('a', { class: 'btn', href: '#/lab' }, '下一章：编码实验室 →'),
    ]),
  );

  if (state._missionRun) run(root, state._missionSeed);
}

function slider(label, value, options, onChange, fmt2) {
  const idx = Math.max(0, options.indexOf(value));
  const val = el('span', { class: 'tag measured', style: 'margin-left:auto' }, fmt2(value));
  const input = el('input', { type: 'range', min: 0, max: options.length - 1, value: idx, step: 1 });
  input.addEventListener('input', () => {
    const v = options[parseInt(input.value, 10)];
    onChange(v);
    val.textContent = fmt2(v);
  });
  return el('label', { class: 'field' }, [
    el('div', { style: 'display:flex; align-items:center' }, [el('span', {}, label), val]),
    input,
  ]);
}

/* ---------- 运行与动画 ---------- */
function run(root, seed = 20261013) {
  state._missionRun = true;
  state._missionSeed = seed;
  const $ = (id) => root.querySelector(id);
  const stage = $('#mission-stage');
  if (!stage) return;
  clear(stage);

  const msg = messageWithTs();
  const jsonBytes = encodeJSON(msg);
  const layers = encodeLayers(msg);
  const cfg = state.network;
  const r = oneRun(jsonBytes.length, layers, cfg, seed);

  const maxMs = Math.max(r.json.timeMs, r.layered.l2Ms);
  const DURATION = 14000; // 动画总时长（ms）
  const scale = maxMs / DURATION;

  /* 两策略泳道 */
  const jsonLane = buildLane('A · 常规 App：JSON 整包', jsonBytes.length, cfg.packetSize, []);
  const l0Lane = buildLane('B · 1% 协议：L0 信标 / L1 定位 / L2 详情',
    layers.l0.length + layers.l1.length + layers.l2.length, cfg.packetSize,
    [['L0', layers.l0.length], ['L1', layers.l1.length], ['L2', layers.l2.length]]);

  /* 接收端 */
  const recv = el('div', { class: 'grid cols-2' });
  const recvJSON = el('div', { class: 'card tight' }, [
    el('h3', {}, 'A 接收端'),
    el('div', { class: 'tiny' }, '必须等全部数据包到达才能解析，否则什么都没有'),
  ]);
  const recvLayer = el('div', { class: 'card tight' }, [
    el('h3', {}, 'B 接收端'),
    el('div', { class: 'tiny' }, '边收边解，每一层都可立即行动'),
  ]);

  const u0 = el('div', { class: 'unlock', id: 'u-l0' }, [
    el('h4', {}, '🔒 L0 信标（5 B）'),
    el('div', { class: 'lock-note', id: 'u-l0-body' }, '等待中…'),
  ]);
  const u1 = el('div', { class: 'unlock', id: 'u-l1' }, [
    el('h4', {}, '🔒 L1 定位（9 B）'),
    el('div', { class: 'lock-note', id: 'u-l1-body' }, '等待中…'),
  ]);
  const u2 = el('div', { class: 'unlock', id: 'u-l2' }, [
    el('h4', {}, '🔒 L2 详情（变长）'),
    el('div', { class: 'lock-note', id: 'u-l2-body' }, '等待中…'),
  ]);
  const uJson = el('div', { class: 'unlock', id: 'u-json' }, [
    el('h4', {}, '🔒 完整 JSON'),
    el('div', { class: 'lock-note' }, '所有包到达前无法解析任何字段'),
  ]);
  recvLayer.append(u0, u1, u2);
  recvJSON.append(uJson);
  recv.append(recvJSON, recvLayer);

  const liveStats = el('div', { class: 'grid cols-4' }, [
    stat('信道时间', '—', 'sim-time'),
    stat('A 已耗能量', '—', 'a-energy'),
    stat('B 已耗能量', '—', 'b-energy'),
    stat('救援方已掌握', '无', 'known'),
  ]);

  stage.append(
    el('div', { class: 'card', style: 'margin-top:16px' }, [
      el('h2', {}, '发送中 · 窄带信道（动画加速）'),
      el('p', { class: 'tiny' }, `绿=已确认 红=丢包重传；实际时间 ${fmtMs(maxMs)} 被压缩到约 14 秒播放`),
      el('div', { class: 'lanes' }, [jsonLane.lane, l0Lane.lane]),
    ]),
    liveStats,
    el('div', { class: 'grid cols-2', style: 'margin-top:16px' }, [recvJSON, recvLayer]),
  );

  /* 动画调度 */
  cancelAnimationFrame(animTimer);
  const t0 = performance.now();
  const fill = $('#mission-battery-fill');
  const pctEl = $('#mission-battery-pct');
  const budget = state.budgetJ;
  const pW = ENERGY_MODEL.pRadio + ENERGY_MODEL.pScreen;
  const cutMs = budget / pW * 1000; // 能量预算耗尽时的模拟时间点

  const jsonEvents = r.json.events.map((e) => ({ ...e, atMs: e.atMs }));
  const layerEvents = r.layered.events;
  let ji = 0, li = 0;
  let l0Done = false, l1Done = false, l2Done = false, jsonDone = false, dead = false;

  const tick = (now) => {
    const elapsed = now - t0;
    const rawSimT = Math.min(maxMs, elapsed * scale);
    const simT = rawSimT;

    // 能量预算耗尽后不再处理任何新事件（模拟关机）
    const alive = simT < cutMs;

    // 事件驱动包状态（超出预算的发送尝试保持"发送中"灰态）
    while (ji < jsonEvents.length && jsonEvents[ji].atMs <= simT && alive) {
      const e = jsonEvents[ji++];
      const cell = jsonLane.cells[e.packet];
      if (e.lost) { cell.className = 'pkt lost'; cell.textContent = '✕'; }
      else { cell.className = 'pkt acked'; cell.textContent = '✓'; }
    }
    while (li < layerEvents.length && layerEvents[li].atMs <= simT && alive) {
      const e = layerEvents[li++];
      const cell = l0Lane.cells[e.layer + '-' + e.packet];
      if (e.lost) { cell.className = 'pkt ' + e.layer + ' lost'; cell.textContent = '✕'; }
      else { cell.className = 'pkt ' + e.layer + ' acked'; cell.textContent = '✓'; }
    }

    // 能量（随无线电在线时间线性增长，CPU 项对两策略对称，略去）
    const eA = Math.min(r.json.timeMs, simT, cutMs) / 1000 * pW;
    const eB = Math.min(r.layered.l2Ms, simT, cutMs) / 1000 * pW;
    const remain = Math.max(0, budget - eA);
    fill.style.width = Math.max(1, remain / budget * 100) + '%';
    fill.classList.toggle('low', remain / budget < 0.3);
    pctEl.textContent = (remain / budget * 100).toFixed(0) + '%';

    setStat(root, 'sim-time', fmtMs(simT) + (alive ? '' : '（已关机）'));
    setStat(root, 'a-energy', eA.toFixed(2) + ' J');
    setStat(root, 'b-energy', eB.toFixed(2) + ' J');

    // 逐层解锁（只在预算耗尽前有效）
    if (!l0Done && alive && simT >= r.layered.l0Ms) {
      l0Done = true; unlock(root, 'l0', renderL0(decodeL0(layers.l0)));
      setStat(root, 'known', 'SOS + 区域', 'var(--green)');
    }
    if (!l1Done && alive && simT >= r.layered.l1Ms) {
      l1Done = true; unlock(root, 'l1', renderL1(mergeL1(decodeL0(layers.l0), layers.l1)));
      setStat(root, 'known', '精确位置 + 人数', 'var(--green)');
    }
    if (!l2Done && alive && simT >= r.layered.l2Ms) {
      l2Done = true; unlock(root, 'l2', renderL2(mergeL2(mergeL1(decodeL0(layers.l0), layers.l1), layers.l2)));
      setStat(root, 'known', '完整求救信息', 'var(--green)');
    }
    if (!jsonDone && alive && simT >= r.json.timeMs) {
      jsonDone = true;
      uJson.classList.add('unlocked');
      uJson.querySelector('h4').textContent = '✓ 完整 JSON（' + jsonBytes.length + ' B）';
      uJson.querySelector('.lock-note').textContent = `此时才能解析：${jsonBytes.length} 字节全部到达`;
    }

    // 预算耗尽瞬间：标注未能送达的部分
    if (!dead && !alive) {
      dead = true;
      if (!jsonDone) {
        uJson.querySelector('h4').textContent = '⛔ 完整 JSON · 未送达';
        uJson.querySelector('.lock-note').textContent = `电量耗尽，还差未确认的包；JSON 整包无法解析，救援方什么都没得到`;
      }
      if (!l2Done) {
        u2.querySelector('h4').textContent = '⏳ L2 详情 · 超出能量预算';
        u2.querySelector('.lock-note').textContent = `需 ${(r.layered.l2Ms / 1000 * pW).toFixed(1)} J，预算 ${budget} J 不足；但 L0/L1 已让救援启动——详情可在补充供电/二次窗口补发`;
      }
      setStat(root, 'known', l0Done ? '已送出核心信息（L0/L1）' : '无', 'var(--red)');
    }

    if (elapsed < DURATION) {
      animTimer = requestAnimationFrame(tick);
    } else {
      finish(root, r, jsonBytes.length, layers, budget);
    }
  };
  animTimer = requestAnimationFrame(tick);
}

function buildLane(name, totalBytes, S, groups) {
  const lane = el('div', { class: 'lane' }, [
    el('div', { class: 'lane-head' }, [el('b', {}, name), el('span', { class: 'tiny' }, totalBytes + ' B · ' + Math.ceil(totalBytes / S) + ' 包')]),
    el('div', { class: 'lane-track' }),
  ]);
  const track = lane.querySelector('.lane-track');
  const cells = {};
  if (groups.length) {
    groups.forEach(([g, bytes]) => {
      const n = Math.ceil(bytes / S);
      for (let i = 0; i < n; i++) {
        const c = el('div', { class: `pkt ${g} sending` }, g);
        track.append(c);
        cells[g + '-' + i] = c;
      }
    });
  } else {
    const n = Math.ceil(totalBytes / S);
    for (let i = 0; i < n; i++) {
      const c = el('div', { class: 'pkt sending' }, String(i + 1));
      track.append(c);
      cells[i] = c;
    }
  }
  return { lane, cells };
}

function stat(label, value, id) {
  return el('div', { class: 'card tight' }, [
    el('div', { class: 'metric amber', id: 'st-' + id, style: 'font-size:19px' }, value),
    el('div', { class: 'metric-label' }, label),
  ]);
}
function setStat(root, id, value, color) {
  const e = root.querySelector('#st-' + id);
  if (e) { e.textContent = value; if (color) e.style.color = color; }
}
function unlock(root, id, html) {
  const u = root.querySelector('#u-' + id);
  if (!u) return;
  u.classList.add('unlocked');
  u.querySelector('h4').textContent = u.querySelector('h4').textContent.replace('🔒', '✓');
  const body = root.querySelector('#u-' + id + '-body');
  if (body) { body.className = ''; body.innerHTML = html; }
}

function renderL0(p) {
  const sev = ['安全', '轻伤', '重伤', '危急'][p.severity];
  const type = ['SOS 求救', '通报', '平安'][p.type];
  return `<b>${type}</b>，严重度：<b>${sev}</b><br>
  粗坐标：${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}<br>
  <span class="tiny">网格精度约 ${p.latResolutionM.toFixed(0)}m × ${p.lonResolutionM.toFixed(0)}m —— 足以把救援队派往正确的山谷</span>`;
}
function renderL1(p) {
  const need = Object.entries(p.needs).filter(([, v]) => v).map(([k]) => ({ medical: '医疗', water: '饮水', food: '食物', shelter: '避险', warmth: '保暖', rescue: '转移' }[k])).join('、');
  return `精确坐标：<b>${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}</b>（误差 &lt;1m）<br>
  人数：<b>${p.people}</b>　需求：<b>${need || '无'}</b><br>
  时间戳：${new Date(p.ts * 1000).toLocaleString('zh-CN', { hour12: false })}<br>
  <span class="tiny">相对 L0 只发送差分坐标（delta 编码，9+10 位）</span>`;
}
function renderL2(p) {
  const phrases = p.phrases.map((id) => PHRASES[id].zh).join('；');
  return `协议短语：<b>${phrases || '无'}</b><br>
  自由文本：${p.text}<br>
  <span class="tiny">短语来自双方共享词典，每个 1 个标志位；文本经静态 Huffman 压缩</span>`;
}

function finish(root, r, jsonBytes, layers, budget) {
  const stage = root.querySelector('#mission-stage');
  const pW = ENERGY_MODEL.pRadio + ENERGY_MODEL.pScreen;
  const eJSON = r.json.timeMs / 1000 * pW;
  const eL0 = r.layered.l0Ms / 1000 * pW;
  const eL1 = r.layered.l1Ms / 1000 * pW;
  const eFull = r.layered.l2Ms / 1000 * pW;

  const aOk = eJSON <= budget;
  const bL0 = eL0 <= budget;
  const bL1 = eL1 <= budget;
  const bFull = eFull <= budget;

  let cls, icon, title, detail;
  if (aOk && bFull) {
    cls = 'win'; icon = '✅';
    title = '两套策略都送完了——但代价相差悬殊';
    detail = `A 完整送达耗时 ${fmtMs(r.json.timeMs)}、耗能 ${eJSON.toFixed(2)} J；B 的首个可行动信息（L0）只用 ${fmtMs(r.layered.l0Ms)}、${eL0.toFixed(2)} J——同样的能量，B 可以重发约 ${(eJSON / eL0).toFixed(0)} 次信标。`;
  } else if (!aOk && bFull) {
    cls = 'win'; icon = '⛔';
    title = 'A 电量耗尽、零信息送达；B 完整送达，还有能量富余';
    detail = `A 完整送达需要 ${eJSON.toFixed(1)} J（超出预算 ${budget} J），关键信息随关机一起丢失；B 在 ${fmtMs(r.layered.l0Ms)} / ${eL0.toFixed(2)} J 时就把救援区域送出，全部详情也只花 ${eFull.toFixed(2)} J（预算内剩余 ${(budget - eFull).toFixed(1)} J 可用于重发确认）。`;
  } else if (!bFull && bL0) {
    cls = 'win'; icon = '⛔';
    title = 'A 电量耗尽、零信息送达；B 已在预算内送出 L0/L1，救援因此启动';
    detail = `A 需要 ${eJSON.toFixed(1)} J（超出预算 ${budget} J），救援方什么都没收到；B 的信标 ${fmtMs(r.layered.l0Ms)} / ${eL0.toFixed(2)} J 即达，${bL1 ? '定位包 ' + fmtMs(r.layered.l1Ms) + ' / ' + eL1.toFixed(2) + ' J 也已送达' : '定位包超出预算'}，完整详情需 ${eFull.toFixed(1)} J，可在补充供电后补发——但救援队此刻已经知道“去哪里、救谁、有多急”。`;
  } else {
    cls = 'lose'; icon = '⛔';
    title = '能量预算过低：连 5 字节信标都未能送达';
    detail = `在 ${budget} J 预算下，单条 L0 信标也需 ${eL0.toFixed(1)} J。请调高能量预算滑块，或把信道切换到更差档位对比——本作品所有数值均为实时模拟，不预设结论。`;
  }

  const verdict = el('div', { class: 'verdict ' + cls }, [
    el('div', { style: 'font-size:30px' }, icon),
    el('div', {}, [
      el('h3', {}, title),
      el('p', { class: 'muted', style: 'margin:4px 0 0' }, detail),
    ]),
  ]);

  const yn = (b) => b ? '是 ✓' : '否 ✗';
  const table = el('div', { class: 'card', style: 'margin-top:16px' }, [
    el('h2', {}, '本次对比（单次随机结果）'),
    tableHTML([
      ['指标', 'A · JSON 整包', 'B · L0 信标', 'B · 三层完整'],
      ['字节数', jsonBytes + ' B', layers.l0.length + ' B', layers.total + ' B'],
      ['信道时间', fmtMs(r.json.timeMs), fmtMs(r.layered.l0Ms), fmtMs(r.layered.l2Ms)],
      ['发送尝试（含重传）', r.json.attempts + ' 包次', r.layered.events.filter((e) => e.layer === 'L0').length + ' 包次', r.layered.attempts + ' 包次'],
      ['耗能（模型）', eJSON.toFixed(2) + ' J', eL0.toFixed(2) + ' J', eFull.toFixed(2) + ' J'],
      ['在 ' + budget + ' J 预算内送达', yn(aOk), yn(bL0), yn(bFull)],
      ['接收端可行动', aOk ? '完整送达后' : '不可', '立即', '完整送达后'],
    ]),
  ]);
  stage.append(verdict, table);
}

function tableHTML(rows) {
  const t = el('table');
  rows.forEach((r, i) => {
    const tr = el(i === 0 ? 'th' : 'tr');
    r.forEach((c, j) => {
      const cell = el(i === 0 ? 'th' : 'td', { class: j > 0 ? 'num' : '' }, String(c));
      tr.append(cell);
    });
    t.append(i === 0 ? el('thead', {}, tr) : tr);
  });
  return t;
}
