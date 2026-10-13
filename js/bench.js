/*
 * bench.js — 浏览器内实测基准 / In-browser real benchmark
 * 所有数字在你的设备上现算，不使用任何预填结果。
 */

import { mulberry32 } from './bit.js';
import { PHRASES } from './phrasebook.js';
import {
  encodeJSON, encodeMonolithic, encodeLayers, decodeMonolithic,
  decodeLayersProgressively, encodeL2Dynamic, encodeGzip,
} from './protocol.js';
import { decodeDynamic } from './huffman.js';
import { monteCarlo, analyticExpectedMs, DEFAULT_PROFILE } from './network.js';
import { energyCost } from './energy.js';

const TEXT_TEMPLATES = [
  '{a}人{b}，需要{c}，位置见坐标，请尽快救援。',
  '我们在{loc}，{a}人被困，{b}，手机快没电了。',
  '道路塌方，{a}人滞留{loc}，需要{c}，老人儿童各一名。',
  '已避险于{loc}，{a}人，{b}，收到请回复确认。',
  '{a} people {b}, need {c}. Coordinates attached, please respond.',
  'Shelter at {loc}, {a} people, {b}, battery low.',
];
const A = ['两', '三', '七', '十二', '五', '二十'];
const B = ['一人重伤', '有人骨折', '轻伤若干', '有人失温', '药品将尽', '有人失联'];
const C = ['医疗和饮用水', '担架与药品', '毯子和食物', '照明和电源', '饮用水和保暖物资'];
const LOC = ['溪谷东侧巨石下', '山腰平台', '废弃护林站', '公路 K23 塌方点', '溪流北岸', '村小操场'];

export function randomMessage(rng) {
  const tpl = TEXT_TEMPLATES[Math.floor(rng() * TEXT_TEMPLATES.length)];
  const text = tpl
    .replace('{a}', A[Math.floor(rng() * A.length)])
    .replace('{b}', B[Math.floor(rng() * B.length)])
    .replace('{c}', C[Math.floor(rng() * C.length)])
    .replace('{loc}', LOC[Math.floor(rng() * LOC.length)]);
  const needs = {
    medical: rng() > 0.4 ? 1 : 0,
    water: rng() > 0.45 ? 1 : 0,
    food: rng() > 0.6 ? 1 : 0,
    shelter: rng() > 0.6 ? 1 : 0,
    warmth: rng() > 0.6 ? 1 : 0,
    rescue: rng() > 0.3 ? 1 : 0,
  };
  const pn = 1 + Math.floor(rng() * 8);
  const phrases = [];
  for (let i = 0; i < pn; i++) {
    const id = Math.floor(rng() * PHRASES.length);
    if (!phrases.includes(id)) phrases.push(id);
  }
  return {
    type: rng() > 0.3 ? 0 : 1,
    lat: 18 + rng() * 30,
    lon: 95 + rng() * 30,
    ts: Math.floor(Date.now() / 1000 - rng() * 86400),
    people: 1 + Math.floor(rng() * 45),
    severity: Math.floor(rng() * 4),
    needs,
    phrases,
    text,
  };
}

const stats = (arr) => {
  const s = arr.slice().sort((a, b) => a - b);
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  return {
    mean,
    median: s[Math.floor(s.length / 2)],
    min: s[0],
    max: s[s.length - 1],
  };
};

// 亚毫秒级操作采用批量计时：自适应增大每批次数，使每批耗时 ≥ ~3ms，再除以次数
function timedBatch(fn, batches = 25, targetMs = 3) {
  for (let i = 0; i < 30; i++) fn();
  const perCall = [];
  let k = 1;
  for (let b = 0; b < batches; b++) {
    const t0 = performance.now();
    for (let i = 0; i < k; i++) fn();
    const dt = performance.now() - t0;
    perCall.push(dt / k);
    if (dt < targetMs && k < 100000) k *= 4;
  }
  return stats(perCall).median;
}

async function timedBatchAsync(fn, batches = 20, targetMs = 5) {
  for (let i = 0; i < 5; i++) await fn();
  const perCall = [];
  let k = 1;
  for (let b = 0; b < batches; b++) {
    const t0 = performance.now();
    for (let i = 0; i < k; i++) await fn();
    const dt = performance.now() - t0;
    perCall.push(dt / k);
    if (dt < targetMs && k < 2000) k *= 2;
  }
  return stats(perCall).median;
}

export async function runBenchmark({ count = 300, onProgress } = {}) {
  const rng = mulberry32(20261013);
  const msgs = Array.from({ length: count }, () => randomMessage(rng));

  const sizes = { json: [], mono: [], l0: [], l1: [], l2: [], layers: [], gzip: [], l2dynHeader: [], l2dyn: [] };

  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    const j = encodeJSON(m);
    const mono = encodeMonolithic(m);
    const layers = encodeLayers(m);
    sizes.json.push(j.length);
    sizes.mono.push(mono.length);
    sizes.l0.push(layers.l0.length);
    sizes.l1.push(layers.l1.length);
    sizes.l2.push(layers.l2.length);
    sizes.layers.push(layers.total);
    const dyn = encodeL2Dynamic(m);
    sizes.l2dynHeader.push(dyn.headerBytes);
    sizes.l2dyn.push(dyn.totalBytes);
    if (i % 20 === 0 && onProgress) onProgress(i / msgs.length * 0.7);
  }

  // gzip 体积（异步、原生）
  for (let i = 0; i < Math.min(60, msgs.length); i++) {
    const g = await encodeGzip(msgs[i]);
    if (g) sizes.gzip.push(g.length);
  }

  // 编解码耗时：批量计时（被测报文预先编码好，计时只覆盖解码本身）
  const t = msgs[0];
  const tj = encodeJSON(t);
  const tMono = encodeMonolithic(t);
  const tLayers = encodeLayers(t);
  const tJsonText = new TextDecoder().decode(tj);
  const one = (v) => ({ mean: v, median: v, min: v, max: v });
  const encJson = timedBatch(() => encodeJSON(t));
  const encMono = timedBatch(() => encodeMonolithic(t));
  const encLayer = timedBatch(() => encodeLayers(t));
  const decJson = timedBatch(() => JSON.parse(tJsonText));
  const decMono = timedBatch(() => decodeMonolithic(tMono));
  const decLayer = timedBatch(() => decodeLayersProgressively(tLayers));
  const encGzip = await timedBatchAsync(() => encodeGzip(t));
  const encStats = {
    json: one(encJson),
    mono: one(encMono),
    layered: one(encLayer),
    gzip: isFinite(encGzip) ? one(encGzip) : null,
  };
  const decStats = {
    json: one(decJson),
    mono: one(decMono),
    layered: one(decLayer),
  };
  if (onProgress) onProgress(1);

  // 典型样本的网络蒙特卡洛
  const sample = msgs[0];
  const layers = encodeLayers(sample);
  const mc = monteCarlo({
    jsonBytes: encodeJSON(sample).length,
    layers,
    cfg: DEFAULT_PROFILE,
    runs: 300,
  });
  const analytic = {
    json: analyticExpectedMs(encodeJSON(sample).length, DEFAULT_PROFILE),
    l0: analyticExpectedMs(layers.l0.length, DEFAULT_PROFILE),
    l1: analyticExpectedMs(layers.l0.length + layers.l1.length, DEFAULT_PROFILE),
    l2: analyticExpectedMs(layers.total, DEFAULT_PROFILE),
  };

  // 能量：用蒙特卡洛均值 + 编码中位耗时
  const energyJSON = energyCost(mc.json.meanMs, encStats.json.median + decStats.json.median, true);
  const energyL0 = energyCost(mc.layered.l0.meanMs, encStats.layered.median, true);
  const energyFull = energyCost(mc.layered.l2.meanMs, encStats.layered.median + decStats.layered.median, true);

  return {
    generatedAt: new Date().toISOString(),
    count,
    sample,
    sizes: {
      json: stats(sizes.json),
      mono: stats(sizes.mono),
      l0: stats(sizes.l0),
      l1: stats(sizes.l1),
      l2: stats(sizes.l2),
      layers: stats(sizes.layers),
      gzip: sizes.gzip.length ? stats(sizes.gzip) : null,
      l2dynHeader: stats(sizes.l2dynHeader),
      l2dyn: stats(sizes.l2dyn),
    },
    encMs: encStats,
    decMs: decStats,
    network: { mc, analytic, cfg: DEFAULT_PROFILE },
    energy: { json: energyJSON, l0: energyL0, full: energyFull },
    ratios: {
      jsonVsLayered: stats(sizes.json).mean / stats(sizes.layers).mean,
      jsonVsL0: stats(sizes.json).mean / stats(sizes.l0).mean,
      monoVsLayered: stats(sizes.mono).mean / stats(sizes.layers).mean,
      gzipVsLayered: sizes.gzip.length ? stats(sizes.gzip).mean / stats(sizes.layers).mean : null,
      ttfa: mc.json.meanMs / mc.layered.l0.meanMs,
    },
  };
}
