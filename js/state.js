/* state.js — 跨章节共享状态（当前演练的求救报文） */
import { SCENARIOS } from './phrasebook.js';

export const state = {
  scenarioId: 'hike',
  message: cloneMessage(SCENARIOS[1].msg),
  network: { bps: 600, loss: 0.3, rtt: 1500, packetSize: 32 },
  budgetJ: 30,
};

function cloneMessage(m) {
  return {
    type: m.type, lat: m.lat, lon: m.lon, people: m.people, severity: m.severity,
    needs: { ...m.needs }, phrases: [...(m.phrases || [])], text: m.text,
  };
}

export function loadScenario(id) {
  const sc = SCENARIOS.find((s) => s.id === id);
  if (!sc) return;
  state.scenarioId = id;
  state.message = cloneMessage(sc.msg);
}

export function messageWithTs() {
  return { ts: Math.floor(Date.now() / 1000), ...state.message };
}
