/* lab.js — 编码实验室：四种编码同屏对比 + 位级检视 + Huffman 树 */
import { el, fold, clear, bitGrid, modal, tabs } from './common.js';
import { state, messageWithTs } from '../state.js';
import { PHRASES, STATIC_CORPUS } from '../phrasebook.js';
import { utf8Encoder } from '../huffman.js';
import {
  buildHuffmanTree, codeLengthsFromFreq, canonicalCodes,
  getStaticModel, encodeDynamic,
} from '../huffman.js';
import {
  encodeJSON, encodeMonolithic, encodeLayers, encodeL2Dynamic,
  encodeL0, encodeL1, encodeL2, roundTripOK,
  l0FieldSpans, l1FieldSpans,
} from '../protocol.js';
import { bytesToHex } from '../bit.js';
import { encodeGzip } from '../protocol.js';

export async function renderLab(root) {
  const msg = messageWithTs();
  const head = el('div', {}, [
    el('div', { class: 'kicker' }, 'Chapter 03 · 编码实验室 / Encoding Lab'),
    el('h1', {}, '同一条消息，用多少字节？'),
    el('p', { class: 'lead' }, [
      '所有编码都在浏览器里实时计算，',
      el('b', {}, '可解码还原、可逐位检视'),
      '。你可以直接修改自由文本，观察每种编码的字节变化。中文为 UTF-8 三字节，动态 Huffman 的表头代价也如实呈现。',
    ]),
  ]);

  const textArea = el('textarea', { class: 'mono', style: 'min-height:64px' }, msg.text);
  const phraseLine = el('div', { class: 'tiny', style: 'margin-top:6px' });
  const refreshPhrase = () => {
    phraseLine.innerHTML = '已勾选共享短语：' +
      (msg.phrases.length
        ? msg.phrases.map((id) => `<b style="color:var(--green)">${PHRASES[id].zh}</b>`).join('；')
        : '（无）');
  };
  refreshPhrase();

  const results = el('div', {});

  const recompute = () => {
    msg.text = textArea.value;
    refreshPhrase();
    compute(results, msg);
  };
  textArea.addEventListener('input', recompute);

  root.append(head,
    el('div', { class: 'card', style: 'margin-top:18px' }, [
      el('h2', {}, '自由文本（其余字段在第 2 章「绝境终端」编辑）'),
      textArea, phraseLine,
    ]),
    results,
    folds(),
    el('div', { class: 'nav-row' }, [
      el('a', { class: 'btn ghost', href: '#/mission' }, '← 上一章：绝境终端'),
      el('a', { class: 'btn', href: '#/network' }, '下一章：弱网实验室 →'),
    ]),
  );
  compute(results, msg);
}

async function compute(root, msg) {
  clear(root);
  const json = encodeJSON(msg);
  const mono = encodeMonolithic(msg);
  const layers = encodeLayers(msg);
  const dyn = encodeL2Dynamic(msg);
  const gzip = await encodeGzip(msg);
  const rt = roundTripOK(msg);

  const ok = (b) => el('span', { class: 'tag measured' }, b ? '✓ 解码还原一致' : '✗ 不一致');
  const ratio = (n) => {
    const r = json.length / n;
    return el('span', { class: 'ratio-good', style: 'margin-left:8px' }, r.toFixed(2) + '× 节省');
  };

  const jsonCard = el('div', { class: 'card' }, [
    el('h3', {}, ['JSON 基线 · ', el('span', { class: 'muted', style: 'font-weight:400' }, '常规 App'), ' ', ok(rt.monolithic)]),
    el('div', { style: 'display:flex;align-items:baseline;gap:10px;margin:8px 0' }, [
      el('span', { class: 'metric amber', style: 'font-size:30px' }, json.length + ' B'),
      el('span', { class: 'tiny' }, 'UTF-8 文本，字段名重复传输，中文 3 字节/字'),
    ]),
    el('div', { class: 'hex' }, bytesToHex(json.slice(0, 48)) + (json.length > 48 ? ' …' : '')),
    el('div', { class: 'tiny', style: 'margin-top:8px' }, 'ASCII 预览：' + new TextDecoder().decode(json.slice(0, 90)) + (json.length > 90 ? '…' : '')),
  ]);

  const monoCard = el('div', { class: 'card' }, [
    el('h3', {}, ['单体位打包 · ', el('span', { class: 'muted', style: 'font-weight:400' }, '二进制但不分级'), ' ', ok(rt.monolithic)]),
    el('div', { style: 'display:flex;align-items:baseline;gap:10px;margin:8px 0' }, [
      el('span', { class: 'metric amber', style: 'font-size:30px' }, mono.length + ' B'),
      ratio(mono.length),
    ]),
    el('div', { class: 'hex' }, bytesToHex(mono)),
    el('div', { class: 'tiny', style: 'margin-top:8px' }, '所有字段紧凑排列，但接收端必须拿到整包才能解析'),
  ]);

  const layerBlocks = [];
  [['L0', layers.l0, '信标：类型+粗坐标+严重度'], ['L1', layers.l1, '定位：时间+差分坐标+人数+需求'], ['L2', layers.l2, '详情：短语位 + Huffman 文本']]
    .forEach(([name, data, desc], i) => {
      layerBlocks.push(el('div', {
        style: 'border-left:3px solid ' + ['var(--green)', 'var(--blue)', 'var(--violet)'][i] + ';padding-left:12px;margin:10px 0',
      }, [
        el('div', { style: 'display:flex;align-items:baseline;gap:8px' }, [
          el('b', {}, name),
          el('span', { class: 'metric', style: `font-size:20px;color:${['var(--green)', 'var(--blue)', 'var(--violet)'][i]}` }, data.length + ' B'),
        ]),
        el('div', { class: 'tiny' }, desc),
        el('div', { class: 'hex', style: 'margin-top:6px' }, bytesToHex(data)),
      ]));
    });

  const layerCard = el('div', { class: 'card accent-green' }, [
    el('h3', {}, ['1% 三层协议 · ', el('span', { class: 'muted', style: 'font-weight:400' }, '边收边解'), ' ', ok(rt.layered)]),
    el('div', { style: 'display:flex;align-items:baseline;gap:10px;margin:8px 0' }, [
      el('span', { class: 'metric green', style: 'font-size:30px' }, layers.total + ' B'),
      ratio(layers.total),
    ]),
    ...layerBlocks,
    el('div', { class: 'tiny', style: 'margin-top:6px' },
      `仅 L0 就只有 ${json.length} B 中的 ${layers.l0.length} B（${(json.length / layers.l0.length).toFixed(1)}×），且它是一条独立可行动的信息`),
  ]);

  const gzipCard = el('div', { class: 'card' });
  if (gzip) {
    gzipCard.append(
      el('h3', {}, 'gzip · 通用压缩器（浏览器原生）'),
      el('div', { style: 'display:flex;align-items:baseline;gap:10px;margin:8px 0' }, [
        el('span', { class: 'metric amber', style: 'font-size:30px' }, gzip.length + ' B'),
        el('span', { class: 'tiny' }, '通用算法 + 流式字典，短报文摊不平固定开销'),
      ]),
      el('div', { class: 'tiny' }, `对这种短报文，gzip 只把 ${json.length} B 的 JSON 压到 ${gzip.length} B（约 ${(json.length / gzip.length).toFixed(2)}×），体积仍是三层协议的 ${(gzip.length / layers.total).toFixed(2)} 倍；通用压缩器也不知道“哪些字段最该先到”。`),
    );
  } else {
    gzipCard.append(el('h3', {}, 'gzip · 浏览器不支持 CompressionStream'), el('div', { class: 'tiny' }, '当前环境无此 API，跳过该对照'));
  }

  const grid = el('div', { class: 'grid cols-2' }, [jsonCard, gzipCard, monoCard, layerCard]);

  /* 动态 vs 静态表头对照 */
  const staticModel = getStaticModel();
  const rawTextBytes = utf8Encoder.encode(msg.text || '').length;
  const dynNote = el('div', { class: 'card', style: 'margin-top:16px' }, [
    el('h2', {}, '智能缓存：Huffman 模型该谁来付？'),
    el('div', { class: 'grid cols-4' }, [
      mini('自由文本原文', rawTextBytes + ' B'),
      mini('动态 Huffman（含表头）', dyn.totalBytes + ' B', '表头 ' + dyn.headerBytes + ' B'),
      mini('静态 Huffman（模型已预装）', layers.l2.length + ' B', 'L2 整体'),
      mini('静态模型只付一次', staticModel.modelBytes + ' B', '随 App 预装，零流量分摊'),
    ]),
    el('p', { class: 'tiny', style: 'margin-top:10px' },
      '单条短报文里，动态模型的表头常常比省下的字节还多——这正是真实工程的取舍。1% 协议让双方共享由应急语料训练的静态模型，如同 Brotli 内置字典与短报文应急码：把一次性的成本移出最窄的信道。'),
  ]);

  /* 工具按钮 */
  const tools = el('div', { style: 'display:flex;gap:10px;flex-wrap:wrap;margin-top:16px' }, [
    el('button', {
      class: 'btn', onclick: () => openBitInspector(msg),
    }, '🔍 位级检视器（L0 / L1）'),
    el('button', {
      class: 'btn', onclick: () => openTree(msg),
    }, '🌳 Huffman 树（当前文本）'),
  ]);

  root.append(tools, grid, dynNote);
}

function mini(label, value, sub) {
  return el('div', { class: 'card tight' }, [
    el('div', { class: 'metric', style: 'font-size:20px' }, value),
    el('div', { class: 'metric-label' }, label),
    sub ? el('div', { class: 'tiny' }, sub) : null,
  ]);
}

function folds() {
  return el('div', { style: 'margin-top:18px' }, [
    fold('位打包：为什么一个字段不用整数个字节？', [
      el('p', {}, '严重度只有 0–3 四种取值，用 2 位就够；需求 6 项各占 1 位。JSON 里 "severity":3 是 12 个字节，位打包后只占 2 位。协议里 L0 信标 38 位 = 5 字节，已经装下类型、粗坐标与严重度。'),
    ]),
    fold('定点数 + 差分：坐标怎么从 20 字节变成 5 字节？', [
      el('p', {}, '坐标是小数，JSON 按文本写 "22.2543" 要 8 个字符。我们把 [-90,90] 线性映射到 25 位整数，误差约 0.6 米，救援足够。L0 先发高 16 位（约 300 米网格），L1 再发低 9 位差分——同一个坐标的精度，按紧急程度分两次送达。'),
    ]),
    fold('共享词典：一句短语为什么只值 1 位？', [
      el('p', {}, '“有人重伤，急需医疗救助”在 UTF-8 里是 39 字节。通信双方预装同一本 16 条应急短语词典，每条只占一个标志位，16 条总共 2 字节。这不是偷懒：警务无线电 10-code、航空应急码、短信应急码都是同一个思路。'),
    ]),
    fold('为什么不直接上 gzip？', [
      el('p', {}, 'gzip/Brotli 是优秀的通用压缩器，但它们面向字节流，不理解“优先级”。短报文摊不平字典与流头；更关键的是压缩后的整体仍是一个不可分割的块——收到 90% 也无法解码。1% 协议的设计单位是“决策”而非“字节”：先送达的必须是最能改变行动的信息。'),
    ]),
  ]);
}

/* ---------- 位级检视模态 ---------- */
function openBitInspector(msg) {
  const l0 = encodeL0(msg);
  const l1 = encodeL1(msg);
  const wrap = el('div', {}, tabs([
    {
      name: 'L0 信标（5 B）',
      render: (c) => c.append(bitGrid(l0, l0FieldSpans()),
        el('p', { class: 'tiny', style: 'margin-top:10px' }, '每种颜色一个字段；位串按高位在前排列，与代码中的 BitWriter 完全一致。')),
    },
    {
      name: 'L1 定位（9 B）',
      render: (c) => c.append(bitGrid(l1, l1FieldSpans()),
        el('p', { class: 'tiny', style: 'margin-top:10px' }, 'L1 不含坐标高位——它们在 L0 里，只补发 9+10 位差分，这就是差分编码。')),
    },
  ]));
  modal('位级检视器 · Bit Inspector', wrap);
}

/* ---------- Huffman 树 ---------- */
function openTree(msg) {
  const text = msg.text || '';
  const bytes = utf8Encoder.encode(text);
  if (!bytes.length) {
    return modal('Huffman 树', el('p', { class: 'muted' }, '当前没有自由文本，输入一些文字后再查看。'));
  }
  const freq = new Uint32Array(256);
  for (const b of bytes) freq[b]++;
  const tree = buildHuffmanTree(freq);
  const lens = codeLengthsFromFreq(freq);
  const codes = canonicalCodes(lens);

  // 布局
  const leaves = [];
  (function index(node, depth) {
    if (node.sym >= 0) { leaves.push({ node, depth }); return; }
    if (node.left) index(node.left, depth + 1);
    if (node.right) index(node.right, depth + 1);
  })(tree, 0);
  const LW = 56, LH = 74;
  const W = Math.max(640, leaves.length * LW);
  const maxDepth = Math.max(...leaves.map((l) => l.depth));
  const H = (maxDepth + 1) * LH + 40;
  const leafX = new Map();
  leaves.forEach((l, i) => { l.x = i * LW + 30; l.y = l.depth * LH + 24; leafX.set(l.node, l.x); });

  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', W); svg.setAttribute('height', H);
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

  // 自底向上确定内部节点 x
  (function layout(node) {
    if (node.sym >= 0) { node.x = leafX.get(node); node.y = nodeDepth(node) * LH + 24; return; }
    layout(node.left); layout(node.right);
    node.x = (node.left.x + node.right.x) / 2;
    const d = nodeDepth(node);
    node.y = d * LH + 24;
  })(tree);
  function nodeDepth(target) {
    let d;
    (function walk(n, depth) {
      if (n === target) d = depth;
      else if (n.sym < 0) { walk(n.left, depth + 1); walk(n.right, depth + 1); }
    })(tree, 0);
    return d;
  }

  // 画边
  (function edges(node) {
    if (node.sym >= 0) return;
    [[node.left, '0'], [node.right, '1']].forEach(([child, bit]) => {
      const line = document.createElementNS(ns, 'line');
      line.setAttribute('x1', node.x); line.setAttribute('y1', node.y);
      line.setAttribute('x2', child.x); line.setAttribute('y2', child.y);
      line.setAttribute('stroke', bit === '0' ? '#3ddc84' : '#ffb020');
      line.setAttribute('stroke-width', '1.4');
      svg.append(line);
    });
    edges(node.left); edges(node.right);
  })(tree);
  // 画节点
  (function nodes(node) {
    const g = document.createElementNS(ns, 'g');
    const c = document.createElementNS(ns, 'circle');
    c.setAttribute('cx', node.x); c.setAttribute('cy', node.y);
    c.setAttribute('r', node.sym >= 0 ? 13 : 9);
    c.setAttribute('fill', node.sym >= 0 ? '#1e2822' : '#121714');
    c.setAttribute('stroke', node.sym >= 0 ? '#58b6ff' : '#68796e');
    c.setAttribute('stroke-width', '1.4');
    g.append(c);
    if (node.sym >= 0) {
      const t = document.createElementNS(ns, 'text');
      t.setAttribute('x', node.x); t.setAttribute('y', node.y + 32);
      t.setAttribute('text-anchor', 'middle');
      t.setAttribute('fill', '#9db1a5');
      t.setAttribute('font-size', '10');
      t.setAttribute('font-family', 'monospace');
      const ch = node.sym >= 32 && node.sym < 127 ? String.fromCharCode(node.sym) : '0x' + node.sym.toString(16);
      t.textContent = `${ch}·${node.freq}`;
      g.append(t);
    }
    svg.append(g);
    if (node.sym < 0) { nodes(node.left); nodes(node.right); }
  })(tree);

  const scroll = el('div', { style: 'overflow:auto;max-height:56vh;border:1px solid var(--border-soft);border-radius:10px' }, svg);
  const rows = leaves.map(({ node }) => {
    const code = codes[node.sym];
    const bits = lens[node.sym];
    let str = '';
    for (let i = bits - 1; i >= 0; i--) str += (code >> i) & 1;
    const ch = node.sym >= 32 && node.sym < 127 ? String.fromCharCode(node.sym) : '0x' + node.sym.toString(16).padStart(2, '0');
    return { ch, freq: node.freq, code: str, bits };
  }).sort((a, b) => b.freq - a.freq);
  const table = el('table', { style: 'margin-top:12px' }, [
    el('thead', {}, el('tr', {}, [
      el('th', {}, '字节'), el('th', { class: 'num' }, '出现次数'),
      el('th', { class: 'num' }, 'Huffman 码'), el('th', { class: 'num' }, '码长'),
    ])),
    el('tbody', {}, rows.map((r) => el('tr', {}, [
      el('td', { class: 'mono' }, r.ch),
      el('td', { class: 'num' }, r.freq),
      el('td', { class: 'num' }, el('span', { class: 'mono', style: 'color:var(--green)' }, r.code)),
      el('td', { class: 'num' }, r.bits + ' 位'),
    ]))),
  ]);
  modal('Huffman 树 · 当前文本的动态模型（按真实现测频率构建）', el('div', {}, [
    el('p', { class: 'tiny' }, '绿边=0，橙边=1；高频字节码长短。这棵树若随消息发送，就是你看到的“动态表头”成本。'),
    scroll, table,
  ]));
}
