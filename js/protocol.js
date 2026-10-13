/*
 * protocol.js — 三种求救报文编码 / Three rescue-message encodings
 *
 *  JSON 基线：常规 App 的做法（自描述、冗长、UTF-8 中文 3 字节/字）
 *  单体位打包：把字段按位压缩，但仍要求整包到达才有意义
 *  1% 三层协议：L0 信标 → L1 定位 → L2 详情
 *               越靠前的层越短、越关键；收到任意一层即可行动
 */

import { BitWriter, BitReader, encodeFixed, decodeFixed } from './bit.js';
import { encodeStatic, decodeStatic, getStaticModel, encodeDynamic, decodeDynamic } from './huffman.js';
import { utf8Encoder } from './huffman.js';

/* ---- 位布局常量 ---- */
const B = {
  tag: 2,
  type: 2,
  latFull: 25, lonFull: 26,
  latCoarse: 16, lonCoarse: 16,
  latFine: 9, lonFine: 10,
  ts: 31, people: 7, severity: 2, needs: 6, phrases: 16,
};

const NEED_KEYS = ['medical', 'water', 'food', 'shelter', 'warmth', 'rescue'];

export function needsToBits(needs) {
  let v = 0;
  NEED_KEYS.forEach((k, i) => { if (needs[k]) v |= 1 << (NEED_KEYS.length - 1 - i); });
  return v;
}
export function bitsToNeeds(v) {
  const o = {};
  NEED_KEYS.forEach((k, i) => { o[k] = (v >> (NEED_KEYS.length - 1 - i)) & 1; });
  return o;
}

export function phrasesToBits(ids) {
  let v = 0;
  for (const id of ids) v |= 1 << id;
  return v;
}
export function bitsToPhrases(v) {
  const out = [];
  for (let i = 0; i < 16; i++) if ((v >> i) & 1) out.push(i);
  return out;
}

/* ---------- 1. JSON 基线 ---------- */

export function encodeJSON(m) {
  return utf8Encoder.encode(JSON.stringify(m));
}
export function decodeJSON(bytes) {
  return JSON.parse(new TextDecoder().decode(bytes));
}

/* ---------- 2. 单体位打包（不分级） ---------- */

export function encodeMonolithic(m) {
  const w = new BitWriter();
  w.writeUint(0, B.tag); // 单体包 tag = 0
  w.writeUint(m.type, B.type);
  w.writeUint(encodeFixed(m.lat, -90, 90, B.latFull), B.latFull);
  w.writeUint(encodeFixed(m.lon, -180, 180, B.lonFull), B.lonFull);
  w.writeUint(m.ts >>> 0, B.ts);
  w.writeUint(m.people & 0x7f, B.people);
  w.writeUint(m.severity & 3, B.severity);
  w.writeUint(needsToBits(m.needs), B.needs);
  w.writeUint(phrasesToBits(m.phrases || []), B.phrases);
  const hp = encodeStatic(m.text || '');
  w.writeVarint(hp.bits);
  w.writeBytes(hp.data);
  return w.finish();
}

export function decodeMonolithic(data) {
  const r = new BitReader(data);
  r.readUint(B.tag);
  const m = {};
  m.type = r.readUint(B.type);
  m.lat = decodeFixed(r.readUint(B.latFull), -90, 90, B.latFull);
  m.lon = decodeFixed(r.readUint(B.lonFull), -180, 180, B.lonFull);
  m.ts = r.readUint(B.ts);
  m.people = r.readUint(B.people);
  m.severity = r.readUint(B.severity);
  m.needs = bitsToNeeds(r.readUint(B.needs));
  m.phrases = bitsToPhrases(r.readUint(B.phrases));
  const bitCount = r.readVarint();
  const rest = r.readBytes(data.length - r.pos);
  m.text = bitCount ? decodeStatic(rest, bitCount) : '';
  return m;
}

/* ---------- 3. 1% 三层协议 ---------- */

/** L0 信标：SOS + 数百米级粗坐标 + 严重度，5 字节 */
export function encodeL0(m) {
  const w = new BitWriter();
  w.writeUint(1, B.tag); // 1 = L0
  w.writeUint(m.type, B.type);
  const latI = encodeFixed(m.lat, -90, 90, B.latFull);
  const lonI = encodeFixed(m.lon, -180, 180, B.lonFull);
  w.writeUint(latI >>> B.latFine, B.latCoarse);
  w.writeUint(lonI >>> B.lonFine, B.lonCoarse);
  w.writeUint(m.severity & 3, B.severity);
  return w.finish();
}

export function decodeL0(data) {
  const r = new BitReader(data);
  const tag = r.readUint(B.tag);
  const type = r.readUint(B.type);
  const latC = r.readUint(B.latCoarse);
  const lonC = r.readUint(B.lonCoarse);
  const severity = r.readUint(B.severity);
  // 粗网格中点（量化误差：纬向 ~300m / 经向 ~500m）
  const latI = (latC << B.latFine) | (1 << (B.latFine - 1));
  const lonI = (lonC << B.lonFine) | (1 << (B.lonFine - 1));
  const lat = decodeFixed(latI, -90, 90, B.latFull);
  const lon = decodeFixed(lonI, -180, 180, B.lonFull);
  return {
    _tag: tag, _layer: 0,
    type, severity, latC, lonC, lat, lon,
    latResolutionM: 180 / (1 << B.latCoarse) * 111000,
    lonResolutionM: 360 / (1 << B.lonCoarse) * 111000 * Math.cos(lat * Math.PI / 180),
  };
}

/** L1 定位：精确坐标 + 时间 + 人数 + 需求，9 字节 */
export function encodeL1(m) {
  const w = new BitWriter();
  w.writeUint(2, B.tag); // 2 = L1
  const latI = encodeFixed(m.lat, -90, 90, B.latFull);
  const lonI = encodeFixed(m.lon, -180, 180, B.lonFull);
  w.writeUint(m.ts >>> 0, B.ts);
  w.writeUint(latI & ((1 << B.latFine) - 1), B.latFine);
  w.writeUint(lonI & ((1 << B.lonFine) - 1), B.lonFine);
  w.writeUint(m.people & 0x7f, B.people);
  w.writeUint(needsToBits(m.needs), B.needs);
  return w.finish();
}

/** 合并 L0 + L1：L1 只带差分，必须与 L0 合并 */
export function mergeL1(l0, data) {
  const r = new BitReader(data);
  const tag = r.readUint(B.tag);
  const ts = r.readUint(B.ts);
  const latFine = r.readUint(B.latFine);
  const lonFine = r.readUint(B.lonFine);
  const people = r.readUint(B.people);
  const needs = bitsToNeeds(r.readUint(B.needs));
  const latI = (l0.latC << B.latFine) | latFine;
  const lonI = (l0.lonC << B.lonFine) | lonFine;
  return {
    ...l0, _tag: tag, _layer: 1,
    ts, people, needs,
    lat: decodeFixed(latI, -90, 90, B.latFull),
    lon: decodeFixed(lonI, -180, 180, B.lonFull),
  };
}

/** L2 详情：16 位短语标志 + 静态 Huffman 自由文本 */
export function encodeL2(m) {
  const w = new BitWriter();
  w.writeUint(3, B.tag); // 3 = L2
  w.writeUint(phrasesToBits(m.phrases || []), B.phrases);
  const hp = encodeStatic(m.text || '');
  w.writeVarint(hp.bits);
  w.writeBytes(hp.data);
  return w.finish();
}

export function mergeL2(l1, data) {
  const r = new BitReader(data);
  const tag = r.readUint(B.tag);
  const phraseBits = r.readUint(B.phrases);
  const bitCount = r.readVarint();
  const rest = r.readBytes(data.length - r.pos);
  return {
    ...l1, _tag: tag, _layer: 2,
    phrases: bitsToPhrases(phraseBits),
    text: bitCount ? decodeStatic(rest, bitCount) : '',
  };
}

/** 一次性编码三层 */
export function encodeLayers(m) {
  const l0 = encodeL0(m);
  const l1 = encodeL1(m);
  const l2 = encodeL2(m);
  return {
    l0, l1, l2,
    total: l0.length + l1.length + l2.length,
  };
}

/** 逐层解码（模拟接收端边收边解） */
export function decodeLayersProgressively(layers) {
  const steps = [];
  const p0 = decodeL0(layers.l0);
  steps.push(p0);
  const p1 = mergeL1(p0, layers.l1);
  steps.push(p1);
  const p2 = mergeL2(p1, layers.l2);
  steps.push(p2);
  return steps;
}

/* ---------- 动态 Huffman 对照（用于实验室展示表头代价） ---------- */

export function encodeL2Dynamic(m) {
  const d = encodeDynamic(m.text || '');
  const w = new BitWriter();
  w.writeUint(3, B.tag);
  w.writeUint(phrasesToBits(m.phrases || []), B.phrases);
  const prefix = w.finish();
  const out = new Uint8Array(prefix.length + d.data.length);
  out.set(prefix, 0);
  out.set(d.data, prefix.length);
  return { data: out, headerBytes: d.headerBytes, totalBytes: out.length, modelBytes: getStaticModel().modelBytes };
}

/* ---------- gzip 基线（浏览器原生通用压缩器） ---------- */

export async function encodeGzip(m) {
  if (typeof CompressionStream === 'undefined') return null;
  const raw = encodeJSON(m);
  const cs = new CompressionStream('gzip');
  const stream = new Blob([raw]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/* ---------- 往返一致性校验 ---------- */

export function roundTripOK(m) {
  const mono = decodeMonolithic(encodeMonolithic(m));
  const layers = decodeLayersProgressively(encodeLayers(m));
  const full = layers[2];
  const cmp = (a, b) => Math.abs(a - b) < 2e-5; // 定点量化误差
  return {
    monolithic:
      mono.type === m.type && cmp(mono.lat, m.lat) && cmp(mono.lon, m.lon) &&
      mono.ts === m.ts && mono.people === m.people && mono.severity === m.severity &&
      mono.text === m.text &&
      JSON.stringify(mono.needs) === JSON.stringify(m.needs) &&
      JSON.stringify(mono.phrases) === JSON.stringify(m.phrases || []),
    layered:
      full.type === m.type && cmp(full.lat, m.lat) && cmp(full.lon, m.lon) &&
      full.ts === m.ts && full.people === m.people && full.severity === m.severity &&
      full.text === m.text &&
      JSON.stringify(full.needs) === JSON.stringify(m.needs) &&
      JSON.stringify(full.phrases) === JSON.stringify(m.phrases || []),
    decoded: full,
  };
}

/* ---------- 字段级位标注（供位可视化上色） ---------- */

export function l0FieldSpans() {
  return [
    { key: 'tag', zh: '层标记', bits: B.tag },
    { key: 'type', zh: '报文类型', bits: B.type },
    { key: 'lat', zh: '纬度·粗', bits: B.latCoarse },
    { key: 'lon', zh: '经度·粗', bits: B.lonCoarse },
    { key: 'severity', zh: '严重度', bits: B.severity },
  ];
}
export function l1FieldSpans() {
  return [
    { key: 'tag', zh: '层标记', bits: B.tag },
    { key: 'ts', zh: '时间戳', bits: B.ts },
    { key: 'lat', zh: '纬度·差分', bits: B.latFine },
    { key: 'lon', zh: '经度·差分', bits: B.lonFine },
    { key: 'people', zh: '人数', bits: B.people },
    { key: 'needs', zh: '需求位', bits: B.needs },
  ];
}
