/*
 * bit.js — 位级读写引擎 / Bit-level I/O
 * 1% Battery 的第一层基础设施：把数据按"位"而不是"字节"打包。
 * MSB-first（高位在前），与纸面上画出的位串顺序一致，便于教学演示。
 */

export class BitWriter {
  constructor() {
    this.bytes = [];
    this.cur = 0; // 当前正在组装的字节
    this.n = 0;   // 当前字节已写入位数
  }

  writeBit(b) {
    this.cur = (this.cur << 1) | (b & 1);
    this.n++;
    if (this.n === 8) {
      this.bytes.push(this.cur);
      this.cur = 0;
      this.n = 0;
    }
  }

  /** 写入 bits 位无符号整数（bits <= 32） */
  writeUint(value, bits) {
    value = value >>> 0;
    for (let i = bits - 1; i >= 0; i--) this.writeBit((value >>> i) & 1);
  }

  /** 写入有符号整数：先 zigzag 映射为无符号 */
  writeSint(value, bits) {
    const zz = ((value << 1) ^ (value >> 31)) >>> 0;
    this.writeUint(zz, bits);
  }

  writeBytes(data) {
    for (const b of data) this.writeUint(b, 8);
  }

  /** LEB128 无符号变长整数（小整数更省位） */
  writeVarint(value) {
    value = value >>> 0;
    do {
      let b = value & 0x7f;
      value >>>= 7;
      if (value) b |= 0x80;
      this.writeUint(b, 8);
    } while (value);
  }

  finish() {
    if (this.n > 0) {
      this.cur <<= 8 - this.n; // 末字节右侧补 0
      this.bytes.push(this.cur);
      this.cur = 0;
      this.n = 0;
    }
    return Uint8Array.from(this.bytes);
  }

  /** 已写入的总位数（未 finish 时也准确） */
  get bits() {
    return this.bytes.length * 8 + this.n;
  }

  get bytesCount() {
    return this.bytes.length + (this.n > 0 ? 1 : 0);
  }
}

export class BitReader {
  constructor(data) {
    this.data = data;
    this.pos = 0;
    this.cur = 0;
    this.n = 0;
  }

  readBit() {
    if (this.n === 0) {
      if (this.pos >= this.data.length) throw new Error('BitReader: 数据意外结束');
      this.cur = this.data[this.pos++];
      this.n = 8;
    }
    this.n--;
    return (this.cur >>> this.n) & 1;
  }

  readUint(bits) {
    let v = 0;
    for (let i = 0; i < bits; i++) v = (v << 1) | this.readBit();
    return v >>> 0;
  }

  readSint(bits) {
    const zz = this.readUint(bits);
    const signed = (zz >>> 1) ^ -(zz & 1);
    return signed;
  }

  readBytes(len) {
    const out = new Uint8Array(len);
    for (let i = 0; i < len; i++) out[i] = this.readUint(8);
    return out;
  }

  readVarint() {
    let v = 0, s = 0, b;
    do {
      b = this.readUint(8);
      v |= (b & 0x7f) << s;
      s += 7;
    } while (b & 0x80);
    return v >>> 0;
  }

  /** 丢弃当前字节剩余位，回到字节边界（表头填充位之后使用） */
  alignToByte() {
    this.n = 0;
  }
}

/** 把实数线性映射到 bits 位无符号定点整数 */
export function encodeFixed(value, min, max, bits) {
  const maxIndex = (1 << bits) - 1;
  let t = (value - min) / (max - min);
  t = Math.max(0, Math.min(1, t));
  return Math.round(t * maxIndex);
}

/** 定点整数还原为实数（返回区间中点，量化误差有界） */
export function decodeFixed(index, min, max, bits) {
  const maxIndex = (1 << bits) - 1;
  return min + (index / maxIndex) * (max - min);
}

/** 可复现的伪随机数（mulberry32），让所有"网络模拟"结果可以复现 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function bytesToHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join(' ');
}

export function bytesToAscii(bytes) {
  return Array.from(bytes).map((b) => (b >= 32 && b < 127) ? String.fromCharCode(b) : '·').join('');
}
