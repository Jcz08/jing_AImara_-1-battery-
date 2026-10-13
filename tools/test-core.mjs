/* 核心算法自测：node tools/test-core.mjs */
import { BitWriter, BitReader, encodeFixed, decodeFixed, mulberry32 } from '../js/bit.js';
import {
  encodeDynamic, decodeDynamic, getStaticModel, encodeStatic, decodeStatic,
  canonicalCodes, codeLengthsFromFreq,
} from '../js/huffman.js';
import {
  encodeJSON, encodeMonolithic, decodeMonolithic, encodeLayers,
  decodeLayersProgressively, encodeL2Dynamic, roundTripOK,
} from '../js/protocol.js';
import { monteCarlo, analyticExpectedMs, simulateMessage } from '../js/network.js';
import { SCENARIOS } from '../js/phrasebook.js';

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  PASS', label); }
  else { fail++; console.error('  FAIL', label); }
}

// 1. 位读写往返
{
  const w = new BitWriter();
  w.writeUint(0b10110, 5);
  w.writeUint(0b1110101, 7);
  w.writeVarint(300);
  const data = w.finish();
  const r = new BitReader(data);
  assert(r.readUint(5) === 0b10110, 'BitWriter/Reader 5bit');
  assert(r.readUint(7) === 0b1110101, 'BitWriter/Reader 7bit');
  assert(r.readVarint() === 300, 'varint 300');
}

// 2. 定点坐标量化精度
{
  const lat = 22.2543, lon = 113.5321;
  const li = encodeFixed(lat, -90, 90, 25);
  const back = decodeFixed(li, -90, 90, 25);
  assert(Math.abs(back - lat) < 6e-6, `定点纬度误差 < 6e-6° (实际 ${Math.abs(back - lat).toExponential(2)})`);
}

// 3. 动态 Huffman 往返（中文）
{
  const text = '两人重伤，需要医疗与饮用水，我们在溪谷东侧的巨石下避雨。';
  const d = encodeDynamic(text);
  const back = decodeDynamic(d.data);
  assert(back === text, `动态 Huffman 中文往返 (${d.data.length}B 载荷, 表头 ${d.headerBytes}B)`);
}

// 4. 静态 Huffman 往返
{
  const model = getStaticModel();
  const text = '七人被困山腰平台，需要药品与毯子，坐标见报文，手机快没电了。';
  const e = encodeStatic(text);
  const back = decodeStatic(e.data, e.bits);
  assert(back === text, `静态 Huffman 中文往返 (${e.data.length}B vs ${e.rawBytes}B, 模型 ${model.modelBytes}B 预装)`);
}

// 5. 三个场景：所有编码往返
for (const sc of SCENARIOS) {
  const m = { ts: 1760380000, ...sc.msg };
  const rt = roundTripOK(m);
  assert(rt.monolithic, `[${sc.id}] 单体位打包往返`);
  assert(rt.layered, `[${sc.id}] 三层协议往返`);
}

// 6. 体积对比
{
  const m = { ts: 1760380000, ...SCENARIOS[0].msg };
  const j = encodeJSON(m);
  const mono = encodeMonolithic(m);
  const layers = encodeLayers(m);
  const dyn = encodeL2Dynamic(m);
  console.log(`\n  样本「${SCENARIOS[0].title}」`);
  console.log(`    JSON      : ${j.length} B`);
  console.log(`    单体位打包 : ${mono.length} B`);
  console.log(`    L0 信标   : ${layers.l0.length} B`);
  console.log(`    L1 定位   : ${layers.l1.length} B`);
  console.log(`    L2 详情   : ${layers.l2.length} B（动态表头版本总 ${dyn.totalBytes} B，表头 ${dyn.headerBytes} B）`);
  console.log(`    三层合计   : ${layers.total} B`);
  console.log(`    压缩比 JSON/三层 : ${(j.length / layers.total).toFixed(2)}×；JSON/L0 : ${(j.length / layers.l0.length).toFixed(2)}×`);
  assert(layers.l0.length <= 6, 'L0 不超过 6 字节');
  assert(layers.l1.length <= 10, 'L1 不超过 10 字节');
  assert(j.length > layers.total * 2, 'JSON 至少是三层协议的 2 倍');
}

// 7. 渐进解码：L0 即可行动
{
  const m = { ts: 1760380000, ...SCENARIOS[1].msg };
  const steps = decodeLayersProgressively(encodeLayers(m));
  assert(steps[0].severity === m.severity && Math.abs(steps[0].lat - m.lat) < 0.003, 'L0 粗坐标误差 < 0.003°');
  assert(steps[1].people === m.people && Math.abs(steps[1].lat - m.lat) < 2e-5, 'L1 精确坐标与人数');
  assert(steps[2].text === m.text, 'L2 文本完整');
}

// 8. 网络模拟：蒙特卡洛 vs 解析近似
{
  const m = { ts: 1760380000, ...SCENARIOS[0].msg };
  const j = encodeJSON(m);
  const layers = encodeLayers(m);
  const cfg = { bps: 600, loss: 0.3, rtt: 1500, packetSize: 32 };
  const mc = monteCarlo({ jsonBytes: j.length, layers, cfg, runs: 300 });
  const aJson = analyticExpectedMs(j.length, cfg);
  const aL0 = analyticExpectedMs(layers.l0.length, cfg);
  console.log(`\n  弱网 600bps / 丢包30% / RTT1.5s（300 次蒙特卡洛）`);
  console.log(`    JSON 完整送达: 均值 ${mc.json.meanMs.toFixed(0)}ms 30秒内成功率 ${(mc.json.successRate * 100).toFixed(1)}% (解析 ${aJson.toFixed(0)}ms)`);
  console.log(`    L0 可行动    : 均值 ${mc.layered.l0.meanMs.toFixed(0)}ms 30秒内成功率 ${(mc.layered.l0.successRate * 100).toFixed(1)}% (解析 ${aL0.toFixed(0)}ms)`);
  assert(Math.abs(mc.json.meanMs - aJson) / aJson < 0.25, 'MC 与解析近似偏差 <25%');
  assert(mc.layered.l0.successRate > mc.json.successRate, 'L0 成功率显著高于整包 JSON');
}

console.log(`\n${fail === 0 ? '全部通过' : '存在失败'}：${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
