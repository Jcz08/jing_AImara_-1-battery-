/*
 * network.js — 受损窄带网络模拟器 / Damaged narrow-band network simulator
 *
 * 模型参数（全部显式、可调）：
 *   bps     信道有效带宽（bit/s）
 *   loss    单包丢包率（独立同分布）
 *   rtt     停等式 ARQ 的超时/确认往返（ms）
 *   packetSize 每包载荷字节（不足按实际算）
 *
 * 两种策略：
 *   A 一次性整包：必须全部包到达，接收方才能解析；丢一个包就要重传
 *   B 分层优先：L0→L1→L2 各自独立确认，L0 到达即"可行动"
 *
 * 全部模拟使用固定种子的 mulberry32，结果可复现。
 */

import { mulberry32 } from './bit.js';

export const DEFAULT_PROFILE = {
  bps: 600,
  loss: 0.30,
  rtt: 1500,
  packetSize: 32,
};

export const PROFILES = [
  { key: 'sms',  name: '灾后 2G 控制信道', bps: 600,  loss: 0.30, rtt: 1500 },
  { key: '2g',   name: '弱 2G / GPRS',    bps: 2400, loss: 0.20, rtt: 1000 },
  { key: 'edge', name: 'EDGE 弱网',       bps: 12000, loss: 0.10, rtt: 600 },
  { key: 'fair', name: '一般 4G 弱覆盖',  bps: 200000, loss: 0.03, rtt: 200 },
];

/**
 * 停等式发送一段字节流，返回单次随机结果
 * @returns {{packets:number, attempts:number, timeMs:number, events:Array}}
 */
export function simulateMessage(bytes, cfg, rng) {
  const S = cfg.packetSize;
  const n = Math.ceil(bytes / S);
  let attempts = 0;
  let timeMs = 0;
  const events = [];
  for (let i = 0; i < n; i++) {
    const start = (i * S);
    const piece = Math.min(S, bytes - start);
    const txMs = (piece * 8) / cfg.bps * 1000;
    let tries = 0;
    let ok = false;
    while (!ok) {
      tries++;
      attempts++;
      timeMs += txMs + cfg.rtt;
      if (rng() >= cfg.loss) {
        ok = true;
        events.push({ packet: i, tries, atMs: timeMs });
      } else {
        events.push({ packet: i, tries, atMs: timeMs, lost: true });
      }
    }
  }
  return { packets: n, attempts, timeMs, events };
}

/**
 * 分层发送：L0→L1→L2，累计时间戳
 * @returns {{l0Ms,l1Ms,l2Ms, attempts, events}}
 */
export function simulateLayers(layers, cfg, rng) {
  const events = [];
  let base = 0;
  const run = (name, bytes) => {
    const r = simulateMessage(bytes, cfg, rng);
    r.events.forEach((e) => events.push({ ...e, layer: name, atMs: base + e.atMs }));
    base += r.timeMs;
    return { ...r, cumMs: base };
  };
  const a = run('L0', layers.l0.length);
  const b = run('L1', layers.l1.length);
  const c = run('L2', layers.l2.length);
  return {
    l0Ms: a.cumMs, l1Ms: b.cumMs, l2Ms: c.cumMs,
    attempts: a.attempts + b.attempts + c.attempts,
    events,
  };
}

function percentile(sorted, q) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
  return sorted[idx];
}

/**
 * 蒙特卡洛 N 次：统计 TTFA（首个可行动信息）、完整送达、窗口内成功率
 */
export function monteCarlo({ jsonBytes, layers, cfg, runs = 300, seed = 20261013, windowMs = 30000 }) {
  const rng = mulberry32(seed);
  const jsonT = [], jsonAttempts = [], l0T = [], l2T = [], l1T = [];
  let jsonOk = 0, l0Ok = 0, l2Ok = 0;
  for (let i = 0; i < runs; i++) {
    const r = simulateMessage(jsonBytes, cfg, mulberry32(rng() * 2 ** 32 >>> 0));
    jsonT.push(r.timeMs); jsonAttempts.push(r.attempts);
    if (r.timeMs <= windowMs) jsonOk++;

    const lr = simulateLayers(layers, cfg, mulberry32(rng() * 2 ** 32 >>> 0));
    l0T.push(lr.l0Ms); l1T.push(lr.l1Ms); l2T.push(lr.l2Ms);
    if (lr.l0Ms <= windowMs) l0Ok++;
    if (lr.l2Ms <= windowMs) l2Ok++;
  }
  const sort = (a) => a.slice().sort((x, y) => x - y);
  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  return {
    runs,
    windowMs,
    json: {
      meanMs: mean(jsonT), p50: percentile(sort(jsonT), 0.5), p95: percentile(sort(jsonT), 0.95),
      successRate: jsonOk / runs,
      attempts: mean(jsonAttempts),
    },
    layered: {
      l0: { meanMs: mean(l0T), p50: percentile(sort(l0T), 0.5), p95: percentile(sort(l0T), 0.95), successRate: l0Ok / runs },
      l1: { meanMs: mean(l1T), p50: percentile(sort(l1T), 0.5), p95: percentile(sort(l1T), 0.95) },
      l2: { meanMs: mean(l2T), p50: percentile(sort(l2T), 0.5), p95: percentile(sort(l2T), 0.95), successRate: l2Ok / runs },
    },
  };
}

/** 解析近似值（用于交叉验证蒙特卡洛）：每包期望发送次数 1/(1-loss) */
export function analyticExpectedMs(bytes, cfg) {
  const S = cfg.packetSize;
  const n = Math.ceil(bytes / S);
  let total = 0;
  for (let i = 0; i < n; i++) {
    const piece = Math.min(S, bytes - i * S);
    const txMs = (piece * 8) / cfg.bps * 1000;
    total += (txMs + cfg.rtt) / (1 - cfg.loss);
  }
  return total;
}

/** 一次随机模拟（任务动画用，返回可逐步播放的事件序列） */
export function oneRun(jsonBytes, layers, cfg, seed = 7) {
  const rngA = mulberry32(seed);
  const rngB = mulberry32(seed + 1);
  return {
    json: simulateMessage(jsonBytes, cfg, rngA),
    layered: simulateLayers(layers, cfg, rngB),
  };
}
