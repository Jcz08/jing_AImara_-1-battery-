/*
 * huffman.js — 从零实现的 Huffman 压缩 / From-scratch Huffman coding
 *
 * 两种模式，刻意都展示出来：
 *  1) 动态模型：每条消息现算频率，频率表作为表头一起发送，
 *     短文本里表头可能比省下的字节还多——这是真实的工程代价。
 *  2) 静态模型：用应急语料提前训练一次，模型随 App 预装（双方共享），
 *     相当于"智能缓存"，单条消息零表头。
 *
 * 全程操作 UTF-8 字节（不是字符），保证数据口径与真实传输一致。
 */

import { BitWriter, BitReader } from './bit.js';
import { STATIC_CORPUS } from './phrasebook.js';

/* ---------- 频度统计 ---------- */

function byteFrequency(bytes) {
  const freq = new Uint32Array(256);
  for (const b of bytes) freq[b]++;
  return freq;
}

/* ---------- 最小堆（构造 Huffman 树） ---------- */

class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(node) {
    const a = this.a;
    a.push(node);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].freq <= a[i].freq) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l].freq < a[m].freq) m = l;
        if (r < a.length && a[r].freq < a[m].freq) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/** 构造 Huffman 树，返回根节点（叶子 {freq,sym}，内部节点 {freq,sym:-1,left,right}） */
export function buildHuffmanTree(freq) {
  const heap = new MinHeap();
  let present = 0;
  for (let s = 0; s < 256; s++) if (freq[s] > 0) { heap.push({ freq: freq[s], sym: s }); present++; }
  if (present === 0) return null;
  if (present === 1) {
    const only = heap.pop();
    return { freq: only.freq, sym: -1, left: only, right: null };
  }
  while (heap.size > 1) {
    const a = heap.pop();
    const b = heap.pop();
    heap.push({ freq: a.freq + b.freq, sym: -1, left: a, right: b });
  }
  return heap.pop();
}

/**
 * 由频度数组计算每个字节的码长（树深）
 * 返回长度 256 的数组，0 表示该符号未出现
 */
export function codeLengthsFromFreq(freq) {
  const root = buildHuffmanTree(freq);
  if (!root) return new Uint8Array(256);
  const lens = new Uint8Array(256);
  (function walk(node, depth) {
    if (!node) return;
    if (node.sym >= 0) { lens[node.sym] = Math.max(1, depth); return; }
    walk(node.left, depth + 1);
    walk(node.right, depth + 1);
  })(root, 0);
  return lens;
}

/**
 * 由码长生成规范 Huffman 码（canonical codes）
 * 返回 Uint16 数组 code[256]，另有长度数组；未出现的符号 code 为 -1
 */
export function canonicalCodes(lengths) {
  const maxLen = Math.max(1, ...lengths);
  const blCount = new Uint32Array(maxLen + 1);
  for (let s = 0; s < 256; s++) if (lengths[s]) blCount[lengths[s]]++;

  const nextCode = new Uint32Array(maxLen + 1);
  let code = 0;
  for (let bits = 1; bits <= maxLen; bits++) {
    code = (code + blCount[bits - 1]) << 1;
    nextCode[bits] = code;
  }

  const codes = new Int32Array(256).fill(-1);
  for (let s = 0; s < 256; s++) {
    const len = lengths[s];
    if (len) {
      codes[s] = nextCode[len];
      nextCode[len]++;
    }
  }
  return codes;
}

/** 用现成模型编码，返回 { bits, data: Uint8Array }（不含任何表头） */
export function encodeWithModel(bytes, lengths, codes) {
  const w = new BitWriter();
  for (const b of bytes) {
    const len = lengths[b];
    if (!len) throw new Error('静态模型缺少符号 ' + b + '，无法编码');
    w.writeUint(codes[b], len);
  }
  return { bits: w.bits, data: w.finish() };
}

/** 用现成模型解码，bitCount 为有效载荷位数（末字节可能有填充） */
export function decodeWithModel(data, bitCount, lengths) {
  // 规范码（canonical）按 (码长, firstCode) 排序，可用偏移表直接定位符号
  const maxLen = Math.max(1, ...lengths);
  const blCount = new Uint32Array(maxLen + 1);
  for (let s = 0; s < 256; s++) if (lengths[s]) blCount[lengths[s]]++;
  const firstCode = new Int32Array(maxLen + 1).fill(-1);
  let c = 0;
  for (let bits = 1; bits <= maxLen; bits++) {
    c = (c + blCount[bits - 1]) << 1;
    if (blCount[bits]) firstCode[bits] = c;
  }
  // 每个码长下按符号排序，index = code - firstCode
  const byLen = {};
  for (let s = 0; s < 256; s++) {
    const len = lengths[s];
    if (len) {
      (byLen[len] ||= []).push(s);
    }
  }
  for (const len of Object.keys(byLen)) byLen[len].sort((a, b) => a - b);

  const r = new BitReader(data);
  const out = [];
  let read = 0;
  let cur = 0, curLen = 0;
  while (read < bitCount) {
    cur = (cur << 1) | r.readBit();
    curLen++;
    read++;
    if (curLen <= maxLen && firstCode[curLen] >= 0 && cur >= firstCode[curLen]) {
      const idx = cur - firstCode[curLen];
      const syms = byLen[curLen];
      if (idx < syms.length) {
        out.push(syms[idx]);
        cur = 0; curLen = 0;
      }
    }
  }
  return Uint8Array.from(out);
}

/* ---------- 动态模型：表头 + 载荷 ---------- */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * 动态 Huffman 编码：
 *   表头 = varint(符号数) + [symbol(8) + codelen(5)] × n
 *   载荷 = varint(有效位数) + 压缩位流
 */
export function encodeDynamic(text) {
  const bytes = encoder.encode(text);
  if (bytes.length === 0) return { data: new Uint8Array([0]), payloadBits: 0, headerBytes: 1, model: null };

  const freq = byteFrequency(bytes);
  const lengths = codeLengthsFromFreq(freq);
  const codes = canonicalCodes(lengths);
  const payload = encodeWithModel(bytes, lengths, codes);

  const w = new BitWriter();
  const present = [];
  for (let s = 0; s < 256; s++) if (lengths[s]) present.push(s);
  w.writeVarint(present.length);
  for (const s of present) {
    w.writeUint(s, 8);
    w.writeUint(lengths[s], 5);
  }
  const header = w.finish();

  const body = new BitWriter();
  body.writeVarint(payload.bits);
  body.writeBytes(payload.data);
  const bodyBytes = body.finish();

  const data = new Uint8Array(header.length + bodyBytes.length);
  data.set(header, 0);
  data.set(bodyBytes, header.length);
  return {
    data,
    payloadBits: payload.bits,
    headerBytes: header.length,
    payloadBytes: bodyBytes.length,
    rawBytes: bytes.length,
    model: { lengths, codes },
  };
}

export function decodeDynamic(data) {
  const r = new BitReader(data);
  const n = r.readVarint();
  if (n === 0) return '';
  const lengths = new Uint8Array(256);
  for (let i = 0; i < n; i++) {
    const s = r.readUint(8);
    lengths[s] = r.readUint(5);
  }
  r.alignToByte(); // 表头末字节有填充位，跳过后进入载荷
  const bitCount = r.readVarint();
  // 剩余字节
  const rest = r.readBytes(data.length - r.pos);
  const out = decodeWithModel(rest, bitCount, lengths);
  return decoder.decode(out);
}

/* ---------- 静态模型：语料预训练 ---------- */

let staticModelCache = null;

export function getStaticModel() {
  if (staticModelCache) return staticModelCache;
  const corpusBytes = encoder.encode(STATIC_CORPUS.join('\n'));
  const freq = byteFrequency(corpusBytes);
  // 保证所有可打印 ASCII + 常见中文 UTF-8 尾字节可编码；
  // 对语料未覆盖的字节用加一平滑，避免编码失败。
  for (let s = 0; s < 256; s++) freq[s] = Math.max(1, freq[s]);
  const lengths = codeLengthsFromFreq(freq);
  const codes = canonicalCodes(lengths);

  // 模型自身序列化大小（随 App 预装，只需传输一次）
  const w = new BitWriter();
  let count = 0;
  for (let s = 0; s < 256; s++) if (lengths[s]) count++;
  w.writeVarint(count);
  for (let s = 0; s < 256; s++) {
    if (lengths[s]) { w.writeUint(s, 8); w.writeUint(lengths[s], 5); }
  }
  const modelBytes = w.finish();
  staticModelCache = { lengths, codes, modelBytes: modelBytes.length };
  return staticModelCache;
}

export function encodeStatic(text) {
  const model = getStaticModel();
  const bytes = encoder.encode(text);
  if (bytes.length === 0) return { data: new Uint8Array(0), bits: 0, rawBytes: 0 };
  const packed = encodeWithModel(bytes, model.lengths, model.codes);
  return { data: packed.data, bits: packed.bits, rawBytes: bytes.length };
}

export function decodeStatic(data, bitCount) {
  const model = getStaticModel();
  const out = decodeWithModel(data, bitCount, model.lengths);
  return decoder.decode(out);
}

export { encoder as utf8Encoder, decoder as utf8Decoder };
