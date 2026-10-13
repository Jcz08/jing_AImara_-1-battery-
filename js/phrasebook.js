/*
 * phrasebook.js — 协议级共享短语词典 / Shared protocol phrase dictionary
 *
 * 这是"智能缓存"的体现：通信双方在 App 里预装同一本应急短语词典，
 * 常见句子只需要发送 1 个标志位，而不是几十个 UTF-8 字节。
 * 真实世界里的对应设计：短信应急码、警务/消防 10-code、
 * 以及 Brotli 压缩内置的静态字典。
 */

export const PHRASES = [
  { id: 0,  zh: '有人重伤，急需医疗救助', en: 'Critical injury, medical aid needed' },
  { id: 1,  zh: '有轻伤，需要药品',         en: 'Minor injuries, medicine needed' },
  { id: 2,  zh: '需要饮用水',               en: 'Need drinking water' },
  { id: 3,  zh: '需要食物',                 en: 'Need food' },
  { id: 4,  zh: '需要保暖衣物与毯子',       en: 'Need warm clothes and blankets' },
  { id: 5,  zh: '有老人和儿童',             en: 'Elderly and children present' },
  { id: 6,  zh: '手机电量即将耗尽',         en: 'Phone battery almost depleted' },
  { id: 7,  zh: '道路塌方无法通行',         en: 'Road blocked by landslide' },
  { id: 8,  zh: '我们被困无法移动',         en: 'Trapped, unable to move' },
  { id: 9,  zh: '已找到安全避险点',         en: 'Found safe shelter' },
  { id: 10, zh: '有人失联',                 en: 'Person missing' },
  { id: 11, zh: '需要照明与电源',           en: 'Need light and power' },
  { id: 12, zh: '可以行动，等待接应',       en: 'Can move, awaiting extraction' },
  { id: 13, zh: '请保持信号，不要关机',     en: 'Keep signal, do not power off' },
  { id: 14, zh: '附近有水源',               en: 'Water source nearby' },
  { id: 15, zh: '请求医疗直升机',           en: 'Request medical helicopter' },
];

export const NEEDS = [
  { id: 'medical', zh: '医疗', en: 'medical' },
  { id: 'water',   zh: '饮水', en: 'water' },
  { id: 'food',    zh: '食物', en: 'food' },
  { id: 'shelter', zh: '避险', en: 'shelter' },
  { id: 'warmth',  zh: '保暖', en: 'warmth' },
  { id: 'rescue',  zh: '转移', en: 'rescue' },
];

export const MSG_TYPES = [
  { id: 0, key: 'SOS',  zh: '求救', en: 'SOS' },
  { id: 1, key: 'INFO', zh: '通报', en: 'info' },
  { id: 2, key: 'OK',   zh: '平安', en: 'safe' },
];

export const SEVERITY = [
  { id: 0, zh: '安全', en: 'safe' },
  { id: 1, zh: '轻伤', en: 'minor' },
  { id: 2, zh: '重伤', en: 'serious' },
  { id: 3, zh: '危急', en: 'critical' },
];

/**
 * 静态 Huffman 模型的训练语料：
 * 词典全文 + 模拟求救自由文本样本。
 * 模型本身在 App 里只保存一次（双方共享），相当于"预同步字典"。
 */
export const STATIC_CORPUS = [
  ...PHRASES.map((p) => p.zh),
  ...PHRASES.map((p) => p.en),
  '我们在溪谷东侧的巨石下避雨，能见度很低，等待救援。',
  '两人轻伤一人重伤，急需饮用水与医疗包，坐标见报文。',
  '山路塌方，七人被困山腰平台，有老人，请尽快转移。',
  '手机只剩百分之一电量，信号微弱，收到请回复。',
  'Two injured, one critical. Need water and medics. Coordinates attached.',
  'Landslide blocked the trail. Seven people stranded, including a child.',
  'Battery at one percent, weak signal. Shelter found near the stream.',
  '请救援队沿溪谷向上搜索，我们在巨石下方，有红色衣物做标记。',
  '紧急求救，海拔较高，夜间失温风险大，需要保暖物资。',
];

/** 任务场景的预设（模拟数据，明确标注） */
export const SCENARIOS = [
  {
    id: 'quake',
    title: '地震后的村落',
    titleEn: 'Village after the earthquake',
    desc: '地震后基站大面积损毁，网络接近 2G 短信带宽，你所在的临时安置点有伤员，必须把伤情与位置送出。',
    msg: {
      type: 0, lat: 31.0603, lon: 103.3675, people: 23, severity: 3,
      needs: { medical: 1, water: 1, food: 0, shelter: 1, warmth: 1, rescue: 1 },
      phrases: [0, 2, 5, 6],
      text: '安置点有两名重伤员，需要医疗与饮用水，夜间降温，需要毯子。',
    },
  },
  {
    id: 'hike',
    title: '断电的山野徒步',
    titleEn: 'Off-grid hike',
    desc: '徒步途中队友骨折，手机电量 1%，山谷中只有极弱的窄带信号。你要在关机前把精确位置和伤情发出去。',
    msg: {
      type: 0, lat: 22.2543, lon: 113.5321, people: 4, severity: 2,
      needs: { medical: 1, water: 0, food: 0, shelter: 0, warmth: 1, rescue: 1 },
      phrases: [0, 8, 13],
      text: '队友小腿骨折无法移动，我们在溪谷东侧巨石下，需要担架转移。',
    },
  },
  {
    id: 'storm',
    title: '台风中的孤岛',
    titleEn: 'Island during the typhoon',
    desc: '台风导致停电与断网，岛上药店的库存将尽，需要把药品清单与人数通过时断时续的卫星短报文送出。',
    msg: {
      type: 1, lat: 22.1821, lon: 113.5677, people: 41, severity: 1,
      needs: { medical: 1, water: 1, food: 1, shelter: 0, warmth: 0, rescue: 0 },
      phrases: [1, 2, 11, 14],
      text: '岛上四十一人，常用药将尽，附近有水源，请求补充药品与食物。',
    },
  },
];
