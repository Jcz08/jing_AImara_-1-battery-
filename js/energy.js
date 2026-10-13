/*
 * energy.js — 透明可调的能量模型 / Transparent energy model
 *
 * 重要口径声明：
 *  - 字节数、CPU 耗时、传输耗时：浏览器内【实测】
 *  - 焦耳换算：基于公开文献中手机部件功耗的【数量级模型】，
 *    系数全部可调；不同设备差异很大，但不改变方案间的【倍数关系】
 */

export const ENERGY_MODEL = {
  // 3.8V × 3000mAh ≈ 41 kJ 满电，1% ≈ 410 J
  batteryTotalJ: 41000,
  onePercentJ: 410,
  // 任务预设：低电量保护模式下，扣除待机与系统保活后，
  // 留给本次求救发送的"可支配通信能量"（可调）
  missionBudgetJ: 15,
  // 部件功耗（W）——数量级假设，可在实验室拖动滑块
  pRadio: 0.8,   // 2G/窄带发射平均
  pScreen: 0.4,  // 暗色屏幕最低档
  pCpu: 0.3,     // 旧 SoC 活跃
};

/**
 * 计算一次发送的能量消耗（焦耳）
 * @param {number} radioMs  无线电在线毫秒（含重传）
 * @param {number} cpuMs    编解码 CPU 毫秒（实测）
 * @param {boolean} screenOn 发送期间是否亮屏
 */
export function energyCost(radioMs, cpuMs, screenOn, m = ENERGY_MODEL) {
  const eRadio = (radioMs / 1000) * m.pRadio;
  const eScreen = screenOn ? (radioMs / 1000) * m.pScreen : 0;
  const eCpu = (cpuMs / 1000) * m.pCpu;
  return {
    radio: eRadio,
    screen: eScreen,
    cpu: eCpu,
    total: eRadio + eScreen + eCpu,
  };
}

/** 实测量（ms）与模型量（J）的标签，UI 统一引用，避免口径混淆 */
export const PROVENANCE = {
  measured: '实测',
  model: '模型估算',
};
